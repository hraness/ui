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
  renderNextDevCss, requireNextDevSnapshot, STYLEX_NEXT_DEV_CSS_ENTRY,
  transformNextDevSource, type StylexNextDevOptions,
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

test("only the registered UI private client build-tool path can enter the development browser graph", async () => {
  const options = await fixture();
  const packageRoot = join(options.rootDirectory, "node_modules/@fixture/ui");
  const manifestPath = join(packageRoot, "dist/stylex-manifest.json");
  const original = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  const client = "dist/build/next-dev-client.js";
  const other = "dist/build/next-dev-session.js";
  const source = '"use client";\nexport const bridge = true;\n';
  await write(join(packageRoot, client), source);
  await write(join(packageRoot, other), "export const compiler = true;\n");
  const buildTools = await Promise.all([client, other].map(path => artifactForFile(packageRoot, path)));
  const manifest = { ...original, buildTools, package: { name: "@hraness/ui", version: "1.0.0" } };
  await write(join(packageRoot, "package.json"), '{"name":"@hraness/ui","version":"1.0.0","type":"module"}\n');
  await write(manifestPath, canonicalJson(manifest) + "\n");
  const prepared = await createNextDevSession(options).prepare();
  expect((await loadNextDevModule(prepared, join(packageRoot, client), source)).code).toBe(source);
  await expect(loadNextDevModule(prepared, join(packageRoot, client), source + "\n")).rejects.toThrow("runtime changed");
  await expect(loadNextDevModule(prepared, join(packageRoot, other), "export const compiler = true;\n")).rejects.toThrow("outside its declared runtime");
  await write(join(packageRoot, "package.json"), '{"name":"@fixture/ui","version":"1.0.0","type":"module"}\n');
  await write(manifestPath, canonicalJson({ ...manifest, package: original.package }) + "\n");
  const foreign = await createNextDevSession(options).prepare();
  await expect(loadNextDevModule(foreign, join(packageRoot, client), source)).rejects.toThrow("outside its declared runtime");
});

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
  expect(snapshot.stylesheets).toEqual([{ path: "node_modules/@fixture/ui/src/compiler-foundation.css",
    sha256: sha256("@layer base{body{margin:0}}\n"), source: "@layer base{body{margin:0}}\n" }]);
  expect(Object.isFrozen(snapshot.stylesheets[0])).toBeTrue();
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

test("chained and same-revision retained unions preserve complete coverage until explicit pruning", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const first = requireNextDevSnapshot(await session.prepare());
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(39.375));
  const second = requireNextDevSnapshot(await session.prepare());
  const firstTransition = composeNextDevSnapshot(second, [first]);
  expect(composeNextDevSnapshot(second, [firstTransition]).css).toBe(firstTransition.css);
  await write(join(options.rootDirectory, "app/page.tsx"), recipe(40.375));
  const third = requireNextDevSnapshot(await session.prepare());
  const transition = composeNextDevSnapshot(third, [firstTransition]);
  expect(transition.includedRevisions).toEqual([first.revision, second.revision, third.revision].sort());
  for (const value of ["38.375px", "39.375px", "40.375px"]) expect(transition.css).toContain(value);
  // Duplicate source identities must not discard the wider union. All input
  // permutations and duplicate retained entries serialize identically.
  for (const retained of [[firstTransition, second], [second, firstTransition], [firstTransition, firstTransition]]) {
    expect(composeNextDevSnapshot(third, retained)).toEqual(transition);
  }
  const pruned = composeNextDevSnapshot(third, []);
  expect(pruned.includedRevisions).toEqual([third.revision]);
  expect(pruned.css).not.toContain("38.375px");
  expect(pruned.css).not.toContain("39.375px");
  expect(pruned.css).toContain("40.375px");
  const overLimit = Array.from({ length: 33 }, (_, index) => sha256(`captured-revision-${index}`)).sort();
  expect(() => composeNextDevSnapshot(third, [{ ...firstTransition, includedRevisions: overLimit }])).toThrow("finite revision bound");
});

test("captured foundation bytes remain immutable and a changed foundation cannot enter a retained union", async () => {
  const options = await fixture();
  const session = createNextDevSession(options);
  const first = requireNextDevSnapshot(await session.prepare());
  const path = "node_modules/@fixture/ui/src/compiler-foundation.css";
  const source = "@layer base{body{margin:1px}}\n";
  await write(join(options.rootDirectory, path), source);
  const manifestPath = join(options.rootDirectory, options.packageManifests[0]!);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StylexPackageManifestV1;
  await write(manifestPath, `${canonicalJson({ ...manifest, stylesheets: [artifact("src/compiler-foundation.css", source)] })}\n`);
  const second = requireNextDevSnapshot(await session.prepare());
  expect(first.stylesheets[0]?.source).toBe("@layer base{body{margin:0}}\n");
  expect(second.stylesheets[0]).toEqual({ path, source, sha256: sha256(source) });
  expect(() => composeNextDevSnapshot(second, [first])).toThrow("foundations changed; restart next dev");
  expect(composeNextDevSnapshot(second, []).stylesheets).toEqual(second.stylesheets);
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
  for (const alias of ["@hraness", "@hraness/ui", "@hraness/ui/stylex-build", "@hraness/ui/stylex-build/next-dev-client", "@hraness/ui/stylex-build/next-dev-client$"]) {
    expect(() => callback({ optimization: safeOptimization, resolve: { alias: { [alias]: "/unowned" } } }, webpackContext("client")))
      .toThrow("private client alias is already owned");
  }
  const unrelated = callback({ optimization: safeOptimization, resolve: { alias: { "@hraness/ui$": "/ordinary-root-only" } } }, webpackContext("client"));
  expect((unrelated.resolve as { alias: Record<string, unknown> }).alias["@hraness/ui$"]).toBe("/ordinary-root-only");
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
  expect(css).toContain("this.resourcePath === context.preparation.snapshot.cssEntry ? null : inputSourceMap");
  expect(source).toContain("context.loadNextDevModule(this.resourcePath, source, inputSourceMap)");
  expect(css).toContain("context.auditNextDevCss(this.resourcePath, source)");
  for (const text of [source, css]) {
    expect(text).toContain("this.cacheable(false)");
    expect(text).toContain("Symbol.for");
    expect(text).toContain("assertNextDevRuntime()");
    expect(text).not.toMatch(/document\.|WebSocket|next\/dist\//u);
  }
});
