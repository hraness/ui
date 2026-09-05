import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, spyOn, test } from "bun:test";

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
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import {
  createStylexGeneration,
  finalizeStylexGeneration,
} from "./generation.js";
import {
  collectBunStylexGraph,
  STYLEX_BUN_ADAPTER_VERSION,
} from "./bun.js";

const roots: string[] = [];
const packageTailwindSource = [
  '@source "./";',
  '@custom-variant dark (&:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *):not(:where([data-theme="light"], [data-theme="light"] *)));',
  "@theme inline { --color-background: var(--fixture-background); }",
  "",
].join("\n");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function logical(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(value.length > 0 && !value.startsWith("../"));
  return value;
}

async function ordinaryFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(logical(root, path));
    }
  }
  await visit(root);
  return output.sort();
}

async function write(path: string, source: string): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, source, { flag: "wx" });
}

async function fixture(): Promise<{
  generationOutput: string;
  manifestPath: string;
  root: string;
}> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-bun-adapter-"));
  roots.push(root);
  const packageRoot = join(root, "node_modules/@fixture/ui");
  await write(
    join(root, "node_modules/@stylexjs/stylex/package.json"),
    `${JSON.stringify({ exports: "./index.js", name: "@stylexjs/stylex", type: "module", version: "0.19.0" })}\n`,
  );
  await write(
    join(root, "node_modules/@stylexjs/stylex/index.js"),
    "export const create = (styles) => styles; export const props = (...styles) => ({ className: styles.join(' ') });\n",
  );
  await write(
    join(packageRoot, "package.json"),
    `${JSON.stringify({
      exports: { ".": "./dist/runtime.js", "./build": "./build/index.js", "./compiler-foundation.css": "./src/compiler-foundation.css", "./stylex.css": "./dist/stylex.css", "./tailwind.css": "./src/tailwind.css" },
      name: "@fixture/ui",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  await write(join(packageRoot, "dist/runtime.js"), "export const packageRuntime = true;\n");
  await write(join(packageRoot, "build/index.js"), "export const packageBuildTool = true;\n");
  await write(join(packageRoot, "dist/stylex.css"), ".x-package{color:red}\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), ".foundation{display:block}\n");
  await write(join(packageRoot, "src/tailwind.css"), packageTailwindSource);
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
    stylesheets: await Promise.all([
      artifactForFile(packageRoot, "src/compiler-foundation.css"),
      artifactForFile(packageRoot, "src/tailwind.css"),
    ]),
  };
  const manifestPath = join(packageRoot, "dist/stylex-manifest.json");
  await write(manifestPath, `${canonicalJson(manifest)}\n`);
  return { generationOutput: join(root, "generations"), manifestPath, root };
}

async function generation(
  context: Awaited<ReturnType<typeof fixture>>,
  generationId: string,
  expectedGraphs: readonly StylexGraphExpectationV1[],
): Promise<StylexGenerationHandleV1> {
  return createStylexGeneration({
    expectedGraphs,
    generationId,
    outputDirectory: context.generationOutput,
    packageManifests: [logical(context.root, context.manifestPath)],
    rootDirectory: context.root,
  });
}

function expectation(
  root: string,
  graphId: string,
  kind: "client" | "ssr",
  ...entrypoints: string[]
): StylexGraphExpectationV1 {
  return {
    adapter: "bun",
    entrypoints: entrypoints.map((path) => logical(root, path)).sort(),
    id: graphId,
    kind,
  };
}

async function receiptExists(generationValue: StylexGenerationHandleV1, graphId: string): Promise<boolean> {
  return Bun.file(join(generationValue.directory, ".stylex-generation/receipts", `${graphId}.json`)).exists();
}

async function makeGraphSources(root: string): Promise<{ entries: string[]; server: string }> {
  const first = join(root, "src/first.ts");
  const second = join(root, "src/second.ts");
  const lazy = join(root, "src/lazy.ts");
  const server = join(root, "src/server.ts");
  const serverOnly = join(root, "src/server-only.ts");
  await write(
    first,
    "import * as stylex from '@stylexjs/stylex'; export { packageRuntime } from '@fixture/ui'; const styles = stylex.create({ root: { color: 'red' } }); export const first = stylex.props(styles.root).className; export const loadLazy = () => import('./lazy.ts');\n",
  );
  await write(second, "export { first } from './first.ts'; export const second = 2;\n");
  await write(lazy, "export const lazyOnly = 'lazy';\n");
  await write(server, "export const loadServerOnly = () => import('./server-only.ts');\n");
  await write(serverOnly, "export const ssrOnly = 'ssr';\n");
  return { entries: [first, second], server };
}

function stableGraph(receipt: StylexGraphReceiptV1): unknown {
  return {
    adapter: receipt.adapter,
    edges: receipt.edges,
    entrypoints: receipt.entrypoints,
    inputs: receipt.inputs,
    outputs: receipt.outputs,
    rules: receipt.rules,
    rulesSha256: receipt.rulesSha256,
    target: receipt.target,
  };
}

describe("collectBunStylexGraph", () => {
  test("pins the Bun adapter to the repository toolchain", () => {
    expect(STYLEX_BUN_ADAPTER_VERSION).toBe("1.3.14");
    expect(Bun.version).toBe(STYLEX_BUN_ADAPTER_VERSION);
  });

  test("collects multi-entry and literal lazy modules with deterministic independently hashed outputs", async () => {
    const context = await fixture();
    const sources = await makeGraphSources(context.root);
    const expected = expectation(context.root, "client", "client", ...sources.entries);
    const firstGeneration = await generation(context, "permutation-a", [expected]);
    const secondGeneration = await generation(context, "permutation-b", [expected]);

    const first = await collectBunStylexGraph({
      build: { conditions: ["production", "browser", "module"], minify: true },
      generation: firstGeneration,
      graphId: "client",
      rootDirectory: context.root,
    });
    const second = await collectBunStylexGraph({
      build: { conditions: ["module", "production", "browser"], minify: true },
      generation: secondGeneration,
      graphId: "client",
      rootDirectory: context.root,
    });

    expect(stableGraph(first)).toEqual(stableGraph(second));
    expect(first.entrypoints).toEqual(expected.entrypoints);
    expect(first.inputs.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "src/first.ts",
      "src/lazy.ts",
      "src/second.ts",
      "node_modules/@fixture/ui/dist/runtime.js",
    ]));
    expect(first.rules.length).toBeGreaterThan(0);
    expect(first.edges.some(({ from, to }) => from === "input:src/first.ts" && to === "input:src/lazy.ts")).toBe(true);
    expect(first.outputs.some(({ path }) => path.startsWith("chunks/"))).toBe(true);
    for (const artifact of first.outputs) {
      const bytes = await readFile(join(firstGeneration.directory, ...first.outputRoot.split("/"), ...artifact.path.split("/")));
      expect(bytes.byteLength).toBe(artifact.bytes);
      expect(sha256(bytes)).toBe(artifact.sha256);
    }
    expect(await receiptExists(firstGeneration, "client")).toBe(true);
  });

  test("preserves one manifest-bound Tailwind bridge through graph sealing and finalization", async () => {
    for (const minify of [false, true]) {
      const context = await fixture();
      const entry = join(context.root, "src/tailwind-entry.ts");
      await write(entry, "import '@fixture/ui/tailwind.css'; export const value = true;\n");
      const handle = await generation(context, `tailwind-bridge-${String(minify)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const receipt = await collectBunStylexGraph({
        build: { minify },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });

      expect(receipt.inputs.map(({ path }) => path)).toContain(
        "node_modules/@fixture/ui/src/tailwind.css",
      );
      const stylesheet = receipt.outputs.find(({ path }) => path.endsWith(".css"));
      assert.ok(stylesheet !== undefined);
      const stagedCss = await readFile(
        join(handle.directory, ...receipt.outputRoot.split("/"), ...stylesheet.path.split("/")),
        "utf8",
      );
      expect(stagedCss).toContain('@source "./"');
      expect(stagedCss).toContain(packageTailwindSource.split("\n")[1]!);
      expect(stagedCss).toContain("@theme inline");
      expect(stagedCss).not.toContain("stylex-tailwind-bridge-");

      const output = await finalizeStylexGeneration({
        generation: handle,
        outputDirectory: context.generationOutput,
        rootDirectory: context.root,
      });
      expect(await readFile(join(output, "graphs/client", stylesheet.path), "utf8")).toBe(stagedCss);
    }
  });

  test("reserves the private Tailwind restoration marker from graph inputs", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/reserved-marker-entry.ts");
    const stylesheet = join(context.root, "src/reserved-marker.css");
    await write(stylesheet, '.reserved{--value:"stylex-tailwind-bridge-"}\n');
    await write(entry, "import './reserved-marker.css'; export const value = true;\n");
    const handle = await generation(context, "reserved-tailwind-marker", [
      expectation(context.root, "client", "client", entry),
    ]);

    await expect(collectBunStylexGraph({
      generation: handle,
      graphId: "client",
      rootDirectory: context.root,
    })).rejects.toThrow(/reserved Bun Tailwind bridge marker/u);
    expect(await receiptExists(handle, "client")).toBe(false);
  });

  test("collects a separate SSR-only graph and its lazy module", async () => {
    const context = await fixture();
    const sources = await makeGraphSources(context.root);
    const expected = expectation(context.root, "server", "ssr", sources.server);
    const handle = await generation(context, "ssr-graph", [expected]);
    const receipt = await collectBunStylexGraph({ generation: handle, graphId: "server", rootDirectory: context.root });

    expect(receipt.target).toBe("ssr");
    expect(receipt.inputs.map(({ path }) => path)).toEqual(expect.arrayContaining(["src/server-only.ts", "src/server.ts"]));
    expect(receipt.edges.some(({ from, to }) => from === "input:src/server.ts" && to === "input:src/server-only.ts")).toBe(true);
  });

  test("excludes speculatively loaded tree-shaken inputs, absolute edges, and StyleX rules", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const retained = join(context.root, "src/tree-shaken.ts");
    const speculative = join(context.root, "src/tree-shaken.tsx");
    const runtimeSpeculative = join(context.root, "src/runtime.tsx");
    await write(
      entry,
      "import * as stylex from '@stylexjs/stylex'; import { retained } from './tree-shaken.ts'; const styles = stylex.create({ root: { color: 'rebeccapurple' } }); export const value = `${retained}:${stylex.props(styles.root).className}`;\n",
    );
    await write(retained, "export const retained = 'retained';\n");
    await write(
      speculative,
      "import * as stylex from '@stylexjs/stylex'; const styles = stylex.create({ root: { color: 'chartreuse' } }); export const dropped = stylex.props(styles.root).className;\n",
    );
    await write(
      runtimeSpeculative,
      "import * as stylex from '@stylexjs/stylex'; const styles = stylex.create({ root: { color: 'aquamarine' } }); export const dropped = stylex.props(styles.root).className;\n",
    );
    const handle = await generation(context, "tree-shaken-barrel", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const handlers: Array<(args: { path: string }) => unknown> = [];
      const plugin = options.plugins?.[0];
      assert.ok(plugin !== undefined);
      plugin.setup({
        onEnd() {},
        onLoad(_options: unknown, callback: (args: { path: string }) => unknown) {
          handlers.push(callback);
        },
      } as never);
      const javascriptOnLoad = handlers[0];
      assert.ok(javascriptOnLoad !== undefined);
      await javascriptOnLoad({ path: speculative });
      await javascriptOnLoad({ path: runtimeSpeculative });
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [
        ...result.metafile.inputs[entryKey]!.imports,
        { kind: "import-statement", original: "./tree-shaken.tsx", path: speculative },
        { kind: "import-statement", path: "./tree-shaken" },
        { kind: "import-statement", path: "./runtime.js" },
      ] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });

      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs.map(({ path }) => path)).toContain("src/entry.ts");
      expect(receipt.inputs.map(({ path }) => path)).toContain("src/tree-shaken.ts");
      expect(receipt.inputs.map(({ path }) => path)).not.toContain("src/tree-shaken.tsx");
      expect(receipt.inputs.map(({ path }) => path)).not.toContain("src/runtime.tsx");
      expect(receipt.edges.filter(({ to }) => to === "input:src/tree-shaken.ts")).toHaveLength(1);
      expect(receipt.edges.some(({ to }) => to === "input:src/tree-shaken.tsx")).toBe(false);
      expect(receipt.edges.some(({ to }) => to === "input:src/runtime.tsx")).toBe(false);
      expect(canonicalJson(receipt.rules)).toContain("rebeccapurple");
      expect(canonicalJson(receipt.rules)).not.toContain("chartreuse");
      expect(canonicalJson(receipt.rules)).not.toContain("aquamarine");
    } finally {
      build.mockRestore();
    }
  });

  test("settles Bun's exact unused re-export records from a side-effect-free dependency barrel", async () => {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/side-effect-free");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        exports: "./index.js",
        name: "@fixture/side-effect-free",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(dependencyRoot, "index.js"),
      "export { retained } from './retained.js'; export { dropped } from './dropped.js';\n",
    );
    await write(join(dependencyRoot, "retained.js"), "export const retained = 'retained';\n");
    await write(join(dependencyRoot, "dropped.js"), "export const dropped = 'dropped';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { retained } from '@fixture/side-effect-free'; export const value = retained;\n",
    );
    const handle = await generation(context, "side-effect-free-elided-reexport", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const barrelKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/side-effect-free/index.js")
        || path === "node_modules/@fixture/side-effect-free/index.js"
      );
      assert.ok(barrelKey !== undefined);
      expect(result.metafile.inputs[barrelKey]!.format).toBe("esm");
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "./dropped.js",
      });
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/side-effect-free/dropped.js")
        || path === "node_modules/@fixture/side-effect-free/dropped.js"
      )).toBe(false);
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs.map(({ path }) => path)).toContain(
        "node_modules/@fixture/side-effect-free/retained.js",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/side-effect-free/dropped.js",
      );
      expect(receipt.edges.some(({ from, to }) =>
        from === "input:node_modules/@fixture/side-effect-free/index.js"
        && to.endsWith("/dropped.js")
      )).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects external and mismatched absolute edges to a speculative transform", async () => {
    for (const variant of ["external", "mismatched-original"] as const) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      const speculative = join(context.root, "src/tree-shaken.ts");
      await write(entry, "export const value = 'entry';\n");
      await write(speculative, "export const dropped = 'tree-shaken';\n");
      const handle = await generation(context, `speculative-${variant}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const handlers: Array<(args: { path: string }) => unknown> = [];
        const plugin = options.plugins?.[0];
        assert.ok(plugin !== undefined);
        plugin.setup({
          onEnd() {},
          onLoad(_options: unknown, callback: (args: { path: string }) => unknown) {
            handlers.push(callback);
          },
        } as never);
        const javascriptOnLoad = handlers[0];
        assert.ok(javascriptOnLoad !== undefined);
        await javascriptOnLoad({ path: speculative });
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) =>
          path === "src/entry.ts" || path.endsWith("/src/entry.ts")
        );
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [variant === "external"
          ? { external: true, kind: "import-statement", path: speculative }
          : { kind: "import-statement", original: "./different.js", path: speculative }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects near-miss elided external dependency edges", async () => {
    const variants: readonly Readonly<{
      edge?: Readonly<Record<string, unknown>>;
      id: string;
      importer?: "cjs" | "esm";
      name?: string;
      sideEffects?: unknown;
      target: "closer-scope" | "cross-package" | "directory" | "file" | "known" | "missing" | "non-js" | "symlink";
    }>[] = [
      { id: "missing-side-effects", target: "file" },
      { id: "true-side-effects", sideEffects: true, target: "file" },
      { id: "array-side-effects", sideEffects: ["./dropped.js"], target: "file" },
      { edge: { external: true, kind: "import-statement", original: "./dropped.js", path: "./dropped.js" }, id: "original", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "dynamic-import", path: "./dropped.js" }, id: "dynamic", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "require-call", path: "./dropped.js" }, id: "require", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.js", with: { type: "javascript" } }, id: "attributes", sideEffects: false, target: "file" },
      { edge: { external: false, kind: "import-statement", path: "./dropped.js" }, id: "nonexternal", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.js?raw" }, id: "query-path", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped%2ejs" }, id: "encoded-path", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "../other/dropped.js" }, id: "cross-package", sideEffects: false, target: "cross-package" },
      { id: "missing-target", sideEffects: false, target: "missing" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.json" }, id: "non-js-target", sideEffects: false, target: "non-js" },
      { id: "directory-target", sideEffects: false, target: "directory" },
      { id: "symlink-target", sideEffects: false, target: "symlink" },
      { edge: { external: true, kind: "import-statement", path: "./nested/dropped.js" }, id: "closer-package-scope", sideEffects: false, target: "closer-scope" },
      { id: "wrong-package-name", name: "@fixture/other", sideEffects: false, target: "file" },
      { id: "known-target", sideEffects: false, target: "known" },
      { id: "commonjs-importer", importer: "cjs", sideEffects: false, target: "file" },
    ];

    for (const variant of variants) {
      const context = await fixture();
      const dependencyRoot = join(context.root, "node_modules/@fixture/runtime");
      const importerName = variant.importer === "cjs" ? "index.cjs" : "index.js";
      const manifest: Record<string, unknown> = {
        exports: `./${importerName}`,
        name: variant.name ?? "@fixture/runtime",
        type: variant.importer === "cjs" ? "commonjs" : "module",
        version: "1.0.0",
      };
      if (Object.hasOwn(variant, "sideEffects")) manifest.sideEffects = variant.sideEffects;
      await write(join(dependencyRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
      await write(
        join(dependencyRoot, importerName),
        variant.target === "known"
          ? "export { marker } from './dropped.js';\n"
          : variant.importer === "cjs"
            ? "exports.marker = 'runtime';\n"
            : "export const marker = 'runtime';\n",
      );
      switch (variant.target) {
        case "file":
          await write(join(dependencyRoot, "dropped.js"), "export const dropped = 'dropped';\n");
          break;
        case "known":
          await write(join(dependencyRoot, "dropped.js"), "export const marker = 'runtime';\n");
          break;
        case "cross-package":
          await write(
            join(context.root, "node_modules/@fixture/other/package.json"),
            `${JSON.stringify({ name: "@fixture/other", sideEffects: false, type: "module", version: "1.0.0" })}\n`,
          );
          await write(join(context.root, "node_modules/@fixture/other/dropped.js"), "export const dropped = true;\n");
          break;
        case "directory":
          await mkdir(join(dependencyRoot, "dropped.js"), { recursive: true });
          break;
        case "non-js":
          await write(join(dependencyRoot, "dropped.json"), "{}\n");
          break;
        case "symlink":
          await write(join(dependencyRoot, "actual.js"), "export const dropped = true;\n");
          await symlink(join(dependencyRoot, "actual.js"), join(dependencyRoot, "dropped.js"));
          break;
        case "closer-scope":
          await write(
            join(dependencyRoot, "nested/package.json"),
            `${JSON.stringify({ name: "@fixture/runtime", sideEffects: false, type: "module", version: "1.0.0" })}\n`,
          );
          await write(join(dependencyRoot, "nested/dropped.js"), "export const dropped = true;\n");
          break;
        case "missing": break;
      }
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        `import { marker } from '../node_modules/@fixture/runtime/${importerName}'; export const value = marker;\n`,
      );
      const handle = await generation(context, `elided-external-near-miss-${variant.id}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const importerKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith(`/node_modules/@fixture/runtime/${importerName}`)
          || path === `node_modules/@fixture/runtime/${importerName}`
        );
        assert.ok(importerKey !== undefined);
        result.metafile.inputs[importerKey]!.imports = [variant.edge ?? {
          external: true,
          kind: "import-statement",
          path: "./dropped.js",
        }] as never;
        return result;
      });

      try {
        let rejection: unknown;
        try {
          await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
        } catch (error) {
          rejection = error;
        }
        assert.ok(rejection !== undefined, `near-miss variant unexpectedly resolved: ${variant.id}`);
        assert.match(String(rejection), /Bun metafile import.*is unresolved/u, `near-miss variant rejected differently: ${variant.id}`);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects an elided relative external from a first-party ESM importer", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 'entry';\n");
    await write(join(context.root, "src/dropped.js"), "export const dropped = true;\n");
    const handle = await generation(context, "first-party-elided-external", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        external: true,
        kind: "import-statement",
        path: "./dropped.js",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects an absolute edge to an ordinary in-root file that was not transformed", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const unobserved = join(context.root, "src/unobserved.ts");
    await write(entry, "export const value = 'entry';\n");
    await write(unobserved, "export const hidden = 'unobserved';\n");
    const handle = await generation(context, "unobserved-absolute-input", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: unobserved,
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("repairs a deduplicated .js runtime specifier from one TypeScript graph input", async () => {
    const context = await fixture();
    const runtime = join(context.root, "src/runtime.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtime, "export const marker = 'runtime';\n");
    await write(entry, "import { marker } from './runtime.js'; export const value = marker;\n");
    const handle = await generation(context, "typescript-runtime-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "./runtime.js",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "input:src/runtime.ts",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("repairs deduplicated runtime extensions in Bun resolver order", async () => {
    for (const [runtimeExtension, sourceExtension] of [
      [".jsx", ".ts"],
      [".jsx", ".tsx"],
      [".jsx", ".mts"],
      [".js", ".mts"],
      [".mjs", ".mts"],
    ] as const) {
      const context = await fixture();
      const runtime = join(context.root, `src/runtime${sourceExtension}`);
      const entry = join(context.root, "src/entry.ts");
      await write(runtime, "export const marker = 'runtime';\n");
      await write(
        entry,
        `import { marker } from './runtime${sourceExtension}'; export const value = marker;\n`,
      );
      const handle = await generation(context, `typescript-runtime-input-alias-${runtimeExtension.slice(1)}-${sourceExtension.slice(1)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) =>
          path === "src/entry.ts" || path.endsWith("/src/entry.ts")
        );
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [{
          kind: "import-statement",
          path: `./runtime${runtimeExtension}`,
        }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: `input:src/runtime${sourceExtension}`,
        });
      } finally {
        build.mockRestore();
      }
    }
  });

  test("does not rewrite a .cjs runtime specifier to a .cts input", async () => {
    const context = await fixture();
    const runtime = join(context.root, "src/runtime.cts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtime, "export const marker = 'runtime';\n");
    await write(entry, "import { marker } from './runtime.cts'; export const value = marker;\n");
    const handle = await generation(context, "cjs-runtime-input-alias-mismatch", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "./runtime.cjs",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved: \.\/runtime\.cjs/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("uses Bun resolver order for a deduplicated runtime specifier with multiple TypeScript inputs", async () => {
    const context = await fixture();
    const runtimeTs = join(context.root, "src/runtime.ts");
    const runtimeTsx = join(context.root, "src/runtime.tsx");
    const raw = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtimeTs, "export const tsMarker = 'ts';\n");
    await write(runtimeTsx, "export const tsxMarker = 'tsx';\n");
    await write(raw, "import { tsMarker } from './runtime.ts'; export const rawMarker = tsMarker;\n");
    await write(
      entry,
      "export { tsMarker } from './runtime.ts'; export { tsxMarker } from './runtime.tsx'; export { rawMarker } from './raw.ts';\n",
    );
    const handle = await generation(context, "ambiguous-typescript-runtime-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const rawKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/raw.ts" || path.endsWith("/src/raw.ts")
      );
      assert.ok(rawKey !== undefined);
      result.metafile.inputs[rawKey]!.imports = [{
        kind: "import-statement",
        path: "./runtime.js",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/raw.ts",
        kind: "import-statement",
        to: "input:src/runtime.ts",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("uses Bun appended-extension probes before TypeScript runtime rewriting", async () => {
    const context = await fixture();
    const runtimeTs = join(context.root, "src/runtime.ts");
    const appended = join(context.root, "src/runtime.js.tsx");
    const raw = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtimeTs, "export const tsMarker = 'ts';\n");
    await write(appended, "export const appendedMarker = 'appended';\n");
    await write(raw, "import { tsMarker } from './runtime.ts'; export const rawMarker = tsMarker;\n");
    await write(
      entry,
      "export { rawMarker } from './raw.ts'; export { appendedMarker } from './runtime.js.tsx';\n",
    );
    const handle = await generation(context, "appended-extension-before-typescript-runtime-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const rawKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/raw.ts" || path.endsWith("/src/raw.ts")
      );
      assert.ok(rawKey !== undefined);
      result.metafile.inputs[rawKey]!.imports = [{
        kind: "import-statement",
        path: "./runtime.js",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/raw.ts",
        kind: "import-statement",
        to: "input:src/runtime.js.tsx",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("repairs deduplicated runtime specifiers for dynamic and CommonJS resolution kinds", async () => {
    for (const kind of ["dynamic-import", "require-call", "require-resolve"] as const) {
      const context = await fixture();
      const runtime = join(context.root, "src/runtime.ts");
      const entry = join(context.root, "src/entry.ts");
      await write(runtime, "export const marker = 'runtime';\n");
      await write(entry, "import { marker } from './runtime.ts'; export const value = marker;\n");
      const handle = await generation(context, `typescript-runtime-input-alias-${kind}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) =>
          path === "src/entry.ts" || path.endsWith("/src/entry.ts")
        );
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [{ kind, path: "./runtime.js" }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind,
          to: "input:src/runtime.ts",
        });
      } finally {
        build.mockRestore();
      }
    }
  });

  test("does not repair a runtime specifier for an unknown import kind", async () => {
    const context = await fixture();
    const runtime = join(context.root, "src/runtime.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtime, "export const marker = 'runtime';\n");
    await write(entry, "import { marker } from './runtime.ts'; export const value = marker;\n");
    const handle = await generation(context, "unknown-kind-runtime-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "future-import-kind",
        path: "./runtime.js",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved: \.\/runtime\.js/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("does not rewrite a .mjs runtime specifier inside node_modules", async () => {
    const context = await fixture();
    const runtime = join(context.root, "node_modules/@fixture/runtime/runtime.mts");
    const entry = join(context.root, "src/entry.ts");
    await write(runtime, "export const marker = 'runtime';\n");
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(entry, "import { marker } from '../node_modules/@fixture/runtime/runtime.mts'; export const value = marker;\n");
    const handle = await generation(context, "node-modules-mjs-runtime-input-alias-mismatch", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "../node_modules/@fixture/runtime/runtime.mjs",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved: \.\.\/node_modules\/@fixture\/runtime\/runtime\.mjs/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("does not bind an unresolved bare package spelling to a colliding root input", async () => {
    const context = await fixture();
    const collision = join(context.root, "foo.js");
    const entry = join(context.root, "src/entry.ts");
    await write(collision, "export const marker = 'local';\n");
    await write(entry, "import { marker } from '../foo.js'; export const value = marker;\n");
    const handle = await generation(context, "bare-root-input-collision", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path === "src/entry.ts" || path.endsWith("/src/entry.ts")
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "foo.js",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import from src\/entry\.ts is unresolved: foo\.js/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("repairs Bun deduplicated bare input aliases from one resolved package witness", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
    const witness = join(context.root, "src/witness.ts");
    const raw = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(witness, "import { marker } from '@fixture/runtime'; export const witnessed = marker;\n");
    await write(raw, "import { marker } from '@fixture/runtime'; export const deduplicated = marker;\n");
    await write(entry, "export { witnessed } from './witness.ts'; export { deduplicated } from './raw.ts';\n");
    const handle = await generation(context, "bare-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const runtimeKey = Object.keys(inputs).find((path) =>
        path === "node_modules/@fixture/runtime/index.js"
        || path.endsWith("/node_modules/@fixture/runtime/index.js")
      );
      const witnessKey = Object.keys(inputs).find((path) => path.endsWith("/src/witness.ts") || path === "src/witness.ts");
      const rawKey = Object.keys(inputs).find((path) => path.endsWith("/src/raw.ts") || path === "src/raw.ts");
      assert.ok(runtimeKey !== undefined && witnessKey !== undefined && rawKey !== undefined);
      inputs[witnessKey]!.imports = [{
        kind: "import-statement",
        original: "@fixture/runtime",
        path: runtimeKey,
      }] as never;
      inputs[rawKey]!.imports = [{
        kind: "import-statement",
        path: "@fixture/runtime",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      const target = "input:node_modules/@fixture/runtime/index.js";
      expect(receipt.edges).toContainEqual({ external: false, from: "input:src/witness.ts", kind: "import-statement", to: target });
      expect(receipt.edges).toContainEqual({ external: false, from: "input:src/raw.ts", kind: "import-statement", to: target });
      expect(receipt.edges.some(({ external, to }) => external || to === "external:@fixture/runtime")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a witnessed bare alias behind a hidden closer package installation", async () => {
    for (const kind of ["ordinary", "symlink"] as const) {
      const context = await fixture();
      const rootRuntime = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(rootRuntime, "package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(rootRuntime, "index.js"), "export const marker = 'root';\n");
      const witness = join(context.root, "src/witness.ts");
      const raw = join(context.root, "src/nested/raw.ts");
      const entry = join(context.root, "src/entry.ts");
      await write(witness, "import { marker } from '@fixture/runtime'; export const witnessed = marker;\n");
      await write(raw, "import { marker } from '@fixture/runtime'; export const deduplicated = marker;\n");
      await write(entry, "export { witnessed } from './witness.ts'; export { deduplicated } from './nested/raw.ts';\n");
      const handle = await generation(context, `witnessed-alias-hidden-closer-${kind}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const runtimeKey = Object.keys(inputs).find((path) =>
          path === "node_modules/@fixture/runtime/index.js"
          || path.endsWith("/node_modules/@fixture/runtime/index.js")
        );
        const witnessKey = Object.keys(inputs).find((path) =>
          path === "src/witness.ts" || path.endsWith("/src/witness.ts")
        );
        const rawKey = Object.keys(inputs).find((path) =>
          path === "src/nested/raw.ts" || path.endsWith("/src/nested/raw.ts")
        );
        assert.ok(runtimeKey !== undefined && witnessKey !== undefined && rawKey !== undefined);
        const closerRuntime = join(context.root, "src/nested/node_modules/@fixture/runtime");
        if (kind === "ordinary") {
          await write(
            join(closerRuntime, "package.json"),
            `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "2.0.0" })}\n`,
          );
          await write(join(closerRuntime, "index.js"), "export const marker = 'nested';\n");
        } else {
          await mkdir(resolve(closerRuntime, ".."), { recursive: true });
          await symlink(rootRuntime, closerRuntime);
        }
        inputs[witnessKey]!.imports = [{
          kind: "import-statement",
          original: "@fixture/runtime",
          path: runtimeKey,
        }] as never;
        inputs[rawKey]!.imports = [{
          kind: "import-statement",
          path: "@fixture/runtime",
        }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("repairs a Bun package-root alias from one in-graph installation with one canonical input", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-singleton", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(entryKey !== undefined);
      inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "@fixture/runtime",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "input:node_modules/@fixture/runtime/index.js",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("rejects zero-witness CommonJS resolution when only the conditional ESM input is known", async () => {
    for (const [index, kind] of ["require-call", "require-resolve"].entries()) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: { ".": { import: "./index.js", require: "./index.cjs" } },
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(join(runtimeDirectory, "index.js"), "export const marker = 'esm';\n");
      await write(join(runtimeDirectory, "index.cjs"), "exports.marker = 'commonjs';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
      const handle = await generation(context, `bare-input-conditional-commonjs-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
        const knownRuntimeInputs = Object.keys(inputs).filter((path) => path.includes("node_modules/@fixture/runtime/"));
        assert.ok(entryKey !== undefined);
        expect(knownRuntimeInputs).toHaveLength(1);
        expect(knownRuntimeInputs[0]?.endsWith("/index.js")).toBe(true);
        inputs[entryKey]!.imports = [{ kind, path: "@fixture/runtime" }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects a zero-witness package subpath without publishing a receipt", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: { "./feature": "./feature.js" }, name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/feature.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime/feature'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-subpath", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(entryKey !== undefined);
      inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime/feature" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/import.*unresolved.*@fixture\/runtime\/feature/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("repairs a zero-witness package root from its exact conditional import export with multiple in-graph inputs", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        exports: {
          source: "./src/index.ts",
          types: "./dist/types/src/index.d.ts",
          import: "./dist/index.mjs",
          require: "./dist/index.cjs",
        },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeDirectory, "dist/index.mjs"),
      "export { marker } from './private/NumberFormatter.mjs';\n",
    );
    await write(
      join(runtimeDirectory, "dist/private/NumberFormatter.mjs"),
      "export const marker = 'runtime';\n",
    );
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-package-import-export", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(entryKey !== undefined);
      const runtimeInputs = Object.keys(inputs)
        .filter((path) => path.includes("node_modules/@fixture/runtime/"))
        .map((path) => path.replaceAll("\\", "/"))
        .sort();
      expect(runtimeInputs).toHaveLength(2);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/dist/index.mjs")
        || path === "node_modules/@fixture/runtime/dist/index.mjs")).toBe(true);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/dist/private/NumberFormatter.mjs")
        || path === "node_modules/@fixture/runtime/dist/private/NumberFormatter.mjs")).toBe(true);
      inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        build: { conditions: ["browser", "module", "production"] },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "input:node_modules/@fixture/runtime/dist/index.mjs",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("continues package-root export conditions after an active nested branch has no match", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        exports: {
          browser: { development: "./dev.js" },
          import: "./index.mjs",
        },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeDirectory, "index.mjs"),
      "export { marker } from './private.js';\n",
    );
    await write(join(runtimeDirectory, "private.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-package-nested-condition-no-match", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      const runtimeInputs = Object.keys(inputs)
        .filter((path) => path.includes("node_modules/@fixture/runtime/"))
        .map((path) => path.replaceAll("\\", "/"))
        .sort();
      expect(runtimeInputs).toHaveLength(2);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/index.mjs")
        || path === "node_modules/@fixture/runtime/index.mjs")).toBe(true);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/private.js")
        || path === "node_modules/@fixture/runtime/private.js")).toBe(true);
      inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        build: { conditions: ["browser", "production"] },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "input:node_modules/@fixture/runtime/index.mjs",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("repairs an SSR zero-witness package root from Bun's implicit node-addons export condition", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        exports: {
          "node-addons": "./native.js",
          import: "./index.mjs",
        },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeDirectory, "native.js"),
      "export { marker } from './index.mjs';\n",
    );
    await write(join(runtimeDirectory, "index.mjs"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/server.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-package-node-addons-export", [
      expectation(context.root, "server", "ssr", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) =>
        path.endsWith("/src/server.ts") || path === "src/server.ts"
      );
      assert.ok(entryKey !== undefined);
      const runtimeInputs = Object.keys(inputs)
        .filter((path) => path.includes("node_modules/@fixture/runtime/"))
        .map((path) => path.replaceAll("\\", "/"))
        .sort();
      expect(runtimeInputs).toHaveLength(2);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/native.js")
        || path === "node_modules/@fixture/runtime/native.js")).toBe(true);
      expect(runtimeInputs.some((path) => path.endsWith("/node_modules/@fixture/runtime/index.mjs")
        || path === "node_modules/@fixture/runtime/index.mjs")).toBe(true);
      inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: handle,
        graphId: "server",
        rootDirectory: context.root,
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/server.ts",
        kind: "import-statement",
        to: "input:node_modules/@fixture/runtime/native.js",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("rejects zero-witness package-root export metadata that cannot identify an exact in-graph target", async () => {
    const variants = [
      {
        exports: "./index.js",
        id: "wrong-package-name",
        name: "@fixture/other",
      },
      {
        exports: "./missing.js",
        id: "missing-target",
        name: "@fixture/runtime",
      },
      {
        exports: "../outside.js",
        id: "escaping-target",
        name: "@fixture/runtime",
      },
    ] as const;
    for (const variant of variants) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: variant.exports,
          name: variant.name,
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(runtimeDirectory, "index.js"),
        "export { marker } from './private.js';\n",
      );
      await write(join(runtimeDirectory, "private.js"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
      );
      const handle = await generation(context, `bare-input-package-export-${variant.id}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/src/entry.ts") || path === "src/entry.ts"
        );
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [{
          kind: "import-statement",
          path: "@fixture/runtime",
        }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects an unsupported active package-root export condition instead of skipping to import", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        exports: {
          ".": {
            browser: ["./browser.js"],
            import: "./index.js",
          },
        },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeDirectory, "index.js"),
      "export { marker } from './private.js';\n",
    );
    await write(join(runtimeDirectory, "private.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
    );
    const handle = await generation(context, "bare-input-active-unsupported-export-condition", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{
        kind: "import-statement",
        path: "@fixture/runtime",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({
          build: { conditions: ["browser"] },
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a known root installation when a closer ordinary installation is absent from the metafile", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'root';\n");
    const entry = join(context.root, "src/nested/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-closer-physical-installation", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/nested/entry.ts"));
      assert.ok(entryKey !== undefined);
      await write(
        join(context.root, "src/nested/node_modules/@fixture/runtime/package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "2.0.0" })}\n`,
      );
      await write(
        join(context.root, "src/nested/node_modules/@fixture/runtime/index.js"),
        "export const marker = 'nested';\n",
      );
      inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a known root installation when the nearest package identity is a symlink", async () => {
    const context = await fixture();
    const rootRuntime = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(rootRuntime, "package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(rootRuntime, "index.js"), "export const marker = 'root';\n");
    const entry = join(context.root, "src/nested/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-symlinked-installation", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/nested/entry.ts"));
      assert.ok(entryKey !== undefined);
      const closerRuntime = join(context.root, "src/nested/node_modules/@fixture/runtime");
      await mkdir(resolve(closerRuntime, ".."), { recursive: true });
      await symlink(rootRuntime, closerRuntime);
      result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a nonexternal bare input alias without a resolved package witness", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "bare-input-without-witness", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(inputKey !== undefined);
      result.metafile.inputs[inputKey]!.imports = [{
        kind: "import-statement",
        path: "@fixture/missing",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/import.*unresolved.*@fixture\/missing/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects malformed and non-package-root zero-witness spellings without a receipt", async () => {
    const malformedSpecifiers = [
      "@fixture/runtime/feature",
      "@fixture/runtime/",
      "@fixture",
      "@fixture//runtime",
      "#runtime",
      "node:fs",
      "file:runtime",
      "C:/runtime",
      "fixture\\runtime",
      "fixture%2fruntime",
      "fs",
      "bun",
    ] as const;
    for (const [index, specifier] of malformedSpecifiers.entries()) {
      const context = await fixture();
      await write(
        join(context.root, "node_modules/@fixture/runtime/package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
      const handle = await generation(context, `bare-input-malformed-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
        assert.ok(entryKey !== undefined);
        inputs[entryKey]!.imports = [{ kind: "import-statement", path: specifier }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("does not bind a raw Node builtin spelling to a singleton package installation", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/fs/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "fs", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/fs/index.js"), "export const marker = 'not-the-builtin';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { marker } from '../node_modules/fs/index.js'; export const value = marker;\n",
    );
    const handle = await generation(context, "bare-input-node-builtin", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "fs" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*fs/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects zero-witness package spellings matched by root config paths", async () => {
    for (const [index, pattern] of ["@fixture/runtime", "@fixture/*"].entries()) {
      const context = await fixture();
      await write(
        join(context.root, "tsconfig.json"),
        `${JSON.stringify({ compilerOptions: { paths: { [pattern]: ["./src/runtime.ts"] } } })}\n`,
      );
      await write(
        join(context.root, "node_modules/@fixture/runtime/package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
      );
      const handle = await generation(context, `bare-input-config-path-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects a zero-witness package spelling that matches the root package name", async () => {
    const context = await fixture();
    await write(
      join(context.root, "package.json"),
      `${JSON.stringify({ name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
    );
    const handle = await generation(context, "bare-input-package-self-reference", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a zero-witness package spelling that matches the nearest workspace package scope", async () => {
    const context = await fixture();
    await write(
      join(context.root, "packages/runtime/package.json"),
      `${JSON.stringify({ name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'installed';\n");
    const entry = join(context.root, "packages/runtime/src/entry.ts");
    await write(
      entry,
      "import { marker } from '../../../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
    );
    const handle = await generation(context, "bare-input-workspace-self-reference", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const entryKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/packages/runtime/src/entry.ts")
        || path === "packages/runtime/src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/Bun metafile import.*is unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("disables zero-witness fallback for malformed, extended, or baseUrl root configs", async () => {
    const configs = [
      "{\n",
      `${JSON.stringify({ extends: "./base.json" })}\n`,
      `${JSON.stringify({ compilerOptions: { baseUrl: "." } })}\n`,
    ] as const;
    for (const [index, config] of configs.entries()) {
      const context = await fixture();
      await write(join(context.root, "tsconfig.json"), config);
      await write(
        join(context.root, "node_modules/@fixture/runtime/package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
      const handle = await generation(context, `bare-input-disabled-config-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const entryKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
        assert.ok(entryKey !== undefined);
        result.metafile.inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow();
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects root resolution config removal or replacement during the Bun build", async () => {
    for (const mutation of ["remove", "replace"] as const) {
      const context = await fixture();
      const configPath = join(context.root, "tsconfig.json");
      await write(configPath, `${JSON.stringify({ compilerOptions: { strict: true } })}\n`);
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "export const value = 1;\n");
      const handle = await generation(context, `root-config-${mutation}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        if (mutation === "remove") await rm(configPath);
        else await writeFile(configPath, `${JSON.stringify({ compilerOptions: { strict: false } })}\n`);
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/root resolution configuration changed during build/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects nested package scope removal or replacement during the Bun build", async () => {
    for (const mutation of ["remove", "replace"] as const) {
      const context = await fixture();
      const scopePath = join(context.root, "packages/runtime/package.json");
      await write(
        scopePath,
        `${JSON.stringify({ name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      const entry = join(context.root, "packages/runtime/src/entry.ts");
      await write(entry, "export const value = 1;\n");
      const handle = await generation(context, `nested-scope-${mutation}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        if (mutation === "remove") await rm(scopePath);
        else {
          await writeFile(
            scopePath,
            `${JSON.stringify({ name: "@fixture/replacement", type: "module", version: "2.0.0" })}\n`,
          );
        }
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/package scope configuration changed during build/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects unsupported zero-witness import kinds without a receipt", async () => {
    const unsupportedKinds = [
      "dynamic-import",
      "entry-point-build",
      "entry-point-run",
      "import-rule",
      "internal",
      "url-token",
    ] as const;
    for (const [index, kind] of unsupportedKinds.entries()) {
      const context = await fixture();
      await write(
        join(context.root, "node_modules/@fixture/runtime/package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(context.root, "node_modules/@fixture/runtime/index.js"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
      const handle = await generation(context, `bare-input-unsupported-kind-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
        assert.ok(entryKey !== undefined);
        inputs[entryKey]!.imports = [{ kind, path: "@fixture/runtime" }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(/Bun metafile import.*is unresolved/u);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("keeps an explicitly external bare input outside the bundled graph", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "external-bare-input", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      assert.ok(inputKey !== undefined);
      result.metafile.inputs[inputKey]!.imports = [{
        external: true,
        kind: "import-statement",
        path: "src/entry.ts",
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      expect(receipt.edges).toContainEqual({
        external: true,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "external:src/entry.ts",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("audits an explicit external StyleX import as an in-graph package dependency", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/unregistered/package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/unregistered", type: "module", version: "1.0.0" })}\n`,
    );
    await write(join(context.root, "node_modules/@fixture/unregistered/index.js"), "export const marker = 'runtime';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/unregistered'; export const value = marker;\n");
    const handle = await generation(context, "external-stylex-package-import", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const packageKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/unregistered/index.js")
        || path === "node_modules/@fixture/unregistered/index.js"
      );
      assert.ok(packageKey !== undefined);
      result.metafile.inputs[packageKey]!.imports = [{
        external: true,
        kind: "import-statement",
        path: "@stylexjs/stylex",
      }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/StyleX dependency @fixture\/unregistered has no verified package manifest/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("keeps an explicit bare external outside the graph when its spelling collides with an emitted output", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "external-output-collision", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    let collidingPath: string | undefined;
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputKey = Object.keys(result.metafile.inputs).find((path) => path.endsWith("/src/entry.ts") || path === "src/entry.ts");
      const outputKey = Object.keys(result.metafile.outputs).find((path) => path.includes("entries/"));
      assert.ok(inputKey !== undefined && outputKey !== undefined);
      const normalizedOutput = outputKey.replaceAll("\\", "/");
      const entriesIndex = normalizedOutput.lastIndexOf("entries/");
      assert.ok(entriesIndex !== -1);
      collidingPath = normalizedOutput.slice(entriesIndex);
      result.metafile.inputs[inputKey]!.imports = [{
        external: true,
        kind: "import-statement",
        path: collidingPath,
      }] as never;
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root });
      assert.ok(collidingPath !== undefined);
      expect(receipt.outputs.some(({ path }) => path === collidingPath)).toBe(true);
      expect(receipt.edges).toContainEqual({
        external: true,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: `external:${collidingPath}`,
      });
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a deduplicated bare input alias with ambiguous package witnesses", async () => {
    const context = await fixture();
    for (const [directory, marker] of [
      [join(context.root, "node_modules/@fixture/runtime"), "root"],
      [join(context.root, "src/nested/node_modules/@fixture/runtime"), "nested"],
    ] as const) {
      await write(
        join(directory, "package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(directory, "index.js"), `export const marker = '${marker}';\n`);
    }
    const rootImport = join(context.root, "src/root.ts");
    const nestedImport = join(context.root, "src/nested/nested.ts");
    const rawImport = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(rootImport, "import { marker } from '@fixture/runtime'; export const root = marker;\n");
    await write(nestedImport, "import { marker } from '@fixture/runtime'; export const nested = marker;\n");
    await write(rawImport, "import { marker } from '@fixture/runtime'; export const raw = marker;\n");
    await write(entry, "export { root } from './root.ts'; export { nested } from './nested/nested.ts'; export { raw } from './raw.ts';\n");
    const handle = await generation(context, "ambiguous-bare-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const key = (suffix: string) => Object.keys(inputs).find((path) => path.endsWith(suffix));
      const runtimeKeys = Object.keys(inputs).filter((path) =>
        path === "node_modules/@fixture/runtime/index.js"
        || path.endsWith("/node_modules/@fixture/runtime/index.js")
      );
      const rootRuntimeKey = runtimeKeys.find((path) => !path.endsWith("/src/nested/node_modules/@fixture/runtime/index.js"));
      const nestedRuntimeKey = runtimeKeys.find((path) => path.endsWith("/src/nested/node_modules/@fixture/runtime/index.js"));
      const rootImportKey = key("/src/root.ts");
      const nestedImportKey = key("/src/nested/nested.ts");
      const rawImportKey = key("/src/raw.ts");
      assert.ok(
        rootRuntimeKey !== undefined
        && nestedRuntimeKey !== undefined
        && rootRuntimeKey !== nestedRuntimeKey
        && rootImportKey !== undefined
        && nestedImportKey !== undefined
        && rawImportKey !== undefined,
      );
      inputs[rootImportKey]!.imports = [{ kind: "import-statement", original: "@fixture/runtime", path: rootRuntimeKey }] as never;
      inputs[nestedImportKey]!.imports = [{ kind: "import-statement", original: "@fixture/runtime", path: nestedRuntimeKey }] as never;
      inputs[rawImportKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/bare import target is ambiguous.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a bare input alias when another package installation has no bare witness", async () => {
    const context = await fixture();
    for (const [directory, marker] of [
      [join(context.root, "node_modules/@fixture/runtime"), "root"],
      [join(context.root, "src/nested/node_modules/@fixture/runtime"), "nested"],
    ] as const) {
      await write(
        join(directory, "package.json"),
        `${JSON.stringify({ exports: "./index.js", name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
      );
      await write(join(directory, "index.js"), `export const marker = '${marker}';\n`);
    }
    const rootImport = join(context.root, "src/root.ts");
    const nestedImport = join(context.root, "src/nested/nested.ts");
    const rawImport = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(rootImport, "import { marker } from '@fixture/runtime'; export const root = marker;\n");
    await write(nestedImport, "import { marker } from '@fixture/runtime'; export const nested = marker;\n");
    await write(rawImport, "import { marker } from '@fixture/runtime'; export const raw = marker;\n");
    await write(entry, "export { root } from './root.ts'; export { nested } from './nested/nested.ts'; export { raw } from './raw.ts';\n");
    const handle = await generation(context, "unwitnessed-ambiguous-bare-input-alias", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const key = (suffix: string) => Object.keys(inputs).find((path) => path.endsWith(suffix));
      const runtimeKeys = Object.keys(inputs).filter((path) =>
        path === "node_modules/@fixture/runtime/index.js"
        || path.endsWith("/node_modules/@fixture/runtime/index.js")
      );
      const rootRuntimeKey = runtimeKeys.find((path) => !path.endsWith("/src/nested/node_modules/@fixture/runtime/index.js"));
      const nestedRuntimeKey = runtimeKeys.find((path) => path.endsWith("/src/nested/node_modules/@fixture/runtime/index.js"));
      const rootImportKey = key("/src/root.ts");
      const nestedImportKey = key("/src/nested/nested.ts");
      const rawImportKey = key("/src/raw.ts");
      assert.ok(
        rootRuntimeKey !== undefined
        && nestedRuntimeKey !== undefined
        && rootRuntimeKey !== nestedRuntimeKey
        && rootImportKey !== undefined
        && nestedImportKey !== undefined
        && rawImportKey !== undefined,
      );
      inputs[rootImportKey]!.imports = [{ kind: "import-statement", original: "@fixture/runtime", path: rootRuntimeKey }] as never;
      inputs[nestedImportKey]!.imports = [{ kind: "import-statement", path: nestedRuntimeKey }] as never;
      inputs[rawImportKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/bare import target is ambiguous.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a bare input alias without a witness for its resolution kind", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        exports: { ".": { import: "./index.js", require: "./cjs.js" } },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(join(runtimeDirectory, "index.js"), "export const marker = 'esm';\n");
    await write(join(runtimeDirectory, "cjs.js"), "export const marker = 'cjs';\n");
    const esmImport = join(context.root, "src/esm.ts");
    const relativeImport = join(context.root, "src/relative.ts");
    const rawRequire = join(context.root, "src/raw.ts");
    const entry = join(context.root, "src/entry.ts");
    await write(esmImport, "import { marker } from '@fixture/runtime'; export const esm = marker;\n");
    await write(relativeImport, "import { marker } from '../node_modules/@fixture/runtime/cjs.js'; export const cjs = marker;\n");
    await write(rawRequire, "export const raw = 1;\n");
    await write(entry, "export { esm } from './esm.ts'; export { cjs } from './relative.ts'; export { raw } from './raw.ts';\n");
    const handle = await generation(context, "bare-input-resolution-kind", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const key = (suffix: string) => Object.keys(inputs).find((path) => path.endsWith(suffix));
      const esmRuntimeKey = key("/node_modules/@fixture/runtime/index.js")
        ?? (Object.hasOwn(inputs, "node_modules/@fixture/runtime/index.js") ? "node_modules/@fixture/runtime/index.js" : undefined);
      const cjsRuntimeKey = key("/node_modules/@fixture/runtime/cjs.js")
        ?? (Object.hasOwn(inputs, "node_modules/@fixture/runtime/cjs.js") ? "node_modules/@fixture/runtime/cjs.js" : undefined);
      const esmImportKey = key("/src/esm.ts");
      const relativeImportKey = key("/src/relative.ts");
      const rawRequireKey = key("/src/raw.ts");
      assert.ok(
        esmRuntimeKey !== undefined
        && cjsRuntimeKey !== undefined
        && esmImportKey !== undefined
        && relativeImportKey !== undefined
        && rawRequireKey !== undefined,
      );
      inputs[esmImportKey]!.imports = [{
        kind: "import-statement",
        original: "@fixture/runtime",
        path: esmRuntimeKey,
      }] as never;
      inputs[relativeImportKey]!.imports = [{
        kind: "import-statement",
        original: "../node_modules/@fixture/runtime/cjs.js",
        path: cjsRuntimeKey,
      }] as never;
      inputs[rawRequireKey]!.imports = [{ kind: "require-call", path: "@fixture/runtime" }] as never;
      return result;
    });

    try {
      await expect(
        collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
      ).rejects.toThrow(/import.*unresolved.*@fixture\/runtime/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects caller-owned build topology without consuming the graph slot", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "unsafe-options", [expectation(context.root, "client", "client", entry)]);
    const unsafe = [
      { compile: true },
      { entrypoints: [entry] },
      { files: { [entry]: "" } },
      { metafile: false },
      { naming: "../[name].[ext]" },
      { outdir: join(context.root, "other") },
      { outfile: join(context.root, "other.js") },
      { plugins: [] },
      { root: context.root },
      { serve: {} },
      { virtual: {} },
      { watch: true },
    ];
    for (const build of unsafe) {
      await expect(collectBunStylexGraph({ build: build as never, generation: handle, graphId: "client", rootDirectory: context.root })).rejects.toThrow(/adapter-owned|unsupported/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    }
    await expect(collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root })).resolves.toMatchObject({ state: "complete" });
  });

  test("rejects unsealed sourcemap modes without consuming the graph slot", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "unsafe-sourcemaps", [
      expectation(context.root, "client", "client", entry),
    ]);

    for (const sourcemap of [true, "external", "linked"] as const) {
      await expect(collectBunStylexGraph({
        build: { sourcemap } as never,
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      })).rejects.toThrow(/sourcemap supports only/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    }

    await expect(collectBunStylexGraph({
      generation: handle,
      graphId: "client",
      rootDirectory: context.root,
    })).resolves.toMatchObject({ state: "complete" });
  });

  test("accepts sealed sourcemap modes with a complete output inventory", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const expected = expectation(context.root, "client", "client", entry);

    for (const sourcemap of [false, "none", "inline"] as const) {
      const handle = await generation(context, `accepted-sourcemap-${String(sourcemap)}`, [expected]);
      const receipt = await collectBunStylexGraph({
        build: { sourcemap },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      const outputDirectory = join(handle.directory, ...receipt.outputRoot.split("/"));
      expect(receipt.outputs.map(({ path }) => path)).toEqual(await ordinaryFiles(outputDirectory));
      expect(receipt.outputs.some(({ path }) => path.endsWith(".map"))).toBe(false);
      for (const artifact of receipt.outputs) {
        const bytes = await readFile(join(outputDirectory, ...artifact.path.split("/")));
        expect(artifact).toMatchObject({ bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
    }
  });

  test("rejects an inline sourcemap when restoring a verified Tailwind bridge", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/tailwind-inline-sourcemap.ts");
    await write(entry, "import '@fixture/ui/tailwind.css'; export const value = true;\n");
    const handle = await generation(context, "tailwind-inline-sourcemap", [
      expectation(context.root, "client", "client", entry),
    ]);

    await expect(collectBunStylexGraph({
      build: { sourcemap: "inline" },
      generation: handle,
      graphId: "client",
      rootDirectory: context.root,
    })).rejects.toThrow(/cannot restore a verified Tailwind bridge into an inline-sourcemapped CSS output/u);
    expect(await receiptExists(handle, "client")).toBe(false);
  });

  test("rejects malformed metafiles and output topology without publishing a receipt", async () => {
    const malformedContext = await fixture();
    const malformedEntry = join(malformedContext.root, "src/entry.ts");
    await write(malformedEntry, "export const value = 1;\n");
    const malformed = await generation(malformedContext, "malformed-metafile", [
      expectation(malformedContext.root, "client", "client", malformedEntry),
    ]);
    const topologyContext = await fixture();
    const topologyEntry = join(topologyContext.root, "src/entry.ts");
    const topologySource = "export const value = 1;\n";
    await write(topologyEntry, topologySource);
    const topology = await generation(topologyContext, "invalid-output-topology", [
      expectation(topologyContext.root, "client", "client", topologyEntry),
    ]);
    const build = spyOn(Bun, "build")
      .mockResolvedValueOnce({
        logs: [],
        metafile: { inputs: [], outputs: {} },
        outputs: [],
        success: true,
      } as never)
      .mockResolvedValueOnce({
        logs: [],
        metafile: {
          inputs: {
            "src/entry.ts": { bytes: Buffer.byteLength(topologySource), format: "esm", imports: [] },
          },
          outputs: {
            "missing-output.js": {
              bytes: 0,
              entryPoint: "src/entry.ts",
              exports: ["value"],
              imports: [],
              inputs: { "src/entry.ts": { bytesInOutput: 0 } },
            },
          },
        },
        outputs: [],
        success: true,
      } as never);
    try {
      await expect(collectBunStylexGraph({ generation: malformed, graphId: "client", rootDirectory: malformedContext.root })).rejects.toThrow(/metafile/u);
      await expect(collectBunStylexGraph({ generation: topology, graphId: "client", rootDirectory: topologyContext.root })).rejects.toThrow(/output path|outputs differ/u);
      expect(build).toHaveBeenCalledTimes(2);
      expect(await receiptExists(malformed, "client")).toBe(false);
      expect(await receiptExists(topology, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects a non-external unresolved output import without publishing a receipt", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "export const value = 1;\n");
    const handle = await generation(context, "unresolved-output-import", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const outputPath = Object.keys(result.metafile.outputs).sort()[0];
      assert.ok(outputPath !== undefined);
      result.metafile.outputs[outputPath]!.imports = [{
        external: false,
        kind: "import-statement",
        path: "unresolved-package",
      }] as never;
      return result;
    });
    try {
      await expect(
        collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        }),
      ).rejects.toThrow(/output import.*unresolved-package/u);
      expect(build).toHaveBeenCalledTimes(1);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects cross-platform local paths disguised as external output imports", async () => {
    for (const [index, externalPath] of ["FILE:///tmp/outside.js", "C:/outside.js"].entries()) {
      const context = await fixture();
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "export const value = 1;\n");
      const handle = await generation(context, `unsafe-external-${String(index)}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const outputPath = Object.keys(result.metafile.outputs).sort()[0];
        assert.ok(outputPath !== undefined);
        result.metafile.outputs[outputPath]!.imports = [{
          external: true,
          kind: "import-statement",
          path: externalPath,
        }] as never;
        return result;
      });
      try {
        await expect(collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        })).rejects.toThrow(/relative or absolute files cannot be externalized/u);
        expect(build).toHaveBeenCalledTimes(1);
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects an entrypoint whose ancestor symlink escapes the graph root", async () => {
    const context = await fixture();
    const outside = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-bun-adapter-outside-"));
    roots.push(outside);
    await write(join(outside, "entry.ts"), "export const escaped = true;\n");
    await symlink(outside, join(context.root, "escaped"), "dir");
    const escapedEntry = join(context.root, "escaped/entry.ts");
    const handle = await generation(context, "escaped-entrypoint", [
      expectation(context.root, "client", "client", escapedEntry),
    ]);
    await expect(collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root })).rejects.toThrow(/escapes its root/u);
    expect(await receiptExists(handle, "client")).toBe(false);
  });

  test("rejects direct, nested, and copied standalone recipe CSS without a receipt", async () => {
    const cases = [
      {
        id: "direct",
        files: {
          "src/entry.ts": "import '../node_modules/@fixture/ui/dist/stylex.css'; export const value = 1;\n",
        },
      },
      {
        id: "resolved",
        files: {
          "src/entry.ts": "import '@fixture/ui/stylex.css'; export const value = 1;\n",
        },
      },
      {
        id: "nested",
        files: {
          "src/entry.ts": "import './outer.css'; export const value = 1;\n",
          "src/outer.css": "@import './nested.css';\n",
          "src/nested.css": "@import '@fixture/ui/stylex.css';\n",
        },
      },
      {
        id: "copy",
        files: {
          "src/copied.css": "@layer components.hraness-ui.priority1 { .x-package { color: red; } }\n",
          "src/entry.ts": "import './copied.css'; export const value = 1;\n",
        },
      },
    ] as const;
    for (const item of cases) {
      const context = await fixture();
      for (const [path, source] of Object.entries(item.files)) await write(join(context.root, path), source);
      const entry = join(context.root, "src/entry.ts");
      const handle = await generation(context, `css-${item.id}`, [expectation(context.root, "client", "client", entry)]);
      await expect(collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root })).rejects.toThrow(/recipe|StyleX|layer/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    }
  });

  test("rejects a registered package foundation changed after generation preparation", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/foundation-entry.ts");
    await write(
      entry,
      "import '@fixture/ui/compiler-foundation.css'; export const value = 1;\n",
    );
    const handle = await generation(context, "changed-foundation", [
      expectation(context.root, "client", "client", entry),
    ]);
    await writeFile(
      join(context.root, "node_modules/@fixture/ui/src/compiler-foundation.css"),
      ".foundation{display:grid}\n",
    );
    await expect(
      collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      }),
    ).rejects.toThrow(/package stylesheet differs from its manifest/u);
    expect(await receiptExists(handle, "client")).toBe(false);
  });

  test("uses parsed import edges to reject an unregistered dependency that imports StyleX through trivia", async () => {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/unregistered");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({ exports: "./index.js", name: "@fixture/unregistered", type: "module", version: "1.0.0" })}\n`,
    );
    await write(
      join(dependencyRoot, "index.js"),
      "export const loadStylex = () => import(/* resolver hint */ '@stylexjs/stylex');\n",
    );
    const entry = join(context.root, "src/unregistered-entry.ts");
    await write(
      entry,
      "export { loadStylex } from '@fixture/unregistered';\n",
    );
    const handle = await generation(context, "unregistered-stylex-dependency", [
      expectation(context.root, "client", "client", entry),
    ]);
    await expect(
      collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      }),
    ).rejects.toThrow(/no verified package manifest/u);
    expect(await receiptExists(handle, "client")).toBe(false);
  });

  test("rejects same-length native input drift after Bun has read the graph", async () => {
    const context = await fixture();
    const dataPath = join(context.root, "src/data.json");
    const entry = join(context.root, "src/json-entry.ts");
    await write(dataPath, '{"value":"aa"}\n');
    await write(entry, "import data from './data.json'; export const value = data.value;\n");
    const handle = await generation(context, "same-length-json-drift", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      await writeFile(dataPath, '{"value":"bb"}\n');
      return result;
    });
    try {
      await expect(
        collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        }),
      ).rejects.toThrow(/input changed during compilation/u);
      expect(await receiptExists(handle, "client")).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("keeps a failed build incomplete and rejects graph reuse", async () => {
    const context = await fixture();
    const broken = join(context.root, "src/broken.ts");
    await write(broken, "import './missing.ts'; export const value = 1;\n");
    const failed = await generation(context, "failed-build", [expectation(context.root, "client", "client", broken)]);
    await expect(collectBunStylexGraph({ generation: failed, graphId: "client", rootDirectory: context.root })).rejects.toThrow();
    expect(await receiptExists(failed, "client")).toBe(false);

    const valid = join(context.root, "src/valid.ts");
    await write(valid, "export const valid = true;\n");
    const complete = await generation(context, "reused-graph", [expectation(context.root, "client", "client", valid)]);
    await collectBunStylexGraph({ generation: complete, graphId: "client", rootDirectory: context.root });
    await expect(collectBunStylexGraph({ generation: complete, graphId: "client", rootDirectory: context.root })).rejects.toThrow(/already exists|receipt/u);
  });

  test("rejects graph metadata after finalization begins", async () => {
    const context = await fixture();
    const first = join(context.root, "src/first.ts");
    const second = join(context.root, "src/second.ts");
    await write(first, "export const first = 1;\n");
    await write(second, "export const second = 2;\n");
    const handle = await generation(context, "late-graph", [
      expectation(context.root, "first", "client", first),
      expectation(context.root, "second", "client", second),
    ]);
    await collectBunStylexGraph({ generation: handle, graphId: "first", rootDirectory: context.root });
    await expect(finalizeStylexGeneration({
      generation: handle,
      outputDirectory: context.generationOutput,
      rootDirectory: context.root,
    })).rejects.toThrow(/missing|unexpected/u);
    await expect(collectBunStylexGraph({ generation: handle, graphId: "second", rootDirectory: context.root })).rejects.toThrow(/finalization already started|late/u);
    expect(await receiptExists(handle, "second")).toBe(false);
  });
});
