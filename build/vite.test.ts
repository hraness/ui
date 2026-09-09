import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { build as viteBuild } from "vite";
import { createBoundedDiagnostics } from "../fixtures/vite8-adopter/diagnostics.ts";

import type {
  StylexGenerationHandleV1,
  StylexGraphExpectationV1,
  StylexGraphReceiptV1,
  StylexPackageManifestV1,
  StylexRuleV1,
} from "./contracts.js";
import {
  artifactForFile,
  canonicalJson,
  compilerContract,
  compilerSha256,
  createStylexTransformCollector,
  serializeStylexPackageRules,
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import { createStylexGeneration, finalizeStylexGeneration } from "./generation.js";
import { stylexVite } from "./vite.js";

const roots: string[] = [];
const packageBuildSource = "export const packageBuildTool = true;\n";
const packageRuntimeSource = `import { create } from "@stylexjs/stylex";
export const packageRuntime = typeof create === "function";
`;
const packageStylesheetSource = ".fixture-foundation{display:block}\n";

type ConfigHook = (
  this: object,
  config: Record<string, unknown>,
  environment: Readonly<{ command: "build" | "serve"; mode: string }>,
) => Promise<unknown> | unknown;

type ResolveResult = Readonly<{ external?: boolean; id: string }>;
type TransformContext = Readonly<{
  resolve(source: string, importer?: string, options?: Readonly<{ skipSelf?: boolean }>): Promise<ResolveResult | null>;
}>;
type TransformHook = (
  this: TransformContext,
  code: string,
  id: string,
) => Promise<unknown>;

type OutputOptions = Readonly<{
  dir?: string;
  file?: string;
  sourcemap?: boolean | "hidden" | "inline";
}>;
type OutputValue =
  | Readonly<{
    fileName: string;
    originalFileName?: string | null;
    originalFileNames?: readonly string[];
    source: string | Uint8Array;
    type: "asset";
  }>
  | Readonly<{ fileName: string; type: "chunk" }>;
type OutputBundle = Readonly<Record<string, OutputValue>>;
type GenerateHook = (this: object, options: OutputOptions, bundle: OutputBundle) => Promise<void>;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function handler<T>(value: unknown): T {
  let candidate = value;
  if (typeof value === "object" && value !== null && "handler" in value) candidate = value.handler;
  assert.equal(typeof candidate, "function", "expected a Vite plugin hook");
  return candidate as T;
}

function logical(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(value.length > 0 && !value.startsWith("../"));
  return value;
}

async function write(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, { flag: "wx" });
}

type Fixture = Readonly<{
  generationOutput: string;
  manifestPath: string;
  packageRoot: string;
  root: string;
}>;

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-vite-adapter-"));
  roots.push(root);
  const packageRoot = join(root, "node_modules/@fixture/ui");
  await write(join(root, "node_modules/@stylexjs/stylex/package.json"), `${JSON.stringify({
    exports: "./index.js",
    name: "@stylexjs/stylex",
    type: "module",
    version: "0.19.0",
  })}\n`);
  await write(
    join(root, "node_modules/@stylexjs/stylex/index.js"),
    "export const create = (styles) => styles; export const props = (...styles) => ({ className: styles.join(' ') });\n",
  );
  await write(join(packageRoot, "package.json"), `${JSON.stringify({
    exports: {
      ".": "./dist/runtime.js",
      "./build": "./build/index.js",
      "./compiler-foundation.css": "./src/compiler-foundation.css",
      "./stylex.css": "./dist/stylex.css",
      "./unmanifested.css": "./src/unmanifested.css",
    },
    name: "@fixture/ui",
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(packageRoot, "dist/runtime.js"), packageRuntimeSource);
  await write(join(packageRoot, "build/index.js"), packageBuildSource);
  await write(join(packageRoot, "src/compiler-foundation.css"), packageStylesheetSource);
  await write(join(packageRoot, "src/unmanifested.css"), ".unmanifested{display:block}\n");
  const rules: readonly StylexRuleV1[] = [["x-package", { ltr: ".x-package{color:red}" }, 1000]];
  const standaloneSerializer = {
    before: ["components.fixture-ui.legacy"],
    prefix: "components.fixture-ui",
  } as const;
  await write(join(packageRoot, "dist/stylex.css"), serializeStylexPackageRules(rules, standaloneSerializer));
  const manifest: StylexPackageManifestV1 = {
    buildTools: [await artifactForFile(packageRoot, "build/index.js")],
    compiler: compilerContract,
    compilerSha256,
    compilerFoundation: "src/compiler-foundation.css",
    kind: "hraness-stylex-package-manifest",
    package: { name: "@fixture/ui", version: "1.0.0" },
    rules,
    rulesSha256: stylexRulesSha256(rules),
    runtime: [await artifactForFile(packageRoot, "dist/runtime.js")],
    schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"),
    standaloneSerializer,
    stylesheets: [await artifactForFile(packageRoot, "src/compiler-foundation.css")],
  };
  const manifestPath = join(packageRoot, "dist/stylex-manifest.json");
  await write(manifestPath, `${canonicalJson(manifest)}\n`);
  return { generationOutput: join(root, "generations"), manifestPath, packageRoot, root };
}

function graphExpectation(
  context: Fixture,
  id: string,
  kind: "client" | "ssr",
  entrypoints: readonly string[],
): StylexGraphExpectationV1 {
  return {
    adapter: "vite",
    entrypoints: entrypoints.map((entrypoint) => logical(context.root, entrypoint)).sort(),
    id,
    kind,
  };
}

async function generation(
  context: Fixture,
  expectationValue: StylexGraphExpectationV1,
): Promise<StylexGenerationHandleV1> {
  return createStylexGeneration({
    expectedGraphs: [expectationValue],
    generationId: `vite-${expectationValue.id}`,
    outputDirectory: context.generationOutput,
    packageManifests: [logical(context.root, context.manifestPath)],
    rootDirectory: context.root,
  });
}

type ConfiguredGraph = Readonly<{
  generate: GenerateHook;
  generation: StylexGenerationHandleV1;
  outputDirectory: string;
  transform: TransformHook;
}>;

async function configureGraph(
  context: Fixture,
  graph: StylexGraphExpectationV1,
): Promise<ConfiguredGraph> {
  const generationValue = await generation(context, graph);
  const plugin = stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root });
  const config = handler<ConfigHook>(plugin.config);
  const configured = await config.call({}, {}, { command: "build", mode: "production" });
  assert.ok(typeof configured === "object" && configured !== null && "build" in configured);
  const build = configured.build;
  assert.ok(typeof build === "object" && build !== null && "outDir" in build && typeof build.outDir === "string");
  assert.ok("cssCodeSplit" in build);
  assert.equal(build.cssCodeSplit, false);
  const outputDirectory = build.outDir;
  const configResolved = handler<(config: unknown) => Promise<void>>(plugin.configResolved);
  await configResolved({
    build: {
      assetsInlineLimit: 0,
      copyPublicDir: false,
      cssCodeSplit: false,
      outDir: outputDirectory,
      rollupOptions: { input: graph.entrypoints.map((entrypoint) => resolve(context.root, entrypoint)) },
      sourcemap: false,
      ssr: graph.kind === "ssr" ? resolve(context.root, graph.entrypoints[0]!) : false,
      watch: null,
      write: true,
    },
    command: "build",
    publicDir: "",
    root: context.root,
  });
  return {
    generate: handler<GenerateHook>(plugin.generateBundle),
    generation: generationValue,
    outputDirectory,
    transform: handler<TransformHook>(plugin.transform),
  };
}

function resolver(overrides: Readonly<Record<string, ResolveResult | null>> = {}): TransformContext {
  return {
    async resolve(source, importer) {
      if (source in overrides) return overrides[source] ?? null;
      if (source.startsWith(".") && importer !== undefined) {
        return { external: false, id: resolve(dirname(importer), source) };
      }
      return null;
    },
  };
}

async function readReceipt(
  generationValue: StylexGenerationHandleV1,
  graphId: string,
): Promise<StylexGraphReceiptV1> {
  const source = await readFile(
    join(generationValue.directory, ".stylex-generation/receipts", `${graphId}.json`),
    "utf8",
  );
  return JSON.parse(source) as StylexGraphReceiptV1;
}

async function receiptExists(
  generationValue: StylexGenerationHandleV1,
  graphId: string,
): Promise<boolean> {
  return Bun.file(
    join(generationValue.directory, ".stylex-generation/receipts", `${graphId}.json`),
  ).exists();
}

async function writeDependencyPackage(
  context: Fixture,
  packageName: string,
  source: string,
): Promise<void> {
  const root = join(context.root, "node_modules", packageName);
  await write(join(root, "package.json"), `${JSON.stringify({
    exports: "./index.js",
    name: packageName,
    type: "module",
    version: "1.0.0",
  })}\n`);
  await write(join(root, "index.js"), source);
}

describe("stylexVite external source maps (native)", () => {
  test("seals an authentic empty native chunk without inventing source callbacks", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/empty.ts");
    await write(entry, "export {};\n");
    const graph = graphExpectation(context, "external-empty", "client", [entry]);
    const generationValue = await generation(context, graph);
    await viteBuild({ configFile: false, logLevel: "silent", build: { minify: false },
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root, sourceMaps: "external" })] });
    const receipt = await readReceipt(generationValue, graph.id);
    const publication = await finalizeStylexGeneration({ generation: generationValue, outputDirectory: context.generationOutput, rootDirectory: context.root });
    const maps = receipt.outputs.filter(({ path }) => /\.[cm]?js\.map$/u.test(path));
    expect(maps.length).toBe(1);
    const map = JSON.parse(await readFile(join(publication, "graphs", graph.id, maps[0]!.path), "utf8"));
    expect(map.sources).toEqual([]);
    expect(map.sourcesContent).toEqual([]);
    expect(map.mappings).toBe("");
  });

  test("preserves real client, lazy and SSR source provenance after atomic publication", async () => {
    for (const kind of ["client", "ssr"] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      const lazy = join(context.root, "src/lazy.ts");
      await write(entry, [
        'import * as stylex from "@stylexjs/stylex";',
        'const styles = stylex.create({ root: { color: "red" } });',
        'globalThis.fixture = stylex.props(styles.root);',
        'globalThis.lazy = () => import("./lazy");',
      ].join("\n"));
      await write(lazy, 'export const lazyAnswer = "lazy mapped source";\n');
      const graph = graphExpectation(context, `external-${kind}`, kind, [entry]);
      const generationValue = await generation(context, graph);
      await viteBuild({ configFile: false, logLevel: "silent",
        build: { minify: false, ...(kind === "ssr" ? { ssr: entry } : {}) },
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root, sourceMaps: "external" })],
      });
      const receipt = await readReceipt(generationValue, graph.id);
      const publication = await finalizeStylexGeneration({ generation: generationValue, outputDirectory: context.generationOutput, rootDirectory: context.root });
      const mapped = new Set<string>();
      for (const artifact of receipt.outputs.filter(({ path }) => /\.[cm]?js$/u.test(path))) {
        const javascript = join(publication, "graphs", graph.id, artifact.path);
        const mapPath = `${javascript}.map`;
        const code = await readFile(javascript, "utf8");
        const map = JSON.parse(await readFile(mapPath, "utf8")) as { sources: string[]; sourcesContent: string[]; mappings: string };
        expect(code).toContain(`//# sourceMappingURL=${artifact.path.split("/").at(-1)}.map`);
        expect(receipt.outputs.some(({ path }) => path === `${artifact.path}.map`)).toBe(true);
        for (const [index, source] of map.sources.entries()) {
          const absolute = resolve(dirname(mapPath), source);
          mapped.add(absolute);
          expect(map.sourcesContent[index]).toBe(await readFile(absolute, "utf8"));
          expect(source).not.toContain(".hraness-stylex-");
          expect(source).not.toContain(context.root);
        }
        expect(await artifactForFile(join(publication, "graphs", graph.id), artifact.path)).toEqual(artifact);
      }
      expect(mapped.has(entry)).toBe(true);
      expect(mapped.has(lazy)).toBe(true);
    }
  });

  test("rejects mutated maps, missing companions and late native path overrides", async () => {
    for (const mutation of ["map-bytes", "map-linkage", "missing", "path-projection", "ignore-callback", "chunk-projection", "erase-mappings", "empty-sources", "duplicate-json"] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "globalThis.fixture = 42;\n");
      const graph = graphExpectation(context, "external-negative", "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({ configFile: false, logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root, sourceMaps: "external" }), {
          name: `external-map-${mutation}`,
          outputOptions(output) {
            if (mutation === "path-projection") return { ...output, sourcemapPathTransform: () => "private.ts" };
            if (mutation === "ignore-callback") return { ...output, sourcemapIgnoreList: () => false };
            return null;
          },
          generateBundle: { order: ["chunk-projection", "erase-mappings", "empty-sources", "duplicate-json"].includes(mutation) ? "pre" : "post", handler(_output, bundle) {
            const chunk = Object.values(bundle).find((value) => value.type === "chunk");
            assert.ok(chunk?.type === "chunk");
            const key = `${chunk.fileName}.map`;
            if (mutation === "missing") delete bundle[key];
            else if (mutation === "chunk-projection") chunk.preliminaryFileName = "assets/foreign.js";
            else if (mutation === "map-linkage") chunk.map = null;
            else if (mutation === "map-bytes") {
              const map = bundle[key];
              assert.ok(map?.type === "asset");
              map.source = "{}";
            } else if (["erase-mappings", "empty-sources", "duplicate-json"].includes(mutation)) {
              const mapAsset = bundle[key];
              assert.ok(mapAsset?.type === "asset" && chunk.map !== null);
              if (mutation === "duplicate-json") {
                const raw = typeof mapAsset.source === "string" ? mapAsset.source : Buffer.from(mapAsset.source).toString("utf8");
                mapAsset.source = `{\"sources\":[\"/private/unobserved.ts\"],${raw.slice(1)}`;
              } else {
                chunk.map.mappings = "";
                if (mutation === "empty-sources") {
                  chunk.map.sources = [];
                  chunk.map.sourcesContent = [];
                }
                mapAsset.source = JSON.stringify(chunk.map);
              }
            }
          } },
        }],
      })).rejects.toThrow();
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });
});

describe("stylexVite terminal module census (pure)", () => {
  type Info = Record<string, unknown>;
  function census(engine: "rollup" | "rolldown", extra: readonly Info[] = []) {
    const entry = resolve("src/census-entry.ts");
    const lazy = resolve("src/census-lazy.ts");
    const info = (id: string, code: string | null, isEntry = false): Info => ({
      id, code, isEntry, importedIds: [], dynamicallyImportedIds: [],
      ...(engine === "rollup" ? { isExternal: code === null } : {}),
    });
    const records = new Map<string, Info>([
      [entry, { ...info(entry, "export const load = () => import('./census-lazy');", true), importedIds: ["fixture-external"], dynamicallyImportedIds: [lazy] }],
      [lazy, info(lazy, "export const lazy = true;")],
      ["fixture-external", info("fixture-external", null)],
      ...extra.map((record) => [record.id as string, record] as [string, Info]),
    ]);
    const plugin = stylexVite({ rootDirectory: process.cwd(), graphId: "census",
      generation: { directory: resolve("unused-census-generation"), planSha256: "0".repeat(64) } });
    const context = {
      meta: { rollupVersion: "4.23.0", ...(engine === "rolldown" ? { rolldownVersion: "1.0.0" } : {}) },
      getModuleIds: (): IterableIterator<string> => records.keys(),
      getModuleInfo: (id: string) => records.get(id) ?? null,
    };
    const parse = (id: string) => handler<(info: unknown) => void>(plugin.moduleParsed)(records.get(id));
    const end = (error?: Error) => handler<(this: typeof context, error?: Error) => void>(plugin.buildEnd).call(context, error);
    const render = () => handler<(this: typeof context) => void>(plugin.renderStart).call(context);
    const parseInternals = () => { parse(entry); parse(lazy); };
    return { context, end, entry, info, lazy, parse, parseInternals, records, render };
  }

  test("positively attests internals, lazy edges, bare externals, and native builtins for both engines", () => {
    for (const engine of ["rollup", "rolldown"] as const) {
      const run = census(engine);
      for (const id of ["node:fs/promises", "react-dom/server", "@scope/package/subpath"]) {
        run.records.set(id, run.info(id, null));
        (run.records.get(run.entry)!.importedIds as string[]).push(id);
      }
      run.parseInternals();
      expect(run.end).not.toThrow();
      expect(run.render).not.toThrow();
    }
  });

  test("requires explicit Rollup flags and never forges Rolldown flags", () => {
    for (const value of [undefined, null, "false", 0]) {
      const run = census("rollup");
      run.records.get("fixture-external")!.isExternal = value;
      run.parseInternals();
      expect(run.end).toThrow(/Rollup must explicitly classify/u);
    }
    const run = census("rolldown");
    run.records.get("fixture-external")!.isExternal = true;
    run.parseInternals();
    expect(run.end).toThrow(/Rolldown external classification/u);
  });

  test("rejects unavailable internal code and unparsed code instead of defaulting external", () => {
    for (const engine of ["rollup", "rolldown"] as const) {
      const missing = census(engine);
      missing.records.get(missing.entry)!.code = null;
      expect(() => missing.parse(missing.entry)).toThrow(/parsed internal module must have available code/u);
      const unavailable = census(engine);
      unavailable.records.get(unavailable.entry)!.code = null;
      unavailable.parse(unavailable.lazy);
      expect(unavailable.end).toThrow(/external module may not be an entry|lacks a moduleParsed attestation/u);
      const unparsed = census(engine);
      unparsed.parse(unparsed.entry);
      expect(unparsed.end).toThrow(/unparsed external module has code|lacks a moduleParsed attestation/u);
      const forged = census(engine);
      forged.records.get("fixture-external")!.code = "export const internal = true;";
      forged.parseInternals();
      forged.parse("fixture-external");
      if (engine === "rollup") expect(forged.end).toThrow(/parsed internal module was classified external/u);
      else expect(forged.end).not.toThrow();
    }
  });

  test("rejects queried, private, virtual, and file externals on both engines", () => {
    for (const engine of ["rollup", "rolldown"] as const) {
      for (const id of [
        "./local.ts", "../local.ts", "/private/local.ts", "C:/private/local.ts", "C:\\private\\local.ts",
        "file:///private/local.ts", "\0virtual:module", "virtual:module", "vite:preload-helper",
        "#private", "~/private.ts", "fixture-external?raw", "fixture-external#fragment", "/@fs/private/local.ts",
        "https://example.test/module.js", "data:text/javascript,export default 1", "pkg/../private.ts", "pkg/./private.ts",
      ]) {
        const run = census(engine);
        run.records.delete("fixture-external");
        run.records.set(id, run.info(id, null));
        run.records.get(run.entry)!.importedIds = [id];
        run.parseInternals();
        expect(run.end).toThrow(/external import|may not externalize/u);
      }
    }
  });

  test("closes census membership and rejects unavailable or inconsistent records", () => {
    for (const engine of ["rollup", "rolldown"] as const) {
      for (const mutation of ["missing", "id", "edge", "external-edge", "duplicate", "null-record"] as const) {
        const run = census(engine);
        if (mutation === "edge") run.records.get(run.entry)!.importedIds = ["not-in-census"];
        run.parseInternals();
        if (mutation === "missing") run.records.delete(run.lazy);
        if (mutation === "id") run.records.get(run.lazy)!.id = "wrong-id";
        if (mutation === "external-edge") run.records.get("fixture-external")!.importedIds = [run.lazy];
        if (mutation === "duplicate") run.context.getModuleIds = function* () { yield* run.records.keys(); yield run.entry; };
        if (mutation === "null-record") run.context.getModuleInfo = () => null;
        expect(run.end).toThrow(/census|ID differs|external module has internal|metadata is unavailable/u);
      }
    }
  });

  test("seals code, edges, entry state, and membership by value through output generation", () => {
    for (const engine of ["rollup", "rolldown"] as const) {
      for (const mutation of ["code", "edge", "entry", "new-module", "new-parsed", "removed"] as const) {
        const run = census(engine);
        run.parseInternals();
        run.end();
        if (mutation === "code") run.records.get(run.lazy)!.code = "changed";
        if (mutation === "edge") (run.records.get(run.entry)!.importedIds as string[]).push(run.lazy);
        if (mutation === "entry") run.records.get(run.lazy)!.isEntry = true;
        if (mutation === "new-module") run.records.set("another-external", run.info("another-external", null));
        if (mutation === "removed") run.records.delete("fixture-external");
        if (mutation === "new-parsed") expect(() => run.parse(run.lazy)).toThrow(/after terminal collection/u);
        else expect(run.render).toThrow(/changed|absent from the terminal module census/u);
      }
    }
  });

  test("does not seal failed builds or accept repeated terminal collection", () => {
    const failed = census("rolldown");
    failed.parseInternals();
    failed.end(new Error("native compile failed"));
    expect(failed.render).toThrow(/successful buildEnd/u);
    expect(failed.end).toThrow(/only once/u);
    const good = census("rolldown");
    good.parseInternals();
    good.end();
    expect(good.render).not.toThrow();
    expect(good.end).toThrow(/only once/u);
  });
});

describe("stylexVite", () => {
  test("collects multi-entry, lazy, and nested CSS modules without synthetic CSS provenance", async () => {
    const context = await fixture();
    const first = join(context.root, "src/first.ts");
    const second = join(context.root, "src/second.ts");
    const lazy = join(context.root, "src/lazy.ts");
    const pixel = join(context.root, "src/pixel.svg");
    const secondaryStyles = join(context.root, "src/secondary.css");
    const styles = join(context.root, "src/styles.css");
    const theme = join(context.root, "src/theme.css");
    await write(first, "import './styles.css'; export const loadLazy = () => import('./lazy.ts');\n");
    await write(second, "import './secondary.css'; export { loadLazy } from './first.ts';\n");
    await write(lazy, "export const lazyValue = true;\n");
    await write(pixel, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>\n');
    await write(styles, "@import './theme.css'; .consumer { display: grid; mask-image: url('./pixel.svg'); }\n");
    await write(secondaryStyles, ".secondary { color: rebeccapurple; }\n");
    await write(theme, "@import '@fixture/ui/compiler-foundation.css'; :root { --fixture-color: blue; }\n");
    const graph = graphExpectation(context, "client", "client", [first, second]);
    const generationValue = await generation(context, graph);
    await viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    });

    const receipt = await readReceipt(generationValue, graph.id);
    expect(receipt.target).toBe("client");
    expect(receipt.entrypoints).toEqual(graph.entrypoints);
    const inputPaths = receipt.inputs.map(({ path }) => path);
    expect(inputPaths).toEqual([
      "node_modules/@fixture/ui/src/compiler-foundation.css",
      "src/first.ts",
      "src/lazy.ts",
      "src/pixel.svg",
      "src/second.ts",
      "src/secondary.css",
      "src/styles.css",
      "src/theme.css",
    ]);
    expect(inputPaths).not.toContain("style.css");
    expect(receipt.outputs.filter(({ path }) => path.endsWith(".css"))).toHaveLength(1);
    const stylesheet = receipt.outputs.find(({ path }) => path.endsWith(".css"));
    assert.ok(stylesheet !== undefined);
    const stylesheetSource = await readFile(
      join(generationValue.directory, ".stylex-generation/graphs/client/output", stylesheet.path),
      "utf8",
    );
    expect(stylesheetSource).toContain(".consumer");
    expect(stylesheetSource).toContain(".secondary");
    expect(receipt.outputs.filter(({ path }) => path.endsWith(".js"))).toHaveLength(2);
    expect(receipt.edges).toEqual(expect.arrayContaining([
      { external: false, from: "$entry", kind: "entry", to: "input:src/first.ts" },
      { external: false, from: "input:src/first.ts", kind: "dynamic-import", to: "input:src/lazy.ts" },
      { external: false, from: "input:src/styles.css", kind: "css-url", to: "input:src/pixel.svg" },
      { external: false, from: "input:src/styles.css", kind: "css-import", to: "input:src/theme.css" },
      { external: false, from: "input:src/theme.css", kind: "css-import", to: "input:node_modules/@fixture/ui/src/compiler-foundation.css" },
    ]));
    expect(await Bun.file(join(generationValue.directory, "payload/stylex.css")).exists()).toBe(false);
  });

  test("rejects obsolete Tailwind directives before publishing a graph receipt", async () => {
    for (const [name, directive] of [
      ["source", '@source "./";'],
      ["custom-variant", "@custom-variant dark (&:hover);"],
      ["theme", "@theme inline { --color-background: red; }"],
    ] as const) {
      const context = await fixture();
      const entry = join(context.root, `src/unsupported-${name}.ts`);
      await write(join(context.root, `src/unsupported-${name}.css`), `${directive}\n`);
      await write(entry, `import './unsupported-${name}.css'; export const value = true;\n`);
      const graph = graphExpectation(context, `unsupported-${name}`, "client", [entry]);
      const generationValue = await generation(context, graph);

      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(`unsupported @${name} directive`);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("collects an independent SSR graph receipt", async () => {
    const context = await fixture();
    const server = join(context.root, "src/server.ts");
    const serverOnly = join(context.root, "src/server-only.ts");
    await write(server, "export const loadServerOnly = () => import('./server-only.ts');\n");
    await write(serverOnly, "export const serverOnly = true;\n");
    const graph = graphExpectation(context, "server", "ssr", [server]);
    const generationValue = await generation(context, graph);
    await viteBuild({
      build: { ssr: server },
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    });

    const receipt = await readReceipt(generationValue, graph.id);
    expect(receipt.target).toBe("ssr");
    expect(receipt.inputs.map(({ path }) => path)).toEqual(["src/server-only.ts", "src/server.ts"]);
    expect(receipt.edges).toContainEqual({
      external: false,
      from: "input:src/server.ts",
      kind: "dynamic-import",
      to: "input:src/server-only.ts",
    });
  });

  test("records and verifies runtime modules below any node_modules segment", async () => {
    const context = await fixture();
    const nestedPackage = join(context.root, "apps/site/node_modules/@fixture/ui");
    const entry = join(context.root, "apps/site/src/entry.ts");
    await write(join(nestedPackage, "package.json"), `${JSON.stringify({
      exports: "./dist/runtime.js",
      name: "@fixture/ui",
      type: "module",
      version: "1.0.0",
    })}\n`);
    await write(join(nestedPackage, "dist/runtime.js"), packageRuntimeSource);
    await write(entry, "export { packageRuntime } from '@fixture/ui';\n");
    const graph = graphExpectation(context, "nested-runtime", "client", [entry]);
    const generationValue = await generation(context, graph);
    await viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    });

    const receipt = await readReceipt(generationValue, graph.id);
    expect(receipt.inputs.map(({ path }) => path)).toContain(
      "apps/site/node_modules/@fixture/ui/dist/runtime.js",
    );
    expect(receipt.edges).toContainEqual({
      external: false,
      from: "input:apps/site/src/entry.ts",
      kind: "static-import",
      to: "input:apps/site/node_modules/@fixture/ui/dist/runtime.js",
    });
    expect(receipt.inputs.map(({ path }) => path)).toContain(
      "node_modules/@stylexjs/stylex/index.js",
    );
    expect(receipt.edges).toContainEqual({
      external: false,
      from: "input:apps/site/node_modules/@fixture/ui/dist/runtime.js",
      kind: "static-import",
      to: "input:node_modules/@stylexjs/stylex/index.js",
    });
    expect(receipt.rules).toEqual([]);
  });

  test("rejects verified package build tools and changed runtime bytes", async () => {
    const cases = [
      {
        expected: /build tool entered/u,
        graphId: "package-build-tool",
        importSource: "export { packageBuildTool } from '@fixture/ui/build';\n",
      },
      {
        expected: /runtime differs/u,
        graphId: "changed-runtime",
        importSource: "export { packageRuntime } from '@fixture/ui';\n",
        runtimeSource: "export const packageRuntime = false;\n",
      },
    ] as const;
    for (const item of cases) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, item.importSource);
      const graph = graphExpectation(context, item.graphId, "client", [entry]);
      const generationValue = await generation(context, graph);
      if ("runtimeSource" in item) {
        await writeFile(join(context.packageRoot, "dist/runtime.js"), item.runtimeSource);
      }
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(item.expected);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("rejects unmanifested and changed registered-package stylesheets", async () => {
    const cases = [
      {
        expected: /stylesheet is not bound/u,
        graphId: "unmanifested-stylesheet",
        importSource: "import '@fixture/ui/unmanifested.css'; export const value = true;\n",
      },
      {
        expected: /stylesheet differs/u,
        graphId: "changed-stylesheet",
        importSource: "import '@fixture/ui/compiler-foundation.css'; export const value = true;\n",
        mutation: {
          path: "src/compiler-foundation.css",
          source: ".fixture-foundation{display:grid}\n",
        },
      },
      {
        expected: /stylesheet differs/u,
        graphId: "changed-standalone-stylesheet",
        importSource: "import '@fixture/ui/stylex.css'; export const value = true;\n",
        mutation: {
          path: "dist/stylex.css",
          source: ".not-a-recipe{display:block}\n",
        },
      },
    ] as const;
    for (const item of cases) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, item.importSource);
      const graph = graphExpectation(context, item.graphId, "client", [entry]);
      const generationValue = await generation(context, graph);
      if ("mutation" in item) {
        await writeFile(
          join(context.packageRoot, item.mutation.path),
          item.mutation.source,
        );
      }
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(item.expected);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("requires verified manifests for parsed dependency StyleX edges and ignores comments", async () => {
    const parsedCases = [
      {
        graphId: "unverified-static-stylex",
        packageName: "@fixture/static-stylex",
        source: `import { create } from "@stylexjs/stylex";
export const value = typeof create === "function";
`,
      },
      {
        graphId: "unverified-dynamic-stylex",
        packageName: "@fixture/dynamic-stylex",
        source: `export const value = () => import("@stylexjs/stylex");
`,
      },
    ] as const;
    for (const item of parsedCases) {
      const context = await fixture();
      await writeDependencyPackage(context, item.packageName, item.source);
      const entry = join(context.root, "src/entry.ts");
      await write(entry, `export { value } from ${JSON.stringify(item.packageName)};\n`);
      const graph = graphExpectation(context, item.graphId, "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(/has no verified package manifest/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }

    const context = await fixture();
    const packageName = "@fixture/commented-stylex";
    await writeDependencyPackage(
      context,
      packageName,
      `// import { create } from "@stylexjs/stylex";
/* export const ignored = () => import("@stylexjs/stylex"); */
export const value = true;
`,
    );
    const entry = join(context.root, "src/entry.ts");
    await write(entry, `export { value } from ${JSON.stringify(packageName)};\n`);
    const graph = graphExpectation(context, "commented-stylex", "client", [entry]);
    const generationValue = await generation(context, graph);
    await viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    });
    const receipt = await readReceipt(generationValue, graph.id);
    expect(receipt.inputs.map(({ path }) => path)).toContain(
      "node_modules/@fixture/commented-stylex/index.js",
    );
    expect(receipt.edges.some(({ to }) => to.includes("@stylexjs/stylex"))).toBe(false);
  });

  test("rejects same-length JavaScript, CSS, and native input drift after Vite reads the graph", async () => {
    const cases = [
      {
        files: {
          "src/entry.ts": "export const value = 'aa';\n",
        },
        graphId: "same-length-javascript-drift",
        mutationPath: "src/entry.ts",
        replacement: "export const value = 'bb';\n",
      },
      {
        files: {
          "src/entry.ts": "import './outer.css'; export const value = true;\n",
          "src/outer.css": "@import './styles.css';\n",
          "src/styles.css": ".value{display:grid}\n",
        },
        graphId: "same-length-css-drift",
        mutationPath: "src/styles.css",
        replacement: ".value{display:flex}\n",
      },
      {
        files: {
          "src/data.json": "{\"value\":\"aa\"}\n",
          "src/entry.ts": "import data from './data.json'; export const value = data.value;\n",
        },
        graphId: "same-length-native-drift",
        mutationPath: "src/data.json",
        replacement: "{\"value\":\"bb\"}\n",
      },
    ] as const;
    for (const item of cases) {
      const context = await fixture();
      for (const [path, source] of Object.entries(item.files)) {
        await write(join(context.root, path), source);
      }
      const mutationPath = join(context.root, item.mutationPath);
      assert.equal((await readFile(mutationPath)).byteLength, Buffer.byteLength(item.replacement));
      const entry = join(context.root, "src/entry.ts");
      const graph = graphExpectation(context, item.graphId, "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [
          stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
          {
            name: `mutate-${item.graphId}`,
            async generateBundle() {
              await writeFile(mutationPath, item.replacement);
            },
          },
        ],
      })).rejects.toThrow(/input changed during compilation/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("records JavaScript URL assets as exact snapshotted inputs with matching emitted bytes", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const icon = join(context.root, "src/icon.svg");
    const iconSource = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h2v2z"/></svg>\n';
    await write(icon, iconSource);
    await write(entry, "export const icon = new URL('./icon.svg', import.meta.url).href;\n");
    const graph = graphExpectation(context, "javascript-url-asset", "client", [entry]);
    const generationValue = await generation(context, graph);
    await viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    });

    const receipt = await readReceipt(generationValue, graph.id);
    const input = receipt.inputs.find(({ path }) => path === "src/icon.svg");
    assert.ok(input !== undefined);
    expect(input).toMatchObject({ bytes: Buffer.byteLength(iconSource), sha256: sha256(iconSource) });
    expect(receipt.outputs).toContainEqual(expect.objectContaining({
      bytes: input.bytes,
      sha256: input.sha256,
    }));
  });

  test("rejects forced inline and raw asset queries before they can escape output provenance", async () => {
    for (const query of ["inline", "raw"] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(join(context.root, "src/icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
      await write(entry, `import icon from './icon.svg?${query}'; export { icon };\n`);
      const graph = graphExpectation(context, `forced-${query}-asset`, "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(/content-inlining asset queries/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("normalizes module IDs at the first query or fragment delimiter", async () => {
    for (const [index, suffix] of ["?query#fragment", "#fragment?query"].entries()) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      const source = "export const value = true;\n";
      await write(entry, source);
      const graph = graphExpectation(context, `module-id-delimiter-${String(index)}`, "client", [entry]);
      const session = await configureGraph(context, graph);

      await expect(session.transform.call(
        resolver(),
        source,
        `${entry}${suffix}`,
      )).resolves.toMatchObject({ map: null });
    }
  });

  test("rejects JavaScript URL assets outside the declared root", async () => {
    const context = await fixture();
    const outside = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-vite-asset-outside-"));
    roots.push(outside);
    const outsideAsset = join(outside, "outside.svg");
    const entry = join(context.root, "src/entry.ts");
    const reference = relative(dirname(entry), outsideAsset).split(sep).join("/");
    assert.ok(reference.startsWith("../"));
    await write(outsideAsset, '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    await write(entry, `export const icon = new URL(${JSON.stringify(reference)}, import.meta.url).href;\n`);
    const graph = graphExpectation(context, "outside-url-asset", "client", [entry]);
    const generationValue = await generation(context, graph);
    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    })).rejects.toThrow(/escaped the declared root|not root-contained/u);
    expect(await receiptExists(generationValue, graph.id)).toBe(false);
  });

  test("rejects plugin assets without provenance and source-to-output ABA mismatches", async () => {
    const unknown = await fixture();
    const unknownEntry = join(unknown.root, "src/entry.ts");
    await write(unknownEntry, "export const value = true;\n");
    const unknownGraph = graphExpectation(unknown, "unknown-plugin-asset", "client", [unknownEntry]);
    const unknownGeneration = await generation(unknown, unknownGraph);
    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: unknownGeneration, graphId: unknownGraph.id, rootDirectory: unknown.root }),
        {
          name: "emit-unprovenanced-asset",
          generateBundle() {
            this.emitFile({ name: "unknown.bin", source: "unknown", type: "asset" });
          },
        },
      ],
    })).rejects.toThrow(/without source provenance/u);
    expect(await receiptExists(unknownGeneration, unknownGraph.id)).toBe(false);

    const aba = await fixture();
    const abaEntry = join(aba.root, "src/entry.ts");
    const abaAsset = join(aba.root, "src/asset.bin");
    await write(abaAsset, "AAAA");
    await write(abaEntry, "export const asset = new URL('./asset.bin', import.meta.url).href;\n");
    const abaGraph = graphExpectation(aba, "asset-aba-mismatch", "client", [abaEntry]);
    const abaGeneration = await generation(aba, abaGraph);
    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: abaGeneration, graphId: abaGraph.id, rootDirectory: aba.root }),
        {
          name: "mutate-emitted-asset-between-source-states",
          async generateBundle(_options, bundle) {
            await writeFile(abaAsset, "BBBB");
            const emitted = Object.values(bundle).find((output) =>
              output.type === "asset" && output.originalFileNames.includes("src/asset.bin")
            );
            assert.ok(emitted !== undefined && emitted.type === "asset");
            emitted.source = "BBBB";
            await writeFile(abaAsset, "AAAA");
          },
        },
      ],
    })).rejects.toThrow(/differs from its source provenance/u);
    expect(await readFile(abaAsset, "utf8")).toBe("AAAA");
    expect(await receiptExists(abaGeneration, abaGraph.id)).toBe(false);
  });

  test("rejects a post-order plugin mutation after the initial asset audit", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const asset = join(context.root, "src/asset.bin");
    await write(asset, "AAAA");
    await write(entry, "export const asset = new URL('./asset.bin', import.meta.url).href;\n");
    const graph = graphExpectation(context, "post-order-asset-mutation", "client", [entry]);
    const generationValue = await generation(context, graph);

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
        {
          name: "mutate-emitted-asset-after-stylex-audit",
          generateBundle: {
            order: "post",
            handler(_options, bundle) {
              const emitted = Object.values(bundle).find((output) =>
                output.type === "asset" && output.originalFileNames.includes("src/asset.bin")
              );
              assert.ok(emitted !== undefined && emitted.type === "asset");
              emitted.source = "BBBB";
            },
          },
        },
      ],
    })).rejects.toThrow(/settled asset differs from its source provenance/u);
    expect(await readFile(asset, "utf8")).toBe("AAAA");
    expect(await receiptExists(generationValue, graph.id)).toBe(false);

    const cssContext = await fixture();
    const cssEntry = join(cssContext.root, "src/entry.ts");
    const cssSource = `import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ local: { color: "magenta" } });
export const className = stylex.props(styles.local).className;
`;
    await write(cssEntry, cssSource);
    const cssGraph = graphExpectation(cssContext, "post-order-css-mutation", "client", [cssEntry]);
    const cssGeneration = await generation(cssContext, cssGraph);
    const oracle = createStylexTransformCollector(cssContext.root);
    await oracle.transform(cssSource, cssEntry);
    const rule = oracle.seal()[0]?.[1];
    assert.ok(rule !== undefined);

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: cssGeneration, graphId: cssGraph.id, rootDirectory: cssContext.root }),
        {
          name: "emit-caller-rule-after-stylex-audit",
          generateBundle: {
            order: "post",
            handler() {
              this.emitFile({ fileName: "duplicate.css", source: rule.ltr, type: "asset" });
            },
          },
        },
      ],
    })).rejects.toThrow(/settled graph output.*standalone recipe|standalone recipe.*settled graph output/iu);
    expect(await receiptExists(cssGeneration, cssGraph.id)).toBe(false);
  });

  test("rejects absolute file modules outside the declared root", async () => {
    const context = await fixture();
    const outside = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-vite-outside-"));
    roots.push(outside);
    const outsideModule = join(outside, "outside.ts");
    const entry = join(context.root, "src/entry.ts");
    const outsideSource = "export const outside = true;\n";
    await write(outsideModule, outsideSource);
    await write(entry, "export const entry = true;\n");
    const graph = graphExpectation(context, "outside-root", "client", [entry]);
    const session = await configureGraph(context, graph);

    await expect(session.transform.call(
      resolver(),
      outsideSource,
      outsideModule,
    )).rejects.toThrow(/escaped the declared root/u);
    expect(await receiptExists(session.generation, graph.id)).toBe(false);
  });

  test("rejects relative external files and records bare package externals", async () => {
    const rejected = await fixture();
    const rejectedEntry = join(rejected.root, "src/entry.ts");
    await write(rejectedEntry, "export { localValue } from './local.ts';\n");
    await write(join(rejected.root, "src/local.ts"), "export const localValue = true;\n");
    const rejectedGraph = graphExpectation(rejected, "relative-external", "client", [rejectedEntry]);
    const rejectedGeneration = await generation(rejected, rejectedGraph);
    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: rejectedGeneration, graphId: rejectedGraph.id, rootDirectory: rejected.root }),
        {
          enforce: "pre",
          name: "externalize-relative-file",
          resolveId(source) {
            return source === "./local.ts" ? { external: true, id: source } : null;
          },
        },
      ],
    })).rejects.toThrow(/may not externalize a relative or absolute file/u);
    expect(await receiptExists(rejectedGeneration, rejectedGraph.id)).toBe(false);

    const accepted = await fixture();
    const acceptedEntry = join(accepted.root, "src/entry.ts");
    await write(acceptedEntry, "export { packageValue } from 'fixture-external';\n");
    const acceptedGraph = graphExpectation(accepted, "bare-external", "client", [acceptedEntry]);
    const acceptedGeneration = await generation(accepted, acceptedGraph);
    await viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: acceptedGeneration, graphId: acceptedGraph.id, rootDirectory: accepted.root }),
        {
          enforce: "pre",
          name: "externalize-bare-package",
          resolveId(source) {
            return source === "fixture-external" ? { external: true, id: source } : null;
          },
        },
      ],
    });
    const acceptedReceipt = await readReceipt(acceptedGeneration, acceptedGraph.id);
    expect(acceptedReceipt.edges).toContainEqual({
      external: true,
      from: "input:src/entry.ts",
      kind: "static-import",
      to: "external:fixture-external",
    });
    expect(acceptedReceipt.inputs.map(({ path }) => path)).toEqual(["src/entry.ts"]);
  });

  test("rejects direct, nested, and copied standalone CSS through real Vite builds", async () => {
    const cases = [
      {
        files: {
          "src/entry.ts": "import '@fixture/ui/stylex.css'; export const value = true;\n",
        },
        id: "direct",
      },
      {
        files: {
          "src/entry.ts": "import './outer.css'; export const value = true;\n",
          "src/outer.css": "@import '@fixture/ui/stylex.css';\n",
        },
        id: "nested",
      },
      {
        files: {
          "src/copied.css": ".x-package{color:red}\n",
          "src/entry.ts": "import './copied.css'; export const value = true;\n",
        },
        id: "copied",
      },
    ] as const;
    for (const item of cases) {
      const context = await fixture();
      for (const [path, source] of Object.entries(item.files)) {
        await write(join(context.root, path), source);
      }
      const entry = join(context.root, "src/entry.ts");
      const graph = graphExpectation(context, `css-${item.id}`, "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(/recipe|standalone|StyleX/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("rejects an unresolved owned CSS import before receipt sealing", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "css-unresolved", "client", [entry]);
    const session = await configureGraph(context, graph);
    await expect(session.transform.call(
      resolver({ "./missing.css": null }),
      "@import './missing.css';\n",
      join(context.root, "src/unresolved.css"),
    )).rejects.toThrow(/Unresolved owned CSS import/u);
    expect(await receiptExists(session.generation, graph.id)).toBe(false);
  });

  test("rejects recipe CSS emitted by another plugin and output directory drift", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "mixed-output", "client", [entry]);
    const session = await configureGraph(context, graph);
    const copied: OutputBundle = {
      "copied.css": {
        fileName: "copied.css",
        source: "@layer components.hraness-ui.priority1{.x-package{color:red}}\n",
        type: "asset",
      },
    };
    await expect(session.generate.call({}, { dir: session.outputDirectory }, copied)).rejects.toThrow(/recipe layer/u);
    await expect(session.generate.call({}, { dir: join(context.root, "caller-output") }, {})).rejects.toThrow(/escaped/u);
  });

  test("rejects a caller StyleX rule re-emitted as a standalone CSS asset", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const source = `import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ local: { color: "magenta" } });
export const className = stylex.props(styles.local).className;
`;
    await write(entry, source);
    const graph = graphExpectation(context, "caller-rule-output", "client", [entry]);
    const session = await configureGraph(context, graph);
    await session.transform.call(resolver(), source, entry);
    const oracle = createStylexTransformCollector(context.root);
    await oracle.transform(source, entry);
    const rule = oracle.seal()[0]?.[1];
    assert.ok(rule !== undefined);
    await expect(session.generate.call({}, { dir: session.outputDirectory }, {
      "duplicate.css": {
        fileName: "duplicate.css",
        source: rule.ltr,
        type: "asset",
      },
    })).rejects.toThrow(/StyleX rule|standalone recipe/u);
    expect(await receiptExists(session.generation, graph.id)).toBe(false);
  });

  test("rejects serve, watch, HMR, and caller-owned topology", async () => {
    const unusedGeneration: StylexGenerationHandleV1 = {
      directory: join(tmpdir(), "unused-stylex-generation"),
      planSha256: "0".repeat(64),
    };
    const makePlugin = () => stylexVite({
      generation: unusedGeneration,
      graphId: "client",
      rootDirectory: resolve(tmpdir()),
    });
    const servePlugin = makePlugin();
    await expect(handler<ConfigHook>(servePlugin.config).call(
      {},
      {},
      { command: "serve", mode: "development" },
    )).rejects.toThrow(/one-shot builds|HMR/u);

    const unsupported: readonly Record<string, unknown>[] = [
      { root: resolve(tmpdir(), "other-root") },
      { publicDir: "public" },
      { build: { assetsInlineLimit: 4096 } },
      { build: { assetsDir: "assets" } },
      { build: { copyPublicDir: true } },
      { build: { cssCodeSplit: true } },
      { build: { emptyOutDir: true } },
      { build: { lib: { entry: "src/main.ts" } } },
      { build: { outDir: "dist" } },
      { build: { rollupOptions: { external: ["./local.js"] } } },
      { build: { rollupOptions: { input: "src/main.ts" } } },
      { build: { rollupOptions: { output: { dir: "dist" } } } },
      { build: { rolldownOptions: { external: ["./local.js"] } } },
      { build: { rolldownOptions: { input: "src/main.ts" } } },
      { build: { rolldownOptions: { output: { dir: "dist" } } } },
      { build: { watch: {} } },
      { build: { write: false } },
    ];
    for (const config of unsupported) {
      const plugin = makePlugin();
      await expect(handler<ConfigHook>(plugin.config).call(
        {},
        config,
        { command: "build", mode: "production" },
      )).rejects.toThrow(/disables|owns|watch/u);
    }

    expect(() => handler<() => void>(makePlugin().configureServer)()).toThrow(/serve|HMR/u);
    expect(() => handler<() => void>(makePlugin().handleHotUpdate)()).toThrow(/HMR/u);
  });

  test("validates both resolved Vite 8 bundler aliases without relying on object identity", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "resolved-aliases", "client", [entry]);
    const generationValue = await generation(context, graph);
    for (const mutation of [
      { input: [join(context.root, "src/other.ts")] },
      { input: [entry], external: ["react"] },
      { input: [entry], output: { sourcemap: "hidden" } },
    ]) {
      const plugin = stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root });
      const config = await handler<ConfigHook>(plugin.config).call({}, {}, { command: "build", mode: "production" });
      assert.ok(typeof config === "object" && config !== null && "build" in config);
      await expect(handler<(value: unknown) => Promise<void>>(plugin.configResolved)({
        ...config,
        build: { ...config.build as object, rolldownOptions: mutation, ssr: false, watch: null },
        command: "build",
      })).rejects.toThrow(/input differs|externalization|output options/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
    const plugin = stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root });
    const config = await handler<ConfigHook>(plugin.config).call({}, {}, { command: "build", mode: "production" });
    assert.ok(typeof config === "object" && config !== null && "build" in config);
    await expect(handler<(value: unknown) => Promise<void>>(plugin.configResolved)({
      ...config,
      build: { ...config.build as object, rolldownOptions: { input: [entry], platform: "browser" }, ssr: false, watch: null },
      command: "build",
    })).resolves.toBeUndefined();
  });

  test("rejects changed chunk bytes and linkage after generateBundle", async () => {
    for (const part of ["code", "imports", "dynamicImports", "isEntry", "facadeModuleId", "modules"] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "globalThis.fixture = 'before';\n");
      const graph = graphExpectation(context, `chunk-mutation-${part.toLowerCase()}`, "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [
          stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
          {
            name: `mutate-generated-${part}`,
            generateBundle: {
              order: "post",
              handler(_options, bundle) {
                const chunk = Object.values(bundle).find((output) => output.type === "chunk");
                assert.ok(chunk?.type === "chunk");
                if (part === "code") chunk.code = chunk.code.replace("before", "after!");
                else if (part === "imports") chunk.imports.push("changed.js");
                else if (part === "dynamicImports") chunk.dynamicImports.push("changed.js");
                else if (part === "isEntry") chunk.isEntry = !chunk.isEntry;
                else if (part === "facadeModuleId") chunk.facadeModuleId = join(context.root, "src/other.ts");
                else chunk.modules = {};
              },
            },
          },
        ],
      })).rejects.toThrow(/bundle bytes or linkage changed/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("rejects settled chunk drift even when the in-memory bundle stays unchanged", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "globalThis.fixture = 'before';\n");
    const graph = graphExpectation(context, "settled-chunk-drift", "client", [entry]);
    const generationValue = await generation(context, graph);
    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
        {
          name: "mutate-written-chunk",
          writeBundle: {
            order: "pre",
            async handler(options, bundle) {
              const chunk = Object.values(bundle).find((output) => output.type === "chunk");
              assert.ok(chunk?.type === "chunk" && options.dir !== undefined);
              await writeFile(join(options.dir, chunk.fileName), chunk.code.replace("before", "after!"));
            },
          },
        },
      ],
    })).rejects.toThrow(/settled output differs from its generated byte snapshot/u);
    expect(await receiptExists(generationValue, graph.id)).toBe(false);
  });

  test("rejects injected source-map comments despite map-disabled config", async () => {
    for (const directive of [
      "//# sourceMappingURL=hidden.js.map", "//@ sourceMappingURL=hidden.js.map",
      "/*# sourceMappingURL=hidden.js.map */", "/*@ sourceMappingURL=data:application/json;base64,e30= */",
      "globalThis.interpolation = `${/*# sourceMappingURL=hidden.js.map */ 1}`;",
    ]) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "globalThis.fixture = true;\n");
      const graph = graphExpectation(context, "injected-map", "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [
          stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
          { name: "inject-unverified-map", generateBundle(_options, bundle) {
            const chunk = Object.values(bundle).find((output) => output.type === "chunk");
            assert.ok(chunk?.type === "chunk");
            chunk.code += `\n${directive}\n`;
          } },
        ],
      })).rejects.toThrow(/source-map references/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("allows source-map directive text in JavaScript string, regex and template tokens", async () => {
    const source = [
      'globalThis.literal = "//# sourceMappingURL=example.map";',
      "globalThis.blockLiteral = '/*# sourceMappingURL=example.map */';",
      'globalThis.regex = /[//# sourceMappingURL=]/u;',
      'globalThis.template = `//# sourceMappingURL=example.map`;',
      'globalThis.tagged = String.raw`/*# sourceMappingURL=example.map */`;',
      '// Documentation mentions //# sourceMappingURL=example.map.',
      '/* Documentation mentions /*# sourceMappingURL=example.map */',
    ].join("\n");
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, source);
    await write(join(context.root, "src/literals.js"), source);
    await writeFile(entry, `${source}\nglobalThis.rawAsset = new URL('./literals.js', import.meta.url).href;\n`);
    const graph = graphExpectation(context, "map-lookalikes", "client", [entry]);
    const generationValue = await generation(context, graph);
    await expect(viteBuild({
      configFile: false, logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    })).resolves.toBeDefined();
    expect(await receiptExists(generationValue, graph.id)).toBe(true);
  });

  test("bounds diagnostics while retaining exact first and last failure bytes", () => {
    const output = createBoundedDiagnostics(8);
    output.append(Buffer.from("first"));
    expect(output.render("stdout").toString()).toBe("first");
    output.append(Buffer.from("middle"));
    output.append(Buffer.from("last"));
    expect(output.retainedBytes).toBe(8);
    expect(output.render("stdout").toString()).toBe("firs\n[stdout: 7 bytes omitted; first and last diagnostics retained]\nlast");
    const oversized = createBoundedDiagnostics(8);
    oversized.append(Buffer.from("first middle last"));
    expect(oversized.retainedBytes).toBe(8);
    expect(oversized.render("stderr").toString()).toBe("firs\n[stderr: 9 bytes omitted; first and last diagnostics retained]\nlast");
    const untouched = createBoundedDiagnostics(8);
    expect(untouched.render("stdout").length).toBe(0);
    const unicode = createBoundedDiagnostics(16);
    const bytes = Buffer.from("aé🙂z");
    for (const byte of bytes) unicode.append(Buffer.from([byte]));
    expect(unicode.render("stdout")).toEqual(bytes);
    expect(() => createBoundedDiagnostics(1)).toThrow();
    expect(() => createBoundedDiagnostics(1024 * 1024 + 1)).toThrow();
  });

  test("distinguishes real CSS map comments from strings and URL tokens", async () => {
    const benign = [
      '.literal::before { content: "/*# sourceMappingURL=example.map */"; }',
      ".quoted::before { content: '/*@ sourceMappingURL=example.map */'; }",
      '.escaped::before { content: "\\\"/*# sourceMappingURL=example.map */"; }',
      '.url { background-image: url(data:,/*#sourceMappingURL=example.map*/); }',
      '.escaped-url { background-image: u\\72l(data:,/*#sourceMappingURL=example.map*/); }',
      '/* Documentation mentions /*# sourceMappingURL=example.map */',
    ].join("\n");
    for (const directive of ["", "/*# sourceMappingURL=example.map */", "/*@ sourceMappingURL=data:application/json;base64,e30= */"]) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "export const entry = true;\n");
      const graph = graphExpectation(context, "css-map-comments", "client", [entry]);
      const session = await configureGraph(context, graph);
      const outcome = session.generate.call({}, { dir: session.outputDirectory }, {
        "style.css": { fileName: "style.css", source: `${benign}\n${directive}`, type: "asset" },
      });
      if (directive === "") await expect(outcome).resolves.toBeUndefined();
      else await expect(outcome).rejects.toThrow(/source-map references/u);
    }
  });

  test("rejects source maps copied as native assets with otherwise valid provenance", async () => {
    for (const [name, source] of [
      ["copied.map", '{"version":3,"sources":["private.ts"],"sourcesContent":["private source"],"names":[],"mappings":"AAAA"}'],
      ["copied.js", "globalThis.asset = true;\n//# sourceMappingURL=data:application/json;base64,e30=\n"],
      ["copied.JS", "globalThis.asset = true;\n//# sourceMappingURL=data:application/json;base64,e30=\n"],
      ["copied.MJS", "globalThis.asset = true;\n/*# sourceMappingURL=data:application/json;base64,e30= */\n"],
      ["copied.CJS", "globalThis.asset = true;\n//@ sourceMappingURL=data:application/json;base64,e30=\n"],
    ] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(join(context.root, "src", name), source);
      await write(entry, `globalThis.assetUrl = new URL('./${name}', import.meta.url).href;\n`);
      const graph = graphExpectation(context, name.replace(".", "-").toLowerCase(), "client", [entry]);
      const generationValue = await generation(context, graph);
      await expect(viteBuild({
        configFile: false, logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(/source-map output|source-map references/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }
  });

  test("rejects caller sourcemaps without consuming the graph slot", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "unsafe-sourcemaps", "client", [entry]);
    const generationValue = await generation(context, graph);

    for (const sourcemap of [true, "inline", "hidden"] as const) {
      await expect(viteBuild({
        build: { sourcemap },
        configFile: false,
        logLevel: "silent",
        plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
      })).rejects.toThrow(/build\.sourcemap false or undefined/u);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }

    await expect(viteBuild({
      build: { sourcemap: false },
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    })).resolves.toBeDefined();
    expect(await receiptExists(generationValue, graph.id)).toBe(true);
  });

  test("rejects later config sourcemap and output mutations without consuming the graph slot", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "later-config-mutations", "client", [entry]);
    const generationValue = await generation(context, graph);
    const mutations = [
      {
        config: { build: { sourcemap: "inline" } },
        expected: /disable sourcemap output/u,
        name: "enable-sourcemap",
      },
      {
        config: { build: { rollupOptions: { output: { entryFileNames: "caller/[name].js" } } } },
        expected: /owns resolved Rollup output options/u,
        name: "replace-rollup-output",
      },
    ] as const;

    for (const mutation of mutations) {
      await expect(viteBuild({
        configFile: false,
        logLevel: "silent",
        plugins: [
          stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
          {
            name: mutation.name,
            config() {
              return mutation.config;
            },
          },
        ],
      })).rejects.toThrow(mutation.expected);
      expect(await receiptExists(generationValue, graph.id)).toBe(false);
    }

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    })).resolves.toBeDefined();
    expect(await receiptExists(generationValue, graph.id)).toBe(true);
  });

  test("rejects a later configResolved output mutation without consuming the graph slot", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "later-resolved-output", "client", [entry]);
    const generationValue = await generation(context, graph);

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
        {
          name: "mutate-resolved-rollup-output",
          configResolved(config) {
            config.build.rollupOptions.output = { sourcemap: "inline" };
          },
        },
      ],
    })).rejects.toThrow(/owns resolved Rollup output options/u);
    expect(await receiptExists(generationValue, graph.id)).toBe(false);

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root })],
    })).resolves.toBeDefined();
    expect(await receiptExists(generationValue, graph.id)).toBe(true);
  });

  test("rejects a later Rollup sourcemap output mutation without sealing a receipt", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "later-output-sourcemap", "client", [entry]);
    const generationValue = await generation(context, graph);

    await expect(viteBuild({
      configFile: false,
      logLevel: "silent",
      plugins: [
        stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root }),
        {
          name: "enable-rollup-output-sourcemap",
          outputOptions(outputOptions) {
            return { ...outputOptions, sourcemap: "inline" };
          },
        },
      ],
    })).rejects.toThrow(/Rollup sourcemap output.*disabled/u);
    expect(await receiptExists(generationValue, graph.id)).toBe(false);
  });

  test("rejects a client graph configured as SSR", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = true;\n");
    const graph = graphExpectation(context, "wrong-target", "client", [entry]);
    const generationValue = await generation(context, graph);
    const plugin = stylexVite({ generation: generationValue, graphId: graph.id, rootDirectory: context.root });
    const configured = await handler<ConfigHook>(plugin.config).call(
      {},
      {},
      { command: "build", mode: "production" },
    );
    assert.ok(typeof configured === "object" && configured !== null && "build" in configured);
    const build = configured.build;
    assert.ok(typeof build === "object" && build !== null && "outDir" in build && typeof build.outDir === "string");
    await expect(handler<(config: unknown) => Promise<void>>(plugin.configResolved)({
      build: { assetsInlineLimit: 0, copyPublicDir: false, cssCodeSplit: false, outDir: build.outDir, rollupOptions: { input: [entry] }, sourcemap: false, ssr: entry, watch: null, write: true },
      command: "build",
      publicDir: "",
      root: context.root,
    })).rejects.toThrow(/target differs/u);
  });
});
