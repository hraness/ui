import assert from "node:assert/strict";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  serializeStylexPackageRules,
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
  await write(join(packageRoot, "src/compiler-foundation.css"), ".foundation{display:block}\n");
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

async function makeNativeCssUrlGraph(
  context: Awaited<ReturnType<typeof fixture>>,
): Promise<{
  entry: string;
  font: Uint8Array;
  fontPath: string;
  logicalFont: string;
  logicalFontsCss: string;
}> {
  const packageRoot = join(context.root, "node_modules/@fixture/ui");
  await writeFile(
    join(packageRoot, "src/compiler-foundation.css"),
    '@import "./tokens.css";\n.foundation { color: rebeccapurple; }\n',
  );
  await write(
    join(packageRoot, "src/tokens.css"),
    '@import "./fonts.css";\n:root { --fixture-font: "Fixture Font"; }\n',
  );
  const fontsCss = join(packageRoot, "src/fonts.css");
  await write(
    fontsCss,
    '@font-face { font-family: "Fixture Font"; src: url("./fonts/Fixture.woff2") format("woff2"); }\n',
  );
  const fontPath = join(packageRoot, "src/fonts/Fixture.woff2");
  await mkdir(resolve(fontPath, ".."), { recursive: true });
  const font = new Uint8Array(70_000);
  font.set([0x77, 0x4f, 0x46, 0x32]);
  for (let index = 4; index < font.length; index += 1) font[index] = index % 251;
  await writeFile(fontPath, font, { flag: "wx" });
  const manifest = JSON.parse(await readFile(context.manifestPath, "utf8")) as StylexPackageManifestV1;
  const stylesheetPaths = [
    "src/compiler-foundation.css",
    "src/fonts.css",
    "src/tokens.css",
  ];
  await writeFile(
    context.manifestPath,
    `${canonicalJson({
      ...manifest,
      stylesheets: await Promise.all(stylesheetPaths.map((path) => artifactForFile(packageRoot, path))),
    })}\n`,
  );
  const entry = join(context.root, "src/font-entry.ts");
  await write(
    entry,
    'import "@fixture/ui/compiler-foundation.css"; export const value = true;\n',
  );
  return {
    entry,
    font,
    fontPath,
    logicalFont: logical(context.root, fontPath),
    logicalFontsCss: logical(context.root, fontsCss),
  };
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

  test("rejects obsolete Tailwind directives before publishing a graph receipt", async () => {
    for (const [name, directive] of [
      ["source", '@source "./";'],
      ["custom-variant", "@custom-variant dark (&:hover);"],
      ["theme", "@theme inline { --color-background: red; }"],
    ] as const) {
      const context = await fixture();
      const entry = join(context.root, `src/unsupported-${name}.ts`);
      const stylesheet = join(context.root, `src/unsupported-${name}.css`);
      await write(stylesheet, `${directive}\n`);
      await write(entry, `import './unsupported-${name}.css'; export const value = true;\n`);
      const handle = await generation(context, `unsupported-${name}`, [
        expectation(context.root, "client", "client", entry),
      ]);

      await expect(collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      })).rejects.toThrow(`unsupported @${name} directive`);
      expect(await receiptExists(handle, "client")).toBe(false);
    }
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

  test("promotes an exactly observed native CSS URL input omitted by Bun's metafile", async () => {
    const context = await fixture();
    const source = await makeNativeCssUrlGraph(context);
    const handle = await generation(context, "observed-native-css-url", [
      expectation(context.root, "client", "client", source.entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const fontsCssKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/ui/src/fonts.css")
        || path === "node_modules/@fixture/ui/src/fonts.css"
      );
      const fontKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/ui/src/fonts/Fixture.woff2")
        || path === "node_modules/@fixture/ui/src/fonts/Fixture.woff2"
      );
      assert.ok(fontsCssKey !== undefined && fontKey !== undefined);
      expect(result.metafile.inputs[fontsCssKey]!.imports).toContainEqual({
        kind: "url-token",
        original: "./fonts/Fixture.woff2",
        path: source.fontPath,
      });
      delete result.metafile.inputs[fontKey];
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        build: { minify: true },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs).toContainEqual({
        bytes: source.font.byteLength,
        path: source.logicalFont,
        sha256: sha256(source.font),
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: `input:${source.logicalFontsCss}`,
        kind: "url-token",
        to: `input:${source.logicalFont}`,
      });
      expect(receipt.outputs.some(({ path }) => /\.(?:woff2|otf)$/u.test(path))).toBe(false);
      const cssOutput = receipt.outputs.find(({ path }) => path.endsWith(".css"));
      assert.ok(cssOutput !== undefined);
      const css = await readFile(join(
        handle.directory,
        ...receipt.outputRoot.split("/"),
        ...cssOutput.path.split("/"),
      ), "utf8");
      expect(css).toContain("data:font/woff2;base64,");
      expect(await receiptExists(handle, "client")).toBe(true);
    } finally {
      build.mockRestore();
    }
  });

  test("promotes an exact native CSS URL witness despite an unrelated global raw alias", async () => {
    const context = await fixture();
    const source = await makeNativeCssUrlGraph(context);
    const aliasCss = join(context.root, "alias.css");
    const aliasFont = join(context.root, "fonts/Fixture.woff2");
    await write(aliasCss, '@font-face { font-family: "Alias Font"; src: url("./fonts/Fixture.woff2"); }\n');
    await write(aliasFont, "unrelated-local-font\n");
    await writeFile(
      source.entry,
      'import "@fixture/ui/compiler-foundation.css"; import "../alias.css"; export const value = true;\n',
    );
    const handle = await generation(context, "observed-native-css-url-alias-collision", [
      expectation(context.root, "client", "client", source.entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const dependencyFontKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/ui/src/fonts/Fixture.woff2")
        || path === "node_modules/@fixture/ui/src/fonts/Fixture.woff2"
      );
      const aliasFontKey = Object.keys(result.metafile.inputs).find((path) =>
        !path.includes("node_modules")
        && (path.endsWith("/fonts/Fixture.woff2") || path === "fonts/Fixture.woff2")
      );
      assert.ok(dependencyFontKey !== undefined && aliasFontKey !== undefined);
      const aliasMetadata = result.metafile.inputs[aliasFontKey];
      assert.ok(aliasMetadata !== undefined);
      delete result.metafile.inputs[dependencyFontKey];
      delete result.metafile.inputs[aliasFontKey];
      result.metafile.inputs["./fonts/Fixture.woff2"] = aliasMetadata;
      for (const output of Object.values(result.metafile.outputs)) {
        const rawAlias = Object.keys(output.inputs).find((path) =>
          !path.includes("node_modules")
          && (path.endsWith("/fonts/Fixture.woff2") || path === "fonts/Fixture.woff2")
        );
        if (rawAlias === undefined) continue;
        const contribution = output.inputs[rawAlias];
        assert.ok(contribution !== undefined);
        delete output.inputs[rawAlias];
        output.inputs["./fonts/Fixture.woff2"] = contribution;
      }
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        build: { minify: true },
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs).toContainEqual({
        bytes: source.font.byteLength,
        path: source.logicalFont,
        sha256: sha256(source.font),
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: `input:${source.logicalFontsCss}`,
        kind: "url-token",
        to: `input:${source.logicalFont}`,
      });
      expect(await receiptExists(handle, "client")).toBe(true);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects near-miss observed native CSS URL inputs", async () => {
    for (const variant of [
      "context-free-original",
      "invalid-original-syntax",
      "late-package-scope-drift",
      "mismatched-original",
      "mismatched-package-scope",
      "mixed-context-free-original",
      "outer-same-name-package-scope",
      "same-length-drift",
    ] as const) {
      const context = await fixture();
      const source = await makeNativeCssUrlGraph(context);
      if (variant === "outer-same-name-package-scope") {
        await writeFile(
          source.entry,
          'import "../node_modules/@fixture/ui/src/compiler-foundation.css"; export const value = true;\n',
        );
      }
      if (variant === "mismatched-package-scope") {
        await write(
          join(resolve(source.fontPath, ".."), "package.json"),
          `${JSON.stringify({ name: "@fixture/not-ui", version: "1.0.0" })}\n`,
        );
      }
      const handle = await generation(context, `observed-native-css-url-${variant}`, [
        expectation(context.root, "client", "client", source.entry),
      ]);
      if (variant === "outer-same-name-package-scope") {
        await rm(join(context.root, "node_modules/@fixture/ui/package.json"));
        await write(
          join(context.root, "package.json"),
          `${JSON.stringify({ name: "@fixture/ui", type: "module", version: "1.0.0" })}\n`,
        );
      }
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const fontsCssKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/ui/src/fonts.css")
          || path === "node_modules/@fixture/ui/src/fonts.css"
        );
        const fontKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/ui/src/fonts/Fixture.woff2")
          || path === "node_modules/@fixture/ui/src/fonts/Fixture.woff2"
        );
        assert.ok(fontsCssKey !== undefined && fontKey !== undefined);
        delete result.metafile.inputs[fontKey];
        if (variant === "mixed-context-free-original") {
          const canonical = result.metafile.inputs[fontsCssKey]!.imports.find(
            (imported) => imported.path === source.fontPath,
          );
          assert.ok(canonical !== undefined);
          result.metafile.inputs[fontsCssKey]!.imports.push({
            ...canonical,
            original: relative(process.cwd(), source.fontPath).split(sep).join("/"),
          });
        } else if (
          variant === "context-free-original"
          || variant === "invalid-original-syntax"
          || variant === "mismatched-original"
        ) {
          const replacement = variant === "context-free-original"
            ? relative(process.cwd(), source.fontPath).split(sep).join("/")
            : variant === "invalid-original-syntax"
              ? "./fonts/Fixture.woff2?raw"
              : "./fonts/Different.woff2";
          result.metafile.inputs[fontsCssKey]!.imports = result.metafile.inputs[fontsCssKey]!.imports.map(
            (imported) => imported.path === source.fontPath
              ? { ...imported, original: replacement }
              : imported,
          );
        } else if (variant === "same-length-drift") {
          const changed = new Uint8Array(source.font);
          changed[changed.length - 1] = (changed[changed.length - 1]! + 1) % 255;
          await writeFile(source.fontPath, changed);
        } else if (variant === "late-package-scope-drift") {
          const metafile = result.metafile;
          let changed = false;
          Object.defineProperty(result, "metafile", {
            configurable: true,
            get() {
              if (!changed) {
                writeFileSync(
                  join(context.root, "node_modules/@fixture/ui/package.json"),
                  `${JSON.stringify({
                    exports: { ".": "./dist/runtime.js", "./build": "./build/index.js", "./compiler-foundation.css": "./src/compiler-foundation.css", "./stylex.css": "./dist/stylex.css" },
                    name: "@fixture/ui",
                    type: "module",
                    version: "1.0.1",
                  })}\n`,
                );
                changed = true;
              }
              return metafile;
            },
          });
        }
        return result;
      });

      try {
        await expect(collectBunStylexGraph({
          build: { minify: true },
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        })).rejects.toThrow(
          variant === "same-length-drift"
            ? /observed native CSS URL input changed after its completed load/u
            : variant === "late-package-scope-drift"
              ? /promoted native CSS URL input package scope changed during edge settlement/u
              : variant === "mixed-context-free-original"
                ? /promoted native CSS URL input has a noncanonical inbound edge/u
                : /Bun output .* cites an unknown input/u,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
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

  test("settles Bun's exact unused nested re-export records from a CSS-side-effect-only dependency barrel", async () => {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/css-side-effects");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        exports: "./dist/exports/index.mjs",
        name: "@fixture/css-side-effects",
        sideEffects: ["*.css"],
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(dependencyRoot, "dist/exports/index.mjs"),
      [
        "export { Button } from '../private/Button.mjs';",
        "export { Breadcrumbs } from '../private/Breadcrumbs.mjs';",
        "export { Collection } from '../private/Collection.mjs';",
        "export { Dialog } from '../private/Dialog.mjs';",
        "",
      ].join("\n"),
    );
    await write(join(dependencyRoot, "dist/private/Button.mjs"), "export const Button = 'button';\n");
    await write(join(dependencyRoot, "dist/private/Breadcrumbs.mjs"), "export const Breadcrumbs = 'breadcrumbs';\n");
    const observedCollection = join(dependencyRoot, "dist/private/Collection.mjs");
    await write(observedCollection, "export const Collection = 'collection';\n");
    const observedDialog = join(dependencyRoot, "dist/private/Dialog.mjs");
    await write(observedDialog, "export const Dialog = 'dialog';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { Button } from '@fixture/css-side-effects'; export const value = Button;\n",
    );
    const handle = await generation(context, "css-side-effect-only-elided-reexport", [
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
      await javascriptOnLoad({ path: observedCollection });
      await javascriptOnLoad({ path: observedDialog });
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const barrelKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/css-side-effects/dist/exports/index.mjs")
        || path === "node_modules/@fixture/css-side-effects/dist/exports/index.mjs"
      );
      assert.ok(barrelKey !== undefined);
      expect(result.metafile.inputs[barrelKey]!.format).toBe("esm");
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "../private/Breadcrumbs.mjs",
      });
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "../private/Collection.mjs",
      });
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "../private/Dialog.mjs",
      });
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/css-side-effects/dist/private/Breadcrumbs.mjs")
        || path === "node_modules/@fixture/css-side-effects/dist/private/Breadcrumbs.mjs"
      )).toBe(false);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/css-side-effects/dist/private/Collection.mjs")
        || path === "node_modules/@fixture/css-side-effects/dist/private/Collection.mjs"
      )).toBe(false);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/css-side-effects/dist/private/Dialog.mjs")
        || path === "node_modules/@fixture/css-side-effects/dist/private/Dialog.mjs"
      )).toBe(false);
      result.metafile.inputs[barrelKey]!.imports = result.metafile.inputs[barrelKey]!.imports.map((imported) =>
        imported.path === "../private/Dialog.mjs"
          ? { kind: imported.kind, path: imported.path }
          : imported
      ) as never;
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        kind: "import-statement",
        path: "../private/Dialog.mjs",
      });
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
        "node_modules/@fixture/css-side-effects/dist/private/Button.mjs",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/css-side-effects/dist/private/Breadcrumbs.mjs",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/css-side-effects/dist/private/Collection.mjs",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/css-side-effects/dist/private/Dialog.mjs",
      );
      expect(receipt.edges.some(({ from, to }) =>
        from === "input:node_modules/@fixture/css-side-effects/dist/exports/index.mjs"
        && (
          to.endsWith("/Breadcrumbs.mjs")
          || to.endsWith("/Collection.mjs")
          || to.endsWith("/Dialog.mjs")
        )
      )).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("settles one external barrel edge when its target has an independent authoritative import", async () => {
    for (const witnessShape of ["resolved", "raw-relative"] as const) {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/shared-target");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        exports: "./dist/exports/index.mjs",
        name: "@fixture/shared-target",
        sideEffects: ["*.css"],
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(dependencyRoot, "dist/exports/index.mjs"),
      [
        "export { Collection } from '../private/Collection.mjs';",
        "export { ListBox } from '../private/ListBox.mjs';",
        "",
      ].join("\n"),
    );
    await write(
      join(dependencyRoot, "dist/private/Collection.mjs"),
      "export const Collection = 'collection';\n",
    );
    await write(
      join(dependencyRoot, "dist/private/ListBox.mjs"),
      "import { Collection } from './Collection.mjs'; export const ListBox = ['listbox', Collection];\n",
    );
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { ListBox } from '@fixture/shared-target'; export const value = ListBox;\n",
    );
    const handle = await generation(context, `authoritative-shared-elided-barrel-target-${witnessShape}`, [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const barrelKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/shared-target/dist/exports/index.mjs")
        || path === "node_modules/@fixture/shared-target/dist/exports/index.mjs"
      );
      const listBoxKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/shared-target/dist/private/ListBox.mjs")
        || path === "node_modules/@fixture/shared-target/dist/private/ListBox.mjs"
      );
      const collectionKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/shared-target/dist/private/Collection.mjs")
        || path === "node_modules/@fixture/shared-target/dist/private/Collection.mjs"
      );
      assert.ok(barrelKey !== undefined);
      assert.ok(listBoxKey !== undefined);
      assert.ok(collectionKey !== undefined);
      expect(result.metafile.inputs[listBoxKey]!.imports).toContainEqual({
        kind: "import-statement",
        original: "./Collection.mjs",
        path: join(dependencyRoot, "dist/private/Collection.mjs"),
      });
      if (witnessShape === "raw-relative") {
        result.metafile.inputs[listBoxKey]!.imports = result.metafile.inputs[listBoxKey]!.imports.map((imported) =>
          imported.original === "./Collection.mjs"
            ? { kind: "import-statement", path: "./Collection.mjs" }
            : imported
        ) as never;
        expect(result.metafile.inputs[listBoxKey]!.imports).toContainEqual({
          kind: "import-statement",
          path: "./Collection.mjs",
        });
      }
      result.metafile.inputs[barrelKey]!.imports = result.metafile.inputs[barrelKey]!.imports.map((imported) =>
        imported.original === "../private/Collection.mjs"
          ? { external: true, kind: "import-statement", path: "../private/Collection.mjs" }
          : imported
      ) as never;
      expect(result.metafile.inputs[barrelKey]!.imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "../private/Collection.mjs",
      });
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: handle,
        graphId: "client",
        rootDirectory: context.root,
      });
      expect(build).toHaveBeenCalledTimes(1);
      expect(receipt.inputs.map(({ path }) => path)).toEqual(expect.arrayContaining([
        "node_modules/@fixture/shared-target/dist/private/Collection.mjs",
        "node_modules/@fixture/shared-target/dist/private/ListBox.mjs",
      ]));
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:node_modules/@fixture/shared-target/dist/private/ListBox.mjs",
        kind: "import-statement",
        to: "input:node_modules/@fixture/shared-target/dist/private/Collection.mjs",
      });
      expect(receipt.edges.filter(({ from, to }) =>
        from === "input:node_modules/@fixture/shared-target/dist/exports/index.mjs"
        && to.endsWith("/Collection.mjs")
      )).toHaveLength(0);
    } finally {
      build.mockRestore();
    }
    }
  });

  test("rejects malformed independent witnesses for an authoritative barrel target", async () => {
    for (const variant of [
      "external",
      "attributes",
      "wrong-original",
      "cross-package",
      "raw-external",
      "raw-attributes",
      "raw-dynamic",
      "raw-noncanonical",
      "raw-wrong-target",
      "raw-cross-package",
    ] as const) {
      const context = await fixture();
      const dependencyRoot = join(context.root, "node_modules/@fixture/shared-target");
      const otherRoot = join(context.root, "node_modules/@fixture/other-witness");
      await write(
        join(dependencyRoot, "package.json"),
        `${JSON.stringify({
          exports: "./dist/exports/index.mjs",
          name: "@fixture/shared-target",
          sideEffects: ["*.css"],
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(dependencyRoot, "dist/exports/index.mjs"),
        [
          "export { Collection } from '../private/Collection.mjs';",
          "export { ListBox } from '../private/ListBox.mjs';",
          "",
        ].join("\n"),
      );
      await write(
        join(dependencyRoot, "dist/private/Collection.mjs"),
        "export const Collection = 'collection';\n",
      );
      await write(
        join(dependencyRoot, "dist/private/ListBox.mjs"),
        "import { Collection } from './Collection.mjs'; export const ListBox = ['listbox', Collection];\n",
      );
      if (variant === "cross-package" || variant === "raw-cross-package") {
        await write(
          join(otherRoot, "package.json"),
          `${JSON.stringify({
            exports: "./index.mjs",
            name: "@fixture/other-witness",
            sideEffects: false,
            type: "module",
            version: "1.0.0",
          })}\n`,
        );
        await write(
          join(otherRoot, "index.mjs"),
          "import { Collection } from '../shared-target/dist/private/Collection.mjs'; export const Other = Collection;\n",
        );
      }
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        variant === "cross-package" || variant === "raw-cross-package"
          ? "import { ListBox } from '@fixture/shared-target'; import { Other } from '@fixture/other-witness'; export const value = [ListBox, Other];\n"
          : "import { ListBox } from '@fixture/shared-target'; export const value = ListBox;\n",
      );
      const handle = await generation(context, `authoritative-shared-target-near-miss-${variant}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const barrelKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/shared-target/dist/exports/index.mjs")
          || path === "node_modules/@fixture/shared-target/dist/exports/index.mjs"
        );
        const listBoxKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/shared-target/dist/private/ListBox.mjs")
          || path === "node_modules/@fixture/shared-target/dist/private/ListBox.mjs"
        );
        const collectionKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/shared-target/dist/private/Collection.mjs")
          || path === "node_modules/@fixture/shared-target/dist/private/Collection.mjs"
        );
        const otherKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/other-witness/index.mjs")
          || path === "node_modules/@fixture/other-witness/index.mjs"
        );
        assert.ok(barrelKey !== undefined, `${variant}: missing authoritative barrel input`);
        assert.ok(listBoxKey !== undefined, `${variant}: missing authoritative ListBox input`);
        assert.ok(collectionKey !== undefined, `${variant}: missing authoritative Collection input`);
        const witness = result.metafile.inputs[listBoxKey]!.imports.find(({ original, path }) =>
          original === "./Collection.mjs" || path.endsWith("/Collection.mjs")
        );
        if (variant === "cross-package" || variant === "raw-cross-package") {
          assert.ok(otherKey !== undefined, `${variant}: missing cross-package witness input`);
          result.metafile.inputs[listBoxKey]!.imports = result.metafile.inputs[listBoxKey]!.imports.filter(
            (imported) => imported !== witness,
          );
        } else {
          assert.ok(witness !== undefined, `${variant}: missing baseline ListBox to Collection witness`);
          result.metafile.inputs[listBoxKey]!.imports = result.metafile.inputs[listBoxKey]!.imports.map((imported) => {
            if (imported !== witness) return imported;
            switch (variant) {
              case "external": return { ...imported, external: true };
              case "attributes": return { ...imported, with: { type: "javascript" } };
              case "wrong-original": return { ...imported, original: "./Different.mjs" };
              case "raw-external": return { external: true, kind: "import-statement", path: "./Collection.mjs" };
              case "raw-attributes": return { kind: "import-statement", path: "./Collection.mjs", with: { type: "javascript" } };
              case "raw-dynamic": return { kind: "dynamic-import", path: "./Collection.mjs" };
              case "raw-noncanonical": return { kind: "import-statement", path: "./nested/../Collection.mjs" };
              case "raw-wrong-target": return { kind: "import-statement", path: "./ListBox.mjs" };
            }
          }) as never;
        }
        result.metafile.inputs[barrelKey]!.imports = result.metafile.inputs[barrelKey]!.imports.map((imported) =>
          imported.original === "../private/Collection.mjs"
            ? { external: true, kind: "import-statement", path: "../private/Collection.mjs" }
            : imported
        ) as never;
        if (variant === "cross-package" || variant === "raw-cross-package") {
          assert.ok(otherKey !== undefined);
          const otherWitness = {
            kind: "import-statement",
            original: "../shared-target/dist/private/Collection.mjs",
            path: join(dependencyRoot, "dist/private/Collection.mjs"),
          } as const;
          expect(result.metafile.inputs[otherKey]!.imports).toContainEqual(otherWitness);
          if (variant === "raw-cross-package") {
            result.metafile.inputs[otherKey]!.imports = result.metafile.inputs[otherKey]!.imports.map((imported) =>
              imported.original === otherWitness.original
                ? { kind: "import-statement", path: "../shared-target/dist/private/Collection.mjs" }
                : imported
            ) as never;
          }
        }
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

  test("settles Bun's resolved dependency load that is elided after an intermediate export is tree-shaken", async () => {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/icons");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        exports: "./index.js",
        name: "@fixture/icons",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(dependencyRoot, "index.js"),
      [
        "export { BlueskyIcon } from './BlueskyIcon.js';",
        "export { Search01Icon } from './Search01Icon.js';",
        "export { UntouchedIcon } from './UntouchedIcon.js';",
        "",
      ].join("\n"),
    );
    await write(join(dependencyRoot, "BlueskyIcon.js"), "export const BlueskyIcon = ['bluesky'];\n");
    await write(join(dependencyRoot, "Search01Icon.js"), "export const Search01Icon = ['search'];\n");
    await write(join(dependencyRoot, "UntouchedIcon.js"), "export const UntouchedIcon = ['untouched'];\n");
    const intermediate = join(context.root, "src/intermediate.js");
    await write(
      intermediate,
      "import { BlueskyIcon } from '@fixture/icons'; export const retained = 'retained'; export const dropped = BlueskyIcon;\n",
    );
    const entry = join(context.root, "src/entry.js");
    await write(
      entry,
      "import { Search01Icon } from '@fixture/icons'; import { retained } from './intermediate.js'; globalThis.__fixtureIcons = [Search01Icon, retained];\n",
    );
    const handle = await generation(context, "observed-elided-package-input", [
      expectation(context.root, "client", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const importerKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/icons/index.js")
        || path === "node_modules/@fixture/icons/index.js"
      );
      assert.ok(importerKey !== undefined);
      const imports = result.metafile.inputs[importerKey]!.imports;
      const retainedImport = imports.find(({ original }) => original === "./Search01Icon.js");
      expect(retainedImport).toEqual({
        kind: "import-statement",
        original: "./Search01Icon.js",
        path: join(dependencyRoot, "Search01Icon.js"),
      });
      expect(retainedImport?.external ?? false).toBe(false);
      const droppedImport = imports.find(({ original }) => original === "./BlueskyIcon.js");
      expect(droppedImport).toEqual({
        kind: "import-statement",
        original: "./BlueskyIcon.js",
        path: join(dependencyRoot, "BlueskyIcon.js"),
      });
      expect(droppedImport?.external ?? false).toBe(false);
      expect(imports).toContainEqual({
        external: true,
        kind: "import-statement",
        path: "./UntouchedIcon.js",
      });
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/icons/Search01Icon.js")
        || path === "node_modules/@fixture/icons/Search01Icon.js"
      )).toBe(true);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/icons/BlueskyIcon.js")
        || path === "node_modules/@fixture/icons/BlueskyIcon.js"
      )).toBe(false);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/icons/UntouchedIcon.js")
        || path === "node_modules/@fixture/icons/UntouchedIcon.js"
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
        "node_modules/@fixture/icons/Search01Icon.js",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/icons/BlueskyIcon.js",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/icons/UntouchedIcon.js",
      );
      expect(receipt.edges.some(({ to }) =>
        to.endsWith("/BlueskyIcon.js") || to.endsWith("/UntouchedIcon.js")
      )).toBe(false);
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:node_modules/@fixture/icons/index.js",
        kind: "import-statement",
        to: "input:node_modules/@fixture/icons/Search01Icon.js",
      });
    } finally {
      build.mockRestore();
    }
  });

  test("settles an observed bare package subpath export wrapper that Bun tree-shakes from the graph", async () => {
    const context = await fixture();
    const importerRoot = join(context.root, "node_modules/@fixture/barrel");
    const runtimeRoot = join(context.root, "node_modules/@fixture/runtime");
    const exportWrapper = join(runtimeRoot, "dist/exports/private/openLink.mjs");
    const authoritativeRuntime = join(runtimeRoot, "dist/private/openLink.mjs");
    await write(
      join(importerRoot, "package.json"),
      `${JSON.stringify({
        exports: "./index.mjs",
        name: "@fixture/barrel",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(importerRoot, "index.mjs"),
      "import { useFeature } from '@fixture/runtime/useFeature'; export const marker = useFeature;\n",
    );
    await write(
      join(runtimeRoot, "package.json"),
      `${JSON.stringify({
        exports: {
          "./*": {
            source: "./exports/*.ts",
            types: "./dist/types/exports/*.d.ts",
            import: "./dist/exports/*.mjs",
            require: "./dist/exports/*.cjs",
          },
        },
        name: "@fixture/runtime",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeRoot, "dist/exports/useFeature.mjs"),
      "export { openLink as useFeature } from '../private/openLink.mjs';\n",
    );
    await write(
      exportWrapper,
      "export { openLink } from '../../../private/openLink.mjs';\n",
    );
    await write(authoritativeRuntime, "export const openLink = 'open-link';\n");
    const entry = join(context.root, "src/entry.js");
    await write(
      entry,
      "import { marker } from '@fixture/barrel'; globalThis.__bareExportMarker = marker;\n",
    );
    const handle = await generation(context, "observed-elided-bare-package-export", [
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
      await javascriptOnLoad({ path: exportWrapper });
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const importerKey = Object.keys(result.metafile.inputs).find((path) =>
        path.endsWith("/node_modules/@fixture/barrel/index.mjs")
        || path === "node_modules/@fixture/barrel/index.mjs"
      );
      assert.ok(importerKey !== undefined);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/dist/exports/private/openLink.mjs")
        || path === "node_modules/@fixture/runtime/dist/exports/private/openLink.mjs"
      )).toBe(false);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/dist/private/openLink.mjs")
        || path === "node_modules/@fixture/runtime/dist/private/openLink.mjs"
      )).toBe(true);
      result.metafile.inputs[importerKey]!.imports.push({
        kind: "import-statement",
        original: "@fixture/runtime/private/openLink",
        path: exportWrapper,
      });
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
        "node_modules/@fixture/runtime/dist/private/openLink.mjs",
      );
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/runtime/dist/exports/private/openLink.mjs",
      );
      expect(receipt.edges.some(({ from, to }) =>
        from.endsWith("/barrel/index.mjs")
        && to.endsWith("/exports/private/openLink.mjs")
      )).toBe(false);
      expect(receipt.edges.some(({ to }) => to.endsWith("/dist/private/openLink.mjs"))).toBe(true);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects near-miss observed bare package subpath export wrappers", async () => {
    const variants: readonly Readonly<{
      attributes?: boolean;
      builtin?: boolean;
      changed?: boolean;
      dynamic?: boolean;
      exportsMismatch?: boolean;
      external?: boolean;
      hiddenInstallation?: boolean;
      id: string;
      observe?: boolean;
      overlappingExports?: boolean;
      sideEffects?: boolean;
      symlink?: boolean;
      wrongPackage?: boolean;
    }>[] = [
      { id: "wrong-package-identity", wrongPackage: true },
      { exportsMismatch: true, id: "exports-target-mismatch" },
      { id: "overlapping-wildcard-exports", overlappingExports: true },
      { hiddenInstallation: true, id: "resolver-visible-installation-mismatch" },
      { id: "target-side-effects", sideEffects: true },
      { id: "missing-onload-snapshot", observe: false },
      { builtin: true, id: "builtin-spelling" },
      { external: true, id: "external-edge" },
      { attributes: true, id: "import-attributes" },
      { dynamic: true, id: "dynamic-import" },
      { changed: true, id: "changed-after-load" },
      { id: "symlink-after-load", symlink: true },
    ];

    for (const variant of variants) {
      const context = await fixture();
      const importerRoot = join(context.root, "node_modules/@fixture/barrel");
      const targetPackageName = variant.builtin ? "fs" : "@fixture/runtime";
      const targetRoot = join(context.root, "node_modules", targetPackageName);
      const targetSubpath = variant.builtin ? "promises" : "private/openLink";
      const exportWrapper = join(targetRoot, "dist/exports", `${targetSubpath}.mjs`);
      await write(
        join(importerRoot, "package.json"),
        `${JSON.stringify({
          exports: "./index.mjs",
          name: "@fixture/barrel",
          sideEffects: false,
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(join(importerRoot, "index.mjs"), "export const marker = 'marker';\n");
      const exportMap: Record<string, unknown> = {
        "./*": {
          import: variant.exportsMismatch ? "./dist/other/*.mjs" : "./dist/exports/*.mjs",
          require: "./dist/exports/*.cjs",
        },
      };
      if (variant.overlappingExports) {
        exportMap["./private/*"] = { import: "./dist/exports/private/*.mjs" };
      }
      await write(
        join(targetRoot, "package.json"),
        `${JSON.stringify({
          exports: exportMap,
          name: targetPackageName,
          sideEffects: variant.sideEffects ?? false,
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(exportWrapper, "export const openLink = 'open-link';\n");
      if (variant.hiddenInstallation) {
        await mkdir(join(importerRoot, "node_modules", targetPackageName), { recursive: true });
      }
      const entry = join(context.root, "src/entry.js");
      await write(
        entry,
        "import { marker } from '@fixture/barrel'; globalThis.__bareExportMarker = marker;\n",
      );
      const handle = await generation(context, `observed-bare-export-near-miss-${variant.id}`, [
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
        if (variant.observe !== false) {
          const javascriptOnLoad = handlers[0];
          assert.ok(javascriptOnLoad !== undefined);
          await javascriptOnLoad({ path: exportWrapper });
        }
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const importerKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith("/node_modules/@fixture/barrel/index.mjs")
          || path === "node_modules/@fixture/barrel/index.mjs"
        );
        assert.ok(importerKey !== undefined);
        if (variant.changed) {
          await writeFile(exportWrapper, "export const openLink = 'changed';\n");
        } else if (variant.symlink) {
          await rm(exportWrapper);
          const actual = join(targetRoot, "actual.mjs");
          await write(actual, "export const openLink = 'actual';\n");
          await symlink(actual, exportWrapper);
        }
        const original = variant.wrongPackage
          ? "@fixture/other/private/openLink"
          : variant.builtin
            ? "fs/promises"
            : "@fixture/runtime/private/openLink";
        result.metafile.inputs[importerKey]!.imports = [{
          ...(variant.attributes ? { with: { type: "javascript" } } : {}),
          ...(variant.external ? { external: true } : {}),
          kind: variant.dynamic ? "dynamic-import" : "import-statement",
          original,
          path: exportWrapper,
        }] as never;
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(
          variant.changed
            ? /Bun observed elided package input differs from its completed load/u
            : /Bun metafile import.*is unresolved/u,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  }, 30_000);

  test("keeps an adversarial unreferenced dependency observation outside the published graph", async () => {
    const context = await fixture();
    const dependencyRoot = join(context.root, "node_modules/@fixture/speculative");
    await write(
      join(dependencyRoot, "package.json"),
      `${JSON.stringify({
        exports: "./index.js",
        name: "@fixture/speculative",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(join(dependencyRoot, "index.js"), "export const marker = 'marker';\n");
    const speculative = join(dependencyRoot, "speculative.js");
    await write(speculative, "export const speculative = 'speculative';\n");
    const entry = join(context.root, "src/entry.js");
    await write(
      entry,
      "import { marker } from '@fixture/speculative'; globalThis.__speculativeMarker = marker;\n",
    );
    const handle = await generation(context, "unreferenced-speculative-package-input", [
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
      // Exercise the adapter-owned callback directly: an ambient observation
      // without a corresponding metafile edge must remain receipt-inert.
      const javascriptOnLoad = handlers[0];
      assert.ok(javascriptOnLoad !== undefined);
      await javascriptOnLoad({ path: speculative });
      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      expect(Object.keys(result.metafile.inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/speculative/speculative.js")
        || path === "node_modules/@fixture/speculative/speculative.js"
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
      expect(receipt.inputs.map(({ path }) => path)).not.toContain(
        "node_modules/@fixture/speculative/speculative.js",
      );
      expect(receipt.edges.some(({ from, to }) =>
        from.endsWith("/speculative.js") || to.endsWith("/speculative.js")
      )).toBe(false);
      expect(receipt.rules.some(([className, rule]) =>
        className.includes("speculative")
        || rule.ltr.includes("speculative")
        || rule.rtl?.includes("speculative")
      )).toBe(false);
      expect(receipt.outputs.some(({ path }) => path.includes("speculative"))).toBe(false);
    } finally {
      build.mockRestore();
    }
  });

  test("rejects near-miss resolved dependency loads that are absent from the authoritative graph", async () => {
    const variants: readonly Readonly<{
      edge?: Readonly<Record<string, unknown>>;
      id: string;
      importer?: "cjs" | "esm";
      name?: string;
      observe?: boolean;
      sideEffects?: unknown;
      target?: "changed" | "cross-package" | "directory" | "file" | "known" | "symlink";
    }>[] = [
      { edge: { external: true, kind: "import-statement", original: "./dropped.js" }, id: "external", sideEffects: false },
      { edge: { kind: "import-statement", original: undefined }, id: "missing-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "./different.js" }, id: "wrong-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "absolute" }, id: "absolute-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "./dropped.js", with: { type: "javascript" } }, id: "attributes", sideEffects: false },
      { edge: { kind: "dynamic-import", original: "./dropped.js" }, id: "dynamic", sideEffects: false },
      { edge: { kind: "require-call", original: "./dropped.js" }, id: "require", sideEffects: false },
      { edge: { kind: "import-statement", original: "./dropped.js?raw" }, id: "query-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "./dropped%2ejs" }, id: "encoded-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "./nested/../dropped.js" }, id: "noncanonical-original", sideEffects: false },
      { edge: { kind: "import-statement", original: "./dropped.js" }, id: "noncanonical-path", sideEffects: false },
      { edge: { kind: "import-statement", original: "../other/dropped.js" }, id: "cross-package", sideEffects: false, target: "cross-package" },
      { edge: { kind: "import-statement", original: "./dropped.js" }, id: "outside-root", observe: false, sideEffects: false },
      { id: "missing-snapshot-and-scope", observe: false, sideEffects: false },
      { id: "missing-side-effects" },
      { id: "true-side-effects", sideEffects: true },
      { id: "empty-side-effects", sideEffects: [] },
      { id: "non-string-side-effects", sideEffects: [42] },
      { id: "negated-side-effects", sideEffects: ["!*.css"] },
      { id: "broad-side-effects-glob", sideEffects: ["**/*"] },
      { id: "matching-mjs-side-effects", sideEffects: ["*.mjs"] },
      { id: "matching-js-side-effects", sideEffects: ["./dropped.js"] },
      { id: "mixed-css-and-js-side-effects", sideEffects: ["*.css", "./dropped.js"] },
      { id: "ambiguous-side-effects-glob", sideEffects: ["*.{css,js}"] },
      { id: "wrong-package-name", name: "@fixture/other", sideEffects: false },
      { id: "commonjs-importer", importer: "cjs", sideEffects: false },
      { id: "changed-after-load", sideEffects: false, target: "changed" },
      { id: "symlink-after-load", sideEffects: false, target: "symlink" },
      { id: "directory-after-load", sideEffects: false, target: "directory" },
      { id: "known-authoritative-target", sideEffects: false, target: "known" },
    ];

    for (const variant of variants) {
      const context = await fixture();
      const dependencyRoot = join(context.root, "node_modules/@fixture/observed");
      const importerName = variant.importer === "cjs" ? "index.cjs" : "index.js";
      const manifest: Record<string, unknown> = {
        exports: `./${importerName}`,
        name: variant.name ?? "@fixture/observed",
        type: variant.importer === "cjs" ? "commonjs" : "module",
        version: "1.0.0",
      };
      if (Object.hasOwn(variant, "sideEffects")) manifest.sideEffects = variant.sideEffects;
      await write(join(dependencyRoot, "package.json"), `${JSON.stringify(manifest)}\n`);
      await write(
        join(dependencyRoot, importerName),
        variant.target === "known"
          ? "import { dropped } from './dropped.js'; export const marker = dropped;\n"
          : variant.importer === "cjs"
            ? "exports.marker = 'marker';\n"
            : "export const marker = 'marker';\n",
      );
      const ordinaryTarget = join(dependencyRoot, "dropped.js");
      await write(ordinaryTarget, "export const dropped = 'dropped';\n");
      let target = ordinaryTarget;
      if (variant.target === "cross-package") {
        const otherRoot = join(context.root, "node_modules/@fixture/other");
        await write(
          join(otherRoot, "package.json"),
          `${JSON.stringify({ name: "@fixture/other", sideEffects: false, type: "module", version: "1.0.0" })}\n`,
        );
        target = join(otherRoot, "dropped.js");
        await write(target, "export const dropped = 'other';\n");
      }
      const entry = join(context.root, "src/entry.js");
      await write(
        entry,
        `import { marker } from '../node_modules/@fixture/observed/${importerName}'; globalThis.__observedMarker = marker;\n`,
      );
      const handle = await generation(context, `observed-elided-near-miss-${variant.id}`, [
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
        if (variant.observe !== false && variant.target !== "known") {
          const javascriptOnLoad = handlers[0];
          assert.ok(javascriptOnLoad !== undefined);
          await javascriptOnLoad({ path: target });
        }
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const importerKey = Object.keys(result.metafile.inputs).find((path) =>
          path.endsWith(`/node_modules/@fixture/observed/${importerName}`)
          || path === `node_modules/@fixture/observed/${importerName}`
        );
        assert.ok(importerKey !== undefined);
        if (variant.target === "changed") {
          await writeFile(target, "export const dropped = 'changed';\n");
        } else if (variant.target === "symlink") {
          await rm(target);
          const actual = join(dependencyRoot, "actual.js");
          await write(actual, "export const dropped = 'actual';\n");
          await symlink(actual, target);
        } else if (variant.target === "directory") {
          await rm(target);
          await mkdir(target);
        }
        const defaultPath = variant.id === "noncanonical-path"
          ? `${dependencyRoot}/nested/../dropped.js`
          : variant.id === "outside-root"
            ? resolve(context.root, "../outside.js")
            : target;
        result.metafile.inputs[importerKey]!.imports = [{
          kind: "import-statement",
          original: "./dropped.js",
          path: defaultPath,
          ...variant.edge,
          ...(variant.edge?.original === "absolute" ? { original: target } : {}),
        }] as never;
        return result;
      });

      try {
        if (variant.target === "known") {
          const receipt = await collectBunStylexGraph({
            generation: handle,
            graphId: "client",
            rootDirectory: context.root,
          });
          expect(receipt.edges).toContainEqual({
            external: false,
            from: `input:node_modules/@fixture/observed/${importerName}`,
            kind: "import-statement",
            to: "input:node_modules/@fixture/observed/dropped.js",
          });
          expect(receipt.inputs.map(({ path }) => path)).toContain(
            "node_modules/@fixture/observed/dropped.js",
          );
        } else {
          let rejection: unknown;
          try {
            await collectBunStylexGraph({
              generation: handle,
              graphId: "client",
              rootDirectory: context.root,
            });
          } catch (error) {
            rejection = error;
          }
          assert.ok(rejection !== undefined, `near-miss variant unexpectedly resolved: ${variant.id}`);
          expect(await receiptExists(handle, "client")).toBe(false);
        }
      } finally {
        build.mockRestore();
      }
    }
  }, 30_000);

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

  test("rejects near-miss relative elided dependency edges", async () => {
    const variants: readonly Readonly<{
      edge?: Readonly<Record<string, unknown>>;
      id: string;
      importer?: "cjs" | "esm";
      name?: string;
      sideEffects?: unknown;
      target: "changed" | "closer-scope" | "cross-package" | "directory" | "file" | "known" | "missing" | "non-js" | "parent-symlink" | "symlink";
    }>[] = [
      { id: "missing-side-effects", target: "file" },
      { id: "true-side-effects", sideEffects: true, target: "file" },
      { id: "matching-js-side-effects", sideEffects: ["./dropped.js"], target: "file" },
      { id: "mixed-css-and-js-side-effects", sideEffects: ["*.css", "./dropped.js"], target: "file" },
      { id: "ambiguous-side-effects-glob", sideEffects: ["*.{css,js}"], target: "file" },
      { edge: { external: true, kind: "import-statement", original: "./dropped.js", path: "./dropped.js" }, id: "original", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "dynamic-import", path: "./dropped.js" }, id: "dynamic", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "require-call", path: "./dropped.js" }, id: "require", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.js", with: { type: "javascript" } }, id: "attributes", sideEffects: false, target: "file" },
      { edge: { external: false, kind: "import-statement", path: "./dropped.js" }, id: "unobserved-nonexternal", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.js?raw" }, id: "query-path", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./dropped%2ejs" }, id: "encoded-path", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "./nested/../dropped.js" }, id: "noncanonical-path", sideEffects: false, target: "file" },
      { edge: { external: true, kind: "import-statement", path: "../other/dropped.js" }, id: "cross-package", sideEffects: false, target: "cross-package" },
      { id: "changed-after-observation", sideEffects: false, target: "changed" },
      { edge: { external: false, kind: "import-statement", path: "./dropped.js" }, id: "changed-after-observation-nonexternal", sideEffects: false, target: "changed" },
      { id: "missing-target", sideEffects: false, target: "missing" },
      { edge: { external: true, kind: "import-statement", path: "./dropped.json" }, id: "non-js-target", sideEffects: false, target: "non-js" },
      { id: "directory-target", sideEffects: false, target: "directory" },
      { id: "symlink-target", sideEffects: false, target: "symlink" },
      { edge: { external: true, kind: "import-statement", path: "./nested/dropped.js" }, id: "parent-symlink-target", sideEffects: false, target: "parent-symlink" },
      { edge: { external: true, kind: "import-statement", path: "./nested/dropped.js" }, id: "closer-package-scope", sideEffects: false, target: "closer-scope" },
      { id: "wrong-package-name", name: "@fixture/other", sideEffects: false, target: "file" },
      { id: "known-target-without-independent-witness", sideEffects: false, target: "known" },
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
        case "changed":
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
        case "parent-symlink":
          await write(join(dependencyRoot, "actual/dropped.js"), "export const dropped = true;\n");
          await symlink(join(dependencyRoot, "actual"), join(dependencyRoot, "nested"));
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
      const handle = await generation(context, `relative-elided-near-miss-${variant.id}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        if (variant.target === "changed") {
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
          await javascriptOnLoad({ path: join(dependencyRoot, "dropped.js") });
        }
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
        if (variant.target === "changed") {
          await writeFile(join(dependencyRoot, "dropped.js"), "export const dropped = 'changed';\n");
        }
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
        assert.match(
          String(rejection),
          variant.target === "changed"
            ? /Bun observed relative elided package input differs from its completed load/u
            : /Bun metafile import.*is unresolved/u,
          `near-miss variant rejected differently: ${variant.id}`,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  }, 30_000);

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

  test("repairs a Bun package-root alias with a root export beside a valid wildcard subpath", async () => {
    const context = await fixture();
    await write(
      join(context.root, "node_modules/@fixture/runtime/package.json"),
      `${JSON.stringify({
        exports: {
          ".": { production: "./index.js", default: "./fallback.js" },
          "./features/*": "./features/*.js",
        },
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
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

  test("repairs client and SSR zero-witness package roots from Bun.build's real legacy selection", async () => {
    const variants = [
      {
        alternate: "main.js",
        graphId: "client-both",
        kind: "client",
        manifest: { main: "./main.js", module: "./module.js" },
        selected: "module.js",
      },
      {
        alternate: "main.js",
        graphId: "server-both",
        kind: "ssr",
        manifest: { main: "main.js", module: "./module.js" },
        selected: "module.js",
      },
      {
        graphId: "client-module",
        kind: "client",
        manifest: { module: "./module.js" },
        selected: "module.js",
      },
      {
        graphId: "client-identical-aliases",
        kind: "client",
        manifest: { main: "alias.js", module: "./alias.js" },
        selected: "alias.js",
      },
      {
        graphId: "server-main",
        kind: "ssr",
        manifest: { main: "main.js" },
        selected: "main.js",
      },
      {
        graphId: "server-implicit",
        kind: "ssr",
        manifest: {},
        selected: "index.js",
      },
    ] as const;
    for (const variant of variants) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          ...variant.manifest,
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(runtimeDirectory, variant.selected),
        "import './private.js'; export const marker = 'runtime';\n",
      );
      if ("alternate" in variant) {
        await write(
          join(runtimeDirectory, variant.alternate),
          "import './private.js'; export const marker = 'alternate';\n",
        );
      }
      await write(join(runtimeDirectory, "private.js"), "globalThis.__fixtureRuntimeLoaded = true;\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        "import { marker } from '@fixture/runtime'; export const value = marker;\n",
      );
      const handle = await generation(context, `bare-input-legacy-root-${variant.graphId}`, [
        expectation(context.root, variant.graphId, variant.kind, entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(
          result.metafile !== undefined,
          `Bun legacy root fixture failed: ${result.logs.map(String).join("\n")}`,
        );
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) =>
          path.endsWith("/src/entry.ts") || path === "src/entry.ts"
        );
        assert.ok(entryKey !== undefined);
        const selectedKey = Object.keys(inputs).find((path) =>
          path.endsWith(`/node_modules/@fixture/runtime/${variant.selected}`)
          || path === `node_modules/@fixture/runtime/${variant.selected}`
        );
        assert.ok(
          selectedKey !== undefined,
          `Bun did not select ${variant.selected}: ${Object.keys(inputs).sort().join(", ")}`,
        );
        expect(
          Object.keys(inputs).some((path) =>
            path.endsWith("/node_modules/@fixture/runtime/private.js")
            || path === "node_modules/@fixture/runtime/private.js"
          ),
        ).toBe(true);
        const actualRootImport = inputs[entryKey]!.imports.find((imported) =>
          imported.original === "@fixture/runtime"
        );
        assert.ok(actualRootImport !== undefined);
        expect(actualRootImport.kind).toBe("import-statement");
        expect(
          actualRootImport.path === selectedKey
          || actualRootImport.path.endsWith(`/node_modules/@fixture/runtime/${variant.selected}`),
        ).toBe(true);
        inputs[entryKey]!.imports = [{ kind: "import-statement", path: "@fixture/runtime" }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({
          generation: handle,
          graphId: variant.graphId,
          rootDirectory: context.root,
        });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: `input:node_modules/@fixture/runtime/${variant.selected}`,
        });
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects an ambiguous legacy package root when both declared targets are known", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        main: "./main.js",
        module: "./module.js",
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(
      join(runtimeDirectory, "main.js"),
      "export const marker = 'main'; export const mainOnly = 'main-only'; export const moduleOnly = 'main-module-only';\n",
    );
    await write(
      join(runtimeDirectory, "module.js"),
      "import { mainOnly } from './main.js'; export const marker = `module-${mainOnly}`; export const moduleOnly = 'module-only';\n",
    );
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      [
        "import { marker } from '@fixture/runtime';",
        "export const value = marker;",
        "",
      ].join("\n"),
    );
    const probeHandle = await generation(context, "bare-input-contextual-legacy-root", [
      expectation(context.root, "probe", "client", entry),
    ]);
    const buildOriginal = Bun.build.bind(Bun);
    const probeBuild = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(
        result.metafile !== undefined,
        `Bun contextual legacy root fixture failed: ${result.logs.map(String).join("\n")}`,
      );
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      const actualRootImport = inputs[entryKey]!.imports.find((imported) =>
        imported.original === "@fixture/runtime"
      );
      assert.ok(actualRootImport !== undefined, JSON.stringify(inputs[entryKey]!.imports));
      expect(actualRootImport.kind).toBe("import-statement");
      assert.ok(
        actualRootImport.path.endsWith("/node_modules/@fixture/runtime/main.js"),
        JSON.stringify(actualRootImport),
      );
      return result;
    });

    try {
      const receipt = await collectBunStylexGraph({
        generation: probeHandle,
        graphId: "probe",
        rootDirectory: context.root,
      });
      expect(receipt.edges).toContainEqual({
        external: false,
        from: "input:src/entry.ts",
        kind: "import-statement",
        to: "input:node_modules/@fixture/runtime/main.js",
      });
    } finally {
      probeBuild.mockRestore();
    }

    const handle = await generation(context, "bare-input-ambiguous-legacy-root", [
      expectation(context.root, "client", "client", entry, join(runtimeDirectory, "module.js")),
    ]);
    const build = spyOn(Bun, "build").mockImplementation(async (options) => {
      const result = await buildOriginal(options);
      assert.ok(
        result.metafile !== undefined,
        `Bun ambiguous legacy root fixture failed: ${result.logs.map(String).join("\n")}`,
      );
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      assert.ok(Object.keys(inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/main.js")
        || path === "node_modules/@fixture/runtime/main.js"
      ), Object.keys(inputs).sort().join(", "));
      assert.ok(Object.keys(inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/module.js")
        || path === "node_modules/@fixture/runtime/module.js"
      ), Object.keys(inputs).sort().join(", "));
      const rawRootImport = inputs[entryKey]!.imports.find((imported) =>
        imported.path === "@fixture/runtime"
      );
      assert.ok(rawRootImport !== undefined, JSON.stringify(inputs[entryKey]!.imports));
      expect(rawRootImport).toEqual({ kind: "import-statement", path: "@fixture/runtime" });
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

  test("rejects a sole-known legacy target when another declared target was loaded then elided", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    const main = join(runtimeDirectory, "main.js");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        main: "./main.js",
        module: "./module.js",
        name: "@fixture/runtime",
        sideEffects: false,
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(main, "export const marker = 'main';\n");
    await write(join(runtimeDirectory, "module.js"), "export const marker = 'module';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(entry, "import { marker } from '@fixture/runtime'; export const value = marker;\n");
    const handle = await generation(context, "bare-input-observed-elided-legacy-root", [
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
      await javascriptOnLoad({ path: main });

      const result = await buildOriginal(options);
      assert.ok(result.metafile !== undefined);
      const inputs = result.metafile.inputs;
      const entryKey = Object.keys(inputs).find((path) =>
        path.endsWith("/src/entry.ts") || path === "src/entry.ts"
      );
      assert.ok(entryKey !== undefined);
      assert.equal(Object.keys(inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/main.js")
        || path === "node_modules/@fixture/runtime/main.js"
      ), false, Object.keys(inputs).sort().join(", "));
      assert.equal(Object.keys(inputs).some((path) =>
        path.endsWith("/node_modules/@fixture/runtime/module.js")
        || path === "node_modules/@fixture/runtime/module.js"
      ), true, Object.keys(inputs).sort().join(", "));
      const actualRootImport = inputs[entryKey]!.imports.find((imported) =>
        imported.original === "@fixture/runtime"
      );
      assert.ok(actualRootImport !== undefined);
      assert.ok(
        actualRootImport.path.endsWith("/node_modules/@fixture/runtime/module.js"),
        JSON.stringify(actualRootImport),
      );
      inputs[entryKey]!.imports = inputs[entryKey]!.imports.map((imported) =>
        imported === actualRootImport
          ? { kind: "import-statement", path: "@fixture/runtime" }
          : imported
      ) as never;
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

  test("rejects an invalid legacy root field instead of accepting another known target", async () => {
    for (const [index, invalidModule] of [{}, "../outside.js", "dist/index"].entries()) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          main: "./main.js",
          module: invalidModule,
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(runtimeDirectory, "main.js"),
        "import './private.js'; export const marker = 'main';\n",
      );
      await write(join(runtimeDirectory, "private.js"), "globalThis.__fixtureRuntimeLoaded = true;\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        "import { marker } from '../node_modules/@fixture/runtime/main.js'; export const value = marker;\n",
      );
      const handle = await generation(context, `bare-input-invalid-legacy-root-${String(index)}`, [
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

  test("rejects browser-remapped zero-witness package roots", async () => {
    const context = await fixture();
    const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
    await write(
      join(runtimeDirectory, "package.json"),
      `${JSON.stringify({
        browser: { "./index.js": "./browser.js" },
        exports: "./index.js",
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      })}\n`,
    );
    await write(join(runtimeDirectory, "index.js"), "export const marker = 'runtime';\n");
    await write(join(runtimeDirectory, "browser.js"), "export const marker = 'browser';\n");
    const entry = join(context.root, "src/entry.ts");
    await write(
      entry,
      "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
    );
    const handle = await generation(context, "bare-input-browser-remapped-root", [
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
  });

  test("rejects zero-witness package roots without an exact loaded JavaScript file snapshot", async () => {
    for (const [index, variant] of [
      { extension: "css", source: ".fixture { color: red; }\n" },
      { extension: "json", source: '{"marker":"runtime"}\n' },
      { extension: "js", loadedExtension: "txt", source: "runtime\n" },
      { extension: "node", loadedExtension: "txt", source: "runtime\n" },
      { extension: "txt", source: "runtime\n" },
    ].entries()) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      const target = `index.${variant.extension}`;
      const loadedTarget = `index.${"loadedExtension" in variant ? variant.loadedExtension : variant.extension}`;
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({ main: `./${target}`, name: "@fixture/runtime", version: "1.0.0" })}\n`,
      );
      await write(join(runtimeDirectory, loadedTarget), variant.source);
      if (loadedTarget !== target) await write(join(runtimeDirectory, target), "export const marker = 'unobserved';\n");
      const entry = join(context.root, "src/entry.ts");
      const importSource = variant.extension === "css"
        ? `import '../node_modules/@fixture/runtime/${loadedTarget}'; export const value = 1;\n`
        : `import marker from '../node_modules/@fixture/runtime/${loadedTarget}'; export const value = marker;\n`;
      await write(entry, importSource);
      const handle = await generation(context, `bare-input-non-js-root-${String(index)}`, [
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
        if (loadedTarget !== target) {
          const loadedKey = Object.keys(result.metafile.inputs).find((path) =>
            path.endsWith(`/node_modules/@fixture/runtime/${loadedTarget}`)
            || path === `node_modules/@fixture/runtime/${loadedTarget}`
          );
          assert.ok(loadedKey !== undefined);
          const targetKey = `${loadedKey.slice(0, -loadedTarget.length)}${target}`;
          result.metafile.inputs[targetKey] = result.metafile.inputs[loadedKey]!;
          delete result.metafile.inputs[loadedKey];
        }
        result.metafile.inputs[entryKey]!.imports = [{
          kind: "import-statement",
          path: "@fixture/runtime",
        }] as never;
        return result;
      });

      try {
        const collection = collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        });
        await expect(collection).rejects.toThrow(
          loadedTarget === target
            ? /Bun metafile import.*is unresolved.*@fixture\/runtime/u
            : /Bun omitted package-scope capture for a reachable input/u,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects singleton zero-witness package roots whose sole input is not the active root export", async () => {
    const variants = [
      {
        exports: { "./feature": "./feature.js" },
        id: "sole-subpath-export",
        input: "feature.js",
        main: "./feature.js",
      },
      {
        exports: { ".": { browser: "./browser.js", import: "./index.js" } },
        id: "inactive-import-condition",
        input: "index.js",
      },
    ] as const;
    for (const variant of variants) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: variant.exports,
          ...("main" in variant ? { main: variant.main } : {}),
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(join(runtimeDirectory, variant.input), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        `import { marker } from '../node_modules/@fixture/runtime/${variant.input}'; export const value = marker;\n`,
      );
      const handle = await generation(context, `bare-input-singleton-${variant.id}`, [
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
        const runtimeInputs = Object.keys(inputs).filter((path) =>
          path.includes("node_modules/@fixture/runtime/") && !path.endsWith("/package.json")
        );
        assert.ok(entryKey !== undefined);
        expect(runtimeInputs).toHaveLength(1);
        expect(runtimeInputs[0]?.endsWith(`/node_modules/@fixture/runtime/${variant.input}`)
          || runtimeInputs[0] === `node_modules/@fixture/runtime/${variant.input}`).toBe(true);
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
    }
  });

  test("rejects late identity changes to a singleton zero-witness package root", async () => {
    for (const mutation of ["manifest", "target-bytes", "target-mode"] as const) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      const manifestPath = join(runtimeDirectory, "package.json");
      const targetPath = join(runtimeDirectory, "index.js");
      const manifest = {
        exports: "./index.js",
        name: "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      } as const;
      await write(manifestPath, `${JSON.stringify(manifest)}\n`);
      await write(targetPath, "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        "import { marker } from '../node_modules/@fixture/runtime/index.js'; export const value = marker;\n",
      );
      const handle = await generation(context, `bare-input-singleton-late-${mutation}`, [
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
        const output = result.outputs[0];
        assert.ok(output !== undefined);
        const arrayBuffer = output.arrayBuffer.bind(output);
        let mutated = false;
        Object.defineProperty(output, "arrayBuffer", {
          configurable: true,
          value: async () => {
            const bytes = await arrayBuffer();
            if (!mutated) {
              mutated = true;
              if (mutation === "manifest") {
                writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: "1.0.1" })}\n`);
              } else if (mutation === "target-bytes") {
                writeFileSync(targetPath, "export const marker = 'changed';\n");
              } else {
                chmodSync(targetPath, 0o600);
              }
            }
            return bytes;
          },
        });
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(
          mutation === "manifest"
            ? /Bun raw fallback package scope changed after edge settlement/u
            : /Bun raw fallback source changed after edge settlement/u,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
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

  test("repairs zero-witness package subpaths from exact and unique wildcard exports", async () => {
    for (const mapping of ["exact", "wildcard"] as const) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: mapping === "exact"
            ? { "./feature": { import: "./dist/feature.mjs" } }
            : { "./*": { import: "./dist/*.mjs" } },
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(runtimeDirectory, "dist/feature.mjs"),
        "export { marker } from './private.mjs';\n",
      );
      await write(join(runtimeDirectory, "dist/private.mjs"), "export const marker = 'runtime';\n");
      const entry = join(context.root, "src/entry.ts");
      await write(entry, "import { marker } from '@fixture/runtime/feature'; export const value = marker;\n");
      const handle = await generation(context, `bare-input-subpath-${mapping}`, [
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
        expect(Object.keys(inputs).filter((path) => path.includes("node_modules/@fixture/runtime/"))).toHaveLength(2);
        inputs[entryKey]!.imports = [{
          kind: "import-statement",
          path: "@fixture/runtime/feature",
        }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: "input:node_modules/@fixture/runtime/dist/feature.mjs",
        });
        expect(receipt.edges).not.toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: "input:node_modules/@fixture/runtime/dist/private.mjs",
        });
      } finally {
        build.mockRestore();
      }
    }
  });

  test("substitutes package export wildcard captures as literal path text", async () => {
    const replacements = [
      { id: "dollar", value: "cash$$" },
      { id: "match", value: "match$&" },
      { id: "prefix", value: "prefix$`" },
      { id: "suffix", value: "suffix$'" },
    ] as const;
    for (const replacement of replacements) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: { "./tokens/*": { import: "./dist/tokens/*.mjs" } },
          name: "@fixture/runtime",
          type: "module",
          version: "1.0.0",
        })}\n`,
      );
      await write(
        join(runtimeDirectory, "dist/tokens", `${replacement.value}.mjs`),
        "export const marker = 'runtime';\n",
      );
      const specifier = `@fixture/runtime/tokens/${replacement.value}`;
      const entry = join(context.root, "src/entry.ts");
      await write(entry, `import { marker } from ${JSON.stringify(specifier)}; export const value = marker;\n`);
      const handle = await generation(context, `bare-input-subpath-token-${replacement.id}`, [
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
        inputs[entryKey]!.imports = [{ kind: "import-statement", path: specifier }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: `input:node_modules/@fixture/runtime/dist/tokens/${replacement.value}.mjs`,
        });
      } finally {
        build.mockRestore();
      }
    }
  });

  test("maps an observed transparent CommonJS selector directly to its authoritative production child", async () => {
    for (const exportMode of ["exact", "conditional-default"] as const) {
      const context = await fixture();
      const packageName = "use-sync-external-store";
      const runtimeDirectory = join(context.root, "node_modules", packageName);
      const wrapper = join(runtimeDirectory, "shim/index.js");
      const production = join(runtimeDirectory, "cjs/use-sync-external-store-shim.production.js");
      const development = join(runtimeDirectory, "cjs/use-sync-external-store-shim.development.js");
      const specifier = `${packageName}/shim/index.js`;
      await write(
        join(runtimeDirectory, "package.json"),
        `${JSON.stringify({
          exports: exportMode === "exact"
            ? { "./shim/index.js": "./shim/index.js" }
            : { "./shim/index.js": { "react-native": "./shim/index.native.js", default: "./shim/index.js" } },
          name: packageName,
          version: "1.6.0",
        })}\n`,
      );
      await write(
        wrapper,
        [
          "'use strict';",
          "",
          "if (process.env.NODE_ENV === 'production') {",
          "  module.exports = require('../cjs/use-sync-external-store-shim.production.js');",
          "} else {",
          "  module.exports = require('../cjs/use-sync-external-store-shim.development.js');",
          "}",
          "",
        ].join("\n"),
      );
      await write(production, "'use strict'; module.exports = { marker: 'production' };\n");
      await write(development, "'use strict'; module.exports = { marker: 'development' };\n");
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        `import runtime from '../node_modules/${packageName}/cjs/use-sync-external-store-shim.production.js'; export const value = runtime.marker;\n`,
      );
      const handle = await generation(context, `commonjs-selector-${exportMode}`, [
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
        await javascriptOnLoad({ path: wrapper });
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) =>
          path.endsWith("/src/entry.ts") || path === "src/entry.ts"
        );
        assert.ok(entryKey !== undefined);
        expect(Object.keys(inputs).some((path) => path.endsWith(`/${logical(context.root, production)}`)
          || path === logical(context.root, production))).toBe(true);
        expect(Object.keys(inputs).some((path) => path.endsWith(`/${logical(context.root, wrapper)}`)
          || path === logical(context.root, wrapper))).toBe(false);
        expect(Object.keys(inputs).some((path) => path.endsWith(`/${logical(context.root, development)}`)
          || path === logical(context.root, development))).toBe(false);
        inputs[entryKey]!.imports = [{ kind: "import-statement", path: specifier }] as never;
        return result;
      });

      try {
        const receipt = await collectBunStylexGraph({
          generation: handle,
          graphId: "client",
          rootDirectory: context.root,
        });
        expect(receipt.edges).toContainEqual({
          external: false,
          from: "input:src/entry.ts",
          kind: "import-statement",
          to: `input:${logical(context.root, production)}`,
        });
        expect(receipt.inputs.some(({ path }) => path === logical(context.root, wrapper))).toBe(false);
        expect(receipt.inputs.some(({ path }) => path === logical(context.root, development))).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  });

  test("rejects unsafe transparent CommonJS selector fallbacks and late identity changes", async () => {
    const canonicalWrapper = [
      "'use strict';",
      "",
      "if (process.env.NODE_ENV === 'production') {",
      "  module.exports = require('../cjs/runtime.production.js');",
      "} else {",
      "  module.exports = require('../cjs/runtime.development.js');",
      "}",
      "",
    ].join("\n");
    const variants: readonly Readonly<{
      ambiguousInstallationInput?: boolean;
      childScope?: boolean;
      edge?: "attributes" | "dynamic" | "require";
      id: string;
      importerBrowser?: boolean;
      lateMutation?: "child-bytes" | "child-mode" | "child-parent-symlink" | "config" | "manifest" | "wrapper-bytes" | "wrapper-mode" | "wrapper-parent-symlink";
      observeWrapper?: boolean;
      packageBrowser?: boolean;
      packageName?: "@fixture/runtime";
      pathsAlias?: boolean;
      rawSpecifier?: "use-sync-external-store/shim";
      selectedChild?: "development";
      wrapperScope?: boolean;
      wrapperSource?: string;
    }>[] = [
      { id: "unobserved-wrapper", observeWrapper: false },
      { id: "extra-statement", wrapperSource: `globalThis.sideEffect = true;\n${canonicalWrapper}` },
      { id: "wrong-condition", wrapperSource: canonicalWrapper.replace("=== 'production'", "=== 'development'") },
      { id: "loose-condition", wrapperSource: canonicalWrapper.replace("=== 'production'", "== 'production'") },
      { id: "computed-export", wrapperSource: canonicalWrapper.replaceAll("module.exports", "module['exports']") },
      { id: "nonliteral-require", wrapperSource: canonicalWrapper.replace("require('../cjs/runtime.production.js')", "require(productionTarget)") },
      { id: "escaping-production-require", wrapperSource: canonicalWrapper.replace("../cjs/runtime.production.js", "../../outside.js") },
      { id: "noncanonical-production-require", wrapperSource: canonicalWrapper.replace("../cjs/runtime.production.js", "../cjs/nested/../runtime.production.js") },
      { id: "redundant-dot-parent-production-require", wrapperSource: canonicalWrapper.replace("../cjs/runtime.production.js", "./../cjs/runtime.production.js") },
      { id: "escaping-development-require", wrapperSource: canonicalWrapper.replace("../cjs/runtime.development.js", "../../outside.js") },
      { id: "recursive-development-require", wrapperSource: canonicalWrapper.replace("../cjs/runtime.development.js", "../shim/index.js") },
      { id: "production-child-not-authoritative", selectedChild: "development" },
      { ambiguousInstallationInput: true, id: "ambiguous-authoritative-installation-inputs" },
      { childScope: true, id: "selected-child-package-scope" },
      { id: "wrapper-package-scope", wrapperScope: true },
      { id: "target-package-browser-remap", packageBrowser: true },
      { id: "importer-package-browser-remap", importerBrowser: true },
      { id: "root-paths-alias", pathsAlias: true },
      { id: "wrong-package", packageName: "@fixture/runtime" },
      { id: "shim-alias", rawSpecifier: "use-sync-external-store/shim" },
      { edge: "attributes", id: "import-attributes" },
      { edge: "dynamic", id: "dynamic-import" },
      { edge: "require", id: "require-call" },
      { id: "late-wrapper-bytes", lateMutation: "wrapper-bytes" },
      { id: "late-wrapper-mode", lateMutation: "wrapper-mode" },
      { id: "late-wrapper-parent-symlink", lateMutation: "wrapper-parent-symlink" },
      { id: "late-selected-child-bytes", lateMutation: "child-bytes" },
      { id: "late-selected-child-mode", lateMutation: "child-mode" },
      { id: "late-selected-child-parent-symlink", lateMutation: "child-parent-symlink" },
      { id: "late-package-manifest", lateMutation: "manifest" },
      { id: "late-root-config", lateMutation: "config" },
    ];

    for (const variant of variants) {
      const context = await fixture();
      const packageName = variant.packageName ?? "use-sync-external-store";
      const runtimeDirectory = join(context.root, "node_modules", packageName);
      const manifestPath = join(runtimeDirectory, "package.json");
      const wrapper = join(runtimeDirectory, "shim/index.js");
      const production = join(runtimeDirectory, "cjs/runtime.production.js");
      const development = join(runtimeDirectory, "cjs/runtime.development.js");
      const extra = join(runtimeDirectory, "cjs/runtime.extra.js");
      const manifest: Record<string, unknown> = {
        exports: { "./shim/index.js": "./shim/index.js" },
        name: packageName,
        version: "1.6.0",
      };
      if (variant.packageBrowser) manifest.browser = { "./shim/index.js": "./shim/browser.js" };
      await write(manifestPath, `${JSON.stringify(manifest)}\n`);
      await write(wrapper, variant.wrapperSource ?? canonicalWrapper);
      await write(production, "'use strict'; module.exports = { marker: 'production' };\n");
      await write(development, "'use strict'; module.exports = { marker: 'development' };\n");
      if (variant.ambiguousInstallationInput) {
        await write(extra, "'use strict'; module.exports = { marker: 'extra' };\n");
      }
      if (variant.childScope) {
        await write(
          join(runtimeDirectory, "cjs/package.json"),
          `${JSON.stringify({ name: "use-sync-external-store-child", version: "1.0.0" })}\n`,
        );
      }
      if (variant.wrapperScope) {
        await write(
          join(runtimeDirectory, "shim/package.json"),
          `${JSON.stringify({ name: "use-sync-external-store-wrapper", version: "1.0.0" })}\n`,
        );
      }
      if (variant.importerBrowser) {
        await write(
          join(context.root, "package.json"),
          `${JSON.stringify({ browser: { "./src/entry.ts": "./src/browser.ts" }, name: "@fixture/app" })}\n`,
        );
      }
      if (variant.pathsAlias || variant.lateMutation === "config") {
        await write(
          join(context.root, "tsconfig.json"),
          `${JSON.stringify({ compilerOptions: variant.pathsAlias
            ? { paths: { [`${packageName}/*`]: ["./src/*"] } }
            : { strict: true } })}\n`,
        );
      }
      const authoritative = variant.selectedChild === "development" ? development : production;
      const entry = join(context.root, "src/entry.ts");
      await write(
        entry,
        variant.ambiguousInstallationInput
          ? `import runtime from '../${logical(context.root, authoritative)}'; import extra from '../${logical(context.root, extra)}'; export const value = runtime.marker + extra.marker;\n`
          : `import runtime from '../${logical(context.root, authoritative)}'; export const value = runtime.marker;\n`,
      );
      const handle = await generation(context, `commonjs-selector-near-miss-${variant.id}`, [
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
        if (variant.observeWrapper !== false) {
          const javascriptOnLoad = handlers[0];
          assert.ok(javascriptOnLoad !== undefined);
          await javascriptOnLoad({ path: wrapper });
        }
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) =>
          path.endsWith("/src/entry.ts") || path === "src/entry.ts"
        );
        assert.ok(entryKey !== undefined);
        inputs[entryKey]!.imports = [{
          ...(variant.edge === "attributes" ? { with: { type: "javascript" } } : {}),
          kind: variant.edge === "dynamic"
            ? "dynamic-import"
            : variant.edge === "require"
              ? "require-call"
              : "import-statement",
          path: variant.rawSpecifier ?? `${packageName}/shim/index.js`,
        }] as never;
        if (variant.lateMutation !== undefined) {
          const output = result.outputs[0];
          assert.ok(output !== undefined);
          const arrayBuffer = output.arrayBuffer.bind(output);
          let mutated = false;
          Object.defineProperty(output, "arrayBuffer", {
            configurable: true,
            value: async () => {
              const bytes = await arrayBuffer();
              if (!mutated) {
                mutated = true;
                switch (variant.lateMutation) {
                  case "wrapper-bytes":
                    writeFileSync(wrapper, canonicalWrapper.replace("runtime.production.js", "runtime.changed.js"));
                    break;
                  case "wrapper-mode":
                    chmodSync(wrapper, 0o600);
                    break;
                  case "wrapper-parent-symlink": {
                    const actual = join(runtimeDirectory, "actual-shim");
                    mkdirSync(actual);
                    writeFileSync(join(actual, "index.js"), canonicalWrapper);
                    rmSync(resolve(wrapper, ".."), { recursive: true });
                    symlinkSync(actual, resolve(wrapper, ".."), "dir");
                    break;
                  }
                  case "child-bytes":
                    writeFileSync(production, "'use strict'; module.exports = { marker: 'changed' };\n");
                    break;
                  case "child-mode":
                    chmodSync(production, 0o600);
                    break;
                  case "child-parent-symlink": {
                    const actual = join(runtimeDirectory, "actual-cjs");
                    mkdirSync(actual);
                    writeFileSync(join(actual, "runtime.production.js"), "'use strict'; module.exports = { marker: 'production' };\n");
                    writeFileSync(join(actual, "runtime.development.js"), "'use strict'; module.exports = { marker: 'development' };\n");
                    rmSync(resolve(production, ".."), { recursive: true });
                    symlinkSync(actual, resolve(production, ".."), "dir");
                    break;
                  }
                  case "manifest":
                    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: "1.6.1" })}\n`);
                    break;
                  case "config":
                    writeFileSync(
                      join(context.root, "tsconfig.json"),
                      `${JSON.stringify({ compilerOptions: { paths: { [`${packageName}/*`]: ["./src/*"] }, strict: true } })}\n`,
                    );
                    break;
                }
              }
              return bytes;
            },
          });
        }
        return result;
      });

      try {
        await expect(
          collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
        ).rejects.toThrow(
          variant.lateMutation === "config"
            ? /Bun root resolution configuration changed after raw fallback edge settlement/u
            : variant.lateMutation === "manifest"
              ? /Bun raw fallback package scope changed after edge settlement/u
              : variant.lateMutation !== undefined
                ? /Bun raw fallback source(?: realpath)? changed after edge settlement/u
                : /Bun metafile import.*is unresolved/u,
        );
        expect(await receiptExists(handle, "client")).toBe(false);
      } finally {
        build.mockRestore();
      }
    }
  }, 30_000);

  test("rejects unsafe zero-witness package subpath fallbacks", async () => {
    const variants: readonly Readonly<{
      browser?: boolean;
      edge?: "attributes" | "dynamic" | "external" | "require";
      exportMode?: "missing" | "overlapping" | "unreferenced" | "wrong-subpath";
      hiddenInstallation?: "ordinary" | "symlink";
      id: string;
      importerBrowser?: boolean;
      lateConfigMutation?: boolean;
      lateManifestMutation?: boolean;
      multipleInstallations?: boolean;
      pathsAlias?: boolean;
      selfReference?: boolean;
      wrongManifest?: boolean;
    }>[] = [
      { edge: "external", id: "external-edge" },
      { edge: "attributes", id: "import-attributes" },
      { edge: "dynamic", id: "dynamic-import" },
      { edge: "require", id: "require-call" },
      { exportMode: "missing", id: "absent-export-target" },
      { exportMode: "unreferenced", id: "non-authoritative-export-target" },
      { exportMode: "wrong-subpath", id: "wrong-export-subpath" },
      { exportMode: "overlapping", id: "overlapping-wildcard-exports" },
      { browser: true, id: "target-package-browser-remap" },
      { id: "importer-package-browser-remap", importerBrowser: true },
      { id: "wrong-package-manifest", wrongManifest: true },
      { hiddenInstallation: "ordinary", id: "hidden-closer-installation" },
      { hiddenInstallation: "symlink", id: "symlinked-closer-installation" },
      { id: "multiple-in-graph-installations", multipleInstallations: true },
      { id: "root-package-self-reference", selfReference: true },
      { id: "root-paths-alias", pathsAlias: true },
      { id: "late-root-config-mutation", lateConfigMutation: true },
      { id: "late-captured-manifest-mutation", lateManifestMutation: true },
    ];

    for (const variant of variants) {
      const context = await fixture();
      const runtimeDirectory = join(context.root, "node_modules/@fixture/runtime");
      const manifestPath = join(runtimeDirectory, "package.json");
      const exports = variant.exportMode === "missing"
        ? { "./feature": "./dist/missing.mjs" }
        : variant.exportMode === "unreferenced"
          ? { "./feature": "./dist/unreferenced.mjs" }
          : variant.exportMode === "wrong-subpath"
            ? { "./other": "./dist/feature.mjs" }
            : variant.exportMode === "overlapping"
              ? { "./*": "./dist/*.mjs", "./f*": "./dist/*.mjs" }
              : { "./feature": "./dist/feature.mjs" };
      const manifest: Record<string, unknown> = {
        exports,
        name: variant.wrongManifest ? "@fixture/other" : "@fixture/runtime",
        type: "module",
        version: "1.0.0",
      };
      if (variant.browser) manifest.browser = { "./server.mjs": "./browser.mjs" };
      await write(manifestPath, `${JSON.stringify(manifest)}\n`);
      await write(
        join(runtimeDirectory, "dist/feature.mjs"),
        "export { marker } from './private.mjs';\n",
      );
      await write(join(runtimeDirectory, "dist/private.mjs"), "export const marker = 'runtime';\n");
      if (variant.exportMode === "unreferenced") {
        await write(
          join(runtimeDirectory, "dist/unreferenced.mjs"),
          "export const marker = 'unreferenced';\n",
        );
      }
      if (variant.selfReference) {
        await write(
          join(context.root, "package.json"),
          `${JSON.stringify({ name: "@fixture/runtime", type: "module", version: "1.0.0" })}\n`,
        );
      }
      if (variant.importerBrowser) {
        await write(
          join(context.root, "package.json"),
          `${JSON.stringify({
            browser: { "./src/server.ts": "./src/browser.ts" },
            name: "@fixture/app",
            type: "module",
            version: "1.0.0",
          })}\n`,
        );
      }
      if (variant.pathsAlias) {
        await write(
          join(context.root, "tsconfig.json"),
          `${JSON.stringify({ compilerOptions: { paths: { "@fixture/runtime/*": ["./src/*"] } } })}\n`,
        );
      }
      if (variant.lateConfigMutation) {
        await write(
          join(context.root, "tsconfig.json"),
          `${JSON.stringify({ compilerOptions: { strict: true } })}\n`,
        );
      }

      const entry = join(context.root, "src/nested/entry.ts");
      let entrySource = "import { marker } from '../../node_modules/@fixture/runtime/dist/feature.mjs'; export const value = marker;\n";
      if (variant.multipleInstallations) {
        const secondRuntime = join(context.root, "vendor/node_modules/@fixture/runtime");
        await write(
          join(secondRuntime, "package.json"),
          `${JSON.stringify({
            exports: { "./second": "./dist/second.mjs" },
            name: "@fixture/runtime",
            type: "module",
            version: "2.0.0",
          })}\n`,
        );
        await write(join(secondRuntime, "dist/second.mjs"), "export const second = 'second';\n");
        entrySource = "import { marker } from '../../node_modules/@fixture/runtime/dist/feature.mjs'; import { second } from '../../vendor/node_modules/@fixture/runtime/dist/second.mjs'; export const value = marker + second;\n";
      }
      await write(entry, entrySource);
      const handle = await generation(context, `bare-input-subpath-near-miss-${variant.id}`, [
        expectation(context.root, "client", "client", entry),
      ]);
      const buildOriginal = Bun.build.bind(Bun);
      const build = spyOn(Bun, "build").mockImplementation(async (options) => {
        const result = await buildOriginal(options);
        assert.ok(result.metafile !== undefined);
        const inputs = result.metafile.inputs;
        const entryKey = Object.keys(inputs).find((path) =>
          path.endsWith("/src/nested/entry.ts") || path === "src/nested/entry.ts"
        );
        assert.ok(entryKey !== undefined);
        const rawEdge: Record<string, unknown> = {
          ...(variant.edge === "external" ? { external: true } : {}),
          ...(variant.edge === "attributes" ? { with: { type: "javascript" } } : {}),
          kind: variant.edge === "dynamic"
            ? "dynamic-import"
            : variant.edge === "require"
              ? "require-call"
              : "import-statement",
        };
        if (
          variant.hiddenInstallation !== undefined
          || variant.lateConfigMutation
          || variant.lateManifestMutation
        ) {
          let mutated = false;
          Object.defineProperty(rawEdge, "path", {
            enumerable: true,
            get() {
              if (!mutated) {
                mutated = true;
                if (variant.hiddenInstallation !== undefined) {
                  const closerRuntime = join(context.root, "src/nested/node_modules/@fixture/runtime");
                  mkdirSync(resolve(closerRuntime, ".."), { recursive: true });
                  if (variant.hiddenInstallation === "ordinary") {
                    mkdirSync(join(closerRuntime, "dist"), { recursive: true });
                    writeFileSync(
                      join(closerRuntime, "package.json"),
                      `${JSON.stringify({
                        exports: { "./feature": "./dist/feature.mjs" },
                        name: "@fixture/runtime",
                        type: "module",
                        version: "2.0.0",
                      })}\n`,
                    );
                    writeFileSync(
                      join(closerRuntime, "dist/feature.mjs"),
                      "export const marker = 'closer';\n",
                    );
                  } else {
                    symlinkSync(runtimeDirectory, closerRuntime);
                  }
                }
                if (variant.lateConfigMutation) {
                  writeFileSync(
                    join(context.root, "tsconfig.json"),
                    `${JSON.stringify({
                      compilerOptions: {
                        paths: { "@fixture/runtime/*": ["./src/*"] },
                        strict: true,
                      },
                    })}\n`,
                  );
                }
                if (variant.lateManifestMutation) {
                  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: "1.0.1" })}\n`);
                }
              }
              return "@fixture/runtime/feature";
            },
          });
        } else {
          rawEdge.path = "@fixture/runtime/feature";
        }
        inputs[entryKey]!.imports = [rawEdge] as never;
        return result;
      });

      try {
        if (variant.edge === "external") {
          const receipt = await collectBunStylexGraph({
            generation: handle,
            graphId: "client",
            rootDirectory: context.root,
          });
          expect(receipt.edges).toContainEqual({
            external: true,
            from: "input:src/nested/entry.ts",
            kind: "import-statement",
            to: "external:@fixture/runtime/feature",
          });
          expect(receipt.edges).not.toContainEqual({
            external: false,
            from: "input:src/nested/entry.ts",
            kind: "import-statement",
            to: "input:node_modules/@fixture/runtime/dist/feature.mjs",
          });
        } else {
          await expect(
            collectBunStylexGraph({ generation: handle, graphId: "client", rootDirectory: context.root }),
          ).rejects.toThrow(
            variant.multipleInstallations
              ? /Bun metafile bare import target is ambiguous/u
              : variant.lateConfigMutation
                ? /Bun root resolution configuration changed after raw fallback edge settlement/u
                : variant.lateManifestMutation
                  ? /Bun raw fallback package scope changed after edge settlement/u
                : /Bun metafile import.*is unresolved.*@fixture\/runtime\/feature/u,
          );
          expect(await receiptExists(handle, "client")).toBe(false);
        }
      } finally {
        build.mockRestore();
      }
    }
  }, 30_000);

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
      "@fixture/runtime/../feature",
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
  }, 30_000);

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
