import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { build as viteBuild } from "vite";

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
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import { createStylexGeneration } from "./generation.js";
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
  await write(join(packageRoot, "dist/stylex.css"), ".x-package{color:red}\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), packageStylesheetSource);
  await write(join(packageRoot, "src/unmanifested.css"), ".unmanifested{display:block}\n");
  const rules: readonly StylexRuleV1[] = [["x-package", { ltr: ".x-package{color:red}" }, 1000]];
  const manifest: StylexPackageManifestV1 = {
    buildTools: [await artifactForFile(packageRoot, "build/index.js")],
    compiler: compilerContract,
    compilerSha256,
    kind: "hraness-stylex-package-manifest",
    package: { name: "@fixture/ui", version: "1.0.0" },
    rules,
    rulesSha256: stylexRulesSha256(rules),
    runtime: [await artifactForFile(packageRoot, "dist/runtime.js")],
    schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"),
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
      rollupOptions: {},
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
      build: { assetsInlineLimit: 0, copyPublicDir: false, cssCodeSplit: false, outDir: build.outDir, rollupOptions: {}, sourcemap: false, ssr: entry, watch: null, write: true },
      command: "build",
      publicDir: "",
      root: context.root,
    })).rejects.toThrow(/target differs/u);
  });
});
