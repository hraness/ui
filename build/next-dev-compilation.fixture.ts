/** Genuine-Node source/producer checks with constructed public Webpack hooks. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { artifactForFile, canonicalJson, compilerContract, compilerSha256, serializeStylexPackageRules, sha256 } from "./compiler.js";
import { captureNextDevConsumerRegistry, createNextDevCompilationOwner, type NextDevCompilationContext } from "./next-dev-compilation.js";
import { NEXT_DEV_CLIENT_IMPORT } from "./next-dev-markers.js";
import type { NextDevNativeCompilation, NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import { createNextDevSession, requireNextDevSnapshot, STYLEX_NEXT_DEV_CSS_ENTRY, type StylexNextDevOptions } from "./next-dev-session.js";

type Tap = Readonly<{ name: string; stage?: number }>;
class Hook<Args extends unknown[], Result = void> {
  readonly taps: (Tap & Readonly<{ callback: (...args: Args) => Result }>)[] = [];
  tap(options: Tap, callback: (...args: Args) => Result): void {
    this.taps.push({ ...options, callback });
    this.taps.sort((left, right) => (left.stage ?? 0) - (right.stage ?? 0));
  }
  run(...args: Args): Result | undefined {
    let result: Result | undefined;
    for (const { callback } of this.taps) result = callback(...args);
    return result;
  }
}
class RawSource {
  constructor(readonly value: string) {}
  source(): string { return this.value; }
}
class ConcatSource {
  readonly parts: (Readonly<{ source(): string | Uint8Array }> | string)[];
  constructor(...parts: (Readonly<{ source(): string | Uint8Array }> | string)[]) { this.parts = parts; }
  source(): string { return this.parts.map((part) => typeof part === "string" ? part : part.source()).join(""); }
}
class RuntimeModule {
  static STAGE_BASIC = 5;
  static STAGE_TRIGGER = 20;
  constructor(readonly name: string, readonly stage: number) {}
  generate(): string | null { return null; }
}

function emission(owner: ReturnType<typeof createNextDevCompilationOwner>, context: NextDevCompilationContext) {
  const requirements = new Set<string>();
  const chunk = { getEntryOptions: () => undefined, hasRuntime: () => true };
  const modules: { generate(): string | null }[] = [];
  const runtime = new Hook<[typeof chunk, Set<string>]>();
  const processAssets = new Hook<[]>();
  const startup = new Hook<[Readonly<{ source(): string | Uint8Array }>, unknown, Readonly<{ chunk: typeof chunk }>], Readonly<{ source(): string | Uint8Array }>>();
  const assets = new Map<string, { name: string; source: RawSource; info: { hotModuleReplacement?: unknown } }>();
  const errors: Error[] = [];
  const compilation: NextDevNativeCompilation = {
    addRuntimeModule: (_chunk, module) => { modules.push(module); },
    chunkGraph: { getChunkRuntimeRequirements: () => requirements, getTreeRuntimeRequirements: () => requirements },
    chunks: [chunk], emitAsset: (name, source) => { assets.set(name, { name, source: new RawSource(String(source.source())), info: {} }); },
    errors, getAsset: (name) => assets.get(name), getAssets: () => [...assets.values()], hash: "b".repeat(16),
    hooks: { additionalTreeRuntimeRequirements: runtime, processAssets },
    outputOptions: { library: { type: "assign", name: "_N_E" }, module: false, chunkFormat: "array-push", chunkLoading: "jsonp",
      publicPath: "/_next/", hashDigestLength: 16, hotUpdateMainFilename: "static/webpack/[fullhash].[runtime].hot-update.json" },
    records: {}, updateAsset: (name, source) => { assets.get(name)!.source = new RawSource(String(source.source())); },
  };
  const webpack: NextDevNativeWebpack = {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -2000, PROCESS_ASSETS_STAGE_SUMMARIZE: 1000 },
    RuntimeGlobals: { getFullHash: "__webpack_require__.h", hmrDownloadManifest: "__webpack_require__.hmrM",
      require: "__webpack_require__", returnExportsFromRuntime: "return-exports-from-runtime" },
    RuntimeModule, javascript: { JavascriptModulesPlugin: { getCompilationHooks: () => ({ renderStartup: startup }) } },
    sources: { RawSource, ConcatSource },
  };
  // These hooks exercise the actual private publication validator, not a Next
  // build. The deliberately inert factory is never executed as browser code.
  owner.installNative(context, compilation, webpack, "function () { throw new Error('Constructed compiler hook, not native browser evidence'); }", () => true);
  runtime.run(chunk, requirements);
  startup.run(new RawSource("ordinaryStartup();"), undefined, { chunk });
  processAssets.run();
  return { assets, modules };
}

const boundary = `import { StylexNextDevConsumer as Boundary, stylexNextDevRevision as revision } from "${NEXT_DEV_CLIENT_IMPORT}";`;
const authored: Readonly<Record<string, string>> = {
  "app/layout.tsx": `import type { ReactNode } from "react"; import { StylexNextDevDocument } from "${NEXT_DEV_CLIENT_IMPORT}";
import "./stylex-dev.css";
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body><StylexNextDevDocument>{children}</StylexNextDevDocument></body></html>; }`,
  "app/page.tsx": `${boundary} import * as stylex from "@stylexjs/stylex"; import { styles } from "./data.stylex"; import Client from "./client";
export default function Page() { return <Boundary as="main" revision={revision()} {...stylex.props(styles.root)}><Client/></Boundary>; }`,
  "app/client.tsx": `"use client"; ${boundary} import { useState } from "react";
export default function Client() { const [count, setCount] = useState(0); return <Boundary as="section" revision={revision()}><button onClick={() => setCount(value => value + 1)}>{count}</button></Boundary>; }`,
  "app/unvisited/page.tsx": `${boundary} export const runtime = "edge";
export default function Unvisited() { return <Boundary as="main" revision={revision()}>Unvisited</Boundary>; }`,
};
const data = (value: number) => `import * as stylex from "@stylexjs/stylex"; export const styles = stylex.create({ root: { marginLeft: ${value} } });\n`;

export async function runNextDevCompilationFixture(): Promise<Readonly<{ checks: number; node: string }>> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-compilation-"));
  const write = async (path: string, source: string): Promise<void> => {
    const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, source);
  };
  let checks = 0;
  const check = (run: () => void): void => { run(); checks++; };
  const rejects = async (run: Promise<unknown>, message: RegExp): Promise<void> => { await assert.rejects(run, message); checks++; };
  try {
    const packageRoot = join(root, "node_modules/@fixture/ui");
    const standaloneSerializer = { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" };
    await write("package.json", '{"type":"module"}\n');
    await write("node_modules/@fixture/ui/package.json", '{"name":"@fixture/ui","version":"1.0.0","type":"module"}\n');
    await write("node_modules/@fixture/ui/src/foundation.css", "@layer base { body { margin: 0; } }\n");
    await write("node_modules/@fixture/ui/dist/index.js", "export const ordinary = 1;\n");
    await write("node_modules/@fixture/ui/dist/stylex.css", serializeStylexPackageRules([], standaloneSerializer));
    await write("node_modules/@fixture/ui/dist/stylex-manifest.json", canonicalJson({ buildTools: [], compiler: compilerContract,
      compilerFoundation: "src/foundation.css", compilerSha256, kind: "hraness-stylex-package-manifest",
      package: { name: "@fixture/ui", version: "1.0.0" }, rules: [], rulesSha256: sha256("[]"),
      runtime: [await artifactForFile(packageRoot, "dist/index.js")], schemaVersion: 1,
      standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"), standaloneSerializer,
      stylesheets: [await artifactForFile(packageRoot, "src/foundation.css")] }) + "\n");
    for (const [path, source] of Object.entries(authored)) await write(path, source);
    await write("app/data.stylex.ts", data(31.125));
    await write("app/stylex-dev.css", STYLEX_NEXT_DEV_CSS_ENTRY);
    const options: StylexNextDevOptions = { rootDirectory: root, sourceDirectories: ["app"],
      packageManifests: ["node_modules/@fixture/ui/dist/stylex-manifest.json"], cssEntry: "app/stylex-dev.css" };
    const session = createNextDevSession(options);
    const owner = createNextDevCompilationOwner(session);
    let invalidations = 0;
    owner.registerClientInvalidator(() => { invalidations++; return true; });
    const load = (context: NextDevCompilationContext, path: string) => readFile(join(root, path), "utf8")
      .then((source) => context.loadNextDevModule(join(root, path), source));
    const publish = (context: NextDevCompilationContext) => { const output = emission(owner, context); owner.complete(context, true, true); return output; };

    const framework = await owner.prepare("client");
    check(() => assert.equal(framework.preparation.error, null));
    check(() => assert.equal(owner.inspect().producer?.published, 0));
    owner.complete(framework, false, true);
    check(() => assert.equal(owner.inspect().producer?.published, 0));
    check(() => assert.equal(owner.inspect().producer?.active, false));
    const emptyServer = await owner.prepare("server");
    check(() => assert.equal(owner.validate(emptyServer, false), null));
    owner.complete(emptyServer, false, true);
    check(() => assert.equal(invalidations, 0));
    const blocked = await owner.prepare("server");
    await rejects(load(blocked, "app/page.tsx"), /no exact published native CSS authority/u);
    check(() => assert.equal(invalidations, 1));
    owner.complete(blocked, true, false);

    const first = await owner.prepare("client");
    await rejects(owner.prepare("server"), /terminal collection/u);
    check(() => assert.throws(() => owner.abort("edge-server"), /another target/u));
    const firstSnapshot = requireNextDevSnapshot(first.preparation);
    check(() => assert.deepEqual(owner.inspect().registry, [
      { source: "app/client.tsx", target: "client" }, { source: "app/page.tsx", target: "server" },
      { source: "app/unvisited/page.tsx", target: "edge-server" },
    ]));
    const clientSource = await load(first, "app/client.tsx");
    check(() => assert.ok(clientSource.code.includes('target: "client"') && clientSource.code.includes(firstSnapshot.revision)));
    check(() => assert.deepEqual((clientSource.map as { sourcesContent: unknown }).sourcesContent, [authored["app/client.tsx"]]));
    await rejects(load(first, "app/page.tsx"), /different native compiler target/u);
    await rejects(first.loadNextDevModule(join(root, "app/client.tsx"), authored["app/client.tsx"]! + "\n"), /differs from its compilation snapshot/u);
    await rejects(first.loadNextDevModule(join(root, "app/client.tsx"), authored["app/client.tsx"]!, {}), /before another mapped transform/u);
    const marker = await first.auditNextDevCss(join(root, options.cssEntry), STYLEX_NEXT_DEV_CSS_ENTRY);
    check(() => assert.equal(marker, "/* StyleX Next development native stylesheet marker. */\n"));
    check(() => assert.ok(!marker.includes("@layer") && !marker.includes("@import") && !marker.includes("31.125")));
    await rejects(first.auditNextDevCss(join(root, options.cssEntry), "changed"), /marker changed/u);
    check(() => assert.equal(owner.hasNativeCandidate(first), true));
    const output = publish(first);
    check(() => assert.equal(output.modules.length, 2));
    check(() => assert.equal(owner.inspect().producer?.published, 1));
    check(() => assert.ok([...output.assets.values()].every(({ name, source }) => name.includes(sha256(source.source())))));
    await rejects(load(first, "app/client.tsx"), /foreign, terminal/u);
    check(() => assert.throws(() => owner.complete(first, true, true), /foreign, terminal/u));

    for (const target of ["server", "edge-server"] as const) {
      const next = await owner.prepare(target);
      check(() => assert.equal(next.preparation.error, null));
      const client = await load(next, "app/client.tsx");
      check(() => assert.equal(client.code, clientSource.code)); // SSR must not relabel client ownership.
      const source = await load(next, target === "server" ? "app/page.tsx" : "app/unvisited/page.tsx");
      check(() => assert.ok(source.code.includes(`target: "${target}"`) && source.code.includes(firstSnapshot.revision)));
      check(() => assert.deepEqual((source.map as { sources: unknown }).sources, [target === "server" ? "app/page.tsx" : "app/unvisited/page.tsx"]));
      await rejects(load(next, target === "server" ? "app/unvisited/page.tsx" : "app/page.tsx"), /different native compiler target/u);
      const plain = await load(next, "app/data.stylex.ts");
      check(() => assert.equal(plain.code, firstSnapshot.sources.find(({ logicalPath }) => logicalPath === "app/data.stylex.ts")!.code));
      owner.complete(next, true, true);
    }

    await write("app/data.stylex.ts", data(32.125));
    const serverEdit = await owner.prepare("server");
    await rejects(load(serverEdit, "app/page.tsx"), /no exact published native CSS authority/u);
    check(() => assert.equal(owner.inspect().producer?.published, 1));
    check(() => assert.equal(invalidations, 2));
    owner.complete(serverEdit, true, false);
    const damaged = await owner.prepare("client");
    check(() => assert.ok(requireNextDevSnapshot(damaged.preparation).css.includes("31.125px") && requireNextDevSnapshot(damaged.preparation).css.includes("32.125px")));
    const damage = emission(owner, damaged);
    const asset = [...damage.assets.values()][0]!; asset.source = new RawSource(`${asset.source.source()}/* drift */`);
    check(() => assert.throws(() => owner.complete(damaged, true, true), /native CSS census changed/u));
    check(() => assert.equal(owner.inspect().producer?.published, 1));
    check(() => assert.equal(owner.inspect().active, null));
    check(() => assert.equal(owner.inspect().producer?.active, false));
    const recovery = await owner.prepare("client"); publish(recovery);
    const currentServer = await owner.prepare("server"); owner.complete(currentServer, true, true);
    const failedEmpty = await owner.prepare("edge-server"); owner.complete(failedEmpty, false, false);
    check(() => assert.equal(invalidations, 2));
    const retiredEdge = await owner.prepare("edge-server"); owner.complete(retiredEdge, false, true);
    check(() => assert.equal(invalidations, 3));
    const prune = await owner.prepare("client");
    check(() => assert.ok(!requireNextDevSnapshot(prune.preparation).css.includes("31.125px")));
    check(() => assert.deepEqual(requireNextDevSnapshot(prune.preparation).includedRevisions, [requireNextDevSnapshot(recovery.preparation).revision]));
    publish(prune);

    await write("app/added.tsx", `"use client"; ${boundary} export default function Added() { return <Boundary as="p" revision={revision()}>New</Boundary>; }`);
    const changedRegistry = await owner.prepare("client");
    check(() => assert.match(changedRegistry.preparation.error!.message, /registry changed/u));
    check(() => assert.equal(owner.hasNativeCandidate(changedRegistry), false));
    owner.complete(changedRegistry, true, false);
    await rm(join(root, "app/added.tsx"));
    await write("app/data.stylex.ts", "export const broken = ;\n");
    const broken = await owner.prepare("client");
    check(() => assert.ok(broken.preparation.error !== null && broken.preparation.lastGood !== null));
    check(() => assert.ok(broken.preparation.attemptedFiles.includes(join(root, "app/data.stylex.ts"))));
    await rejects(load(broken, "app/page.tsx"), /Unexpected token/u);
    owner.complete(broken, false, true);
    await write("app/data.stylex.ts", data(32.125));
    const uninstalled = await owner.prepare("client");
    check(() => assert.throws(() => owner.complete(uninstalled, true, true), /omitted its native publication hooks/u));
    check(() => assert.equal(owner.inspect().active, null));
    const aborted = await owner.prepare("client"); owner.abort("client");
    await rejects(load(aborted, "app/client.tsx"), /foreign, terminal/u);
    check(() => assert.equal(owner.inspect().producer?.active, false));

    const snapshot = requireNextDevSnapshot(await session.prepare());
    const invalid = { ...snapshot, sources: snapshot.sources.map((source) => source.logicalPath === "app/client.tsx"
      ? { ...source, sourceSha256: "0".repeat(64) } : source) };
    await rejects(captureNextDevConsumerRegistry(invalid), /exact authored source bytes/u);
    await write("app/client.tsx", authored["app/client.tsx"]!.replace("revision()", "null"));
    const fresh = createNextDevCompilationOwner(createNextDevSession(options));
    const missingMarker = await fresh.prepare("client");
    check(() => assert.ok(missingMarker.preparation.error !== null));
    check(() => assert.equal(fresh.inspect().registry, null));
    fresh.complete(missingMarker, true, false);
    await write("app/client.tsx", authored["app/client.tsx"]!);
    const repaired = await fresh.prepare("client");
    check(() => assert.equal(repaired.preparation.error, null));
    fresh.abort("client");
    check(() => assert.equal(fresh.inspect().producer?.published, 0));
    return { checks, node: process.versions.node };
  } finally {
    // Sole test-created tree with synthetic source/package bytes, never a
    // retained worktree, provider fixture or browser/profile directory.
    await rm(root, { recursive: true, force: false });
  }
}
