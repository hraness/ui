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
      exports: { ".": "./dist/runtime.js", "./build": "./build/index.js", "./compiler-foundation.css": "./src/compiler-foundation.css", "./stylex.css": "./dist/stylex.css" },
      name: "@fixture/ui",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  await write(join(packageRoot, "dist/runtime.js"), "export const packageRuntime = true;\n");
  await write(join(packageRoot, "build/index.js"), "export const packageBuildTool = true;\n");
  await write(join(packageRoot, "dist/stylex.css"), ".x-package{color:red}\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), ".foundation{display:block}\n");
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

  test("excludes speculatively loaded tree-shaken inputs and their StyleX rules", async () => {
    const context = await fixture();
    const entry = join(context.root, "src/entry.ts");
    const speculative = join(context.root, "src/tree-shaken.ts");
    await write(
      entry,
      "import * as stylex from '@stylexjs/stylex'; const styles = stylex.create({ root: { color: 'rebeccapurple' } }); export const value = stylex.props(styles.root).className;\n",
    );
    await write(
      speculative,
      "import * as stylex from '@stylexjs/stylex'; const styles = stylex.create({ root: { color: 'chartreuse' } }); export const dropped = stylex.props(styles.root).className;\n",
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
        onLoad(_options: unknown, callback: (args: { path: string }) => unknown) {
          handlers.push(callback);
        },
      } as never);
      const javascriptOnLoad = handlers[0];
      assert.ok(javascriptOnLoad !== undefined);
      await javascriptOnLoad({ path: speculative });
      return buildOriginal(options);
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });

      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs.map(({ path }) => path)).toContain("src/entry.ts");
      expect(receipt.inputs.map(({ path }) => path)).not.toContain("src/tree-shaken.ts");
      expect(canonicalJson(receipt.rules)).toContain("rebeccapurple");
      expect(canonicalJson(receipt.rules)).not.toContain("chartreuse");
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
