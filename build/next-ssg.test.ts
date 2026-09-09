import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "bun:test";

import { artifactForFile, canonicalJson, compilerSha256, sha256 } from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_REQUIRED_VERSION,
  STYLEX_NEXT_SSG_INITIAL_SOURCE,
  STYLEX_NEXT_SSG_INPUTS,
  STYLEX_NEXT_TARGETS,
  validateStylexNextPostprocessingReceipt,
  serializeStylexNextSsgRoutes as contractSerializeStylexNextSsgRoutes,
} from "./next-contracts.js";
import { deriveStylexNextSsgRoutes, proveStylexNextSsgPostprocessing, serializeStylexNextSsgRoutes } from "./next-ssg.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const prerender = (routes: Record<string, unknown> = {}, dynamicRoutes: Record<string, unknown> = {}) => ({ version: 4, routes, dynamicRoutes, notFoundRoutes: [], preview: {} });
const manifest = (locales?: readonly string[]) => ({ version: 3, appType: "app", staticRoutes: [], dynamicRoutes: [], ...(locales === undefined ? {} : { i18n: { locales, defaultLocale: locales[0] } }) });

async function fixture(options: Readonly<{ linkCreators?: boolean; linkPackage?: boolean }> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ui-next-ssg-")));
  roots.push(root);
  const installedAliases: { alias: string; path: string; source: Buffer }[] = [];
  const hardlinkInstalled = async (path: string, source: Buffer) => {
    const alias = join(root, "installed-aliases", path);
    await mkdir(dirname(alias), { recursive: true });
    await link(join(root, "node_modules/next", path), alias);
    installedAliases.push({ alias, path: join(root, "node_modules/next", path), source });
  };
  for (const [path, expected] of STYLEX_NEXT_SSG_INPUTS) {
    const source = await readFile(new URL(`../node_modules/next/${path}`, import.meta.url));
    assert.equal(sha256(source), expected);
    const destination = join(root, "node_modules/next", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source);
    if (options.linkCreators) await hardlinkInstalled(path, source);
  }
  const packageSource = Buffer.from(JSON.stringify({ name: "next", version: STYLEX_NEXT_REQUIRED_VERSION }));
  await writeFile(join(root, "node_modules/next/package.json"), packageSource);
  if (options.linkPackage) await hardlinkInstalled("package.json", packageSource);
  const outputRoot = join(root, ".next");
  const path = "static/build/_ssgManifest.js";
  await mkdir(dirname(join(outputRoot, path)), { recursive: true });
  await writeFile(join(outputRoot, "BUILD_ID"), "build");
  await writeFile(join(outputRoot, "prerender-manifest.json"), JSON.stringify(prerender({ "/_global-error": { srcRoute: "/_global-error" } }), null, 2));
  await writeFile(join(outputRoot, "routes-manifest.json"), JSON.stringify(manifest(), null, 2));
  await writeFile(join(outputRoot, path), serializeStylexNextSsgRoutes([]));
  const initial = {
    input: await artifactForFile(root, "node_modules/next/dist/build/webpack/plugins/build-manifest-plugin.js"),
    output: { bytes: Buffer.byteLength(STYLEX_NEXT_SSG_INITIAL_SOURCE), path, sha256: sha256(STYLEX_NEXT_SSG_INITIAL_SOURCE) },
    role: "ssg-manifest" as const,
  };
  return { initial, installedAliases, outputRoot, path, root };
}

describe("Next native SSG postprocessing", () => {
  test("keeps a nonblocking no-follow descriptor fence after pre-open validation", async () => {
    // A source contract checks the flags without creating a FIFO or launching
    // a process that could hang if this protective boundary regresses.
    const implementation = await readFile(new URL("./next-ssg.ts", import.meta.url), "utf8");
    const preflight = implementation.indexOf("regular(beforeOpen);");
    const descriptorOpen = implementation.indexOf("open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)");
    const identityCheck = implementation.indexOf("identity(before), identity(beforeOpen)");
    const read = implementation.indexOf("await handle.read(");
    assert.ok(preflight >= 0 && descriptorOpen > preflight && identityCheck > descriptorOpen && read > identityCheck);
  });

  test("accepts hardlinked installed creators while rejecting mutation through every alias", async () => {
    const context = await fixture({ linkCreators: true });
    const prove = () => proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial);
    const before = await prove();
    assert.equal(context.installedAliases.length, STYLEX_NEXT_SSG_INPUTS.length);
    for (const { alias, path, source } of context.installedAliases) {
      const stat = await lstat(path);
      const aliasStat = await lstat(alias);
      assert.equal(stat.nlink, 2);
      assert.equal(stat.ino, aliasStat.ino);
      assert.equal(stat.dev, aliasStat.dev);
      const changed = Buffer.from(source);
      changed[0] = changed[0]! ^ 1;
      await writeFile(alias, changed);
      assert.equal((await lstat(path)).nlink, 2);
      await assert.rejects(prove(), /pinned original bytes/u);
      await writeFile(alias, source);
      assert.deepEqual(await prove(), before);
      await unlink(path);
      await symlink(alias, path);
      await assert.rejects(prove(), /symlink/u);
      await unlink(path);
      await link(alias, path);
    }
    assert.deepEqual(await prove(), before);
  });

  test("accepts hardlinked package metadata only with the existing exact package identity", async () => {
    const context = await fixture({ linkPackage: true });
    const prove = () => proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial);
    const before = await prove();
    const { alias, path, source } = context.installedAliases[0]!;
    assert.equal((await lstat(path)).nlink, 2);
    assert.equal((await lstat(path)).ino, (await lstat(alias)).ino);
    assert.equal(before.package.sha256, sha256(source));
    for (const metadata of [{ name: "not-next", version: STYLEX_NEXT_REQUIRED_VERSION }, { name: "next", version: "16.2.13" }]) {
      await writeFile(alias, JSON.stringify(metadata));
      await assert.rejects(prove());
    }
    await writeFile(alias, source);
    assert.deepEqual(await prove(), before);
    await unlink(path);
    await symlink(alias, path);
    await assert.rejects(prove(), /symlink/u);
  });

  test("retains single-link requirements for every generated input and output", async () => {
    const context = await fixture({ linkCreators: true, linkPackage: true });
    const prove = () => proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial);
    const before = await prove();
    const alias = join(context.root, "generated-alias");
    for (const path of ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json", context.path]) {
      await link(join(context.outputRoot, path), alias);
      await assert.rejects(prove(), /single-link/u);
      await unlink(alias);
      assert.deepEqual(await prove(), before);
    }
  });

  test("matches the actual empty rewrite without rebinding the compiled artifact", async () => {
    const context = await fixture();
    const proof = await proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial);
    assert.equal(proof.initial.output.bytes, 77);
    assert.equal(proof.initial.output.sha256, "6f5b4aa00d2f8d6aed9935b471806bf7acef464d0c1d390260e5fe27f800c67e");
    assert.equal(proof.output.bytes, 80);
    assert.equal(proof.output.sha256, "678f6ce2cb80b1fe72fc67e7412be6e2ab6ada083111b64f7c40d35e3cba5e00");
    assert.deepEqual(proof.routes, []);
    assert.deepEqual(proof.inputs.map(({ path }) => path), ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json"]);
    assert.equal(proof.creators.length, 8);
    assert.equal(canonicalJson(proof).includes("preview"), false);
    const receipt = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "test", compilerSha256,
      graphs: STYLEX_NEXT_TARGETS.map((target) => ({ graphId: target, target, receiptSha256: sha256(target) })),
      kind: "hraness-stylex-next-postprocessing", mode: "discovery", nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: ".next", planSha256: sha256("plan"), schemaVersion: 1, ssg: [proof], auxiliaryTraceSnapshots: [],
    };
    assert.deepEqual(validateStylexNextPostprocessingReceipt(receipt), receipt);
    for (const mutation of [
      { ...receipt, ssg: [proof, proof] },
      { ...receipt, mode: "development" },
      { ...receipt, skipOutputs: true },
      { ...receipt, ssg: [{ ...proof, buildId: "other" }] },
      { ...receipt, ssg: [{ ...proof, creators: proof.creators.slice(1) }] },
      { ...receipt, ssg: [{ ...proof, inputs: [...proof.inputs, proof.inputs[0]] }] },
      { ...receipt, ssg: [{ ...proof, routes: ["/z", "/a"] }] },
      { ...receipt, ssg: [{ ...proof, initial: { ...proof.initial, output: proof.output } }] },
      { ...receipt, ssg: [{ ...proof, locales: ["en", "EN"] }] },
    ]) assert.throws(() => validateStylexNextPostprocessingReceipt(mutation));
  });

  test("derives exact locale normalization, static filtering, dynamic keys, sorting and deduplication", () => {
    const input = prerender({
      "/FR/z": { srcRoute: null }, "/en/z": {}, "/en": {}, "/": {}, "/EN/A": {},
      "/en/derived": { srcRoute: "/[slug]" }, "/enough": {}, "/en/a": {},
    }, { "/fr/[slug]": {}, "/z": {} });
    const expected = ["/", "/A", "/a", "/enough", "/fr/[slug]", "/z"];
    assert.deepEqual(deriveStylexNextSsgRoutes(input, manifest(["en", "fr"])), { locales: ["en", "fr"], routes: expected });
    for (let offset = 0; offset < 8; offset++) {
      const entries = Object.entries(input.routes);
      const permuted = { ...input, routes: Object.fromEntries([...entries.slice(offset), ...entries.slice(0, offset)]) };
      assert.deepEqual(deriveStylexNextSsgRoutes(permuted, manifest(["en", "fr"])).routes, expected);
    }
    assert.deepEqual(deriveStylexNextSsgRoutes(prerender({ "/en/page": {} }), manifest()).routes, ["/en/page"]);
    for (const value of [manifest(["en", "EN"]), manifest(["../en"]), { ...manifest(), version: 4 }, { ...manifest(), appType: "pages" }, { ...manifest(), unknown: true }, { ...manifest(), staticRoutes: [{ page: "/a" }, { page: "/a" }] }]) {
      assert.throws(() => deriveStylexNextSsgRoutes(input, value));
    }
    for (const value of [{ ...input, routes: { "/x": { srcRoute: 42 } } }, { ...input, routes: { relative: {} } }, { ...input, dynamicRoutes: { "/x": { source: "fetch('/')" } } }, { ...input, ignored: true }]) {
      assert.throws(() => deriveStylexNextSsgRoutes(value, manifest()));
    }
  });

  test("admits only the exact 16.3 classification fields without changing SSG route selection", () => {
    const expected = { locales: ["en", "fr"], routes: ["/", "/[slug]", "/a"] };
    const input = (metadata: Record<string, unknown>) => prerender({
      "/en": { ...metadata, srcRoute: null }, "/FR/a": metadata, "/en/a": metadata,
      "/en/derived": { ...metadata, srcRoute: "/[slug]" },
    }, { "/[slug]": metadata });
    const classifications = [{}, ...["route", "fallback", "shell", "page"].flatMap(routeType =>
      ["empty", "initial", "complete"].flatMap(response => ["blocking", "resuming", "static"].flatMap(compute =>
        [{ routeType, response, compute }, { routeType, response, compute, htmlSize: 0 }, { routeType, response, compute, htmlSize: 9031 }])) )];
    for (const metadata of classifications) {
      assert.deepEqual(deriveStylexNextSsgRoutes(input(metadata), manifest(["en", "fr"]), "16.3.3"), expected);
      if (Object.keys(metadata).length === 0) {
        assert.deepEqual(deriveStylexNextSsgRoutes(input(metadata), manifest(["en", "fr"])), expected);
      } else {
        assert.throws(() => deriveStylexNextSsgRoutes(input(metadata), manifest(["en", "fr"]), "16.2.12"), /unknown field/u);
      }
    }
    assert.throws(() => deriveStylexNextSsgRoutes(input({}), manifest(), null as never), /exactly/u);
  });

  test("rejects partial, foreign and malformed 16.3 classification metadata in both route tables", () => {
    const valid = { routeType: "page", response: "complete", compute: "static", htmlSize: 9031 };
    const invalid: Record<string, unknown>[] = [
      { ...valid, unknown: true }, { ...valid, routeType: "unknown" }, { ...valid, response: "streaming" },
      { ...valid, compute: "edge" }, { ...valid, routeType: null }, { ...valid, response: 1 },
      ...[-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "9031", null, undefined].map(htmlSize => ({ ...valid, htmlSize })),
      { htmlSize: 1 },
    ];
    for (const missing of ["routeType", "response", "compute"]) invalid.push(Object.fromEntries(Object.entries(valid).filter(([name]) => name !== missing)));
    for (const metadata of invalid) for (const dynamic of [false, true]) {
      const input = dynamic ? prerender({}, { "/[slug]": metadata }) : prerender({ "/a": metadata });
      assert.throws(() => deriveStylexNextSsgRoutes(input, manifest(), "16.3.3"));
    }
  });

  test("matches the pinned devalue Set subset without evaluating emitted JavaScript", async () => {
    assert.equal(serializeStylexNextSsgRoutes, contractSerializeStylexNextSsgRoutes, "Filesystem settlement and receipt validation must share one serializer");
    const serializerPath = "dist/compiled/devalue/devalue.umd.js";
    assert.equal(sha256(await readFile(new URL(`../node_modules/next/${serializerPath}`, import.meta.url))), STYLEX_NEXT_SSG_INPUTS.find(([path]) => path === serializerPath)![1]);
    const serialize = createRequire(import.meta.url)(`next/${serializerPath}`) as (value: Set<string>) => string;
    const candidates = ["/", "/a", "/Z", "/[...all]", '/"quote"', "/slash\\", "/<script>", "/é", "/😀", "/\ud800", "/\udfff", "/\u2028\u2029", "/$.prototype", "/💚/🙂"];
    for (let offset = 0; offset <= candidates.length; offset++) {
      const paths = [...new Set(candidates.slice(offset))].sort();
      assert.equal(serializeStylexNextSsgRoutes(paths), `self.__SSG_MANIFEST=${serialize(new Set(paths))};self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()`);
    }
    assert.throws(() => serializeStylexNextSsgRoutes(["/z", "/a"]), /sorted unique/u);
    assert.throws(() => serializeStylexNextSsgRoutes(["/a", "/a"]), /sorted unique/u);
    assert.throws(() => serializeStylexNextSsgRoutes(["/\0x"]), /pathname/u);
  });

  test("rejects creator, package, BUILD_ID, output, duplicate-key and unsupported-branch forgeries", async () => {
    const context = await fixture();
    const prove = () => proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial);
    for (const path of ["node_modules/next/package.json", ...STYLEX_NEXT_SSG_INPUTS.map(([path]) => `node_modules/next/${path}`)]) {
      const absolute = join(context.root, path);
      const saved = await readFile(absolute);
      await writeFile(absolute, path.endsWith("package.json") ? '{"name":"next","version":"16.2.13"}' : "changed creator");
      await assert.rejects(prove());
      await writeFile(absolute, saved);
    }
    for (const value of ["other", "../build", "build\n", "build/else"]) {
      await writeFile(join(context.outputRoot, "BUILD_ID"), value);
      await assert.rejects(prove());
    }
    await writeFile(join(context.outputRoot, "BUILD_ID"), "build");
    const output = join(context.outputRoot, context.path);
    for (const source of [STYLEX_NEXT_SSG_INITIAL_SOURCE, serializeStylexNextSsgRoutes(["/forged"]), serializeStylexNextSsgRoutes([]) + ";fetch('/')", serializeStylexNextSsgRoutes([]) + "\n"]) {
      await writeFile(output, source);
      await assert.rejects(prove(), /exact pinned native derivation/u);
    }
    await writeFile(output, serializeStylexNextSsgRoutes([]));
    const manifestPath = join(context.outputRoot, "prerender-manifest.json");
    const saved = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, saved.replace('"version": 4', '"version": 4, "version": 4'));
    await assert.rejects(prove(), /pinned formatter/u);
    await writeFile(manifestPath, saved);
    // An exact coherent native route change is new evidence, never the old seal.
    const first = await prove();
    await writeFile(manifestPath, JSON.stringify(prerender({ "/real": {} }), null, 2));
    await writeFile(output, serializeStylexNextSsgRoutes(["/real"]));
    const changed = await prove();
    assert.notEqual(canonicalJson(first), canonicalJson(changed));
    assert.notEqual(first.inputs[1]!.sha256, changed.inputs[1]!.sha256);
    assert.deepEqual(first.initial, changed.initial);
  });

  test("rejects symlinks and hardlinks rather than following mutable aliases", async () => {
    const context = await fixture();
    const source = join(context.outputRoot, context.path);
    const retained = join(context.outputRoot, "retained.js");
    await writeFile(retained, await readFile(source));
    await unlink(source);
    await symlink(retained, source);
    await assert.rejects(proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial), /symlink/u);
    await unlink(source);
    await link(retained, source);
    await assert.rejects(proveStylexNextSsgPostprocessing(context.root, context.outputRoot, context.initial), /single-link/u);
  });
});
