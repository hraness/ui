import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import {
  artifactForFile, canonicalJson, compilerContract, compilerSha256,
  serializeStylexPackageRules, serializeStylexRuleUnionV1, sha256, stylexRulesSha256, stylexUnionPolicySha256,
} from "./compiler.js";
import type { StylexPackageManifestV1, StylexRuleV1 } from "./contracts.js";
import {
  assertNextDevRuntime, auditNextDevCss, composeNextDevSnapshot, createNextDevSession, loadNextDevModule, parseNextDevOptions,
  renderNextDevCss, requireNextDevSnapshot, STYLEX_NEXT_DEV_CONTEXT, STYLEX_NEXT_DEV_CSS_ENTRY,
  transformNextDevSource, type NextDevPreparation, type StylexNextDevOptions,
} from "./next-dev-session.js";
import { withStylexNextDev } from "./next-dev.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function write(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function recipe(value: number): string {
  return `import * as stylex from "@stylexjs/stylex";\nexport const styles = stylex.create({ root: { outlineOffset: ${value} } });\n`;
}

function variables(value: string, themeValue: string): string {
  return `import * as stylex from "@stylexjs/stylex";\nexport const palette = stylex.defineVars({ tone: ${JSON.stringify(value)} });\nexport const theme = stylex.createTheme(palette, { tone: ${JSON.stringify(themeValue)} });\n`;
}

type FixtureTarget = "client" | "edge-server" | "server";

function webpackContext(target: FixtureTarget, dev = true): Readonly<{
  dev: boolean;
  isServer: boolean;
  nextRuntime?: "edge" | "nodejs";
  webpack: { version: string };
}> {
  if (target === "client") return { dev, isServer: false, webpack: { version: "5.0.0" } };
  return { dev, isServer: true, nextRuntime: target === "edge-server" ? "edge" : "nodejs", webpack: { version: "5.0.0" } };
}

function artifact(path: string, contents: string): Readonly<{ bytes: number; path: string; sha256: string }> {
  return { bytes: Buffer.byteLength(contents), path, sha256: sha256(contents) };
}

async function fixture(): Promise<StylexNextDevOptions> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-session-"));
  roots.push(root);
  const packageRoot = join(root, "node_modules/@fixture/ui");
  const rules: readonly StylexRuleV1[] = [["x-fixture-package", { ltr: ".x-fixture-package{color:red}" }, 1000]];
  const standaloneSerializer = { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" };
  await write(join(root, "package.json"), '{"type":"module"}\n');
  await write(join(root, "node_modules/next/package.json"), '{"name":"next","version":"16.2.12"}\n');
  await write(join(packageRoot, "package.json"), '{"name":"@fixture/ui","version":"1.0.0","type":"module"}\n');
  await write(join(packageRoot, "dist/index.js"), "export const packageRuntime = 1;\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), "@layer base{body{margin:0}}\n");
  await write(join(packageRoot, "dist/stylex.css"), serializeStylexPackageRules(rules, standaloneSerializer));
  const manifest: StylexPackageManifestV1 = {
    buildTools: [], compiler: compilerContract, compilerFoundation: "src/compiler-foundation.css", compilerSha256,
    kind: "hraness-stylex-package-manifest", package: { name: "@fixture/ui", version: "1.0.0" }, rules,
    rulesSha256: stylexRulesSha256(rules), runtime: [await artifactForFile(packageRoot, "dist/index.js")], schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"), standaloneSerializer,
    stylesheets: [await artifactForFile(packageRoot, "src/compiler-foundation.css")],
  };
  await write(join(packageRoot, "dist/stylex-manifest.json"), `${canonicalJson(manifest)}\n`);
  await write(join(root, "app/page.tsx"), recipe(38.375));
  await write(join(root, "app/unvisited/page.tsx"), recipe(62.625));
  await write(join(root, "app/stylex-dev.css"), STYLEX_NEXT_DEV_CSS_ENTRY);
  return { cssEntry: "app/stylex-dev.css", packageManifests: ["node_modules/@fixture/ui/dist/stylex-manifest.json"], rootDirectory: root, sourceDirectories: ["app"] };
}

test("captures unopened server/lazy sources and one complete package union before any loader runs", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const preparation = await session.prepare();
  const snapshot = requireNextDevSnapshot(preparation);
  expect(snapshot.sources.map(({ logicalPath }) => logicalPath)).toEqual(["app/page.tsx", "app/unvisited/page.tsx"]);
  expect(snapshot.css).toContain("38.375px");
  expect(snapshot.css).toContain("62.625px");
  expect(snapshot.css).toContain(".x-fixture-package");
  expect(snapshot.css).toContain("components.fixture-ui.legacy, components.hraness-stylex.priority1");
  expect(snapshot.css).not.toContain("components.fixture-ui.priority");
  expect(snapshot.revision).toBe(sha256(canonicalJson({
    compilerSha256,
    options: { ...session.options, rootDirectory: "<root>" },
    packages: snapshot.manifests.map((manifest) => sha256(canonicalJson(manifest))),
    sources: snapshot.sources.map(({ logicalPath, sourceSha256 }) => ({ logicalPath, sourceSha256 })),
    unionPolicySha256: stylexUnionPolicySha256,
  })));
  expect(snapshot.css.indexOf("@layer")).toBeLessThan(snapshot.css.indexOf("@import"));
  expect(snapshot.css.indexOf("@import")).toBeLessThan(snapshot.css.indexOf(".x-fixture-package"));
  expect(snapshot.css).not.toContain(options.rootDirectory);
  expect(Object.isFrozen(snapshot)).toBeTrue();
  expect(Object.isFrozen(snapshot.sources[0]?.map)).toBeTrue();
  expect((await session.prepare()).snapshot).toBe(snapshot);
});

async function registerSecondPackage(options: StylexNextDevOptions, rules?: readonly StylexRuleV1[]): Promise<StylexNextDevOptions> {
  const original = JSON.parse(await readFile(join(options.rootDirectory, options.packageManifests[0]!), "utf8")) as StylexPackageManifestV1;
  const packageRoot = join(options.rootDirectory, "node_modules/@fixture/theme");
  const standaloneSerializer = { before: ["components.fixture-theme.legacy"], prefix: "components.fixture-theme" };
  const packageRules = rules ?? [...original.rules, ["x-fixture-theme", { ltr: ".x-fixture-theme{background-color:blue}" }, 2000] as const];
  await write(join(packageRoot, "package.json"), '{"name":"@fixture/theme","version":"1.0.0","type":"module"}\n');
  await write(join(packageRoot, "dist/index.js"), "export const themeRuntime = 1;\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), "@layer components.fixture-theme.legacy{.fixture-theme{color:green}}\n");
  await write(join(packageRoot, "dist/stylex.css"), serializeStylexPackageRules(packageRules, standaloneSerializer));
  const manifest: StylexPackageManifestV1 = {
    ...original, package: { name: "@fixture/theme", version: "1.0.0" },
    rules: packageRules, rulesSha256: stylexRulesSha256(packageRules), standaloneSerializer,
    runtime: [await artifactForFile(packageRoot, "dist/index.js")],
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"),
    stylesheets: [await artifactForFile(packageRoot, "src/compiler-foundation.css")],
  };
  const manifestPath = "node_modules/@fixture/theme/dist/stylex-manifest.json";
  await write(join(options.rootDirectory, manifestPath), `${canonicalJson(manifest)}\n`);
  return { ...options, packageManifests: [...options.packageManifests, manifestPath] };
}

test("development uses the complete multi-package union before and during an atomic transition", async () => {
  const options = await registerSecondPackage(await fixture());
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  expect(original.css).toContain("components.fixture-theme.legacy, components.fixture-ui.legacy, components.hraness-stylex.priority1");
  expect(original.css).not.toMatch(/components\.fixture-(?:ui|theme)\.priority/u);
  expect(original.css.match(/\.x-fixture-package\s*\{/gu)).toHaveLength(1);
  expect(original.foundations).toHaveLength(2);
  const union = serializeStylexRuleUnionV1(original.rules, original.manifests.map(({ standaloneSerializer }) => standaloneSerializer));
  const prelude = /^(?:@layer [^;{}]+;\n)+/u.exec(union)![0];
  expect(original.css.startsWith(prelude)).toBeTrue();
  expect(original.css.endsWith(union.slice(prelude.length))).toBeTrue();
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  const candidate = requireNextDevSnapshot(await session.prepare());
  const transition = composeNextDevSnapshot(candidate, [original]);
  expect(transition.css).toContain("38.375px");
  expect(transition.css).toContain("39.375px");
  expect(transition.css).toContain("components.fixture-theme.legacy, components.fixture-ui.legacy, components.hraness-stylex.priority1");
  const stylesheet = join(options.rootDirectory, "app/extra.css");
  for (const source of [
    "@layer components.hraness-stylex{.foreign{color:red}}",
    "@layer components.fixture-theme.priority1{.foreign{color:red}}",
    ".x-fixture-theme{background-color:blue}",
  ]) {
    await write(stylesheet, source);
    await expect(auditNextDevCss(await session.prepare(), stylesheet, source)).rejects.toThrow();
  }
});

test("development rejects cross-package rule conflicts and foundation recipe contamination", async () => {
  const conflicting = await registerSecondPackage(await fixture(), [["x-fixture-package", { ltr: ".x-fixture-package{color:blue}" }, 1000]]);
  expect((await createNextDevSession(conflicting).prepare()).error?.message).toContain("Conflicting");

  const options = await registerSecondPackage(await fixture());
  const packageRoot = join(options.rootDirectory, "node_modules/@fixture/ui");
  const manifestPath = join(packageRoot, "dist/stylex-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  await write(join(packageRoot, manifest.compilerFoundation), ".x-fixture-theme{background-color:blue}\n");
  await write(manifestPath, canonicalJson({ ...manifest, stylesheets: [await artifactForFile(packageRoot, manifest.compilerFoundation)] }));
  expect((await createNextDevSession(options).prepare()).error).toBeInstanceOf(Error);
});

test("coalesces one in-flight source extraction request", async () => {
  const session = createNextDevSession(await fixture());
  const client = session.prepare();
  const server = session.prepare();
  expect(client).toBe(server);
  expect((await client).snapshot).not.toBeNull();
});

test("replacement, added files, rename, and deletion discard obsolete rules while preserving old snapshots", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  await write(join(options.rootDirectory, "app/added.tsx"), recipe(81.125));
  const added = requireNextDevSnapshot(await session.prepare());
  expect(added.css).not.toContain("38.375px");
  expect(added.css).toContain("39.375px");
  expect(added.css).toContain("81.125px");
  expect(original.css).toContain("38.375px");
  await rename(join(options.rootDirectory, "app/added.tsx"), join(options.rootDirectory, "app/renamed.tsx"));
  const renamed = requireNextDevSnapshot(await session.prepare());
  expect(renamed.revision).not.toBe(added.revision);
  expect(renamed.sources.map(({ logicalPath }) => logicalPath)).not.toContain("app/added.tsx");
  await rm(join(options.rootDirectory, "app/renamed.tsx"));
  const removed = requireNextDevSnapshot(await session.prepare());
  expect(removed.css).not.toContain("81.125px");
  expect(removed.css).toContain("39.375px");
});

test("transition CSS retains old atomic identities and fails closed on changed stable variables", async () => {
  const options = await fixture();
  const path = join(options.rootDirectory, "app/theme.stylex.ts");
  await write(path, variables("rgb(17, 31, 47)", "rgb(59, 71, 83)"));
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  const atomicCandidate = requireNextDevSnapshot(await session.prepare());
  const transition = composeNextDevSnapshot(atomicCandidate, [original]);
  expect(transition.includedRevisions).toEqual([original.revision, atomicCandidate.revision].sort());
  expect(transition.replacedRuleKeys).toEqual([]);
  expect(transition.css).toContain("38.375px");
  expect(transition.css).toContain("39.375px");
  await write(path, variables("rgb(19, 37, 53)", "rgb(61, 73, 89)"));
  const candidate = requireNextDevSnapshot(await session.prepare());
  const stableChanges = candidate.rules.filter((rule) => original.rules.some((entry) => entry[0] === rule[0] && canonicalJson(entry) !== canonicalJson(rule))).map((rule) => rule[0]);
  expect(stableChanges.length).toBeGreaterThan(0);
  expect(() => composeNextDevSnapshot(candidate, [original])).toThrow("restart next dev");
  expect(composeNextDevSnapshot(candidate, []).css).not.toContain("38.375px");
});

test("failed package preparation exposes exact existing and missing artifact watches and recovers", async () => {
  const cases = [
    { role: "runtime", contents: "export const repairedRuntime = 1;\n", missing: true },
    { role: "buildTools", contents: "export const repairedBuildTool = 1;\n", missing: false },
    { role: "foundation", contents: "@layer base{body{margin:0}}\n", missing: true },
    { role: "standalone", contents: null, missing: true },
  ] as const;
  for (const item of cases) {
    const options = await fixture();
    const manifestPath = join(options.rootDirectory, options.packageManifests[0]!);
    const packageRoot = join(options.rootDirectory, "node_modules/@fixture/ui");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
    const contents = item.contents ?? serializeStylexPackageRules(manifest.rules, manifest.standaloneSerializer);
    const logical = `dist/repaired-${item.role}.${item.role === "foundation" || item.role === "standalone" ? "css" : "js"}`;
    const nextArtifact = artifact(logical, contents);
    const nextManifest = item.role === "runtime" ? { ...manifest, runtime: [nextArtifact] }
      : item.role === "buildTools" ? { ...manifest, buildTools: [nextArtifact] }
      : item.role === "foundation" ? { ...manifest, compilerFoundation: logical, stylesheets: [nextArtifact] }
      : { ...manifest, standaloneCss: nextArtifact };
    await write(manifestPath, `${canonicalJson(nextManifest)}\n`);
    const absolute = join(packageRoot, logical);
    if (!item.missing) await write(absolute, "corrupt\n");
    const session = createNextDevSession(options);
    const failed = await session.prepare();
    expect(failed.error).toBeInstanceOf(Error);
    expect(item.missing ? failed.attemptedMissing : failed.attemptedFiles).toContain(absolute);
    expect(item.missing ? failed.attemptedFiles : failed.attemptedMissing).not.toContain(absolute);
    await write(absolute, contents);
    expect(requireNextDevSnapshot(await session.prepare()).files).toContain(absolute);
  }
});

test("a last-good package revision watches a newly declared missing artifact and recovers without an unrelated edit", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  const manifestPath = join(options.rootDirectory, options.packageManifests[0]!);
  const packageRoot = join(options.rootDirectory, "node_modules/@fixture/ui");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  const contents = "export const replacementRuntime = 1;\n";
  const logical = "dist/replacement-runtime.js";
  const replacement = { ...manifest, runtime: [artifact(logical, contents)] };
  await write(manifestPath, `${canonicalJson(replacement)}\n`);
  const failed = await session.prepare();
  const absolute = join(packageRoot, logical);
  expect(failed.lastGood).toBe(original);
  expect(failed.attemptedMissing).toContain(absolute);
  expect(failed.attemptedFiles).toContain(manifestPath);
  await write(absolute, contents);
  const recovered = requireNextDevSnapshot(await session.prepare());
  expect(recovered.revision).not.toBe(original.revision);
  expect(recovered.files).toContain(absolute);
});

test("failed revisions retain last-good CSS, fail their loaders, and recover without a poisoned session", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), "export const broken = ;\n");
  const failed = await session.prepare();
  expect(failed.error).toBeInstanceOf(Error);
  expect(failed.snapshot).toBeNull();
  expect(failed.lastGood).toBe(original);
  expect(() => renderNextDevCss(failed, join(options.rootDirectory, options.cssEntry), STYLEX_NEXT_DEV_CSS_ENTRY)).toThrow();
  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), recipe(63.625));
  const recovered = requireNextDevSnapshot(await session.prepare());
  expect(recovered.css).toContain("63.625px");
  expect(recovered.css).not.toContain("62.625px");
});

test("maps original TSX while rejecting late source changes and an earlier transform", async () => {
  const options = await fixture();
  const prepared = await createNextDevSession(options).prepare();
  const path = join(options.rootDirectory, "app/page.tsx");
  const result = await transformNextDevSource(prepared, path, recipe(38.375));
  expect(result.map.version).toBe(3);
  expect(result.map.sources).toEqual(["app/page.tsx"]);
  expect(result.map.sourcesContent).toEqual([recipe(38.375)]);
  expect(result.code).not.toContain("stylex.create");
  expect(result.code).not.toContain("runtimeInjection");
  await expect(transformNextDevSource(prepared, path, recipe(99))).rejects.toThrow("compilation snapshot");
  await expect(transformNextDevSource(prepared, path, recipe(38.375), {})).rejects.toThrow("before another mapped transform");
  await expect(transformNextDevSource(prepared, `${path}?t=1`, recipe(38.375))).rejects.toThrow("query-free");
});

test("rejects relative JavaScript imports outside bounded sources before StyleX resolution", async () => {
  const options = await fixture();
  await write(join(options.rootDirectory, "outside.stylex.ts"), recipe(17));
  await write(join(options.rootDirectory, "app/page.tsx"), 'export { styles } from "../outside.stylex";\n');
  const prepared = await createNextDevSession(options).prepare();
  expect(prepared.error?.message).toContain("leaves its inventory");
});

test("a missing relative import registers exact resolution candidates and recovers when one appears", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const original = requireNextDevSnapshot(await session.prepare());
  const page = join(options.rootDirectory, "app/page.tsx");
  await write(page, 'export { styles } from "./created-later";\n');
  const failed = await session.prepare();
  expect(failed.lastGood).toBe(original);
  expect(failed.error?.message).toContain("cannot be resolved");
  for (const candidate of ["created-later", "created-later.js", "created-later.mjs", "created-later.tsx"]) {
    expect(failed.attemptedMissing).toContain(join(options.rootDirectory, "app", candidate));
  }
  const created = join(options.rootDirectory, "app/created-later.tsx");
  await write(created, recipe(71.625));
  const recovered = requireNextDevSnapshot(await session.prepare());
  expect(recovered.css).toContain("71.625px");
  expect(recovered.files).toContain(created);
});

test("bounded extension aliases resolve JavaScript specifiers to TypeScript without accepting excluded predecessors", async () => {
  const options = await fixture();
  await write(join(options.rootDirectory, "app/aliased.ts"), recipe(17.25));
  await write(join(options.rootDirectory, "app/page.tsx"), 'export { styles } from "./aliased.js";\n');
  expect(requireNextDevSnapshot(await createNextDevSession(options).prepare()).css).toContain("17.25px");
  await write(join(options.rootDirectory, "app/aliased.js"), recipe(18.25));
  const excluded = await createNextDevSession({ ...options, exclude: ["app/aliased.ts"] }).prepare();
  expect(excluded.error?.message).toContain("leaves its inventory");
});

test("real loader runtime enforcement accepts only genuine Node 24", () => {
  expect(() => assertNextDevRuntime({ node: "24.13.0" }, false)).not.toThrow();
  expect(() => assertNextDevRuntime({ node: "22.0.0" }, false)).toThrow("genuine Node 24");
  expect(() => assertNextDevRuntime({ node: "24.13.0", bun: "1.3.14" }, false)).toThrow("genuine Node 24");
  expect(() => assertNextDevRuntime({ node: "24.13.0" }, true)).toThrow("genuine Node 24");
});

test("rejects symlinked sources, ancestor symlinks, and undeclared package runtime", async () => {
  const options = await fixture();
  await symlink(join(options.rootDirectory, "app/page.tsx"), join(options.rootDirectory, "app/link.tsx"));
  const session = createNextDevSession(options);
  expect((await session.prepare()).error?.message).toContain("symlink");
  await rm(join(options.rootDirectory, "app/link.tsx"));
  const prepared = await session.prepare();
  const runtime = join(options.rootDirectory, "node_modules/@fixture/ui/dist/index.js");
  expect((await loadNextDevModule(prepared, runtime, "export const packageRuntime = 1;\n")).map).toBeNull();
  await expect(loadNextDevModule(prepared, runtime, "export const packageRuntime = 2;\n")).rejects.toThrow("runtime changed");
  const undeclared = join(options.rootDirectory, "node_modules/@fixture/ui/dist/undeclared.js");
  await write(undeclared, "export const hidden = 1;\n");
  await expect(loadNextDevModule(prepared, undeclared, "export const hidden = 1;\n")).rejects.toThrow("outside its declared runtime");
  await symlink(join(options.rootDirectory, "app"), join(options.rootDirectory, "linked"));
  expect((await createNextDevSession({ ...options, sourceDirectories: ["linked"] }).prepare()).error?.message).toContain("symlink");
});

test("owns the marker and rejects independently serialized package CSS", async () => {
  const options = await fixture();
  const prepared = await createNextDevSession(options).prepare();
  const snapshot = requireNextDevSnapshot(prepared);
  expect(renderNextDevCss(prepared, snapshot.cssEntry, STYLEX_NEXT_DEV_CSS_ENTRY)).toBe(snapshot.css);
  expect(() => renderNextDevCss(prepared, snapshot.cssEntry, "body{}" )).toThrow("marker changed");
  const stylesheet = join(options.rootDirectory, "app/extra.css");
  await write(stylesheet, '@import "@fixture/ui/stylex.css";');
  await expect(auditNextDevCss(prepared, stylesheet, '@import "@fixture/ui/stylex.css";')).rejects.toThrow("standalone recipe CSS");
  const packageCss = join(options.rootDirectory, "node_modules/@fixture/ui/src/compiler-foundation.css");
  await expect(auditNextDevCss(prepared, packageCss, "body{color:blue}" )).rejects.toThrow("stylesheet changed");
});

test("configuration is closed, bounded, and development-only", async () => {
  const options = await fixture();
  for (const sourceDirectories of [["../app"], ["node_modules"], ["app", "app/nested"], []]) expect(() => parseNextDevOptions({ ...options, sourceDirectories })).toThrow();
  expect(() => parseNextDevOptions({ ...options, exclude: ["outside.ts"] })).toThrow();
  expect(() => parseNextDevOptions({ ...options, packageManifests: ["../other/dist/stylex-manifest.json"] })).toThrow();
  expect(() => parseNextDevOptions({ ...options, cssEntry: "../styles.css" })).toThrow();
  expect(() => withStylexNextDev({ turbopack: {} }, options)).toThrow("Turbopack");
  const config = withStylexNextDev({ webpack(value: Record<string, unknown>) { return value; } }, options);
  const callback = config.webpack as unknown as (value: Record<string, unknown>, context: ReturnType<typeof webpackContext>) => Record<string, unknown>;
  expect(() => callback({}, webpackContext("client", false))).toThrow("production");
  expect(() => callback({}, { ...webpackContext("client"), webpack: { version: "6.0.0" } })).toThrow("Webpack 5");
  const safeOptimization = { emitOnErrors: false };
  const wrapped = callback({ optimization: safeOptimization, plugins: ["preserved"], module: { rules: ["preserved"] } }, webpackContext("client"));
  assert.ok(Array.isArray(wrapped.plugins));
  expect(wrapped.plugins[0]).toBe("preserved");
  const module = wrapped.module as { rules: unknown[] };
  expect(module.rules[0]).toBe("preserved");
  expect(module.rules).toHaveLength(3);
  expect(wrapped.optimization).toBe(safeOptimization);
  expect(() => callback({ optimization: safeOptimization, resolve: { extensions: [".js", ".ts"] } }, webpackContext("client"))).toThrow("resolution extensions");
  expect(() => callback({ optimization: safeOptimization, resolve: { extensionAlias: { ".js": [".js", ".ts"] } } }, webpackContext("client"))).toThrow("extension alias differs");
  expect(() => callback({}, { ...webpackContext("client"), nextRuntime: "nodejs" })).toThrow("client compiler");
  for (const optimization of [undefined, null, [], {}, { emitOnErrors: true }, { emitOnErrors: "false" }]) {
    expect(() => callback({ optimization }, webpackContext("client"))).toThrow("optimization.emitOnErrors=false");
  }
  const unsafeConfig = withStylexNextDev({
    webpack(value: Record<string, unknown>) { return { ...value, optimization: { emitOnErrors: true } }; },
  }, options);
  const unsafeCallback = unsafeConfig.webpack as unknown as typeof callback;
  expect(() => unsafeCallback({ optimization: safeOptimization }, webpackContext("client")))
    .toThrow("optimization.emitOnErrors=false");
});

test("CJS entries only delegate to the compilation snapshot and native CSS loader chain", async () => {
  const source = await readFile(new URL("./next-dev-loader.cjs", import.meta.url), "utf8");
  const css = await readFile(new URL("./next-dev-css-loader.cjs", import.meta.url), "utf8");
  expect(source).toContain("loadNextDevModule");
  expect(css).toContain("auditNextDevCss");
  expect(css).toContain("this.resourcePath === preparation.snapshot.cssEntry ? null : inputSourceMap");
  for (const text of [source, css]) {
    expect(text).toContain("this.cacheable(false)");
    expect(text).toContain("Symbol.for");
    expect(text).toContain("assertNextDevRuntime()");
    expect(text).not.toMatch(/document\.|WebSocket|next\/dist\//u);
  }
});

test("native serial compiler hooks publish transition CSS, reject drift, prune after participating targets converge, and retain failure watches", async () => {
  const options = await fixture();
  const config = withStylexNextDev({ webpack(value: Record<string, unknown>) { return value; } }, options);
  const callback = config.webpack as unknown as (value: Record<string, unknown>, context: ReturnType<typeof webpackContext>) => Record<string, unknown>;
  type CompilationModule = { resource: string; resourceResolveData?: { fragment: string; path: string; query: string } };
  type Compilation = {
    contextDependencies: Set<string>;
    errors: Error[];
    fileDependencies: Set<string>;
    hooks: { finishModules: { tap(name: string, run: (modules: Iterable<CompilationModule>) => void): void } };
    missingDependencies: Set<string>;
  };
  type Stats = { compilation: Compilation; hasErrors(): boolean };
  const harness = (target: FixtureTarget, configuredTarget: FixtureTarget = target, emitOnErrors = false) => {
    const wrapped = callback({ optimization: { emitOnErrors: false } }, webpackContext(target));
    const plugins = wrapped.plugins as readonly { apply(compiler: unknown): void }[];
    const plugin = plugins[plugins.length - 1];
    assert.ok(plugin !== undefined);
    let before: (() => Promise<void>) | null = null;
    let compile: ((compilation: Compilation) => void) | null = null;
    let done: ((stats: Stats) => void) | null = null;
    let loader: ((context: Record<symbol, unknown> & { resourceFragment?: string; resourcePath: string; resourceQuery?: string }) => void) | null = null;
    let invalidations = 0;
    const finishModules = new WeakMap<Compilation, (modules: Iterable<CompilationModule>) => void>();
    const compiler = {
      name: undefined as FixtureTarget | undefined,
      options: { name: configuredTarget, optimization: { emitOnErrors } },
      watching: { invalidate() { invalidations += 1; } },
      hooks: {
        beforeCompile: { tapPromise(_name: string, run: () => Promise<void>) { before = run; } },
        done: { tap(_name: string, run: (stats: Stats) => void) { done = run; } },
        thisCompilation: { tap(_name: string, run: (compilation: Compilation) => void) { compile = run; } },
      },
      webpack: { NormalModule: { getCompilationHooks() { return { loader: { tap(_name: string, run: typeof loader) { loader = run; } } }; } } },
    };
    plugin.apply(compiler);
    return {
      async start(actualTarget: FixtureTarget = target) {
        assert.ok(before !== null && compile !== null);
        compiler.name = actualTarget;
        await before();
        const compilation: Compilation = {
          contextDependencies: new Set(),
          errors: [],
          fileDependencies: new Set(),
          hooks: { finishModules: { tap(_name, run) { finishModules.set(compilation, run); } } },
          missingDependencies: new Set(),
        };
        compile(compilation);
        return compilation;
      },
      context(resourcePath = join(options.rootDirectory, "app/page.tsx"), resourceQuery = "", resourceFragment = "") {
        assert.ok(loader !== null);
        const context: Record<symbol, unknown> & { resourceFragment: string; resourcePath: string; resourceQuery: string } = { resourceFragment, resourcePath, resourceQuery };
        loader(context);
        return context[Symbol.for(STYLEX_NEXT_DEV_CONTEXT)] as NextDevPreparation;
      },
      finish(compilation: Compilation, succeeded = compilation.errors.length === 0, resources: readonly (string | CompilationModule)[] = target === "client"
        ? [join(options.rootDirectory, options.cssEntry), join(options.rootDirectory, "app/page.tsx")]
        : [join(options.rootDirectory, target === "edge-server" ? "app/unvisited/page.tsx" : "app/page.tsx")]) {
        assert.ok(done !== null);
        const finish = finishModules.get(compilation);
        assert.ok(finish !== undefined);
        finish(resources.map((resource) => typeof resource === "string"
          ? { resource, resourceResolveData: { fragment: "", path: resource, query: "" } }
          : resource));
        done({ compilation, hasErrors: () => !succeeded || compilation.errors.length > 0 });
      },
      invalidations() { return invalidations; },
      setEmitOnErrors(value: boolean) { compiler.options.optimization.emitOnErrors = value; },
    };
  };
  expect(() => harness("client", "server")).toThrow("configured identity differs");
  for (const target of ["client", "server", "edge-server"] as const) {
    expect(() => harness(target, target, true)).toThrow("optimization.emitOnErrors=false");
    const driftedEmission = harness(target);
    driftedEmission.setEmitOnErrors(true);
    await expect(driftedEmission.start()).rejects.toThrow("optimization.emitOnErrors=false");
  }
  const forgedServer = harness("server");
  await expect(forgedServer.start("client")).rejects.toThrow("compiler identity differs");
  const client = harness("client");
  const server = harness("server");
  const edge = harness("edge-server");

  // Next starts with framework-only compiler graphs before the first on-demand
  // application route. Those successful passes publish and attest nothing.
  const frameworkClient = await client.start();
  client.finish(frameworkClient, true, []);
  expect(frameworkClient.errors).toEqual([]);
  const frameworkServer = await server.start();
  server.finish(frameworkServer, true, []);
  expect(frameworkServer.errors).toEqual([]);
  expect(client.invalidations()).toBe(0);

  // Pinned Next's metadata/discover loader imports this native fixture asset
  // with ?__next_metadata__. Assets cannot contribute a StyleX source revision
  // or satisfy the client CSS marker, regardless of their native loader query.
  const nativeAsset = join(options.rootDirectory, "app/icon.svg");
  const metadataModule: CompilationModule = {
    resource: `${nativeAsset}?__next_metadata__`,
    resourceResolveData: { fragment: "", path: nativeAsset, query: "?__next_metadata__" },
  };
  for (const compiler of [client, server, edge]) {
    const assetsOnly = await compiler.start();
    compiler.finish(assetsOnly, true, [metadataModule, { resource: `${nativeAsset}?native-asset#fragment` }]);
    expect(assetsOnly.errors).toEqual([]);
  }
  expect(client.invalidations()).toBe(0);
  const assetWithoutMarker = await client.start();
  client.finish(assetWithoutMarker, true, [metadataModule, join(options.rootDirectory, "app/page.tsx")]);
  expect(assetWithoutMarker.errors.map(({ message }) => message)).toContain(
    "Next development client source graph omitted its owned StyleX stylesheet entry",
  );

  // Cached modules can omit a loader visit or resolve metadata. Neither raw
  // resource spelling nor a framework-looking query may bypass JS/CSS checks.
  for (const path of [
    join(options.rootDirectory, "app/page.tsx"),
    join(options.rootDirectory, "app/icon.tsx"),
    join(options.rootDirectory, options.cssEntry),
    join(options.rootDirectory, "node_modules/@fixture/ui/dist/index.js"),
  ]) {
    for (const query of ["?raw", "?__next_metadata__", "?__next_metadata_image_meta__", "?__next_edge_ssr_entry__"]) {
      for (const resource of [
        { resource: `${path}${query}`, resourceResolveData: { path, query, fragment: "" } },
        { resource: `${path}${query}` },
        { resource: path, resourceResolveData: { path, query, fragment: "" } },
      ]) {
        const queried = await client.start();
        expect(() => client.finish(queried, true, [resource])).toThrow("resource query");
      }
      expect(() => client.context(path, query)).toThrow("must not contain a query");
    }
    const fragmented = await client.start();
    expect(() => client.finish(fragmented, true, [{ resource: `${path}#fragment` }])).toThrow("resource fragment");
  }
  const mismatchedPath = await client.start();
  expect(() => client.finish(mismatchedPath, true, [{
    resource: nativeAsset,
    resourceResolveData: { fragment: "", path: join(options.rootDirectory, "app/page.tsx"), query: "" },
  }])).toThrow("resource path differs");
  for (const rawPath of [join(options.rootDirectory, "app/page.tsx"), join(options.rootDirectory, options.cssEntry)]) {
    for (const path of [nativeAsset, "app/icon.svg"]) {
      for (const suffix of ["", "?raw", "#fragment"]) {
        const maskedSource = await client.start();
        expect(() => client.finish(maskedSource, true, [{
          resource: `${rawPath}${suffix}`,
          resourceResolveData: { fragment: "", path, query: "" },
        }])).toThrow("resource path differs");
      }
    }
  }
  const edgeQuery = "?__next_edge_ssr_entry__";
  const edgeSource = join(options.rootDirectory, "app/unvisited/page.tsx");
  for (const [compiler, path] of [
    [server, edgeSource],
    [edge, join(options.rootDirectory, options.cssEntry)],
    [edge, join(options.rootDirectory, "node_modules/@fixture/ui/dist/index.js")],
  ] as const) {
    expect(() => compiler.context(path, edgeQuery)).toThrow("exact Edge SSR entry contract");
    const queriedGraph = await compiler.start();
    expect(() => compiler.finish(queriedGraph, true, [{
      resource: `${path}${edgeQuery}`,
      resourceResolveData: { fragment: "", path, query: edgeQuery },
    }])).toThrow("exact Edge SSR entry contract");
  }
  expect(() => edge.context(edgeSource, edgeQuery, "#fragment")).toThrow("contain a fragment");
  for (const resource of [
    { resource: `${edgeSource}${edgeQuery}`, resourceResolveData: { fragment: "", path: edgeSource, query: "" } },
    { resource: edgeSource, resourceResolveData: { fragment: "", path: edgeSource, query: edgeQuery } },
    { resource: `${edgeSource}${edgeQuery}` },
    { resource: `${edgeSource}${edgeQuery}#fragment`, resourceResolveData: { fragment: "#fragment", path: edgeSource, query: edgeQuery } },
  ]) {
    const malformedEdgeEntry = await edge.start();
    expect(() => edge.finish(malformedEdgeEntry, true, [resource])).toThrow(/resource (?:fragment|query)/u);
  }

  // A real server graph cannot emit a source revision until the matching
  // browser stylesheet has been published by a relevant client graph.
  const blockedServer = await server.start();
  server.context();
  server.finish(blockedServer);
  expect(blockedServer.errors.map(({ message }) => message)).toEqual([
    expect.stringContaining("no successfully published client stylesheet"),
  ]);
  expect(client.invalidations()).toBe(1);

  const clientCompilation = await client.start();
  const clientPreparation = client.context();
  client.finish(clientCompilation);

  // Cached modules do not rerun loaders, but remain present in the completed
  // compilation module graph and therefore retain client participation.
  const cachedClientCompilation = await client.start();
  client.finish(cachedClientCompilation);
  expect(cachedClientCompilation.errors).toEqual([]);

  // Seeing owned source without the exact marker would otherwise publish CSS
  // that the browser graph can never load.
  const missingStylesheet = await client.start();
  client.context();
  client.finish(missingStylesheet, true, [join(options.rootDirectory, "app/page.tsx")]);
  expect(missingStylesheet.errors.map(({ message }) => message)).toEqual([
    "Next development client source graph omitted its owned StyleX stylesheet entry",
  ]);

  const initialServerCompilation = await server.start();
  const initialServerPreparation = server.context();
  server.finish(initialServerCompilation);
  expect(requireNextDevSnapshot(initialServerPreparation).revision).toBe(requireNextDevSnapshot(clientPreparation).revision);
  const cachedServerCompilation = await server.start();
  server.finish(cachedServerCompilation);
  expect(cachedServerCompilation.errors).toEqual([]);
  const initialEdgeCompilation = await edge.start();
  const initialEdgePreparation = edge.context(edgeSource, edgeQuery);
  const transformedEdgeSource = await loadNextDevModule(initialEdgePreparation, edgeSource, await readFile(edgeSource, "utf8"));
  expect(transformedEdgeSource.code).not.toContain("stylex.create");
  expect(transformedEdgeSource.map).toHaveProperty("sources", ["app/unvisited/page.tsx"]);
  edge.finish(initialEdgeCompilation, true, [{
    resource: `${edgeSource}${edgeQuery}`,
    resourceResolveData: { fragment: "", path: edgeSource, query: edgeQuery },
  }]);
  expect(initialEdgeCompilation.errors).toEqual([]);
  expect(requireNextDevSnapshot(initialEdgePreparation).revision).toBe(requireNextDevSnapshot(clientPreparation).revision);

  // A successful graph census with no owned modules retires prior client
  // participation without replacing its last published stylesheet.
  const removedClientCompilation = await client.start();
  client.finish(removedClientCompilation, true, []);
  expect(removedClientCompilation.errors).toEqual([]);

  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  const transitioningClientCompilation = await client.start();
  const transitioningClient = client.context();
  expect(requireNextDevSnapshot(transitioningClient).css).toContain("38.375px");
  expect(requireNextDevSnapshot(transitioningClient).css).toContain("39.375px");
  client.finish(transitioningClientCompilation);
  expect(client.invalidations()).toBe(1);

  // A repeat client compilation before the active server and Edge compiler
  // attest the revision must retain both sides without self-invalidating.
  const earlyPruneCompilation = await client.start();
  const earlyPrune = client.context();
  expect(requireNextDevSnapshot(earlyPrune).css).toContain("38.375px");
  expect(requireNextDevSnapshot(earlyPrune).css).toContain("39.375px");
  client.finish(earlyPruneCompilation);
  expect(client.invalidations()).toBe(1);

  // This edit occurs between Next's serial client and server starts. The server
  // cannot expose N+2 JavaScript while the browser still has the N+1 sheet.
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(40.375));
  const driftedServerCompilation = await server.start();
  const driftedServer = server.context();
  expect(driftedServer.error).toBeNull();
  server.finish(driftedServerCompilation);
  expect(driftedServerCompilation.errors.map(({ message }) => message)).toEqual([
    expect.stringContaining("no successfully published client stylesheet"),
  ]);
  expect(client.invalidations()).toBe(2);

  const recoveryClientCompilation = await client.start();
  const recoveryClient = client.context();
  const recoveryCss = requireNextDevSnapshot(recoveryClient).css;
  expect(recoveryCss).toContain("38.375px");
  expect(recoveryCss).toContain("39.375px");
  expect(recoveryCss).toContain("40.375px");
  client.finish(recoveryClientCompilation);
  const recoveryServerCompilation = await server.start();
  const recoveryServer = server.context();
  expect(requireNextDevSnapshot(recoveryServer).revision).toBe(requireNextDevSnapshot(recoveryClient).revision);
  server.finish(recoveryServerCompilation);
  expect(client.invalidations()).toBe(2);

  // Edge still attests only the original revision. An unsuccessful empty graph
  // cannot retire that participant or release the current revision's barrier.
  expect(requireNextDevSnapshot(initialEdgePreparation).revision)
    .not.toBe(requireNextDevSnapshot(recoveryClient).revision);
  const failedIrrelevantEdgeCompilation = await edge.start();
  edge.finish(failedIrrelevantEdgeCompilation, false, []);
  expect(client.invalidations()).toBe(2);

  // A successful empty graph proves the route is absent. No owned Edge module
  // or new Edge source attestation is needed before the client can prune.
  const irrelevantEdgeCompilation = await edge.start();
  edge.finish(irrelevantEdgeCompilation, true, []);
  expect(irrelevantEdgeCompilation.errors).toEqual([]);
  expect(client.invalidations()).toBe(3);

  const pruneCompilation = await client.start();
  const pruned = client.context();
  expect(requireNextDevSnapshot(pruned).includedRevisions).toEqual([requireNextDevSnapshot(recoveryClient).revision]);
  expect(requireNextDevSnapshot(pruned).css).not.toContain("38.375px");
  expect(requireNextDevSnapshot(pruned).css).not.toContain("39.375px");
  expect(requireNextDevSnapshot(pruned).css).toContain("40.375px");
  expect(requireNextDevSnapshot(initialEdgePreparation).revision)
    .toBe(requireNextDevSnapshot(clientPreparation).revision);
  client.finish(pruneCompilation);
  expect(client.invalidations()).toBe(3);

  expect(clientCompilation.contextDependencies.has(join(options.rootDirectory, "app"))).toBeTrue();
  expect(clientCompilation.fileDependencies.has(join(options.rootDirectory, "app/unvisited/page.tsx"))).toBeTrue();
  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), "export const broken = ;");
  const failedFrameworkClient = await client.start();
  expect(failedFrameworkClient.errors).toEqual([]);
  client.finish(failedFrameworkClient, true, []);
  expect(failedFrameworkClient.errors).toEqual([]);
  const failedFrameworkServer = await server.start();
  expect(failedFrameworkServer.errors).toEqual([]);
  server.finish(failedFrameworkServer, true, []);
  expect(failedFrameworkServer.errors).toEqual([]);
  const failedMissingStylesheet = await client.start();
  const failedMissingPreparation = client.context();
  assert.ok(failedMissingPreparation.error !== null);
  client.finish(failedMissingStylesheet, true, [join(options.rootDirectory, "app/page.tsx")]);
  expect(failedMissingStylesheet.errors.map(({ message }) => message)).toContain(
    "Next development client source graph omitted its owned StyleX stylesheet entry",
  );
  expect(failedMissingStylesheet.errors).toContain(failedMissingPreparation.error);
  const failed = await client.start();
  expect(failed.errors).toEqual([]);
  const failedPreparation = client.context();
  expect(failedPreparation.lastGood?.revision).toBe(requireNextDevSnapshot(pruned).revision);
  expect(failedPreparation.attemptedFiles).toContain(join(options.rootDirectory, "app/unvisited/page.tsx"));
  expect(failed.contextDependencies.has(join(options.rootDirectory, "app"))).toBeTrue();
  client.finish(failed);
  expect(failed.errors).toHaveLength(1);
  await write(join(options.rootDirectory, "node_modules/@fixture/unregistered/dist/stylex-manifest.json"), "{}");
  expect(() => client.context(join(options.rootDirectory, "node_modules/@fixture/unregistered/dist/index.js"))).toThrow("unregistered StyleX package");
  expect(() => client.context("/outside/source.ts")).toThrow("outside its owned root");
  expect(() => client.context(join(options.rootDirectory, "app/page.tsx"), "?raw")).toThrow("must not contain a query");

  await write(join(options.rootDirectory, "app/unvisited/page.tsx"), recipe(62.625));
  const manifestPath = join(options.rootDirectory, options.packageManifests[0]!);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  const missingLogical = "dist/watched-after-failure.js";
  await write(manifestPath, `${canonicalJson({ ...manifest, runtime: [artifact(missingLogical, "export const watched = true;\n")] })}\n`);
  const missingCompilation = await client.start();
  const missingAbsolute = join(options.rootDirectory, "node_modules/@fixture/ui", missingLogical);
  expect(missingCompilation.errors).toEqual([]);
  expect(missingCompilation.missingDependencies.has(missingAbsolute)).toBeTrue();
  expect(missingCompilation.fileDependencies.has(join(options.rootDirectory, "node_modules/@fixture/ui/dist/index.js"))).toBeTrue();
  expect(client.context().attemptedMissing).toContain(missingAbsolute);
  client.finish(missingCompilation);
  expect(missingCompilation.errors).toHaveLength(1);
});
