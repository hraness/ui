import assert from "node:assert/strict";
import { resolve } from "node:path";

import { describe, test } from "bun:test";
import { sha256 } from "./compiler.js";
import { STYLEX_NEXT_EMPTY_ENTRY_LOADER } from "./next-contracts.js";

import {
  assertStylexNextAuxiliaryTraceOwnership,
  resolveStylexNextOutputPath,
  requireStylexNextChunkMaps,
  stylexNextJavaScriptChunks,
  stylexCssFilesForEntrypoint,
  stylexNextEntrypointReceipts,
  stylexNextExtractedCssChunks,
  stylexNextCssInputPaths,
  validateStylexNextCompilationCoverage,
  validateStylexNextPluginPlan,
  validateStylexNextSourceCensus,
  captureStylexNextEmptyEntryGraph,
  type StylexNextWebpackChunk,
} from "./next-plugin.js";

describe("StyleX Next output provenance", () => {
  test("CSS input identities survive cached extraction without ordinary nested modules", () => {
    const root = "/fixture";
    const foundation = "/fixture/node_modules/public-ui/compiler-foundation.css";
    const nested = ["compiler-reset.css", "components.css", "tokens.css"]
      .map((name) => `/fixture/node_modules/public-ui/${name}`);
    const extracted = (source: string) => ({
      type: "css/mini-extract", nameForCondition: () => source,
      getSourceTypes: () => new Set(["css/mini-extract"]),
    });
    const shared = [{ resource: foundation }, extracted(foundation), ...nested.map(extracted)];
    const cold = [...shared, ...nested.map((resource) => ({ resource }))];
    const expected = [foundation, ...nested].map((path) => path.slice(root.length + 1)).sort();
    assert.deepEqual(stylexNextCssInputPaths(root, cold), expected);
    assert.deepEqual(stylexNextCssInputPaths(root, shared), expected);
    assert.deepEqual(stylexNextCssInputPaths(root, [...shared].reverse()), expected);
    assert.deepEqual(stylexNextCssInputPaths(root, [...shared, extracted(nested[0]!)]), expected);
  });

  test("CSS input census rejects malformed extracted identities and ignores unrelated naming methods", () => {
    const root = "/fixture";
    const source = "/fixture/app/site.css";
    const extracted = {
      type: "css/mini-extract", nameForCondition: () => source,
      getSourceTypes: () => new Set(["css/mini-extract"]),
    };
    for (const invalid of [
      { ...extracted, nameForCondition: undefined },
      { ...extracted, nameForCondition: () => null },
      { ...extracted, nameForCondition: () => "app/site.css" },
      { ...extracted, nameForCondition: () => "/other/site.css" },
      { ...extracted, nameForCondition: () => "/fixture/app/../site.css" },
      { ...extracted, nameForCondition: () => "/fixture/app/site.css?different" },
      { ...extracted, nameForCondition: () => "/fixture/app/site.css#different" },
      { ...extracted, nameForCondition: () => "/fixture/app/si\0te.css" },
      { ...extracted, nameForCondition: () => "/fixture/app/site.js" },
      { ...extracted, getSourceTypes: undefined },
      { ...extracted, getSourceTypes: () => new Set(["css/mini-extract", "javascript"]) },
      { ...extracted, resource: "/fixture/app/other.css" },
    ]) assert.throws(() => stylexNextCssInputPaths(root, [invalid] as never), /extracted CSS/);
    const unrelated = {
      type: "javascript/auto",
      nameForCondition(): never { throw new Error("An unrelated module is not CSS input authority"); },
    };
    assert.deepEqual(stylexNextCssInputPaths(root, [unrelated]), []);
    assert.deepEqual(stylexNextCssInputPaths(root, [{ ...unrelated, resource: source }]), ["app/site.css"]);
    assert.deepEqual(stylexNextCssInputPaths(root, [{ type: "css/unknown", nameForCondition: () => source }]), []);
  });

  test("auxiliary dependency traces cannot relabel synchronous, lazy, or module-linked resources", () => {
    const output = "/fixture/.next/server/chunks";
    const name = "../app/page.js.nft.json";
    const asset = { name, info: {} };
    assertStylexNextAuxiliaryTraceOwnership({ chunks: [{ files: ["../app/page.js"] }], modules: [] }, asset, output);
    for (const compilation of [
      { chunks: [{ files: [name] }], modules: [] },
      { chunks: [{ files: [] }, { files: [], auxiliaryFiles: [name] }], modules: [] },
      { chunks: [], modules: [{ buildInfo: { assets: { [name]: {} } } }] },
      { chunks: [], modules: [{ buildInfo: { assetsInfo: new Map([[name, {}]]) } }] },
    ]) assert.throws(() => assertStylexNextAuxiliaryTraceOwnership(compilation, asset, output), /cannot become/);
    assert.throws(() => assertStylexNextAuxiliaryTraceOwnership({ chunks: [], modules: [] }, { name, info: { sourceFilename: "source.json" } }, output), /cannot become/);
    assert.throws(() => assertStylexNextAuxiliaryTraceOwnership({ chunks: [], modules: [{ buildInfo: { assetsInfo: {} } }] }, asset, output), /must be a Map/);
    assertStylexNextAuxiliaryTraceOwnership({ chunks: [{ files: [], auxiliaryFiles: ["../other.json"] }], modules: [{ buildInfo: { assets: { "../other.json": {} }, assetsInfo: new Map([["../other.json", {}]]) } }] }, asset, output);
  });
  test("entrypoint receipts include only registered transitive startup and stylesheet dependencies", () => {
    const root = resolve("/fixture/.next");
    type Group = { chunks: StylexNextWebpackChunk[]; parentsIterable: Group[] };
    const entry = (files: string[], parentsIterable: Group[] = []) => ({
      chunks: [{ files }], parentsIterable, getFiles: () => files, getRuntimeChunk: () => null,
    });
    const grandparent = entry(["static/shared.js", "static/shared.css"]);
    const parent = entry(["static/layout.js"], [grandparent]);
    const unrelated = entry(["static/unrelated.js", "static/unrelated.css"]);
    const ordinary: Group = { chunks: [{ files: ["static/ordinary-group.js"] }], parentsIterable: [unrelated] };
    const leaf = entry(["static/page.js"], [parent, ordinary]);
    const compilation = {
      asyncEntrypoints: [grandparent],
      entrypoints: new Map([["app/page", leaf], ["app/layout", parent], ["app/unrelated", unrelated]]),
    };
    const receipt = () => stylexNextEntrypointReceipts(compilation as never, root, root).find(({ name }) => name === "app/page");
    assert.deepEqual(receipt(), {
      name: "app/page", css: ["static/shared.css"], stylexCss: [],
      files: ["static/layout.js", "static/page.js", "static/shared.css", "static/shared.js"],
      javascript: ["static/layout.js", "static/page.js", "static/shared.js"],
    });
    assert.deepEqual(stylexCssFilesForEntrypoint(leaf, new Set(grandparent.chunks), root, root, "app/page", [leaf, parent, grandparent]), ["static/shared.css"]);
    assert.throws(() => stylexCssFilesForEntrypoint(leaf, new Set(unrelated.chunks), root, root, "app/page", [leaf, parent, grandparent]), /does not include/u);
    // A diamond or even a cyclic untrusted registry cannot expand the walk.
    leaf.parentsIterable.push(grandparent);
    grandparent.parentsIterable.push(leaf);
    assert.equal(receipt()?.files.length, 4);
    grandparent.parentsIterable = [];
    compilation.asyncEntrypoints = [];
    assert.throws(receipt, /differs from the compilation registry/u);
    compilation.asyncEntrypoints = [grandparent, leaf];
    assert.throws(receipt, /registries overlap/u);
  });

  test("requires the real empty loader, original source, entry module and startup chunk graph", () => {
    const root = resolve("/fixture");
    const outputRoot = resolve(root, ".next");
    type FixtureChunk = {
      files: string[];
      hasRuntime(): boolean;
      id: number;
      ids: number[];
    };
    type FixtureGroup = {
      chunks: FixtureChunk[];
      parentsIterable: FixtureGroup[];
    };
    type FixtureEntrypoint = FixtureGroup & {
      getFiles(): string[];
      getRuntimeChunk(): FixtureChunk | null;
    };
    const fixture = () => {
      const module = {
        blocks: [], dependencies: [], layer: "app-pages-browser", type: "javascript/auto",
        loaders: [{ loader: resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER), options: "server=false" }],
        request: `${resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER)}?server=false!`,
        originalSource: () => ({ source: () => "", map: (): unknown => null }),
      };
      const chunk = { files: ["static/empty.js"], id: 167, ids: [167], hasRuntime: () => false };
      const cssChunk = { files: ["static/recipes.css"], id: 625, ids: [625], hasRuntime: () => false };
      const cssModule = { type: "css/mini-extract", getSourceTypes: () => new Set(["css/mini-extract"]) };
      const runtime = { files: ["static/runtime.js"], id: 99, ids: [99], hasRuntime: () => true };
      const dependency = { files: ["static/dependency-a.js"], id: 441, ids: [441], hasRuntime: () => false };
      const sibling = { files: ["static/dependency-b.js"], id: 794, ids: [794], hasRuntime: () => false };
      const ancestor = { files: ["static/dependency-c.js"], id: 358, ids: [358], hasRuntime: () => false };
      const ordinaryGroup: FixtureGroup = { chunks: [], parentsIterable: [] };
      const grandparent: FixtureEntrypoint = {
        chunks: [runtime, sibling, ancestor],
        getFiles: () => [runtime, sibling, ancestor].flatMap((item) => item.files),
        getRuntimeChunk: () => runtime,
        parentsIterable: [],
      };
      const parent: FixtureEntrypoint = {
        chunks: [runtime, dependency, sibling],
        getFiles: () => [runtime, dependency, sibling].flatMap((item) => item.files),
        getRuntimeChunk: () => runtime,
        parentsIterable: [grandparent],
      };
      const group: FixtureEntrypoint = {
        chunks: [runtime, chunk],
        getFiles: () => [runtime, chunk].flatMap((item) => item.files),
        getRuntimeChunk: () => runtime,
        parentsIterable: [ordinaryGroup, parent],
      };
      const compilation = {
        asyncEntrypoints: [grandparent],
        chunkGraph: {
          getModuleChunksIterable: () => [chunk],
          getChunkModulesIterable: (candidate: FixtureChunk): (typeof cssModule | typeof module)[] => candidate === cssChunk ? [cssModule] : [module],
          getChunkModulesIterableBySourceType: (candidate: FixtureChunk, sourceType: string) =>
            candidate === cssChunk && sourceType === "css/mini-extract" ? [cssModule] : undefined,
          getChunkRuntimeModulesIterable: (_candidate: FixtureChunk): unknown[] => [],
          getChunkEntryModulesWithChunkGroupIterable: (candidate: FixtureChunk) => candidate === cssChunk ? [] : [[module, group] as const],
          getModuleId: () => 4441,
        },
        entrypoints: new Map<string, FixtureEntrypoint>([["app/empty", group], ["shared", parent]]),
      };
      return { ancestor, chunk, compilation, cssChunk, cssModule, dependency, grandparent, group, module, ordinaryGroup, parent, runtime, sibling };
    };
    const capture = (value: ReturnType<typeof fixture>) => captureStylexNextEmptyEntryGraph(value.compilation as never, value.chunk, root, outputRoot, outputRoot, "static/empty.js");
    assert.deepEqual(capture(fixture()), {
      chunkIds: [167], dependencies: [
        { cssFiles: [], files: ["static/dependency-a.js"], id: 441 },
        { cssFiles: [], files: ["static/dependency-b.js"], id: 794 },
        { cssFiles: [], files: ["static/dependency-c.js"], id: 358 },
      ], entryModuleId: 4441,
      entrypoints: ["app/empty"], loader: STYLEX_NEXT_EMPTY_ENTRY_LOADER, loaderOptions: "server=false",
      originalSource: { bytes: 0, sha256: sha256("") },
    });
    const independent = fixture();
    independent.group.parentsIterable = [];
    assert.deepEqual(capture(independent).dependencies, []);
    const runtimeFlaggedSibling = fixture();
    runtimeFlaggedSibling.dependency.hasRuntime = () => true;
    assert.deepEqual(capture(runtimeFlaggedSibling).dependencies.map(({ id }) => id), [441, 794, 358]);
    const withCss = () => {
      const value = fixture();
      value.group.chunks.splice(1, 0, value.cssChunk);
      return value;
    };
    const nativeCss = capture(withCss());
    assert.deepEqual(nativeCss.dependencies, [
      { cssFiles: ["static/recipes.css"], files: [], id: 625 },
      ...capture(fixture()).dependencies,
    ], "Native CSS-only startup ID and order must remain in the bootstrap proof");
    const mixed = fixture();
    mixed.dependency.files.push("static/recipes.css");
    mixed.compilation.chunkGraph.getChunkModulesIterableBySourceType = (candidate, sourceType) =>
      candidate === mixed.dependency && sourceType === "css/mini-extract" ? [mixed.cssModule] : undefined;
    mixed.compilation.chunkGraph.getChunkModulesIterable = (candidate) =>
      candidate === mixed.dependency ? [mixed.cssModule, mixed.module] : [mixed.module];
    assert.deepEqual(capture(mixed).dependencies[0], { cssFiles: ["static/recipes.css"], files: ["static/dependency-a.js"], id: 441 });
    const cssAttacks: ((value: ReturnType<typeof fixture>) => void)[] = [
      ({ cssChunk }) => { cssChunk.files = []; },
      ({ cssChunk }) => { cssChunk.files = ["static/recipes.wasm"]; },
      ({ cssChunk }) => { cssChunk.files.push("static/recipes.json"); },
      ({ cssChunk }) => { cssChunk.files.push("static/recipes.css"); },
      ({ cssChunk }) => { cssChunk.files = ["../outside.css"]; },
      ({ cssChunk }) => { cssChunk.hasRuntime = () => true; },
      ({ cssModule }) => { cssModule.type = "javascript/auto"; },
      ({ cssModule }) => { cssModule.getSourceTypes = () => new Set(["css/mini-extract", "javascript"]); },
      ({ cssModule }) => { cssModule.getSourceTypes = () => new Set(); },
      ({ compilation }) => { compilation.chunkGraph.getChunkModulesIterableBySourceType = () => undefined; },
      ({ compilation, cssModule }) => { compilation.chunkGraph.getChunkModulesIterableBySourceType = () => [cssModule]; },
      ({ compilation, cssChunk, module }) => {
        const original = compilation.chunkGraph.getChunkModulesIterable;
        compilation.chunkGraph.getChunkModulesIterable = (candidate) => candidate === cssChunk ? [module] : original(candidate);
      },
      ({ compilation, cssChunk, cssModule }) => {
        const original = compilation.chunkGraph.getChunkModulesIterable;
        compilation.chunkGraph.getChunkModulesIterable = (candidate) => candidate === cssChunk ? [cssModule, cssModule] : original(candidate);
      },
      ({ compilation, cssChunk, module }) => { compilation.chunkGraph.getChunkRuntimeModulesIterable = (candidate) => candidate === cssChunk ? [module] : []; },
      ({ compilation, module, group }) => { compilation.chunkGraph.getChunkEntryModulesWithChunkGroupIterable = () => [[module, group] as const]; },
    ];
    for (const attack of cssAttacks) { const value = withCss(); attack(value); assert.throws(() => capture(value)); }
    const attacks: ((value: ReturnType<typeof fixture>) => void)[] = [
      ({ module }) => Object.assign(module, { resource: "/fixture/app.tsx" }),
      ({ module }) => Object.assign(module, { type: "javascript/esm" }),
      ({ module }) => Object.assign(module, { layer: "rsc" }),
      ({ module }) => Object.assign(module, { request: "other-loader?server=false!" }),
      ({ module }) => Object.assign(module, { loaders: [{ loader: "/other-loader", options: "server=false" }] }),
      ({ module }) => Object.assign(module, { loaders: [{ loader: resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER), options: "modules=app.tsx&server=false" }] }),
      ({ module }) => Object.assign(module, { loaders: [{ loader: resolve(root, STYLEX_NEXT_EMPTY_ENTRY_LOADER), options: "server=false", ident: "redirect" }] }),
      ({ module }) => Object.assign(module, { dependencies: [{}] }),
      ({ module }) => Object.assign(module, { blocks: [{}] }),
      ({ module }) => Object.assign(module, { originalSource: () => ({ source: () => "export{}", map: () => null }) }),
      ({ module }) => Object.assign(module, { originalSource: () => ({ source: () => "", map: () => ({ mappings: "AAAA" }) }) }),
      ({ compilation }) => Object.assign(compilation.chunkGraph, { getChunkModulesIterable: () => [] }),
      ({ compilation, module }) => Object.assign(compilation.chunkGraph, { getChunkModulesIterable: () => [module, module] }),
      ({ compilation, module }) => Object.assign(compilation.chunkGraph, { getChunkRuntimeModulesIterable: () => [module] }),
      ({ compilation, group }) => Object.assign(compilation.chunkGraph, { getChunkEntryModulesWithChunkGroupIterable: () => [[{}, group]] }),
      ({ group, dependency }) => { group.chunks = [dependency]; },
      ({ chunk }) => { chunk.hasRuntime = () => true; },
      ({ compilation }) => { compilation.entrypoints.clear(); },
      ({ compilation }) => { compilation.entrypoints.delete("shared"); },
      ({ compilation }) => { compilation.asyncEntrypoints.splice(0); },
      ({ compilation, group }) => { compilation.asyncEntrypoints.push(group); },
      ({ ordinaryGroup, runtime }) => { Object.assign(ordinaryGroup, { getRuntimeChunk: () => runtime }); },
      ({ group }) => { group.getRuntimeChunk = () => null; },
      ({ dependency }) => { dependency.files = []; },
    ];
    for (const attack of attacks) { const value = fixture(); attack(value); assert.throws(() => capture(value)); }
  });
  test("requires maps for every public webpack chunk, including lazy and synthetic-looking names", () => {
    const root = resolve("/fixture/app/.next");
    const chunks = stylexNextJavaScriptChunks([
      { files: ["static/app.js", "static/style.css"] },
      { files: ["static/lazy.js"] },
      { files: ["server/next-font-manifest.js"] },
    ], root, root);
    assert.deepEqual(chunks, ["server/next-font-manifest.js", "static/app.js", "static/lazy.js"]);
    const outputs = chunks.flatMap((path) => [
      { bytes: 1, path, sha256: "a".repeat(64) },
      { bytes: 1, path: `${path}.map`, sha256: "b".repeat(64) },
    ]);
    assert.doesNotThrow(() => requireStylexNextChunkMaps(chunks, outputs));
    for (const missing of chunks) assert.throws(
      () => requireStylexNextChunkMaps(chunks, outputs.filter(({ path }) => path !== `${missing}.map`)),
      /chunk omitted its external source map/u,
    );
  });
  test("resolves Next server parent segments against compiler.outputPath", () => {
    const passRoot = resolve("/fixture/app/.next");
    const compilerRoot = resolve(passRoot, "server/chunks");
    assert.equal(
      resolveStylexNextOutputPath(passRoot, compilerRoot, "../app/page.js"),
      "server/app/page.js",
    );
    assert.equal(
      resolveStylexNextOutputPath(passRoot, resolve(passRoot, "static/chunks"), "app/page.css"),
      "static/chunks/app/page.css",
    );
  });

  test("rejects compiler roots and emitted names outside the pass output", () => {
    const passRoot = resolve("/fixture/app/.next");
    assert.throws(
      () => resolveStylexNextOutputPath(passRoot, resolve("/fixture/elsewhere"), "asset.js"),
      /compiler output path escapes/u,
    );
    assert.throws(
      () => resolveStylexNextOutputPath(passRoot, resolve(passRoot, "server/chunks"), "../../../outside.js"),
      /emitted asset escapes/u,
    );
  });

  test("binds generated CSS through the exact entrypoint chunk instead of unrelated CSS", () => {
    const passRoot = resolve("/fixture/app/.next");
    const compilerRoot = resolve(passRoot, "static/chunks");
    const generatedChunk: StylexNextWebpackChunk = { files: ["app/generated.css", "app/page.js"] };
    const unrelatedChunk: StylexNextWebpackChunk = { files: ["app/unrelated.css", "app/other.js"] };
    assert.deepEqual(
      stylexCssFilesForEntrypoint(
        {
          chunks: [generatedChunk],
          getFiles: () => ["app/generated.css", "app/page.js"],
          getRuntimeChunk: () => null,
          parentsIterable: [],
        },
        new Set([generatedChunk]),
        passRoot,
        compilerRoot,
        "app/page",
      ),
      ["static/chunks/app/generated.css"],
    );
    assert.throws(
      () => stylexCssFilesForEntrypoint(
        {
          chunks: [unrelatedChunk],
          getFiles: () => ["app/unrelated.css", "app/other.js"],
          getRuntimeChunk: () => null,
          parentsIterable: [],
        },
        new Set([generatedChunk]),
        passRoot,
        compilerRoot,
        "app/unrelated",
      ),
      /does not include the generated StyleX CSS chunk/u,
    );
  });

  test("binds generated CSS on every and only physical App Router delivery owner", () => {
    const root = resolve("/fixture/app/.next");
    const generatedResource = "/fixture/app/.stylex-next/attempt/generated/stylex.css";
    const generatedChunk: StylexNextWebpackChunk = { files: ["static/stylex.css"] };
    type FixtureEntrypoint = {
      chunks: StylexNextWebpackChunk[];
      getFiles(): string[];
      getRuntimeChunk(): null;
      parentsIterable: FixtureEntrypoint[];
    };
    const entry = (files: string[], chunks: StylexNextWebpackChunk[] = [{ files }]): FixtureEntrypoint => ({
      chunks, getFiles: () => chunks.flatMap((chunk) => [...chunk.files]), getRuntimeChunk: () => null, parentsIterable: [],
    });
    const layout = entry(["static/layout.js"], [{ files: ["static/layout.js"] }, generatedChunk]);
    const globalError = entry(["static/global-error.js"], [{ files: ["static/global-error.js"] }, generatedChunk]);
    const page = entry(["static/page.js"]);
    page.parentsIterable.push(layout);
    const nestedLayout = entry(["static/nested-layout.js"]);
    const mainApp = entry(["static/main-app.js"]);
    const proxy = { resource: generatedResource, type: "javascript/auto", userRequest: generatedResource, layer: "app-pages-browser" };
    const cssLoader = "/fixture/app/node_modules/next/dist/build/webpack/loaders/css-loader/src/index.js??ruleSet[1].rules[15].oneOf[10].use[2]";
    const postcssLoader = "/fixture/app/node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js??ruleSet[1].rules[15].oneOf[10].use[3]";
    const evaluation = {
      resource: generatedResource,
      type: "javascript/auto",
      userRequest: `${generatedResource}.webpack[javascript/auto]!=!${cssLoader}!${postcssLoader}!${generatedResource}`,
      layer: null,
    };
    const extracted = {
      getSourceTypes: () => new Set(["css/mini-extract"]),
      nameForCondition: () => generatedResource,
      type: "css/mini-extract",
    };
    const compilation = {
      asyncEntrypoints: [],
      chunkGraph: { getModuleChunksIterable: (module: unknown) => module === extracted ? [generatedChunk] : [] },
      entrypoints: new Map([
        ["main-app", mainApp],
        ["app/_global-error/page", entry(["static/global-error-route.js"])],
        ["app/layout", layout],
        ["app/page", page],
        ["app/nested/layout", nestedLayout],
        ["app/global-error", globalError],
      ]),
      modules: [proxy, evaluation, extracted],
    };
    const receipts = stylexNextEntrypointReceipts(compilation as never, root, root, generatedResource);
    assert.deepEqual(
      receipts.filter(({ stylexCss }) => stylexCss.length > 0).map(({ name, stylexCss }) => ({ name, stylexCss })),
      [
        { name: "app/global-error", stylexCss: ["static/stylex.css"] },
        { name: "app/layout", stylexCss: ["static/stylex.css"] },
      ],
    );
    assert.ok(receipts.filter(({ name }) => !["app/global-error", "app/layout"].includes(name)).every(({ stylexCss }) => stylexCss.length === 0));
    assert.deepEqual(receipts.find(({ name }) => name === "app/page")?.css, ["static/stylex.css"]);
    layout.chunks.pop();
    layout.parentsIterable.push(globalError);
    assert.throws(
      () => stylexNextEntrypointReceipts(compilation as never, root, root, generatedResource),
      /delivery entrypoint app\/layout does not include/u,
    );
    layout.parentsIterable.pop();
    layout.chunks.push(generatedChunk);
    proxy.resource = "/fixture/app/.stylex-next/attempt/generated/../generated/stylex.css";
    assert.throws(
      () => stylexNextEntrypointReceipts(compilation as never, root, root, generatedResource),
      /exactly the generated CSS proxy and loader evaluation/u,
    );
    proxy.resource = generatedResource;
    compilation.modules.push({ ...proxy });
    assert.throws(
      () => stylexNextEntrypointReceipts(compilation as never, root, root, generatedResource),
      /exactly the generated CSS proxy and loader evaluation/u,
    );
    compilation.modules.pop();
    for (const malformed of [
      { ...evaluation, layer: "app-pages-browser" },
      { ...evaluation, type: "javascript/esm" },
      { ...evaluation, resource: `${generatedResource}?other` },
      { ...evaluation, userRequest: evaluation.userRequest.replace(cssLoader, "/fixture/unregistered-loader.js??ruleSet[1].rules[15].oneOf[10].use[2]") },
      { ...evaluation, userRequest: evaluation.userRequest.replace(`${cssLoader}!`, `${cssLoader}!${cssLoader}!`) },
      { ...evaluation, userRequest: evaluation.userRequest.replace("use[2]", "unbound") },
      { ...evaluation, userRequest: evaluation.userRequest.replace(".webpack[javascript/auto]", ".webpack[javascript/esm]") },
      { ...evaluation, userRequest: `${evaluation.userRequest}?different` },
    ]) {
      assert.throws(() => stylexNextEntrypointReceipts({
        ...compilation,
        modules: [proxy, malformed, extracted],
      } as never, root, root, generatedResource), /Next generated CSS/u);
    }
    assert.throws(() => stylexNextEntrypointReceipts({
      ...compilation,
      chunkGraph: {
        getModuleChunksIterable: (module: unknown) => module === evaluation || module === extracted ? [generatedChunk] : [],
      },
    } as never, root, root, generatedResource), /build-time evaluation cannot own emitted chunks/u);
  });

  test("follows the extracted CSS module after native CSS chunking moves it away from its JavaScript proxy", () => {
    const resource = "/fixture/app/.stylex-next/attempt/generated/stylex.css";
    const proxy = { resource, type: "javascript/auto" };
    const extracted = { type: "css/mini-extract", nameForCondition: () => resource, getSourceTypes: () => new Set(["css/mini-extract"]) };
    const extractedClone = { ...extracted };
    const unrelated = { ...extracted, nameForCondition: () => "/fixture/app/unrelated.css" };
    const proxyChunk = { files: ["static/main.js"] };
    const extractedChunk = { files: ["static/stylex.css"] };
    const unrelatedChunk = { files: ["static/unrelated.css"] };
    type CssCompilation = Parameters<typeof stylexNextExtractedCssChunks>[0];
    const context = (modules: CssCompilation["modules"], owners: readonly StylexNextWebpackChunk[] = [extractedChunk]): CssCompilation => ({
      modules,
      chunkGraph: { getModuleChunksIterable: (module: unknown) => module === proxy ? [proxyChunk] : module === unrelated ? [unrelatedChunk] : owners },
    });
    assert.deepEqual([...stylexNextExtractedCssChunks(context([proxy, unrelated, extracted]), resource)], [extractedChunk]);
    assert.deepEqual([...stylexNextExtractedCssChunks(context([proxy, extracted, extractedClone]), resource)], [extractedChunk]);
    assert.deepEqual(stylexCssFilesForEntrypoint({
      chunks: [proxyChunk, extractedChunk],
      getFiles: () => ["static/main.js", "static/stylex.css"],
      getRuntimeChunk: () => null,
      parentsIterable: [],
    }, stylexNextExtractedCssChunks(context([proxy, extracted]), resource), "/fixture/app/.next", "/fixture/app/.next", "main"), ["static/stylex.css"]);
    for (const modules of [
      [proxy], [proxy, unrelated], [extracted, extracted],
      [{ ...extracted, type: "javascript/auto" }],
      [{ ...extracted, nameForCondition: () => `${resource}?different` }],
      [{ ...extracted, nameForCondition: () => "/fixture/app/.stylex-next/attempt/generated/../generated/stylex.css" }],
      [{ ...extracted, getSourceTypes: () => new Set(["css/mini-extract", "javascript"]) }],
    ]) assert.throws(() => stylexNextExtractedCssChunks(context(modules), resource), /nonempty bounded extracted-module census|repeats an extracted module|another source type/);
    assert.throws(() => stylexNextExtractedCssChunks(context([extracted], []), resource), /chunk owner/);
    assert.throws(() => stylexNextExtractedCssChunks(context([extracted], [proxyChunk]), resource), /emitted no stylesheet/);
    assert.throws(() => stylexCssFilesForEntrypoint({
      chunks: [proxyChunk, unrelatedChunk],
      getFiles: () => ["static/main.js", "static/unrelated.css"],
      getRuntimeChunk: () => null,
      parentsIterable: [],
    }, stylexNextExtractedCssChunks(context([proxy, unrelated, extracted]), resource), "/fixture/app/.next", "/fixture/app/.next", "main"), /does not include/);
  });

  test("binds duplicated config inputs to the verified attempt plan", () => {
    const pluginOptions = {
      attemptDirectory: resolve("/fixture/app/.stylex-next/fixture"),
      graphMap: { client: "client", edgeRsc: "edge-rsc", nodeRsc: "node-rsc" },
      mode: "delivery",
      outputDirectory: ".next",
      packageManifests: ["node_modules/@hraness/ui/dist/stylex-manifest.json"],
      planSha256: "0".repeat(64),
      rootDirectory: resolve("/fixture/app"),
      stateDirectory: ".stylex-next",
      target: "client",
    } as const;
    const plan = {
      attemptId: "fixture",
      graphMap: { client: "client", edgeRsc: "edge-rsc", nodeRsc: "node-rsc" },
      outputDirectory: ".next",
      packageManifests: [{ artifact: { path: "node_modules/@hraness/ui/dist/stylex-manifest.json" } }],
      requiredSources: { client: ["app/page.tsx"], "edge-rsc": [], "node-rsc": ["app/layout.tsx"] },
    };
    assert.deepEqual(validateStylexNextPluginPlan(plan as never, pluginOptions), ["app/page.tsx"]);
    assert.throws(
      () => validateStylexNextPluginPlan({
        ...plan,
        graphMap: { client: "browser", edgeRsc: "edge-rsc", nodeRsc: "node-rsc" },
      } as never, pluginOptions),
      /graph map differs from the verified attempt plan/u,
    );
    assert.throws(
      () => validateStylexNextPluginPlan({
        ...plan,
        packageManifests: [{ artifact: { path: "node_modules/@fixture/theme/dist/stylex-manifest.json" } }],
      } as never, pluginOptions),
      /package manifests differ from the verified attempt plan/u,
    );
  });

  test("treats loader receipts as the exact census and the optimized graph as a subset", () => {
    assert.doesNotThrow(() => validateStylexNextSourceCensus([], [], "edge-rsc"));
    assert.throws(
      () => validateStylexNextSourceCensus(["app/edge/page.tsx"], [], "edge-rsc"),
      /loader receipt census differs from the verified attempt plan/u,
    );
    assert.throws(
      () => validateStylexNextSourceCensus(["app/page.tsx"], ["app/layout.tsx", "app/page.tsx"], "node-rsc"),
      /loader receipt census differs from the verified attempt plan/u,
    );

    const transformed = [
      "app/client.tsx",
      "app/global-error-proof/page.tsx",
      "app/global-error.tsx",
      "app/layout.tsx",
      "app/lazy.tsx",
      "app/page.tsx",
    ];
    assert.doesNotThrow(() => validateStylexNextCompilationCoverage(
      transformed.filter((path) => path !== "app/page.tsx"),
      transformed,
      "node-rsc",
    ));
    const edgeTransformed = ["app/edge/page.tsx", "app/global-error.tsx", "app/layout.tsx"];
    assert.doesNotThrow(() => validateStylexNextCompilationCoverage(
      edgeTransformed.filter((path) => path !== "app/layout.tsx"),
      edgeTransformed,
      "edge-rsc",
    ));
    assert.throws(
      () => validateStylexNextCompilationCoverage(
        ["app/client.tsx", "app/untransformed.tsx"],
        transformed,
        "node-rsc",
      ),
      /optimized webpack graph contains repository sources without loader receipts/u,
    );
  });
});
