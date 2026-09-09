import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, test } from "bun:test";

import type { StylexArtifactV1, StylexPackageManifestV1 } from "./contracts.js";
import {
  artifactForFile,
  canonicalJson,
  compilerContract,
  compilerSha256,
  serializeStylexPackageRules,
  sha256,
  stylexRulesSha256,
  stylexUnionPolicySha256,
  validateStylexPackageManifest,
} from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_AUXILIARY_TRACE_CREATOR,
  STYLEX_NEXT_PROXY_RENAME_CREATOR,
  STYLEX_NEXT_FRAMEWORK_INPUTS,
  STYLEX_NEXT_EMPTY_ENTRY_INPUTS,
  STYLEX_NEXT_EMPTY_ENTRY_LOADER,
  STYLEX_NEXT_TARGETS,
  STYLEX_NEXT_SSG_INPUTS,
  STYLEX_NEXT_SSG_INITIAL_SOURCE,
  compareStylexNextStrings,
  validateStylexNextBuildRecord,
  validateStylexNextPostprocessingReceipt,
  type StylexNextFrameworkRole,
} from "./next-contracts.js";
import { captureStylexNextAuxiliaryTraceAsset } from "./next-auxiliary.js";
import { serializeStylexNextSsgRoutes } from "./next-ssg.js";
import {
  STYLEX_NEXT_GENERATED_ENTRY_SOURCE,
  acquireStylexNextOutputLease,
  completeStylexNextBuild,
  finalizeStylexNextDiscovery,
  prepareStylexNextAttempt,
  readStylexNextAttemptPlan,
  readStylexNextGraphReceipt,
  releaseStylexNextOutputLease,
  stylexNextOutputLeasePath,
  writeStylexNextGraphReceipt,
  proveStylexNextFrameworkAsset,
  verifySettledStylexNextFrameworkAsset,
  proveStylexNextEmptyEntryBootstrap,
  verifySettledStylexNextEmptyEntryBootstrap,
} from "./next-generation.js";
import { transformStylexNextModule } from "./next-loader.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createFixture(): Promise<Readonly<{
  foundation: StylexArtifactV1;
  manifestPath: string;
  root: string;
  siteCss: StylexArtifactV1;
  source: string;
  sourcePath: string;
}>> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ui-stylex-next-generation-")));
  roots.push(root);
  const packageRoot = join(root, "packages", "ui");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await mkdir(join(packageRoot, "dist"));
  await mkdir(join(root, "src"));
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name: "@fixture/ui", type: "module", version: "1.0.0" })}\n`);
  await writeFile(join(packageRoot, "dist", "index.js"), "export const runtime = true;\n");
  await writeFile(join(packageRoot, "src", "compiler-foundation.css"), "@layer base, components;\n@layer components.fixture-ui.legacy;\n");
  const serializer = { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" } as const;
  const rules = [] as const;
  await writeFile(join(packageRoot, "dist", "stylex.css"), serializeStylexPackageRules(rules, serializer));
  const foundation = await artifactForFile(packageRoot, "src/compiler-foundation.css");
  const manifest: StylexPackageManifestV1 = validateStylexPackageManifest({
    buildTools: [],
    compiler: compilerContract,
    compilerFoundation: "src/compiler-foundation.css",
    compilerSha256,
    kind: "hraness-stylex-package-manifest",
    package: { name: "@fixture/ui", version: "1.0.0" },
    rules,
    rulesSha256: stylexRulesSha256(rules),
    runtime: [await artifactForFile(packageRoot, "dist/index.js")],
    schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"),
    standaloneSerializer: serializer,
    stylesheets: [foundation],
  });
  const manifestPath = "packages/ui/dist/stylex-manifest.json";
  await writeFile(join(root, manifestPath), `${canonicalJson(manifest)}\n`);
  const sourcePath = join(root, "src", "app.tsx");
  const source = [
    'import * as stylex from "@stylexjs/stylex";',
    'const styles = stylex.create({ root: { color: "rgb(1, 2, 3)" } });',
    'export const className = stylex.props(styles.root).className;',
    "",
  ].join("\n");
  await writeFile(sourcePath, source);
  await writeFile(join(root, "src", "site.css"), "body { margin: 0; }\n");
  return {
    foundation: { ...foundation, path: `packages/ui/${foundation.path}` },
    manifestPath,
    root,
    siteCss: await artifactForFile(root, "src/site.css"),
    source,
    sourcePath,
  };
}

function output(target: string): readonly StylexArtifactV1[] {
  const source = `export const ${target.replaceAll("-", "_")} = true;\n`;
  const map = `{"mappings":"AAAA","names":[],"sources":["src/app.tsx"],"version":3}`;
  return [
    { bytes: Buffer.byteLength(source), path: `static/${target}.js`, sha256: sha256(source) },
    { bytes: Buffer.byteLength(map), path: `static/${target}.js.map`, sha256: sha256(map) },
  ];
}

async function materializeOutputs(
  root: string,
  outputDirectory: string,
  target: string,
  includeCss = false,
): Promise<void> {
  const contents = new Map<string, string>([
    [`static/${target}.js`, `export const ${target.replaceAll("-", "_")} = true;\n`],
    [`static/${target}.js.map`, `{"mappings":"AAAA","names":[],"sources":["src/app.tsx"],"version":3}`],
    ...(includeCss ? [["static/stylex.css", "c"] as const] : []),
  ]);
  for (const [path, source] of contents) {
    const absolute = join(root, outputDirectory, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, source);
  }
}

function sourceMaps(target: string): readonly StylexArtifactV1[] {
  return output(target).filter(({ path }) => path.endsWith(".map"));
}

async function materializeSsg(root: string, outputDirectory: string) {
  for (const [path] of STYLEX_NEXT_SSG_INPUTS) {
    const destination = join(root, "node_modules/next", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(new URL(`../node_modules/next/${path}`, import.meta.url)));
  }
  await writeFile(join(root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}');
  const path = "static/build/_ssgManifest.js";
  const outputRoot = join(root, outputDirectory);
  await mkdir(dirname(join(outputRoot, path)), { recursive: true });
  await writeFile(join(outputRoot, path), STYLEX_NEXT_SSG_INITIAL_SOURCE);
  await writeFile(join(outputRoot, "BUILD_ID"), "build");
  await writeFile(join(outputRoot, "prerender-manifest.json"), JSON.stringify({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }, null, 2));
  await writeFile(join(outputRoot, "routes-manifest.json"), JSON.stringify({ version: 3, appType: "app", staticRoutes: [], dynamicRoutes: [] }, null, 2));
  return await proveStylexNextFrameworkAsset(root, "client", await artifactForFile(outputRoot, path), Buffer.from(STYLEX_NEXT_SSG_INITIAL_SOURCE));
}

describe("StyleX Next generation", () => {
  test("rejects stale adapter, union policy, or schemas after an attacker rehashes the plan", async () => {
    const context = await createFixture();
    const attempt = await prepareStylexNextAttempt({
      attemptId: "policy-binding",
      packageManifests: [context.manifestPath],
      requiredSources: { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [] },
      rootDirectory: context.root,
    });
    const path = join(attempt.directory, "plan.json");
    const source = await readFile(path, "utf8");
    const plan = JSON.parse(source) as Record<string, unknown>;
    assert.equal(plan.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
    assert.equal(plan.adapterVersion, "hraness-stylex-next-v2");
    assert.equal(plan.schemaVersion, 2);
    assert.equal(plan.unionPolicySha256, stylexUnionPolicySha256);
    assert.equal(plan.compilerSha256, compilerSha256);
    const missingPolicy = { ...plan };
    delete missingPolicy.unionPolicySha256;
    for (const forgedPlan of [
      { ...plan, adapterVersion: "hraness-stylex-next-v1" },
      { ...plan, unionPolicySha256: sha256("obsolete union policy") },
      missingPolicy,
      { ...plan, schemaVersion: 1 },
      { ...missingPolicy, schemaVersion: 1 },
    ]) {
      const forgedSource = `${canonicalJson(forgedPlan)}\n`;
      await writeFile(path, forgedSource);
      const forged = { ...attempt, planSha256: sha256(forgedSource) };
      assert.notEqual(forged.planSha256, attempt.planSha256);
      assert.equal(sha256(await readFile(path)), forged.planSha256);
      await assert.rejects(readStylexNextAttemptPlan(forged));
      await assert.rejects(finalizeStylexNextDiscovery(forged, context.root));
      await assert.rejects(readFile(join(attempt.directory, "complete.json")), /ENOENT/u);
    }
    await writeFile(path, source);
    assert.deepEqual(await readStylexNextAttemptPlan(attempt), plan);
  });

  test("revalidates exact empty bootstrap grammar, original creators and bytes at settlement", async () => {
    const context = await createFixture();
    for (const [path] of STYLEX_NEXT_EMPTY_ENTRY_INPUTS) {
      const destination = join(context.root, "node_modules/next", path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(new URL(`../node_modules/next/${path}`, import.meta.url)));
    }
    await writeFile(join(context.root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}');
    const graph = {
      chunkIds: [167], dependencies: [], entryModuleId: 4441,
      entrypoints: ["app/empty"], loader: STYLEX_NEXT_EMPTY_ENTRY_LOADER, loaderOptions: "server=false",
      originalSource: { bytes: 0, sha256: sha256("") },
    } as const;
    const source = Buffer.from("(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[167],{4441:()=>{}},_=>{_.O(0,[],()=>_(_.s=4441)),_N_E=_.O()}]);");
    const path = "static/empty.js";
    const output = { bytes: source.byteLength, path, sha256: sha256(source) };
    const record = await proveStylexNextEmptyEntryBootstrap(context.root, "client", graph, output, source);
    const outputRoot = join(context.root, ".next");
    await mkdir(dirname(join(outputRoot, path)), { recursive: true });
    await writeFile(join(outputRoot, path), source);
    await verifySettledStylexNextEmptyEntryBootstrap(context.root, outputRoot, "client", record);
    await assert.rejects(proveStylexNextEmptyEntryBootstrap(context.root, "node-rsc", graph, output, source), /Only Next client/u);
    await assert.rejects(proveStylexNextEmptyEntryBootstrap(context.root, "client", graph, { ...output, sha256: sha256("wrong") }, source), /output bytes changed/u);
    await writeFile(join(outputRoot, path), source.toString().replace("()=>{}", "()=>{fetch('/') }"));
    await assert.rejects(verifySettledStylexNextEmptyEntryBootstrap(context.root, outputRoot, "client", record), /output changed/u);
    await assert.rejects(verifySettledStylexNextEmptyEntryBootstrap(context.root, outputRoot, "client", { ...record, output: await artifactForFile(outputRoot, path) }), /exact proven empty bootstrap/u);
    await writeFile(join(outputRoot, path), source);
    const creator = record.inputs[0]!;
    await writeFile(join(context.root, creator.path), "changed loader");
    await assert.rejects(verifySettledStylexNextEmptyEntryBootstrap(context.root, outputRoot, "client", record), /pinned original bytes/u);
  });
  test("binds framework payloads to pinned inputs and independently rejects settlement drift", async () => {
    const context = await createFixture();
    const copyInput = async (role: StylexNextFrameworkRole): Promise<void> => {
      const path = STYLEX_NEXT_FRAMEWORK_INPUTS[role][0];
      const destination = join(context.root, "node_modules/next", path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(new URL(`../node_modules/next/${path}`, import.meta.url)));
      await writeFile(join(context.root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}');
    };
    await copyInput("ssg-manifest");
    const path = "static/build/_ssgManifest.js";
    const source = Buffer.from("self.__SSG_MANIFEST=new Set;self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()");
    const output = { bytes: source.byteLength, path, sha256: sha256(source) };
    const record = await proveStylexNextFrameworkAsset(context.root, "client", output, source);
    assert.equal(record.input.sha256, STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"][1]);
    const outputRoot = join(context.root, ".next");
    await mkdir(dirname(join(outputRoot, path)), { recursive: true });
    await writeFile(join(outputRoot, path), source);
    await verifySettledStylexNextFrameworkAsset(context.root, outputRoot, "client", record);
    await writeFile(join(outputRoot, path), "self.__SSG_MANIFEST=fetch('/');");
    await assert.rejects(verifySettledStylexNextFrameworkAsset(context.root, outputRoot, "client", record), /output changed/u);
    const forged = { ...record, output: await artifactForFile(outputRoot, path) };
    await assert.rejects(verifySettledStylexNextFrameworkAsset(context.root, outputRoot, "client", forged));
    await writeFile(join(outputRoot, path), source);
    await writeFile(join(context.root, record.input.path), "changed emitter");
    await assert.rejects(verifySettledStylexNextFrameworkAsset(context.root, outputRoot, "client", record), /pinned original bytes/u);
    await copyInput("ssg-manifest");
    await writeFile(join(context.root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.13"}');
    await assert.rejects(proveStylexNextFrameworkAsset(context.root, "client", output, source), /package version/u);
    await copyInput("polyfill-nomodule");
    const polyfill = await readFile(join(context.root, "node_modules/next", STYLEX_NEXT_FRAMEWORK_INPUTS["polyfill-nomodule"][0]));
    const polyfillOutput = { bytes: polyfill.byteLength, path: "static/chunks/polyfills-42372ed130431b0a.js", sha256: sha256(polyfill) };
    assert.equal((await proveStylexNextFrameworkAsset(context.root, "client", polyfillOutput, polyfill)).role, "polyfill-nomodule");
    const changed = Buffer.concat([polyfill, Buffer.from("\n")]);
    await assert.rejects(proveStylexNextFrameworkAsset(context.root, "client", { ...polyfillOutput, bytes: changed.byteLength, sha256: sha256(changed) }, changed), /pinned original bytes/u);
    await assert.rejects(proveStylexNextFrameworkAsset(context.root, "node-rsc", polyfillOutput, polyfill), /no reviewed framework role/u);
  });
  test("rejects nested state and Next output directories", async () => {
    const context = await createFixture();
    await assert.rejects(
      prepareStylexNextAttempt({
        attemptId: "nested-state",
        outputDirectory: ".next",
        packageManifests: [context.manifestPath],
        requiredSources: { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [] },
        rootDirectory: context.root,
        stateDirectory: ".next/stylex-evidence",
      }),
      /must be path-disjoint/u,
    );
    await assert.rejects(
      prepareStylexNextAttempt({
        attemptId: "nested-output",
        outputDirectory: ".stylex-next/output",
        packageManifests: [context.manifestPath],
        requiredSources: { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [] },
        rootDirectory: context.root,
        stateDirectory: ".stylex-next",
      }),
      /must be path-disjoint/u,
    );

    await assert.rejects(
      prepareStylexNextAttempt({
        attemptId: "empty-inventory",
        packageManifests: [context.manifestPath],
        requiredSources: { client: [], "edge-rsc": [], "node-rsc": [] },
        rootDirectory: context.root,
      }),
      /must inventory at least one repository-owned production source/u,
    );
  });

  test("serializes the same physical output across different state directories", async () => {
    const context = await createFixture();
    const requiredSources = { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [] } as const;
    const firstAttempt = await prepareStylexNextAttempt({
      attemptId: "state-a",
      packageManifests: [context.manifestPath],
      requiredSources,
      rootDirectory: context.root,
      stateDirectory: ".stylex-next-a",
    });
    const secondAttempt = await prepareStylexNextAttempt({
      attemptId: "state-b",
      packageManifests: [context.manifestPath],
      requiredSources,
      rootDirectory: context.root,
      stateDirectory: ".stylex-next-b",
    });
    assert.notEqual(dirname(firstAttempt.directory), dirname(secondAttempt.directory));
    const firstPath = stylexNextOutputLeasePath(context.root, ".next");
    const secondPath = stylexNextOutputLeasePath(context.root, ".next");
    assert.equal(firstPath, secondPath);
    assert.ok(!firstPath.includes(".stylex-next-a") && !firstPath.includes(".stylex-next-b"));
    const lease = await acquireStylexNextOutputLease(context.root, ".next", "state-a");
    try {
      await assert.rejects(
        acquireStylexNextOutputLease(context.root, ".next", "state-b"),
        /EEXIST/u,
      );
    } finally {
      await releaseStylexNextOutputLease(lease);
    }
    const reacquired = await acquireStylexNextOutputLease(context.root, ".next", "state-b");
    await releaseStylexNextOutputLease(reacquired);
  });

  test("writes mixed-case graph artifacts only in canonical code-unit order", async () => {
    const context = await createFixture();
    const attempt = await prepareStylexNextAttempt({
      attemptId: "mixed-case",
      packageManifests: [context.manifestPath],
      requiredSources: { client: [], "edge-rsc": [], "node-rsc": ["src/app.tsx"] },
      rootDirectory: context.root,
    });
    const frameworkInput = STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"][0];
    const frameworkInputPath = join(context.root, "node_modules/next", frameworkInput);
    await mkdir(dirname(frameworkInputPath), { recursive: true });
    await writeFile(frameworkInputPath, await readFile(new URL(`../node_modules/next/${frameworkInput}`, import.meta.url)));
    await writeFile(join(context.root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}');
    const frameworkSource = Buffer.from("self.__SSG_MANIFEST=new Set;self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()");
    const frameworkOutput = {
      bytes: frameworkSource.byteLength,
      path: "static/ZXEfbqoku3Jea6WTn_4bj/_ssgManifest.js",
      sha256: sha256(frameworkSource),
    };
    const framework = await proveStylexNextFrameworkAsset(
      context.root,
      "client",
      frameworkOutput,
      frameworkSource,
    );
    const outputs = [...output("client"), frameworkOutput];
    const canonical = [...outputs].sort((left, right) => compareStylexNextStrings(left.path, right.path));
    const localized = [...outputs].sort((left, right) => left.path.localeCompare(right.path, "en"));
    assert.notDeepEqual(localized.map(({ path }) => path), canonical.map(({ path }) => path));
    const receipt = await writeStylexNextGraphReceipt({
      attempt,
      cssInputs: [],
      emptyEntryBootstraps: [],
      entrypoints: [{
        css: [], files: ["static/client.js"], javascript: ["static/client.js"], name: "app/page", stylexCss: [],
      }],
      frameworkAssets: [framework],
      auxiliaryTraceAssets: [],
      javascriptChunks: ["static/client.js"],
      mode: "discovery",
      outputDirectory: ".stylex-next/mixed-case/next-discovery",
      outputs: canonical,
      rootDirectory: context.root,
      sourceMaps: sourceMaps("client"),
      target: "client",
      webpackVersion: "5.99.0",
    });
    assert.deepEqual(receipt.outputs.map(({ path }) => path), canonical.map(({ path }) => path));
    await assert.rejects(
      writeStylexNextGraphReceipt({
        attempt,
        cssInputs: [],
        emptyEntryBootstraps: [],
        entrypoints: [{
          css: [], files: ["static/client.js"], javascript: ["static/client.js"], name: "app/page", stylexCss: [],
        }],
        frameworkAssets: [framework],
        auxiliaryTraceAssets: [],
        javascriptChunks: ["static/client.js"],
        mode: "discovery",
        outputDirectory: ".stylex-next/mixed-case/next-discovery",
        outputs: localized,
        rootDirectory: context.root,
        sourceMaps: sourceMaps("client"),
        target: "client",
        webpackVersion: "5.99.0",
      }),
      /Next graph outputs must be path sorted/u,
    );
  });

  // The complete mutation matrix repeatedly rehashes pinned framework inputs and
  // both physical output trees. Keep every check within a bounded integration
  // budget instead of Bun's five-second unit-test default on shared CI runners.
  test("joins exact worker receipts across discovery and delivery before completing", async () => {
    const context = await createFixture();
    const attempt = await prepareStylexNextAttempt({
      attemptId: "fixture",
      packageManifests: [context.manifestPath],
      requiredSources: {
        client: ["src/app.tsx"],
        "edge-rsc": [],
        "node-rsc": ["src/app.tsx"],
      },
      rootDirectory: context.root,
    });
    assert.deepEqual((await readStylexNextAttemptPlan(attempt)).requiredSources, {
      client: ["src/app.tsx"],
      "edge-rsc": [],
      "node-rsc": ["src/app.tsx"],
    });
    for (const target of STYLEX_NEXT_TARGETS) {
      const empty = target === "edge-rsc";
      if (!empty) {
        await materializeOutputs(context.root, ".stylex-next/fixture/next-discovery", target);
        await transformStylexNextModule({
          options: {
            attemptDirectory: attempt.directory,
            mode: "discovery",
            planSha256: attempt.planSha256,
            rootDirectory: context.root,
            target,
          },
          resourcePath: context.sourcePath,
          source: context.source,
        });
      }
      const ssg = target === "client" ? [await materializeSsg(context.root, ".stylex-next/fixture/next-discovery")] : [];
      await writeStylexNextGraphReceipt({
        attempt,
        cssInputs: target === "client" ? [context.foundation, context.siteCss] : [],
        entrypoints: empty ? [] : [{
          css: [], files: [`static/${target}.js`], javascript: [`static/${target}.js`],
          name: target === "client" ? "app/layout" : target, stylexCss: [],
        }],
        emptyEntryBootstraps: [],
        frameworkAssets: ssg,
        auxiliaryTraceAssets: [],
        javascriptChunks: empty ? [] : [`static/${target}.js`],
        mode: "discovery",
        outputDirectory: ".stylex-next/fixture/next-discovery",
        outputs: empty ? [] : [...output(target), ...ssg.map(({ output }) => output)].sort((a, b) => compareStylexNextStrings(a.path, b.path)),
        rootDirectory: context.root,
        sourceMaps: empty ? [] : sourceMaps(target),
        target,
        webpackVersion: "5.99.0",
      });
    }
    const discoveryOutput = join(attempt.directory, "next-discovery/static/build/_ssgManifest.js");
    await writeFile(discoveryOutput, serializeStylexNextSsgRoutes([]));
    const discoveryGraphPath = join(attempt.directory, "discovery/client/graph.json");
    const discoveryGraphSource = await readFile(discoveryGraphPath, "utf8");
    const discoveryClientGraph = JSON.parse(discoveryGraphSource) as {
      cssInputs: StylexArtifactV1[];
      entrypoints: { name: string }[];
    };
    await writeFile(discoveryGraphPath, `${canonicalJson({
      ...discoveryClientGraph,
      entrypoints: discoveryClientGraph.entrypoints.map((entry) => ({ ...entry, name: "pages/index" })),
    })}\n`);
    await assert.rejects(
      finalizeStylexNextDiscovery(attempt, context.root),
      /does not support Pages Router client entries/u,
    );
    await writeFile(discoveryGraphPath, discoveryGraphSource);
    const forbiddenDiscoveryGeneratedCss = {
      bytes: 0,
      path: ".stylex-next/fixture/generated/stylex.css",
      sha256: sha256(""),
    };
    await writeFile(discoveryGraphPath, `${canonicalJson({
      ...discoveryClientGraph,
      cssInputs: [...discoveryClientGraph.cssInputs, forbiddenDiscoveryGeneratedCss]
        .sort((left, right) => compareStylexNextStrings(left.path, right.path)),
    })}\n`);
    await assert.rejects(
      finalizeStylexNextDiscovery(attempt, context.root),
      /Only the Next delivery client graph may contain generated StyleX CSS/u,
    );
    await writeFile(discoveryGraphPath, discoveryGraphSource);
    const finalized = await finalizeStylexNextDiscovery(attempt, context.root);
    const discoverySealPath = join(attempt.directory, "discovery/postprocessing.json");
    const discoverySeal = await readFile(discoverySealPath, "utf8");
    assert.equal(discoveryGraphSource.includes(sha256(STYLEX_NEXT_SSG_INITIAL_SOURCE)), true);
    assert.equal(discoverySeal.includes(sha256(serializeStylexNextSsgRoutes([]))), true);
    assert.ok(finalized.rules.length > 0);
    const finalCssLogical = ".stylex-next/fixture/generated/stylex.css";
    const finalCss = await artifactForFile(context.root, finalCssLogical);
    for (const target of STYLEX_NEXT_TARGETS) {
      const empty = target === "edge-rsc";
      if (!empty) {
        await materializeOutputs(context.root, ".next", target, target === "client");
        await transformStylexNextModule({
          options: {
            attemptDirectory: attempt.directory,
            mode: "delivery",
            planSha256: attempt.planSha256,
            rootDirectory: context.root,
            target,
          },
          resourcePath: context.sourcePath,
          source: context.source,
        });
      }
      const outputs = empty
        ? []
        : target === "client"
        ? [...output(target), { bytes: 1, path: "static/stylex.css", sha256: sha256("c") }]
        : output(target);
      const ssg = target === "client" ? [await materializeSsg(context.root, ".next")] : [];
      await writeStylexNextGraphReceipt({
        attempt,
        cssInputs: target === "client" ? [finalCss, context.foundation, context.siteCss].sort((left, right) => compareStylexNextStrings(left.path, right.path)) : [],
        entrypoints: empty ? [] : [{
          css: target === "client" ? ["static/stylex.css"] : [],
          files: target === "client" ? ["static/client.js", "static/stylex.css"] : [`static/${target}.js`],
          javascript: [`static/${target}.js`],
          name: target === "client" ? "app/layout" : target,
          stylexCss: target === "client" ? ["static/stylex.css"] : [],
        }],
        mode: "delivery",
        emptyEntryBootstraps: [],
        frameworkAssets: ssg,
        auxiliaryTraceAssets: [],
        javascriptChunks: empty ? [] : [`static/${target}.js`],
        outputDirectory: ".next",
        outputs: [...outputs, ...ssg.map(({ output }) => output)].sort((left, right) => compareStylexNextStrings(left.path, right.path)),
        rootDirectory: context.root,
        sourceMaps: empty ? [] : sourceMaps(target),
        target,
        webpackVersion: "5.99.0",
      });
    }
    const deliverySsgOutput = join(context.root, ".next/static/build/_ssgManifest.js");
    await writeFile(deliverySsgOutput, serializeStylexNextSsgRoutes([]));
    const discoveryManifestPath = join(attempt.directory, "next-discovery/prerender-manifest.json");
    const savedManifest = await readFile(discoveryManifestPath, "utf8");
    const deliveryManifestPath = join(context.root, ".next/prerender-manifest.json");
    await writeFile(deliveryManifestPath, JSON.stringify({ version: 4, routes: { "/delivery-drift": {} }, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }, null, 2));
    await writeFile(deliverySsgOutput, serializeStylexNextSsgRoutes(["/delivery-drift"]));
    await assert.rejects(completeStylexNextBuild(attempt, context.root), /route projection drifted between discovery and delivery/u);
    await writeFile(deliveryManifestPath, savedManifest);
    await writeFile(deliverySsgOutput, serializeStylexNextSsgRoutes([]));
    // Even a coherent, exactly serializable replacement cannot rebind the seal.
    await writeFile(discoveryManifestPath, JSON.stringify({ version: 4, routes: { "/changed": {} }, dynamicRoutes: {}, notFoundRoutes: [], preview: {} }, null, 2));
    await writeFile(discoveryOutput, serializeStylexNextSsgRoutes(["/changed"]));
    await assert.rejects(completeStylexNextBuild(attempt, context.root), /discovery postprocessing changed after settlement/u);
    await writeFile(discoveryManifestPath, savedManifest);
    await writeFile(discoveryOutput, serializeStylexNextSsgRoutes([]));
    await writeFile(discoverySealPath, `${canonicalJson({ ...(JSON.parse(discoverySeal) as object), planSha256: sha256("forged") })}\n`);
    await assert.rejects(completeStylexNextBuild(attempt, context.root), /discovery postprocessing changed after settlement/u);
    await writeFile(discoverySealPath, discoverySeal);
    for (const mode of ["discovery", "delivery"] as const) {
      const outputRoot = mode === "discovery" ? join(attempt.directory, "next-discovery") : join(context.root, ".next");
      const manifestPath = join(outputRoot, "prerender-manifest.json");
      await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
        await writeFile(manifestPath, JSON.stringify({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: ["/new-not-found"], preview: {} }, null, 2));
      }), /postprocessing changed after settlement|evidence changed before complete-record/u);
      await assert.rejects(readFile(join(attempt.directory, "complete.json")), /ENOENT/u);
      await writeFile(manifestPath, savedManifest);
    }
    const deliverySealPath = join(attempt.directory, "delivery/postprocessing.json");
    const deliverySeal = await readFile(deliverySealPath, "utf8");
    const creatorPath = join(context.root, "node_modules/next", STYLEX_NEXT_SSG_INPUTS[0]![0]);
    const creatorSource = await readFile(creatorPath);
    await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
      await writeFile(creatorPath, "changed before completion");
    }), /creator differs from pinned original bytes/u);
    await writeFile(creatorPath, creatorSource);
    await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
      await writeFile(deliverySealPath, discoverySeal);
    }), /delivery postprocessing changed after settlement/u);
    await writeFile(deliverySealPath, deliverySeal);
    await writeFile(deliverySealPath, discoverySeal);
    await assert.rejects(completeStylexNextBuild(attempt, context.root), /collision differs/u);
    await writeFile(deliverySealPath, deliverySeal);
    await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
      await writeFile(deliverySsgOutput, `${serializeStylexNextSsgRoutes([])};fetch('/')`);
    }), /exact pinned native derivation/u);
    await writeFile(deliverySsgOutput, serializeStylexNextSsgRoutes([]));
    const clientOutput = join(context.root, ".next/static/client.js");
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root, async () => {
        await writeFile(finalized.entryPath, 'import "./unexpected.js";\n');
      }),
      /generated entry bytes changed/u,
    );
    await assert.rejects(readFile(join(attempt.directory, "complete.json")), /ENOENT/u);
    await writeFile(finalized.entryPath, STYLEX_NEXT_GENERATED_ENTRY_SOURCE);

    await assert.rejects(
      completeStylexNextBuild(attempt, context.root, async () => {
        await writeFile(clientOutput, "changed during complete-record precommit\n");
      }),
      /output changed or disappeared after compilation/u,
    );
    await assert.rejects(readFile(join(attempt.directory, "complete.json")), /ENOENT/u);
    await writeFile(clientOutput, "export const client = true;\n");

    const clientCssOutput = join(context.root, ".next/static/stylex.css");
    await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
      await writeFile(clientCssOutput, "x");
    }), /output changed or disappeared after compilation/u);
    await assert.rejects(readFile(join(attempt.directory, "complete.json")), /ENOENT/u);
    assert.equal(await readFile(deliverySealPath, "utf8"), deliverySeal);
    await writeFile(clientCssOutput, "c");

    const edgeDeliveryGraphPath = join(attempt.directory, "delivery", "edge-rsc", "graph.json");
    const edgeDeliveryGraph = JSON.parse(await readFile(edgeDeliveryGraphPath, "utf8")) as { cssInputs: StylexArtifactV1[]; webpackVersion: string };
    await writeFile(edgeDeliveryGraphPath, `${canonicalJson({ ...edgeDeliveryGraph, cssInputs: [finalCss] })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /Only the Next delivery client graph may contain generated StyleX CSS/u,
    );
    await writeFile(edgeDeliveryGraphPath, `${canonicalJson(edgeDeliveryGraph)}\n`);

    const nodeDeliveryGraphPath = join(attempt.directory, "delivery", "node-rsc", "graph.json");
    const nodeDeliveryGraphSource = await readFile(nodeDeliveryGraphPath, "utf8");
    const nodeDeliveryGraph = JSON.parse(nodeDeliveryGraphSource) as { cssInputs: StylexArtifactV1[] };
    await writeFile(nodeDeliveryGraphPath, `${canonicalJson({ ...nodeDeliveryGraph, cssInputs: [finalCss] })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /Only the Next delivery client graph may contain generated StyleX CSS/u,
    );
    await writeFile(nodeDeliveryGraphPath, nodeDeliveryGraphSource);

    const clientDeliveryGraphPath = join(attempt.directory, "delivery", "client", "graph.json");
    const clientDeliveryGraph = JSON.parse(await readFile(clientDeliveryGraphPath, "utf8")) as {
      cssInputs: StylexArtifactV1[];
      entrypoints: { name: string }[];
    };
    await writeFile(clientDeliveryGraphPath, `${canonicalJson({
      ...clientDeliveryGraph,
      cssInputs: clientDeliveryGraph.cssInputs.filter(({ path }) => path !== finalCss.path),
    })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /delivery graphs must contain exactly one generated StyleX CSS input/u,
    );
    await writeFile(clientDeliveryGraphPath, `${canonicalJson(clientDeliveryGraph)}\n`);
    await writeFile(clientDeliveryGraphPath, `${canonicalJson({
      ...clientDeliveryGraph,
      cssInputs: [...clientDeliveryGraph.cssInputs, finalCss].sort((left, right) => compareStylexNextStrings(left.path, right.path)),
    })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /Next graph cssInputs paths must be unique/u,
    );
    await writeFile(clientDeliveryGraphPath, `${canonicalJson(clientDeliveryGraph)}\n`);
    await writeFile(clientDeliveryGraphPath, `${canonicalJson({
      ...clientDeliveryGraph,
      entrypoints: clientDeliveryGraph.entrypoints.map((entry) => ({ ...entry, name: "app/(alternate)/layout" })),
    })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /entrypoint topology drifted/u,
    );
    await writeFile(clientDeliveryGraphPath, `${canonicalJson(clientDeliveryGraph)}\n`);

    await writeFile(edgeDeliveryGraphPath, `${canonicalJson({ ...edgeDeliveryGraph, webpackVersion: "5.98.0" })}\n`);
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /graph inventory drifted between discovery and delivery/u,
    );
    await writeFile(edgeDeliveryGraphPath, `${canonicalJson(edgeDeliveryGraph)}\n`);

    const complete = await completeStylexNextBuild(attempt, context.root);
    assert.equal(complete.state, "complete");
    assert.equal(complete.schemaVersion, 2);
    assert.equal(complete.unionPolicySha256, stylexUnionPolicySha256);
    assert.equal(complete.compilerSha256, compilerSha256);
    assert.deepEqual(validateStylexNextBuildRecord(complete), complete);
    assert.deepEqual(JSON.parse(await readFile(join(attempt.directory, "complete.json"), "utf8")), complete);
    const missingPolicy = { ...complete } as Record<string, unknown>;
    delete missingPolicy.unionPolicySha256;
    for (const forged of [
      { ...complete, unionPolicySha256: sha256("obsolete union policy") },
      missingPolicy,
      { ...complete, schemaVersion: 1 },
      { ...missingPolicy, schemaVersion: 1 },
    ]) assert.throws(() => validateStylexNextBuildRecord(forged));
    for (const mode of ["discovery", "delivery"] as const) {
      assert.deepEqual(complete.postprocessing[mode], await artifactForFile(context.root, `.stylex-next/fixture/${mode}/postprocessing.json`));
    }
    assert.equal(await readFile(discoveryGraphPath, "utf8"), discoveryGraphSource);
    const immutableGraph = JSON.parse(discoveryGraphSource) as Record<string, unknown>;
    assert.equal(immutableGraph.schemaVersion, 1);
    assert.equal(immutableGraph.compilerSha256, compilerSha256);
    assert.equal(Object.hasOwn(immutableGraph, "unionPolicySha256"), false);
    assert.deepEqual(complete.discovery.map(({ target }) => target), ["client", "edge-rsc", "node-rsc"]);
    assert.deepEqual(complete.delivery.map(({ target }) => target), ["client", "edge-rsc", "node-rsc"]);
    for (const mode of ["discovery", "delivery"] as const) {
      const edge = JSON.parse(await readFile(join(attempt.directory, mode, "edge-rsc", "graph.json"), "utf8")) as {
        entrypoints: unknown[];
        modules: unknown[];
        outputs: unknown[];
      };
      assert.deepEqual(edge.modules, []);
      assert.deepEqual(edge.entrypoints, []);
      assert.deepEqual(edge.outputs, []);
    }
    assert.equal(complete.finalCss.sha256, sha256(await readFile(finalized.cssPath)));

    const siteCssPath = join(context.root, "src/site.css");
    await writeFile(siteCssPath, "body { margin: 1px; }\n");
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /CSS input changed or disappeared after compilation/u,
    );
    await writeFile(siteCssPath, "body { margin: 0; }\n");

    await writeFile(clientOutput, "changed after compilation\n");
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /output changed or disappeared after compilation/u,
    );
    await writeFile(clientOutput, "export const client = true;\n");

    for (const [target, source] of [["client", "a"], ["edge-rsc", "b"]] as const) {
      const graphPath = join(context.root, ".stylex-next/fixture/delivery", target, "graph.json");
      const graph = JSON.parse(await readFile(graphPath, "utf8")) as { outputs: StylexArtifactV1[] };
      graph.outputs.push({ bytes: 1, path: "static/cross-target.txt", sha256: sha256(source) });
      graph.outputs.sort((left, right) => compareStylexNextStrings(left.path, right.path));
      await writeFile(graphPath, `${canonicalJson(graph)}\n`);
    }
    await assert.rejects(
      completeStylexNextBuild(attempt, context.root),
      /graphs emitted conflicting bytes/u,
    );
  }, 30_000);

  for (const entrypoint of ["app/page", "proxy"] as const) test(`seals ${entrypoint} final observations without rebinding initial graphs or completion evidence`, async () => {
    const context = await createFixture();
    const proxy = entrypoint === "proxy";
    const nodeSource = proxy ? "proxy.ts" : "src/app.tsx";
    const nodeSourcePath = join(context.root, nodeSource);
    if (proxy) await writeFile(nodeSourcePath, context.source);
    const attempt = await prepareStylexNextAttempt({
      attemptId: "auxiliary",
      packageManifests: [context.manifestPath],
      requiredSources: { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [nodeSource] },
      rootDirectory: context.root,
    });
    const creatorPath = join(context.root, "node_modules/next", STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]);
    const creatorSource = await readFile(new URL(`../node_modules/next/${STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]}`, import.meta.url));
    assert.equal(sha256(creatorSource), STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[1]);
    await mkdir(dirname(creatorPath), { recursive: true });
    await writeFile(creatorPath, creatorSource);
    if (proxy) await writeFile(join(context.root, "node_modules/next", STYLEX_NEXT_PROXY_RENAME_CREATOR[0]), await readFile(new URL(`../node_modules/next/${STYLEX_NEXT_PROXY_RENAME_CREATOR[0]}`, import.meta.url)));
    const tracePath = `server/${entrypoint}.js.nft.json`;
    const finalTracePath = proxy ? "server/middleware.js.nft.json" : tracePath;
    const initialSource = '{"version":1,"files":["initial.js"]}';
    // These names remain opaque observations. The fixture deliberately creates none of them.
    const finalSource = '{"version":1,"files":["z-final.js","../../shared.js","a-final.js"]}';
    const changedSource = '{"version":1,"files":["z-final.js","../../shared.js","b-final.js"]}';
    const traceArtifact = (source: string): StylexArtifactV1 => ({
      bytes: Buffer.byteLength(source), path: tracePath, sha256: sha256(source),
    });
    const initial = traceArtifact(initialSource);
    const final = { ...traceArtifact(finalSource), path: finalTracePath };
    assert.notEqual(initial.sha256, final.sha256);
    assert.equal(Buffer.byteLength(finalSource), Buffer.byteLength(changedSource));
    const auxiliary = await captureStylexNextAuxiliaryTraceAsset(context.root, entrypoint, initial, initialSource);
    const graphSources = new Map<"discovery" | "delivery", string>();

    for (const mode of ["discovery", "delivery"] as const) {
      const outputDirectory = mode === "discovery" ? ".stylex-next/auxiliary/next-discovery" : ".next";
      const outputRoot = join(context.root, outputDirectory);
      const finalCss = mode === "delivery"
        ? await artifactForFile(context.root, ".stylex-next/auxiliary/generated/stylex.css")
        : undefined;
      for (const target of STYLEX_NEXT_TARGETS) {
        const empty = target === "edge-rsc";
        const javascript = target === "node-rsc" ? `server/${entrypoint}.js` : "static/client.js";
        const css = target === "client" && mode === "delivery" ? ["static/stylex.css"] : [];
        const sources = new Map<string, string>();
        if (!empty) {
          sources.set(javascript, `export const ${target.replaceAll("-", "_")} = true;\n`);
          sources.set(`${javascript}.map`, '{"mappings":"AAAA","names":[],"sources":["src/app.tsx"],"version":3}');
          if (target === "node-rsc") sources.set(tracePath, initialSource);
          if (css.length > 0) sources.set("static/stylex.css", "c");
          for (const [path, source] of sources) {
            await mkdir(dirname(join(outputRoot, path)), { recursive: true });
            await writeFile(join(outputRoot, path), source);
          }
          await transformStylexNextModule({
            options: { attemptDirectory: attempt.directory, mode, planSha256: attempt.planSha256, rootDirectory: context.root, target },
            resourcePath: target === "node-rsc" ? nodeSourcePath : context.sourcePath,
            source: context.source,
          });
        }
        const outputs = [...sources].map(([path, source]) => ({ bytes: Buffer.byteLength(source), path, sha256: sha256(source) }))
          .sort((left, right) => compareStylexNextStrings(left.path, right.path));
        await writeStylexNextGraphReceipt({
          attempt,
          auxiliaryTraceAssets: target === "node-rsc" ? [auxiliary] : [],
          cssInputs: target === "client"
            ? [context.foundation, context.siteCss, ...(finalCss ? [finalCss] : [])].sort((left, right) => compareStylexNextStrings(left.path, right.path))
            : [],
          emptyEntryBootstraps: [],
          entrypoints: empty ? [] : [{
            css, files: [javascript, ...css], javascript: [javascript],
            name: target === "client" ? "app/layout" : entrypoint, stylexCss: css,
          }],
          frameworkAssets: [],
          javascriptChunks: empty ? [] : [javascript],
          mode,
          outputDirectory,
          outputs,
          rootDirectory: context.root,
          sourceMaps: outputs.filter(({ path }) => path.endsWith(".map")),
          target,
          webpackVersion: "5.99.0",
        });
      }
      const graphPath = join(attempt.directory, mode, "node-rsc/graph.json");
      graphSources.set(mode, await readFile(graphPath, "utf8"));
      const graph = await readStylexNextGraphReceipt(attempt, mode, "node-rsc");
      assert.deepEqual(graph.auxiliaryTraceAssets, [auxiliary]);
      assert.deepEqual(graph.outputs.find(({ path }) => path === tracePath), initial);
      assert.deepEqual(graph.entrypoints[0]!.javascript, [`server/${entrypoint}.js`]);
      assert.deepEqual(graph.javascriptChunks, [`server/${entrypoint}.js`]);
      // Model the native post-child rewrite only after the immutable compilation receipt exists.
      if (proxy) {
        await rename(join(outputRoot, "server/proxy.js"), join(outputRoot, "server/middleware.js"));
        await rename(join(outputRoot, tracePath), join(outputRoot, finalTracePath));
      }
      await writeFile(join(outputRoot, finalTracePath), finalSource);
      if (mode === "discovery") await finalizeStylexNextDiscovery(attempt, context.root);
      assert.equal(await readFile(graphPath, "utf8"), graphSources.get(mode));
    }

    const discoverySealPath = join(attempt.directory, "discovery/postprocessing.json");
    const discoverySeal = await readFile(discoverySealPath, "utf8");
    const nodeGraph = await readStylexNextGraphReceipt(attempt, "discovery", "node-rsc");
    const compiledProxy = nodeGraph.outputs.find(({ path }) => path === "server/proxy.js");
    const snapshot = { asset: auxiliary, output: final, semantics: "observation-only", ...(proxy ? { proxyRename: {
      absent: ["server/proxy.js", "server/proxy.js.nft.json"],
      creator: await artifactForFile(context.root, `node_modules/next/${STYLEX_NEXT_PROXY_RENAME_CREATOR[0]}`),
      initial: compiledProxy, output: { ...compiledProxy, path: "server/middleware.js" },
      sourceMap: nodeGraph.sourceMaps.find(({ path }) => path === "server/proxy.js.map"),
    } } : {}) } as const;
    const settled = validateStylexNextPostprocessingReceipt(JSON.parse(discoverySeal));
    assert.deepEqual(settled.auxiliaryTraceSnapshots, [snapshot]);
    assert.deepEqual(settled.ssg, [], "Auxiliary observations must not enter the SSG derivation proof");
    const discoveryTracePath = join(attempt.directory, "next-discovery", finalTracePath);
    const completePath = join(attempt.directory, "complete.json");
    await writeFile(discoveryTracePath, changedSource);
    await assert.rejects(completeStylexNextBuild(attempt, context.root), /discovery postprocessing changed after settlement/u);
    await assert.rejects(readFile(completePath), /ENOENT/u);
    await assert.rejects(readFile(join(attempt.directory, "delivery/postprocessing.json")), /ENOENT/u);
    assert.equal(await readFile(discoverySealPath, "utf8"), discoverySeal);
    await writeFile(discoveryTracePath, finalSource);

    for (const mode of ["discovery", "delivery"] as const) {
      const trace = mode === "discovery" ? discoveryTracePath : join(context.root, ".next", finalTracePath);
      let callbackReached = false;
      await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => {
        callbackReached = true;
        await writeFile(trace, changedSource);
      }), mode === "discovery"
        ? /discovery postprocessing changed after settlement/u
        : /build evidence changed before complete-record commit/u);
      assert.equal(callbackReached, true);
      await assert.rejects(readFile(completePath), /ENOENT/u);
      assert.equal(await readFile(discoverySealPath, "utf8"), discoverySeal);
      const deliverySeal = validateStylexNextPostprocessingReceipt(JSON.parse(await readFile(join(attempt.directory, "delivery/postprocessing.json"), "utf8")));
      assert.deepEqual(deliverySeal.auxiliaryTraceSnapshots, [snapshot], "A failed completion must not refresh the final observation");
      await writeFile(trace, finalSource);
    }

    if (proxy) {
      for (const mode of ["discovery", "delivery"] as const) {
        const outputRoot = mode === "discovery" ? join(attempt.directory, "next-discovery") : join(context.root, ".next");
        for (const path of ["server/middleware.js", "server/proxy.js.map"]) {
          const absolute = join(outputRoot, path);
          const before = await readFile(absolute);
          await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => { await writeFile(absolute, Buffer.concat([before, Buffer.from("\n")])); }), /changed JavaScript|changed its original map/u);
          await assert.rejects(readFile(completePath), /ENOENT/u);
          await writeFile(absolute, before);
        }
        for (const path of ["server/proxy.js", "server/proxy.js.nft.json"]) {
          await assert.rejects(completeStylexNextBuild(attempt, context.root, async () => { await writeFile(join(outputRoot, path), "late"); }), /original path must be absent/u);
          await assert.rejects(readFile(completePath), /ENOENT/u);
          await unlink(join(outputRoot, path));
        }
      }
    }

    const complete = await completeStylexNextBuild(attempt, context.root);
    assert.equal(complete.state, "complete");
    for (const mode of ["discovery", "delivery"] as const) {
      const graphSource = graphSources.get(mode)!;
      assert.equal(await readFile(join(attempt.directory, mode, "node-rsc/graph.json"), "utf8"), graphSource);
      assert.equal(complete[mode].find(({ target }) => target === "node-rsc")!.receiptSha256, sha256(graphSource));
      const graph = await readStylexNextGraphReceipt(attempt, mode, "node-rsc");
      assert.deepEqual(graph.outputs.find(({ path }) => path === tracePath), initial);
      assert.deepEqual(complete.postprocessing[mode], await artifactForFile(context.root, `.stylex-next/auxiliary/${mode}/postprocessing.json`));
      const postprocessing = validateStylexNextPostprocessingReceipt(JSON.parse(await readFile(join(attempt.directory, mode, "postprocessing.json"), "utf8")));
      assert.deepEqual(postprocessing.auxiliaryTraceSnapshots, [snapshot]);
    }
    assert.equal(await readFile(discoverySealPath, "utf8"), discoverySeal);
  });

  test("stops delivery when a transformed module changes between passes", async () => {
    const context = await createFixture();
    const attempt = await prepareStylexNextAttempt({
      attemptId: "drift",
      packageManifests: [context.manifestPath],
      requiredSources: { client: ["src/app.tsx"], "edge-rsc": [], "node-rsc": [] },
      rootDirectory: context.root,
    });
    await transformStylexNextModule({
      options: { attemptDirectory: attempt.directory, mode: "discovery", planSha256: attempt.planSha256, rootDirectory: context.root, target: "client" },
      resourcePath: context.sourcePath,
      source: context.source,
    });
    await writeFile(context.sourcePath, context.source.replace("rgb(1, 2, 3)", "rgb(4, 5, 6)"));
    const changed = await readFile(context.sourcePath, "utf8");
    await transformStylexNextModule({
      options: { attemptDirectory: attempt.directory, mode: "delivery", planSha256: attempt.planSha256, rootDirectory: context.root, target: "client" },
      resourcePath: context.sourcePath,
      source: changed,
    });
    await assert.rejects(
      writeStylexNextGraphReceipt({
        attempt,
        cssInputs: [],
        entrypoints: [{ css: [], files: ["static/client.js"], javascript: ["static/client.js"], name: "client", stylexCss: [] }],
        mode: "delivery",
        outputDirectory: ".next",
        outputs: output("client"),
        emptyEntryBootstraps: [],
        frameworkAssets: [],
        auxiliaryTraceAssets: [],
        javascriptChunks: ["static/client.js"],
        rootDirectory: context.root,
        sourceMaps: sourceMaps("client"),
        target: "client",
        webpackVersion: "5.99.0",
      }),
      /Next module source drifted/u,
    );
  });
});
