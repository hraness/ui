import { stylexNextProfile, stylexNextVersion } from "../build/next-profile.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";

import { chromium } from "playwright-core";

import { resolveFirstBrowserExecutable } from "./browser-executable.ts";
import {
  assertNextAuthoredSourceEmbedding,
  assertNextSourceMapOutputLink,
  nextSourceMapEntries,
  type NextSourceMapEntry,
} from "./next-source-map.ts";

const BUN_VERSION = "1.3.14";
const NODE_VERSION_PREFIX = "24.";
const arguments_ = process.argv.slice(2);
assert.ok(arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--next-version=16.3.3"), "Next smoke accepts only its two exact production profile rows");
const NEXT_VERSION = stylexNextVersion(arguments_.length === 0 ? "16.2.12" : "16.3.3");
const PORT = 39_154;
const NEXT_TARGETS = ["client", "edge-rsc", "node-rsc"] as const;
type NextTarget = (typeof NEXT_TARGETS)[number];
const FIXTURE_REQUIRED_SOURCES: Readonly<Record<NextTarget, readonly string[]>> = {
  client: ["app/client.tsx", "app/global-error.tsx", "app/lazy.tsx", "app/shared-history/category-icon.tsx", "app/shared-history/history-measure-rail.tsx", "app/shared-history/history-sticky-offset-sync.tsx", "app/shared-history/shared-history.stylex.ts"],
  "edge-rsc": ["app/edge/page.tsx", "app/global-error.tsx", "app/layout.tsx"],
  "node-rsc": [
    "app/client.tsx",
    "app/delegated-one/page.tsx",
    "app/delegated-two/page.tsx",
    "app/global-error-proof/page.tsx",
    "app/global-error.tsx",
    "app/index/[manifestProof]/page.tsx",
    "app/layout.tsx",
    "app/lazy.tsx",
    "app/page.tsx",
    "app/shared-history/category-icon.tsx",
    "app/shared-history/history-measure-key.tsx",
    "app/shared-history/history-measure-rail.tsx",
    "app/shared-history/history-sticky-offset-sync.tsx",
    "app/shared-history/shared-history.stylex.ts",
    "app/shared-history/shared-history.tsx",
    "proxy.ts",
  ],
};
const FIXTURE_AUTHORED_SOURCES = [...new Set(NEXT_TARGETS.flatMap((target) => FIXTURE_REQUIRED_SOURCES[target]))].sort();

function resolveNode24(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const executable = resolve(directory, executableName);
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "--eval",
        `if (typeof Bun !== "undefined" || !process.versions.node.startsWith(${JSON.stringify(NODE_VERSION_PREFIX)})) process.exit(1)`,
      ], { stderr: "ignore", stdin: "ignore", stdout: "ignore" });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Keep searching PATH for a genuine Node 24 executable.
    }
  }
  throw new Error("Packed Next adopter smoke requires a genuine Node 24 executable on PATH");
}

async function run(command: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, timeoutMs = 900_000): Promise<void> {
  const child = Bun.spawn([...command], { cwd, env: environment, stdin: "ignore", stderr: "pipe", stdout: "pipe" });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    child.exited.then((code) => ({ code, timeout: false as const })),
    new Promise<{ timeout: true }>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ timeout: true }), timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome.timeout) {
    child.kill("SIGTERM");
    await Promise.race([child.exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  const exitCode = await child.exited;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (stdoutText.length > 0) process.stdout.write(stdoutText);
  if (stderrText.length > 0) process.stderr.write(stderrText);
  assert.equal(outcome.timeout, false, `Command timed out: ${command.join(" ")}`);
  assert.equal(child.signalCode, null, `Command exited by signal: ${command.join(" ")}`);
  assert.equal(exitCode, 0, `Command failed: ${command.join(" ")}`);
}

async function filesBelow(root: string, directory = root): Promise<readonly string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Next smoke output contains a symlink: ${path}`);
    if (entry.isDirectory()) output.push(...await filesBelow(root, path));
    else {
      assert.ok(entry.isFile(), `Next smoke output contains a non-file: ${path}`);
      output.push(relative(root, path).split(sep).join("/"));
    }
  }
  return output.sort();
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactUtf8(value: Buffer, description: string): string {
  const source = value.toString("utf8");
  assert.ok(Buffer.from(source, "utf8").equals(value), `${description} is not exact UTF-8`);
  return source;
}

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, names: readonly string[], description: string): void {
  assert.deepEqual(Object.keys(record).sort(), [...names].sort(), `${description} has an unexpected shape`);
}

function digest(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${description} must be a lowercase SHA-256`);
  return value;
}

function logicalPath(value: unknown, description: string): string {
  assert.ok(
    typeof value === "string"
      && value.length > 0
      && value.length <= 4096
      && !value.startsWith("/")
      && !value.includes("\\")
      && !/[\u0000-\u001f\u007f]/u.test(value)
      && !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === ".."),
    `${description} must be a bounded normalized relative path`,
  );
  return value;
}

function orderedLogicalPaths(value: unknown, description: string): readonly string[] {
  assert.ok(Array.isArray(value) && value.length <= 100_000, `${description} must be a bounded array`);
  for (let index = 0; index < value.length; index += 1) assert.ok(Object.hasOwn(value, index), `${description} must not be sparse`);
  const paths = value.map((path, index) => logicalPath(path, `${description}[${String(index)}]`));
  assert.deepEqual(paths, [...new Set(paths)].sort(), `${description} must be sorted and unique`);
  return paths;
}

function nextTarget(value: unknown, description: string): NextTarget {
  assert.ok(NEXT_TARGETS.includes(value as NextTarget), `${description} is not a supported target`);
  return value as NextTarget;
}

type Artifact = Readonly<{ bytes: number; path: string; sha256: string }>;

// Keep only selected, already verified evidence in memory until the ordinary
// consumer cleanup succeeds. No environment or arbitrary dependency capture.
const retainedEvidence = new Map<string, Buffer>();
const browserOutcomes: unknown[] = [];
function retainEvidence(path: string, bytes: Buffer): void {
  logicalPath(path, "Next retained evidence path");
  const prior = retainedEvidence.get(path);
  if (prior !== undefined) {
    assert.ok(prior.equals(bytes), `Next retained evidence changed: ${path}`);
    return;
  }
  assert.ok(retainedEvidence.size < 4096 && bytes.length + [...retainedEvidence.values()].reduce((sum, value) => sum + value.length, 0) <= 64 * 1024 * 1024, "Next retained proof exceeds its bound");
  retainedEvidence.set(path, Buffer.from(bytes));
}

async function retainOrdinaryEvidence(root: string, path: string, destination: string): Promise<void> {
  logicalPath(path, "Next selected evidence input");
  const absolute = resolve(root, path);
  const stat = await lstat(absolute);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024, "Next selected evidence must be an ordinary bounded file");
  assert.equal(await realpath(absolute), absolute, "Next selected evidence cannot traverse a symlink");
  retainEvidence(destination, await readFile(absolute));
}

async function writeRetainedEvidence(fixtureRoot: string): Promise<void> {
  const created = await mkdtemp(join(fixtureRoot, `next-adopter-proof-${NEXT_VERSION}-`));
  const directory = await realpath(created);
  assert.equal(directory, created, "Next proof directory cannot traverse a symlink");
  const artifacts: Artifact[] = [];
  for (const [path, bytes] of [...retainedEvidence].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const destination = resolve(directory, path);
    assert.equal(relative(directory, destination).split(sep).join("/"), path);
    await mkdir(dirname(destination), { recursive: true });
    assert.equal(await realpath(dirname(destination)), dirname(destination));
    await writeFile(destination, bytes, { flag: "wx" });
    const artifact = { path, bytes: bytes.length, sha256: sha256(bytes) };
    await readArtifact(directory, artifact, "Next retained proof readback");
    artifacts.push(artifact);
  }
  assert.equal(browserOutcomes.length, 8, "Next proof must retain root, two route/resize/cleanup and global-error outcomes");
  const receipt = `${JSON.stringify({ schemaVersion: 1, nextVersion: NEXT_VERSION, state: "passed", disposableConsumerRemoved: true, artifacts, browserOutcomes }, null, 2)}\n`;
  await writeFile(resolve(directory, "receipt.json"), receipt, { flag: "wx" });
  console.log(`Retained packed Next ${NEXT_VERSION} evidence: ${directory}/receipt.json sha256=${sha256(receipt)}`);
}

function artifact(value: unknown, description: string): Artifact {
  const record = object(value, description);
  exactKeys(record, ["bytes", "path", "sha256"], description);
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0, `${description}.bytes is invalid`);
  return {
    bytes: record.bytes as number,
    path: logicalPath(record.path, `${description}.path`),
    sha256: digest(record.sha256, `${description}.sha256`),
  };
}

function orderedArtifacts(value: unknown, description: string): readonly Artifact[] {
  assert.ok(Array.isArray(value) && value.length <= 100_000, `${description} must be a bounded array`);
  const output = value.map((item, index) => artifact(item, `${description}[${String(index)}]`));
  assert.deepEqual(output.map(({ path }) => path), [...new Set(output.map(({ path }) => path))].sort(), `${description} must be path sorted and unique`);
  return output;
}

type GraphIdentity = Readonly<{ graphId: string; receiptSha256: string; target: NextTarget }>;

function graphIdentities(value: unknown, description: string): readonly GraphIdentity[] {
  assert.ok(Array.isArray(value) && value.length === NEXT_TARGETS.length, `${description} must contain every target`);
  const output = value.map((item, index) => {
    const record = object(item, `${description}[${String(index)}]`);
    exactKeys(record, ["graphId", "receiptSha256", "target"], `${description}[${String(index)}]`);
    assert.ok(typeof record.graphId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.graphId), `${description}[${String(index)}].graphId is invalid`);
    return {
      graphId: record.graphId,
      receiptSha256: digest(record.receiptSha256, `${description}[${String(index)}].receiptSha256`),
      target: nextTarget(record.target, `${description}[${String(index)}].target`),
    };
  });
  assert.deepEqual(output.map(({ target }) => target), NEXT_TARGETS, `${description} targets differ from the exact target order`);
  assert.equal(new Set(output.map(({ graphId }) => graphId)).size, output.length, `${description} graph IDs must be unique`);
  return output;
}

function moduleIdentities(value: unknown, description: string): readonly Readonly<{ path: string; receiptSha256: string }>[] {
  assert.ok(Array.isArray(value) && value.length <= 100_000, `${description} must be a bounded array`);
  const output = value.map((item, index) => {
    const module = object(item, `${description}[${String(index)}]`);
    exactKeys(module, ["path", "receiptSha256"], `${description}[${String(index)}]`);
    return {
      path: logicalPath(module.path, `${description}[${String(index)}].path`),
      receiptSha256: digest(module.receiptSha256, `${description}[${String(index)}].receiptSha256`),
    };
  });
  assert.deepEqual(output.map(({ path }) => path), [...new Set(output.map(({ path }) => path))].sort(), `${description} must be path sorted and unique`);
  return output;
}

async function readArtifact(root: string, expected: Artifact, description: string): Promise<Buffer> {
  const path = resolve(root, ...expected.path.split("/"));
  const containment = relative(root, path).split(sep).join("/");
  assert.ok(containment === expected.path && !containment.startsWith("../"), `${description} escapes its root`);
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${description} must be an ordinary nonsymlink file`);
  assert.equal(await realpath(path), path, `${description} must not traverse a symlink`);
  const source = await readFile(path);
  assert.deepEqual(
    { bytes: source.byteLength, sha256: sha256(source) },
    { bytes: expected.bytes, sha256: expected.sha256 },
    `${description} differs from its receipt`,
  );
  return source;
}

async function assertNodeProxyTrace(consumer: string, graph: Record<string, unknown>, postprocessing: Record<string, unknown>): Promise<Artifact> {
  const profile = stylexNextProfile(NEXT_VERSION);
  assert.equal(graph.nextVersion, NEXT_VERSION);
  assert.equal(postprocessing.nextVersion, NEXT_VERSION);
  assert.equal(graph.target, "node-rsc");
  const javascript = "server/proxy.js";
  const tracePath = `${javascript}.nft.json`;
  const outputs = orderedArtifacts(graph.outputs, "Next proxy graph outputs");
  assert.ok(orderedLogicalPaths(graph.javascriptChunks, "Next proxy graph chunks").includes(javascript));
  assert.ok(orderedArtifacts(graph.sourceMaps, "Next proxy graph maps").some(({ path }) => path === `${javascript}.map`));
  assert.ok(moduleIdentities(graph.modules, "Next proxy graph modules").some(({ path }) => path === "proxy.ts"));
  assert.ok(Array.isArray(graph.entrypoints) && graph.entrypoints.length <= 4096);
  const owners = graph.entrypoints.map((value) => object(value, "Next proxy entrypoint")).filter(({ name }) => name === "proxy");
  assert.equal(owners.length, 1);
  assert.ok(orderedLogicalPaths(owners[0]!.files, "Next proxy entry files").includes(javascript));
  assert.ok(orderedLogicalPaths(owners[0]!.javascript, "Next proxy entry JavaScript").includes(javascript));
  assert.ok(Array.isArray(graph.auxiliaryTraceAssets) && graph.auxiliaryTraceAssets.length <= 100_000);
  const traces = graph.auxiliaryTraceAssets.map((value) => object(value, "Next proxy trace")).filter(({ entrypoint }) => entrypoint === "proxy");
  assert.equal(traces.length, 1);
  const trace = traces[0]!;
  exactKeys(trace, ["creator", "entrypoint", "initial", "kind"], "Next proxy trace");
  assert.equal(trace.kind, "next-node-dependency-trace");
  const initial = artifact(trace.initial, "Next proxy initial trace");
  assert.equal(initial.path, tracePath);
  assert.deepEqual(outputs.find(({ path }) => path === tracePath), initial);
  const creator = artifact(trace.creator, "Next proxy trace creator");
  assert.equal(creator.path, `node_modules/next/${profile.auxiliaryTraceCreator[0]}`);
  assert.equal(creator.sha256, profile.auxiliaryTraceCreator[1]);
  await readArtifact(consumer, creator, "Next proxy pinned native creator");
  assert.ok(Array.isArray(postprocessing.auxiliaryTraceSnapshots) && postprocessing.auxiliaryTraceSnapshots.length <= 100_000);
  const snapshots = postprocessing.auxiliaryTraceSnapshots
    .map((value) => object(value, "Next proxy trace snapshot"))
    .filter(({ asset }) => object(asset, "Next proxy snapshot asset").entrypoint === "proxy");
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0]!;
  exactKeys(snapshot, ["asset", "output", "proxyRename", "semantics"], "Next proxy snapshot");
  assert.deepEqual(snapshot.asset, trace);
  assert.equal(snapshot.semantics, "observation-only");
  const output = artifact(snapshot.output, "Next proxy settled trace");
  assert.equal(output.path, "server/middleware.js.nft.json");
  assert.equal(postprocessing.outputDirectory, graph.outputDirectory);
  const outputRoot = resolve(consumer, logicalPath(graph.outputDirectory, "Next proxy output directory"));
  await readArtifact(outputRoot, output, "Next proxy settled trace");
  const rename = object(snapshot.proxyRename, "Next proxy rename proof");
  exactKeys(rename, ["absent", "creator", "initial", "output", "sourceMap"], "Next proxy rename proof");
  const renameCreator = artifact(rename.creator, "Next proxy rename creator");
  assert.equal(renameCreator.path, `node_modules/next/${profile.proxyRenameCreator[0]}`);
  assert.equal(renameCreator.sha256, profile.proxyRenameCreator[1]);
  await readArtifact(consumer, renameCreator, "Next proxy native rename creator");
  const compiled = artifact(rename.initial, "Next proxy compiled JavaScript");
  assert.deepEqual(compiled, outputs.find(({ path }) => path === javascript));
  const renamed = artifact(rename.output, "Next proxy renamed JavaScript");
  assert.deepEqual(renamed, { ...compiled, path: "server/middleware.js" });
  await readArtifact(outputRoot, renamed, "Next proxy renamed JavaScript");
  const map = artifact(rename.sourceMap, "Next proxy unchanged map");
  assert.deepEqual(map, outputs.find(({ path }) => path === `${javascript}.map`));
  await readArtifact(outputRoot, map, "Next proxy unchanged map");
  assert.deepEqual(rename.absent, [javascript, tracePath]);
  for (const path of [javascript, tracePath]) await assert.rejects(lstat(resolve(outputRoot, path)), { code: "ENOENT" });
  return renamed;
}

/** Join an independent, pre-admission live webpack observation to the sealed
 * graph and genuine settled owner files. Success without both zero-module
 * routes is a failed fixture, not coverage for the new category. */
async function assertDelegatedEntries(consumer: string, graph: Record<string, unknown>): Promise<void> {
  assert.equal(graph.adapterVersion, "hraness-stylex-next-v3");
  assert.equal(graph.target, "client");
  assert.equal(graph.nextVersion, NEXT_VERSION);
  assert.ok(typeof graph.attemptId === "string" && /^[a-z0-9-]+$/u.test(graph.attemptId));
  assert.ok(graph.mode === "discovery" || graph.mode === "delivery");
  const evidencePath = resolve(consumer, `.delegated-entry-proof/${graph.attemptId}-${graph.mode}.json`);
  const evidence = object(JSON.parse(await readFile(evidencePath, "utf8")) as unknown, "Delegated native observation");
  assert.equal(evidence.attemptId, graph.attemptId);
  assert.equal(evidence.mode, graph.mode);
  const prefix = `${graph.attemptId}/${graph.mode}`;
  await retainOrdinaryEvidence(consumer, `.delegated-entry-proof/${graph.attemptId}-${graph.mode}.json`, `${prefix}/observation.json`);
  await retainOrdinaryEvidence(consumer, `.delegated-entry-proof/${graph.attemptId}-${graph.mode}-topology.json`, `${prefix}/raw-topology.json`);
  assert.ok(Array.isArray(evidence.observations) && evidence.observations.length === 2);
  const observations = evidence.observations.map((value) => object(value, "Delegated native route"));
  assert.deepEqual(observations.map(({ name }) => name), ["app/delegated-one/page", "app/delegated-two/page"]);
  assert.ok(Array.isArray(graph.delegatedEntryBootstraps) && graph.delegatedEntryBootstraps.length === 2);
  const proofs = graph.delegatedEntryBootstraps.map((value) => object(value, "Delegated proof"));
  const outputs = orderedArtifacts(graph.outputs, "Delegated graph outputs");
  const maps = orderedArtifacts(graph.sourceMaps, "Delegated graph maps");
  const chunks = orderedLogicalPaths(graph.javascriptChunks, "Delegated graph chunks");
  const outputRoot = resolve(consumer, logicalPath(graph.outputDirectory, "Delegated output root"));
  for (const observation of observations) {
    const path = logicalPath(observation.output, "Delegated native output");
    const matching = proofs.filter((proof) => artifact(proof.output, "Delegated output").path === path);
    assert.equal(matching.length, 1);
    const proof = matching[0]!;
    const topology = object(proof.graph, "Delegated graph topology");
    const clientBoundaryImports = [
      "app/shared-history/category-icon.tsx",
      "app/shared-history/history-measure-rail.tsx",
      "app/shared-history/history-sticky-offset-sync.tsx",
    ];
    assert.deepEqual(observation.clientBoundaryImports, clientBoundaryImports);
    assert.ok(Array.isArray(topology.imports));
    assert.deepEqual(topology.imports.map((value) => object(value, "Delegated loader import").request)
      .filter((request) => typeof request === "string" && request.startsWith("app/shared-history/")), clientBoundaryImports);
    assert.deepEqual(topology.chunkIds, [observation.chunkId]);
    assert.equal(topology.entryModuleId, observation.entryModuleId);
    assert.deepEqual(topology.entrypoints, [observation.name]);
    const output = artifact(proof.output, "Delegated output artifact");
    assert.deepEqual(outputs.find((entry) => entry.path === path), output);
    assert.ok(chunks.includes(path) && !maps.some((entry) => entry.path === `${path}.map`));
    const bootstrapBytes = await readArtifact(outputRoot, output, "Delegated settled bootstrap");
    assert.equal(exactUtf8(bootstrapBytes, "Delegated bootstrap"), observation.source);
    retainEvidence(`${prefix}/assets/${output.path}`, bootstrapBytes);
    assert.ok(Array.isArray(observation.owners) && observation.owners.length > 0 && observation.owners.length <= 4096);
    const owners = observation.owners.map((value) => object(value, "Delegated native owner"));
    const expectedOwners = [];
    for (const owner of owners) {
      assert.ok(Array.isArray(owner.files) && owner.files.length > 0 && owner.files.length <= 4096);
      const files = owner.files.map((value) => object(value, "Delegated native owner file"));
      expectedOwners.push({ id: owner.id, files: files.map(({ path }) => logicalPath(path, "Delegated native owner path")).sort() });
      for (const file of files) {
        const ownerPath = logicalPath(file.path, "Delegated mapped owner path");
        const ownerOutput = outputs.find(({ path }) => path === ownerPath);
        const map = maps.find(({ path }) => path === `${ownerPath}.map`);
        assert.ok(ownerOutput !== undefined && map !== undefined && chunks.includes(ownerPath));
        assert.equal(ownerOutput.sha256, file.sha256);
        assert.equal(map.sha256, file.mapSha256);
        const ownerBytes = await readArtifact(outputRoot, ownerOutput, "Delegated mapped owner");
        const ownerSource = exactUtf8(ownerBytes, "Delegated owner");
        const mapBytes = await readArtifact(outputRoot, map, "Delegated genuine owner map");
        retainEvidence(`${prefix}/assets/${ownerOutput.path}`, ownerBytes);
        retainEvidence(`${prefix}/assets/${map.path}`, mapBytes);
        assertNextSourceMapOutputLink(ownerSource, ownerPath, map.path);
      }
    }
    expectedOwners.sort((left, right) => Number(left.id) - Number(right.id));
    assert.deepEqual(topology.entryOwners, expectedOwners, "Delegated receipt lost reciprocal native entry ownership");
  }
}

const themeSetup = String.raw`import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION,
  artifactForFile,
  canonicalJson,
  compilerContract,
  compilerSha256,
  createStylexTransformCollector,
  serializeStylexPackageRules,
  stylexRulesSha256,
  validateStylexPackageManifest,
} from "@hraness/ui/stylex-build";

const root = join(process.cwd(), "node_modules/@fixture/theme");
const sourcePath = join(root, "src/index.ts");
const source = await readFile(sourcePath, "utf8");
const collector = createStylexTransformCollector(root);
const transformed = await collector.transform(source, sourcePath);
const rules = collector.seal();
await mkdir(join(root, "dist"));
await writeFile(join(root, "dist/index.js"), transformed.code + "\n", { flag: "wx" });
const serializer = { before: ["components.fixture-theme.legacy"], prefix: "components.fixture-theme" };
await writeFile(join(root, "dist/stylex.css"), serializeStylexPackageRules(rules, serializer), { flag: "wx" });
await writeFile(join(root, "src/fixture.woff2"), Buffer.alloc(70_000, 17), { flag: "wx" });
const manifest = validateStylexPackageManifest({
  buildTools: [],
  compiler: compilerContract,
  compilerFoundation: "src/compiler-foundation.css",
  compilerSha256,
  kind: "hraness-stylex-package-manifest",
  package: { name: "@fixture/theme", version: "1.0.0" },
  rules,
  rulesSha256: stylexRulesSha256(rules),
  runtime: [await artifactForFile(root, "dist/index.js")],
  schemaVersion: STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION,
  standaloneCss: await artifactForFile(root, "dist/stylex.css"),
  standaloneSerializer: serializer,
  stylesheets: [await artifactForFile(root, "src/compiler-foundation.css")],
});
await writeFile(join(root, "dist/stylex-manifest.json"), canonicalJson(manifest) + "\n", { flag: "wx" });
`;

async function waitForServer(url: string, child: Readonly<{ exited: Promise<number> }>): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const outcome = await Promise.race([
      fetch(url).then((response) => response.ok ? "ready" as const : "wait" as const, () => "wait" as const),
      child.exited.then(() => "exit" as const),
      new Promise<"wait">((resolveWait) => setTimeout(() => resolveWait("wait"), 100)),
    ]);
    if (outcome === "ready") return;
    assert.notEqual(outcome, "exit", "Next server exited before becoming ready");
    assert.ok(Date.now() < deadline, "Next server did not become ready in 30 seconds");
  }
}

assert.equal(Bun.version, BUN_VERSION, `Next adopter smoke requires Bun ${BUN_VERSION}`);
const repository = await realpath(process.cwd());
const fixtureRoot = resolve(repository, ".stylex-fixtures");
await mkdir(fixtureRoot, { recursive: true });
const fixtureRootStat = await lstat(fixtureRoot);
assert.ok(fixtureRootStat.isDirectory() && !fixtureRootStat.isSymbolicLink());
const work = await realpath(await mkdtemp(join(fixtureRoot, "next-adopter-smoke-")));
const consumer = resolve(work, "consumer");
const temporary = resolve(work, "tmp");
const environment = { ...process.env, BUN_TMPDIR: temporary, NODE_ENV: "production", TMPDIR: temporary };
let successful = false;

try {
  const node = resolveNode24();
  await mkdir(consumer);
  await mkdir(temporary, { mode: 0o700 });
  const archive = resolve(work, "hraness-ui.tgz");
  await run([process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository, environment);
  const archiveBytes = await readFile(archive);
  retainEvidence("inputs/archive.json", Buffer.from(JSON.stringify({ bytes: archiveBytes.length, sha256: sha256(archiveBytes) })));
  for (const path of ["package.json", "bun.lock", "scripts/next-adopter-smoke.ts"]) await retainOrdinaryEvidence(repository, path, `inputs/repository/${path}`);
  for (const path of await filesBelow(resolve(repository, "fixtures/next-adopter"))) {
    await retainOrdinaryEvidence(repository, `fixtures/next-adopter/${path}`, `inputs/fixture/${path}`);
  }
  await writeFile(resolve(consumer, "package.json"), `${JSON.stringify({
    dependencies: {
      "@babel/core": "7.29.7",
      "@hraness/ui": `file:${archive}`,
      "@hugeicons/core-free-icons": "4.2.3",
      "@hugeicons/react": "1.1.9",
      "@stylexjs/babel-plugin": "0.19.0",
      "@stylexjs/stylex": "0.19.0",
      "@types/node": "24.13.3",
      "@types/react": "19.2.14",
      "@types/react-dom": "19.2.3",
      lightningcss: "1.33.0",
      next: NEXT_VERSION,
      react: "19.2.3",
      "react-dom": "19.2.3",
      typescript: "6.0.3",
    },
    name: "hraness-packed-next-adopter-smoke",
    private: true,
    scripts: { build: "node ./build.mjs" },
    type: "module",
  }, null, 2)}\n`);
  await run([process.execPath, "install", "--ignore-scripts"], consumer, environment);
  const nextManifest = JSON.parse(await readFile(resolve(consumer, "node_modules/next/package.json"), "utf8")) as { version?: unknown };
  assert.equal(nextManifest.version, NEXT_VERSION);
  const profile = stylexNextProfile(NEXT_VERSION);
  const creators = new Map<string, string>();
  for (const [path, expected] of [...Object.values(profile.frameworkInputs), profile.auxiliaryTraceCreator,
    profile.proxyRenameCreator, ...profile.emptyEntryInputs, ...profile.ssgInputs, ...Object.entries(profile.typeInputs)]) {
    assert.ok(creators.get(path) === undefined || creators.get(path) === expected, `Next ${NEXT_VERSION} has conflicting creator pins: ${path}`);
    creators.set(path, expected);
  }
  for (const [path, expected] of [...creators].sort(([left], [right]) => left.localeCompare(right))) {
    const absolute = resolve(consumer, "node_modules/next", path);
    assert.ok((await lstat(absolute)).isFile(), `Next ${NEXT_VERSION} creator is not an ordinary file: ${path}`);
    assert.equal(await realpath(absolute), absolute, `Next ${NEXT_VERSION} creator traverses a symlink: ${path}`);
    assert.equal(sha256(await readFile(absolute)), expected, `Next ${NEXT_VERSION} installed creator differs: ${path}`);
  }
  retainEvidence("inputs/next-creators.json", Buffer.from(JSON.stringify({ nextVersion: NEXT_VERSION, creators: [...creators].map(([path, sha256]) => ({ path, sha256 })) })));
  await retainOrdinaryEvidence(consumer, "package.json", "inputs/consumer-package.json");
  await retainOrdinaryEvidence(consumer, "bun.lock", "inputs/consumer-bun.lock");
  console.log(`Next ${NEXT_VERSION} verified ${String(creators.size)} exact installed creator identities before native compilation`);
  if (profile.rootParams) {
    await run([node, resolve(repository, "fixtures/next-adopter/root-params-writer-proof.mjs"),
      await realpath(resolve(consumer, "node_modules/next")), resolve(work, "root-params-writer-proof")], consumer, environment);
  }
  await cp(resolve(repository, "fixtures/next-adopter/app"), resolve(consumer, "app"), { recursive: true });
  await cp(resolve(repository, "fixtures/next-adopter/proxy.ts"), resolve(consumer, "proxy.ts"));
  await cp(resolve(repository, "fixtures/next-adopter/next.config.mjs"), resolve(consumer, "next.config.mjs"));
  await cp(resolve(repository, "fixtures/next-adopter/delegated-entry-proof.mjs"), resolve(consumer, "delegated-entry-proof.mjs"));
  await cp(resolve(repository, "fixtures/next-adopter/build.mjs"), resolve(consumer, "build.mjs"));
  await writeFile(resolve(consumer, "profile.mjs"), `export const nextVersion = ${JSON.stringify(NEXT_VERSION)};\n`, { flag: "wx" });
  await cp(resolve(repository, "fixtures/next-adopter/build-no-edge.mjs"), resolve(consumer, "build-no-edge.mjs"));
  await mkdir(resolve(consumer, "node_modules/@fixture"), { recursive: true });
  await cp(resolve(repository, "fixtures/next-adopter/theme-package"), resolve(consumer, "node_modules/@fixture/theme"), { recursive: true });
  await writeFile(resolve(consumer, "setup-theme.mjs"), themeSetup, { flag: "wx" });
  await run([node, "./setup-theme.mjs"], consumer, environment);
  await run([node, "./build.mjs"], consumer, environment);

  const attemptRoot = resolve(consumer, ".stylex-next/packed-next-adopter");
  for (const mode of ["discovery", "delivery"] as const) {
    const phase = resolve(attemptRoot, "typescript", mode);
    const before = object(JSON.parse(await readFile(resolve(phase, "before-webpack.json"), "utf8")) as unknown, "Next native type observation");
    assert.equal(before.nextVersion, NEXT_VERSION);
    assert.deepEqual(before.nativeInputs, profile.typeInputs);
    const inventory = object(JSON.parse(await readFile(resolve(phase, "types.json"), "utf8")) as unknown, "Next native type inventory");
    assert.equal(inventory.nextVersion, NEXT_VERSION);
    const distDir = mode === "delivery" ? ".next" : ".stylex-next/packed-next-adopter/next-discovery";
    assert.ok(Array.isArray(before.artifacts));
    const names = before.artifacts.map((value) => artifact(value, "Next native type input").path);
    for (const name of profile.requiredNativeTypeNames) assert.ok(names.includes(`${distDir}/types/${name}`));
    const rootParams = resolve(consumer, distDir, "types/root-params.d.ts");
    if (profile.rootParams) {
      const bytes = await readFile(rootParams);
      assert.equal(bytes.toString(), "// Type definitions for Next.js root params (next/root-params)\n// No root params detected.\nexport {}\n");
      const item = before.artifacts.map((value) => artifact(value, "Next native type input")).find(({ path }) => path === `${distDir}/types/root-params.d.ts`);
      assert.deepEqual(item, { path: `${distDir}/types/root-params.d.ts`, bytes: bytes.byteLength, sha256: sha256(bytes) });
    } else assert.ok(!names.some((path) => path.endsWith("/root-params.d.ts")));
  }
  const completePath = resolve(attemptRoot, "complete.json");
  const completeSource = await readFile(completePath);
  const complete = object(JSON.parse(exactUtf8(completeSource, "Next complete record")) as unknown, "Next complete record");
  assert.equal(complete.kind, "hraness-stylex-next-build");
  assert.equal(complete.nextVersion, NEXT_VERSION);
  assert.equal(complete.state, "complete");
  assert.equal(complete.attemptId, "packed-next-adopter");
  assert.equal(complete.outputDirectory, ".next");
  const discoveryIdentities = graphIdentities(complete.discovery, "Next complete discovery");
  const deliveryIdentities = graphIdentities(complete.delivery, "Next complete delivery");

  const planPath = resolve(attemptRoot, "plan.json");
  const planSource = await readFile(planPath);
  const plan = object(JSON.parse(exactUtf8(planSource, "Next attempt plan")) as unknown, "Next attempt plan");
  assert.equal(plan.nextVersion, NEXT_VERSION);
  assert.equal(plan.attemptId, complete.attemptId, "Next plan and complete record name different attempts");
  assert.equal(plan.outputDirectory, complete.outputDirectory, "Next plan and complete record name different outputs");
  const graphMap = object(plan.graphMap, "Next attempt graph map");
  exactKeys(graphMap, ["client", "edgeRsc", "nodeRsc"], "Next attempt graph map");
  const expectedGraphIds: Readonly<Record<NextTarget, unknown>> = {
    client: graphMap.client,
    "edge-rsc": graphMap.edgeRsc,
    "node-rsc": graphMap.nodeRsc,
  };
  assert.deepEqual(
    deliveryIdentities.map(({ graphId, target }) => ({ graphId, target })),
    NEXT_TARGETS.map((target) => ({ graphId: expectedGraphIds[target], target })),
    "Next delivery graph identities differ from the fresh plan",
  );
  assert.deepEqual(
    discoveryIdentities.map(({ graphId, target }) => ({ graphId, target })),
    deliveryIdentities.map(({ graphId, target }) => ({ graphId, target })),
    "Next discovery and delivery graph identities differ",
  );
  const requiredRecord = object(plan.requiredSources, "Next attempt required sources");
  exactKeys(requiredRecord, NEXT_TARGETS, "Next attempt required sources");
  const requiredSources = Object.fromEntries(NEXT_TARGETS.map((target) => [
    target,
    orderedLogicalPaths(requiredRecord[target], `Next attempt required sources ${target}`),
  ])) as Readonly<Record<NextTarget, readonly string[]>>;
  assert.deepEqual(requiredSources, FIXTURE_REQUIRED_SOURCES, "Next attempt changed the fixture's exact target source census");
  const physicalFixtureSources = [...(await filesBelow(resolve(consumer, "app")))
    .filter((path) => /\.tsx?$/u.test(path))
    .map((path) => `app/${path}`), "proxy.ts"].sort();
  assert.deepEqual(
    [...new Set(NEXT_TARGETS.flatMap((target) => requiredSources[target]))].sort(),
    physicalFixtureSources,
    "Next attempt omitted or invented a fixture-authored production source",
  );

  const postprocessingRecord = object(complete.postprocessing, "Next complete postprocessing");
  exactKeys(postprocessingRecord, ["delivery", "discovery"], "Next complete postprocessing");
  const deliveryPostprocessingArtifact = artifact(postprocessingRecord.delivery, "Next delivery postprocessing artifact");
  assert.equal(
    deliveryPostprocessingArtifact.path,
    ".stylex-next/packed-next-adopter/delivery/postprocessing.json",
    "Next delivery postprocessing artifact belongs to a different attempt or mode",
  );
  const deliveryPostprocessingSource = await readArtifact(consumer, deliveryPostprocessingArtifact, "Next delivery postprocessing artifact");
  const deliveryPostprocessing = object(
    JSON.parse(exactUtf8(deliveryPostprocessingSource, "Next delivery postprocessing receipt")) as unknown,
    "Next delivery postprocessing receipt",
  );
  assert.equal(deliveryPostprocessing.mode, "delivery");
  assert.equal(deliveryPostprocessing.nextVersion, NEXT_VERSION);
  assert.equal(deliveryPostprocessing.attemptId, complete.attemptId);
  assert.equal(deliveryPostprocessing.outputDirectory, complete.outputDirectory);
  assert.equal(deliveryPostprocessing.planSha256, sha256(planSource), "Next delivery postprocessing is not bound to the fresh plan bytes");
  assert.deepEqual(
    graphIdentities(deliveryPostprocessing.graphs, "Next delivery postprocessing graphs"),
    deliveryIdentities,
    "Next delivery postprocessing is not bound to the complete graph identities",
  );
  const discoveryPostprocessingArtifact = artifact(postprocessingRecord.discovery, "Next discovery postprocessing artifact");
  assert.equal(
    discoveryPostprocessingArtifact.path,
    ".stylex-next/packed-next-adopter/discovery/postprocessing.json",
    "Next discovery postprocessing artifact belongs to a different attempt or mode",
  );
  const discoveryPostprocessingSource = await readArtifact(consumer, discoveryPostprocessingArtifact, "Next discovery postprocessing artifact");
  const discoveryPostprocessing = object(
    JSON.parse(exactUtf8(discoveryPostprocessingSource, "Next discovery postprocessing receipt")) as unknown,
    "Next discovery postprocessing receipt",
  );
  assert.equal(discoveryPostprocessing.mode, "discovery");
  assert.equal(discoveryPostprocessing.nextVersion, NEXT_VERSION);
  assert.equal(discoveryPostprocessing.attemptId, complete.attemptId);
  const discoveryOutputDirectory = logicalPath(discoveryPostprocessing.outputDirectory, "Next discovery output directory");
  assert.equal(discoveryPostprocessing.planSha256, sha256(planSource), "Next discovery postprocessing is not bound to the fresh plan bytes");
  assert.deepEqual(
    graphIdentities(discoveryPostprocessing.graphs, "Next discovery postprocessing graphs"),
    discoveryIdentities,
    "Next discovery postprocessing is not bound to the complete graph identities",
  );
  for (const identity of discoveryIdentities) {
    const description = `Next discovery ${identity.target} graph receipt`;
    const graphPath = resolve(attemptRoot, "discovery", identity.target, "graph.json");
    const graphStat = await lstat(graphPath);
    assert.ok(graphStat.isFile() && !graphStat.isSymbolicLink(), `${description} must be an ordinary file`);
    assert.equal(await realpath(graphPath), graphPath, `${description} must not traverse a symlink`);
    const graphSource = await readFile(graphPath);
    assert.equal(sha256(graphSource), identity.receiptSha256, `${description} differs from complete.json`);
    const graph = object(JSON.parse(exactUtf8(graphSource, description)) as unknown, description);
    assert.equal(graph.nextVersion, NEXT_VERSION);
    assert.equal(graph.attemptId, complete.attemptId);
    assert.equal(graph.mode, "discovery");
    assert.equal(graph.target, identity.target);
    assert.equal(graph.graphId, identity.graphId);
    assert.equal(graph.outputDirectory, discoveryOutputDirectory);
    const modules = moduleIdentities(graph.modules, `Next discovery ${identity.target} modules`);
    assert.deepEqual(modules.map(({ path }) => path), requiredSources[identity.target], `Next discovery ${identity.target} graph differs from the planned source census`);
    assert.equal(graph.sourcesSha256, sha256(JSON.stringify(modules)), `Next discovery ${identity.target} source inventory hash is stale`);
    const outputs = orderedArtifacts(graph.outputs, `Next discovery ${identity.target} outputs`);
    const sourceMaps = orderedArtifacts(graph.sourceMaps, `Next discovery ${identity.target} source maps`);
    assert.deepEqual(
      sourceMaps,
      outputs.filter(({ path }) => path.endsWith(".map")),
      `Next discovery ${identity.target} graph does not bind its complete map inventory`,
    );
    orderedLogicalPaths(graph.javascriptChunks, `Next discovery ${identity.target} JavaScript chunks`);
    if (identity.target === "client") await assertDelegatedEntries(consumer, graph);
    if (identity.target === "node-rsc") await assertNodeProxyTrace(consumer, graph, discoveryPostprocessing);
  }

  const outputFiles = await filesBelow(resolve(consumer, ".next"));
  assert.ok(
    outputFiles.includes("server/app/index/[manifestProof]/page_client-reference-manifest.js"),
    "Next must retain the working dynamic /index route client-reference manifest identity",
  );
  assert.ok(
    !outputFiles.includes("server/app/index/index/[manifestProof]/page_client-reference-manifest.js"),
    "Next must not receive a copied or doubled alias for the dynamic /index route manifest",
  );
  const indexManifest = await readFile(
    resolve(consumer, ".next/server/app/index/[manifestProof]/page_client-reference-manifest.js"),
    "utf8",
  );
  assert.ok(
    indexManifest.includes(JSON.stringify("/index/[manifestProof]/page")),
    "Next dynamic /index manifest lost its exact route identity",
  );
  const mapFiles = outputFiles.filter((path) => path.endsWith(".map"));
  assert.ok(mapFiles.length > 0, "Next delivery must retain output source maps");
  const outputRoot = resolve(consumer, ".next");
  const receiptMapArtifacts = new Map<string, Artifact>();
  const mappedSourcesByTarget = new Map<NextTarget, NextSourceMapEntry[]>(
    NEXT_TARGETS.map((target) => [target, []]),
  );
  let globalErrorStylesheet: Artifact | undefined;
  for (const identity of deliveryIdentities) {
    const graphPath = resolve(attemptRoot, "delivery", identity.target, "graph.json");
    const graphStat = await lstat(graphPath);
    assert.ok(graphStat.isFile() && !graphStat.isSymbolicLink(), `Next ${identity.target} graph receipt must be an ordinary file`);
    assert.equal(await realpath(graphPath), graphPath, `Next ${identity.target} graph receipt must not traverse a symlink`);
    const graphSource = await readFile(graphPath);
    assert.equal(sha256(graphSource), identity.receiptSha256, `Next ${identity.target} graph receipt differs from complete.json`);
    const graph = object(JSON.parse(exactUtf8(graphSource, `Next ${identity.target} graph receipt`)) as unknown, `Next ${identity.target} graph receipt`);
    assert.equal(graph.nextVersion, NEXT_VERSION);
    assert.equal(graph.attemptId, complete.attemptId);
    assert.equal(graph.mode, "delivery");
    assert.equal(graph.target, identity.target);
    assert.equal(graph.graphId, identity.graphId);
    assert.equal(graph.outputDirectory, complete.outputDirectory);
    const modules = moduleIdentities(graph.modules, `Next ${identity.target} modules`);
    assert.deepEqual(modules.map(({ path }) => path), requiredSources[identity.target], `Next ${identity.target} graph differs from the planned source census`);
    assert.equal(graph.sourcesSha256, sha256(JSON.stringify(modules)), `Next ${identity.target} source inventory hash is stale`);
    const outputs = orderedArtifacts(graph.outputs, `Next ${identity.target} outputs`);
    const proxyOutput = identity.target === "node-rsc" ? await assertNodeProxyTrace(consumer, graph, deliveryPostprocessing) : undefined;
    if (identity.target === "client") {
      await assertDelegatedEntries(consumer, graph);
      assert.ok(Array.isArray(graph.entrypoints) && graph.entrypoints.length > 0 && graph.entrypoints.length <= 4096, "Next client entrypoints must be a nonempty bounded array");
      const entrypoints = graph.entrypoints.map((value, index) => object(value, `Next client entrypoint ${String(index)}`));
      const owners = entrypoints.filter(({ name }) => name === "app/global-error");
      assert.equal(owners.length, 1, "Next client graph must contain exactly one global-error owner");
      const owner = owners[0]!;
      const stylesheets = orderedLogicalPaths(owner.stylexCss, "Next global-error StyleX stylesheets");
      assert.equal(stylesheets.length, 1, "Next global-error must own exactly one finalized StyleX stylesheet");
      const stylesheetPath = stylesheets[0]!;
      assert.match(stylesheetPath, /^static\/css\/[a-zA-Z0-9_-]+\.css$/u, "Next global-error stylesheet must be an ordinary static CSS asset");
      assert.ok(orderedLogicalPaths(owner.css, "Next global-error CSS").includes(stylesheetPath), "Next global-error CSS inventory omitted its StyleX stylesheet");
      assert.ok(orderedLogicalPaths(owner.files, "Next global-error files").includes(stylesheetPath), "Next global-error file inventory omitted its StyleX stylesheet");
      globalErrorStylesheet = outputs.find(({ path }) => path === stylesheetPath);
      assert.ok(globalErrorStylesheet !== undefined, "Next global-error stylesheet is not bound to the client output artifacts");
      await readArtifact(outputRoot, globalErrorStylesheet, "Next global-error stylesheet");
    }
    const sourceMaps = orderedArtifacts(graph.sourceMaps, `Next ${identity.target} source maps`);
    assert.deepEqual(
      sourceMaps,
      outputs.filter(({ path }) => path.endsWith(".map")),
      `Next ${identity.target} graph does not bind its complete map inventory`,
    );
    const javascriptChunks = orderedLogicalPaths(graph.javascriptChunks, `Next ${identity.target} JavaScript chunks`);
    for (const sourceMap of sourceMaps) {
      const prior = receiptMapArtifacts.get(sourceMap.path);
      if (prior === undefined) receiptMapArtifacts.set(sourceMap.path, sourceMap);
      else assert.deepEqual(sourceMap, prior, `Next delivery graphs disagree about source map ${sourceMap.path}`);
      const outputPath = sourceMap.path.slice(0, -".map".length);
      const outputArtifact = outputs.find(({ path }) => path === outputPath);
      assert.ok(outputArtifact !== undefined, `Next source map ${sourceMap.path} has no same-graph output owner`);
      const [mapSource, outputSource] = await Promise.all([
        readArtifact(outputRoot, sourceMap, `Next source map ${sourceMap.path}`),
        readArtifact(outputRoot, outputPath === "server/proxy.js" ? proxyOutput! : outputArtifact, `Next mapped output ${outputPath}`),
      ]);
      const outputText = exactUtf8(outputSource, `Next mapped output ${outputPath}`);
      assertNextSourceMapOutputLink(outputText, outputPath, sourceMap.path);
      const entries = nextSourceMapEntries(
        JSON.parse(exactUtf8(mapSource, `Next source map ${sourceMap.path}`)) as unknown,
        `Next ${identity.target} source map ${sourceMap.path}`,
        FIXTURE_AUTHORED_SOURCES,
        outputPath,
      );
      if (javascriptChunks.includes(outputPath)) mappedSourcesByTarget.get(identity.target)!.push(...entries);
    }
  }
  assert.ok(globalErrorStylesheet !== undefined, "Next delivery omitted the global-error stylesheet artifact");
  assert.deepEqual(
    [...receiptMapArtifacts.keys()].sort(),
    mapFiles,
    "Next delivery graph receipts do not own the complete physical source-map census",
  );
  for (const target of NEXT_TARGETS) {
    for (const source of requiredSources[target]) {
      assertNextAuthoredSourceEmbedding(
        mappedSourcesByTarget.get(target)!,
        source,
        await readFile(resolve(consumer, source), "utf8"),
      );
    }
  }
  const fontFiles = outputFiles.filter((path) => path.endsWith(".woff2"));
  assert.equal(fontFiles.length, 1, "Next delivery must emit exactly the registered fixture font URL asset");
  assert.equal(
    sha256(await readFile(resolve(consumer, ".next", fontFiles[0]!))),
    sha256(Buffer.alloc(70_000, 17)),
    "Next emitted font URL asset bytes differ from the registered fixture",
  );
  const cssFiles = outputFiles.filter((path) => path.endsWith(".css"));
  assert.ok(cssFiles.length > 0, "Next delivery must emit CSS assets");
  const css = (await Promise.all(cssFiles.map((path) => readFile(resolve(consumer, ".next", path), "utf8")))).join("\n");
  for (const value of ["13px", "17px", "19px", "23px", "29px", "31px"]) assert.ok(css.includes(value), `Next CSS union omitted ${value}`);
  assert.ok(
    css.includes(fontFiles[0]!.split("/").at(-1)!),
    "Next CSS does not link the exact emitted font URL asset",
  );

  const server = Bun.spawn([node, "./node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: consumer,
    env: environment,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(server.stdout).text();
  const stderr = new Response(server.stderr).text();
  try {
    const base = `http://127.0.0.1:${String(PORT)}`;
    await waitForServer(base, server);
    for (const path of ["/", "/edge", "/index/manifest-proof"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-stylex-node-proxy"), path, "The registered Node proxy must preserve the request path");
      const csp = response.headers.get("content-security-policy") ?? "";
      assert.match(csp, /style-src 'self'(?:;|$)/u);
      assert.doesNotMatch(csp, /style-src[^;]*'unsafe-inline'/u);
      assert.doesNotMatch(await response.text(), /<style(?:\s|>)/iu, "Next response must not use inline style elements");
    }
    const browserExecutable = await resolveFirstBrowserExecutable(
      [
        ...(process.env.CHROMIUM_EXECUTABLE_PATH === undefined ? [] : [process.env.CHROMIUM_EXECUTABLE_PATH]),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        chromium.executablePath(),
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ],
      "No ordinary Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH to run the packed Next browser smoke.",
    );
    const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: browserExecutable, headless: true });
    try {
      const page = await browser.newPage();
      const hydrationDiagnostics: Readonly<{ kind: string; detail: string }>[] = [];
      let hydrationRuntimeFailed = false;
      const recordHydrationDiagnostic = (kind: string, detail: string): void => {
        if (hydrationDiagnostics.length < 100) hydrationDiagnostics.push({ kind, detail: detail.slice(0, 2_000) });
      };
      page.on("pageerror", (error) => {
        hydrationRuntimeFailed = true;
        recordHydrationDiagnostic("pageerror", error.stack ?? error.message);
      });
      page.on("requestfailed", (request) => recordHydrationDiagnostic("requestfailed", `${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") recordHydrationDiagnostic(message.type(), message.text());
      });
      try {
        const response = await page.goto(base, { waitUntil: "networkidle" });
        assert.equal(response?.headers()["x-stylex-node-proxy"], "/", "The browser document must pass through the compiled Node proxy");
        await page.locator('[data-next-hydrated="true"]').waitFor();
        await page.locator('[data-next-lazy="ready"]').waitFor();
      } catch (error) {
        const capture = page.evaluate(() => ({
          readyState: document.readyState,
          sentinels: [...document.querySelectorAll("[data-next-client], [data-next-lazy], [data-next-global-error]")]
            .slice(0, 10).map((element) => ({
              markup: element.outerHTML.slice(0, 2_000),
              display: getComputedStyle(element).display,
              visibility: getComputedStyle(element).visibility,
              rect: element.getBoundingClientRect().toJSON(),
            })),
          scripts: [...document.scripts].slice(0, 100).map((script) => script.src).filter(Boolean),
        })).catch((captureError: unknown) => ({ captureError: String(captureError) }));
        let captureTimeout: ReturnType<typeof setTimeout> | undefined;
        let dom: unknown;
        try {
          dom = await Promise.race([
            capture,
            new Promise((resolveCapture) => {
              captureTimeout = setTimeout(() => resolveCapture({ captureError: "DOM capture exceeded 5 seconds" }), 5_000);
            }),
          ]);
        } finally {
          if (captureTimeout !== undefined) clearTimeout(captureTimeout);
        }
        throw new Error(`Next hydration proof failed: ${JSON.stringify({ runtimeFailed: hydrationRuntimeFailed, diagnostics: hydrationDiagnostics, dom })}`, { cause: error });
      }
      assert.equal(hydrationRuntimeFailed, false, `Next hydration reported browser runtime errors: ${JSON.stringify(hydrationDiagnostics)}`);
      const evidence = await page.evaluate(() => {
        const node = document.querySelector<HTMLElement>("[data-next-node-rsc]");
        const client = document.querySelector<HTMLElement>("[data-next-client]");
        const lazy = document.querySelector<HTMLElement>('[data-next-lazy="ready"]');
        if (node === null || client === null || lazy === null) throw new Error("Next hydration proof is incomplete");
        return {
          client: getComputedStyle(client).scrollMarginBottom,
          lazy: getComputedStyle(lazy).scrollPaddingInlineStart,
          node: getComputedStyle(node).outlineOffset,
          theme: getComputedStyle(node).paddingBlockEnd,
        };
      });
      assert.deepEqual(evidence, { client: "17px", lazy: "19px", node: "13px", theme: "31px" });
      browserOutcomes.push({ kind: "root-hydration", ...evidence });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${base}/delegated-one`, { waitUntil: "networkidle" });
      for (const instance of ["one", "two"]) {
        assert.equal(await page.locator("[data-next-delegated]").getAttribute("data-next-delegated"), instance);
        await page.waitForFunction(() => {
          const main = document.querySelector<HTMLElement>("[data-next-delegated]");
          return main !== null && parseFloat(main.style.getPropertyValue("--history-header-offset")) > 0 && parseFloat(main.style.getPropertyValue("--history-filter-stack-offset")) > 0;
        });
        assert.equal(await page.locator(".history-measure-controls svg").count(), 3, "Delegated mapped icon subtree did not render");
        const valuation = page.locator('[aria-controls="history-measure-valuation"]');
        await valuation.click();
        await page.waitForFunction(() => {
          const rail = document.querySelector<HTMLElement>(".history-measure-rail");
          const card = document.querySelector<HTMLElement>("#history-measure-valuation");
          return rail !== null && card !== null && rail.scrollLeft > 0 && Math.abs(rail.scrollLeft - card.offsetLeft) <= 1 && document.querySelector('[aria-controls="history-measure-valuation"]')?.getAttribute("aria-pressed") === "true";
        });
        assert.equal(await valuation.evaluate((element) => element.getBoundingClientRect().height >= 48), true, "Delegated shared stylesheet did not reach the real control");
        browserOutcomes.push({ kind: "delegated-scroll", instance, ...await valuation.evaluate((element) => ({ pressed: element.getAttribute("aria-pressed"), height: element.getBoundingClientRect().height, scrollLeft: document.querySelector<HTMLElement>(".history-measure-rail")?.scrollLeft, targetOffset: document.querySelector<HTMLElement>("#history-measure-valuation")?.offsetLeft, icons: document.querySelectorAll(".history-measure-controls svg").length })) });
        const resizeOutcomes = [];
        for (const width of [390, 900]) {
          await page.setViewportSize({ width, height: 780 });
          await page.waitForFunction(() => {
            const main = document.querySelector<HTMLElement>("[data-next-delegated]");
            const header = main?.querySelector<HTMLElement>(".stripe-history-header");
            const filters = main?.querySelector<HTMLElement>(".history-filters");
            if (main === null || header == null || filters == null) return false;
            const headerHeight = header.getBoundingClientRect().height;
            return Math.abs(parseFloat(main.style.getPropertyValue("--history-header-offset")) - headerHeight) < 0.1 && Math.abs(parseFloat(main.style.getPropertyValue("--history-filter-stack-offset")) - headerHeight - filters.getBoundingClientRect().height) < 0.1;
          });
          resizeOutcomes.push(await page.locator("[data-next-delegated]").evaluate((element) => ({ width: innerWidth, headerOffset: element.style.getPropertyValue("--history-header-offset"), stackOffset: element.style.getPropertyValue("--history-filter-stack-offset"), headerHeight: element.querySelector(".stripe-history-header")!.getBoundingClientRect().height, filterHeight: element.querySelector(".history-filters")!.getBoundingClientRect().height })));
        }
        browserOutcomes.push({ kind: "delegated-resize", instance, measurements: resizeOutcomes });
        const oldMain = await page.locator("[data-next-delegated]").elementHandle();
        assert.ok(oldMain !== null);
        const next = instance === "one" ? "two" : "one";
        await page.getByRole("link", { name: "Second shared history route" }).click();
        await page.waitForURL(`${base}/delegated-${next}`);
        await page.locator(`[data-next-delegated="${next}"]`).waitFor();
        const cleanup = await oldMain.evaluate((element) => ({ connected: element.isConnected, header: element.style.getPropertyValue("--history-header-offset"), stack: element.style.getPropertyValue("--history-filter-stack-offset") }));
        assert.deepEqual(cleanup, { connected: false, header: "", stack: "" }, "Delegated route cleanup must detach the prior main and remove its observed offsets");
        browserOutcomes.push({ kind: "delegated-route-cleanup", instance, next, ...cleanup });
        await oldMain.dispose();
      }
      assert.equal(hydrationRuntimeFailed, false, `Next delegated hydration reported runtime errors: ${JSON.stringify(hydrationDiagnostics)}`);
      await page.goto(`${base}/edge`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("[data-next-edge-rsc]").evaluate((element) => getComputedStyle(element).marginInlineEnd), "29px");
      await page.goto(`${base}/index/manifest-proof`, { waitUntil: "networkidle" });
      assert.equal(
        await page.locator('[data-next-index-manifest="true"]').evaluate((element) => getComputedStyle(element).borderBlockEndWidth),
        "31px",
        "Next /index route did not receive its compiled StyleX rule",
      );
      const globalErrorPage = await browser.newPage({
        extraHTTPHeaders: { "x-stylex-global-error-proof": "true" },
      });
      try {
        const stylesheetUrl = new URL(`/_next/${globalErrorStylesheet.path}`, base).href;
        const [stylesheetResponse] = await Promise.all([
          globalErrorPage.waitForResponse((response) => response.url() === stylesheetUrl),
          globalErrorPage.goto(`${base}/global-error-proof`, { waitUntil: "networkidle" }),
        ]);
        assert.equal(stylesheetResponse.status(), 200, "Next global-error stylesheet request failed");
        assert.match(stylesheetResponse.headers()["content-type"] ?? "", /^text\/css(?:;|$)/iu, "Next global-error stylesheet response is not CSS");
        const stylesheetBytes = await stylesheetResponse.body();
        assert.deepEqual(
          { bytes: stylesheetBytes.byteLength, sha256: sha256(stylesheetBytes) },
          { bytes: globalErrorStylesheet.bytes, sha256: globalErrorStylesheet.sha256 },
          "Next global-error browser stylesheet differs from its exact graph-bound artifact",
        );
        const globalError = globalErrorPage.locator('[data-next-global-error="true"]');
        await globalError.waitFor();
        const globalErrorEvidence = await globalError.evaluate((element, expectedHref) => {
          const expected = new URL(expectedHref);
          if (expected.origin !== location.origin || expected.search !== "" || expected.hash !== "") {
            throw new Error("Next global-error stylesheet must have one exact same-origin URL");
          }
          const sameResource = (href: string): boolean => {
            const candidate = new URL(href, document.baseURI);
            return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
          };
          const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
            .filter((link) => sameResource(link.href));
          const sheets = [...document.styleSheets]
            .filter((sheet) => sheet.href !== null && sameResource(sheet.href));
          if (links.length !== 1 || sheets.length !== 1) {
            throw new Error("Next global-error stylesheet is absent, duplicated, or aliased");
          }
          const link = links[0]!;
          const sheet = sheets[0]!;
          if (
            link.href !== expected.href || sheet.href !== expected.href
            || link.sheet !== sheet || sheet.ownerNode !== link || sheet.ownerRule !== null
            || link.disabled || sheet.disabled || link.relList.contains("alternate")
            || link.media !== "" || sheet.media.mediaText !== "" || sheet.cssRules.length === 0
          ) {
            throw new Error("Next global-error stylesheet is not the ordinary loaded graph-bound stylesheet");
          }
          if (element.hasAttribute("style")) throw new Error("Next global-error sentinel must not use inline styles");
          const readBorder = () => {
            const computed = getComputedStyle(element);
            return { style: computed.borderBlockStartStyle, width: computed.borderBlockStartWidth };
          };
          const before = readBorder();
          if (before.style !== "solid" || before.width !== "23px") {
            throw new Error(`Next global-error compiled border is missing: ${JSON.stringify(before)}`);
          }
          let disabled: Readonly<{ style: string; width: string }> | undefined;
          try {
            sheet.disabled = true;
            if (!sheet.disabled) throw new Error("Next global-error stylesheet negative control did not disable its target");
            disabled = readBorder();
          } finally {
            sheet.disabled = false;
          }
          if (sheet.disabled) throw new Error("Next global-error stylesheet negative control did not restore its target");
          return { before, disabled, restored: readBorder() };
        }, stylesheetUrl);
        assert.deepEqual(
          globalErrorEvidence,
          {
            before: { style: "solid", width: "23px" },
            disabled: { style: "none", width: "0px" },
            restored: { style: "solid", width: "23px" },
          },
          "Next global-error border must depend only on its loaded graph-bound StyleX stylesheet",
        );
        browserOutcomes.push({ kind: "global-error-stylesheet-negative", ...globalErrorEvidence });
      } finally {
        await globalErrorPage.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
    await Promise.race([server.exited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
    await server.exited;
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
    if (stdoutText.length > 0) process.stdout.write(stdoutText);
    if (stderrText.length > 0) process.stderr.write(stderrText);
  }
  assert.match(sha256(await readFile(completePath)), /^[a-f0-9]{64}$/u);

  await rm(resolve(consumer, "app/edge"), { recursive: true });
  await run([node, "./build-no-edge.mjs"], consumer, environment);
  const noEdgeAttempt = resolve(consumer, ".stylex-next/packed-next-adopter-no-edge");
  const noEdgePlan = JSON.parse(await readFile(resolve(noEdgeAttempt, "plan.json"), "utf8")) as {
    nextVersion?: unknown;
    requiredSources?: Record<string, unknown>;
  };
  assert.equal(noEdgePlan.nextVersion, NEXT_VERSION);
  assert.deepEqual(noEdgePlan.requiredSources?.["edge-rsc"], []);
  const noEdgeComplete = JSON.parse(await readFile(resolve(noEdgeAttempt, "complete.json"), "utf8")) as {
    delivery?: { target?: unknown }[];
    discovery?: { target?: unknown }[];
    state?: unknown;
    nextVersion?: unknown;
  };
  assert.equal(noEdgeComplete.state, "complete");
  assert.equal(noEdgeComplete.nextVersion, NEXT_VERSION);
  assert.deepEqual(noEdgeComplete.discovery?.map(({ target }) => target), ["client", "edge-rsc", "node-rsc"]);
  assert.deepEqual(noEdgeComplete.delivery?.map(({ target }) => target), ["client", "edge-rsc", "node-rsc"]);
  for (const mode of ["discovery", "delivery"] as const) {
    const clientGraph = object(JSON.parse(await readFile(resolve(noEdgeAttempt, mode, "client/graph.json"), "utf8")) as unknown, "Next no-edge client graph");
    await assertDelegatedEntries(consumer, clientGraph);
    const nodeGraph = object(JSON.parse(await readFile(resolve(noEdgeAttempt, mode, "node-rsc/graph.json"), "utf8")) as unknown, "Next no-edge Node graph");
    const postprocessing = object(JSON.parse(await readFile(resolve(noEdgeAttempt, mode, "postprocessing.json"), "utf8")) as unknown, "Next no-edge postprocessing");
    await assertNodeProxyTrace(consumer, nodeGraph, postprocessing);
    const graph = JSON.parse(await readFile(resolve(noEdgeAttempt, mode, "edge-rsc/graph.json"), "utf8")) as {
      entrypoints?: unknown[];
      modules?: unknown[];
      sourcesSha256?: unknown;
      target?: unknown;
    };
    assert.equal(graph.target, "edge-rsc");
    assert.deepEqual(graph.modules, []);
    assert.deepEqual(graph.entrypoints, []);
    assert.equal(graph.sourcesSha256, sha256("[]"));
  }
  for (const attempt of ["packed-next-adopter", "packed-next-adopter-no-edge"]) {
    for (const file of ["plan.json", "complete.json", ...["discovery", "delivery"].flatMap((mode) => [`${mode}/postprocessing.json`, ...NEXT_TARGETS.map((target) => `${mode}/${target}/graph.json`)])]) {
      await retainOrdinaryEvidence(consumer, `.stylex-next/${attempt}/${file}`, `${attempt}/receipts/${file}`);
    }
  }
  successful = true;
  console.log(`Packed Next ${NEXT_VERSION} client, Node RSC, edge RSC, registered Node proxy trace and request headers, exact target/output source-map receipts, two independently observed delegated entries with mapped owner joins and working scroll/resize/icon hydration, explicit no-edge graph, dynamic /index route, lazy, exercised global-error, package union, font-URL asset linkage, CSP, and hydration proof passed`);
} finally {
  if (successful) {
    await rm(work, { force: true, recursive: true });
    await writeRetainedEvidence(fixtureRoot);
  }
  else process.stderr.write(`Retained failed Next adopter fixture: ${work}\n`);
}
