import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import type * as TypeScript from "typescript";

import { canonicalJson, normalizeLogicalPath } from "./compiler.js";
import {
  STYLEX_NEXT_REQUIRED_VERSION,
  STYLEX_NEXT_TARGETS,
  graphIdForStylexNextTarget,
  validateStylexNextGraphReceipt,
  validateStylexNextModuleReceipt,
  type StylexNextProductionMode,
} from "./next-contracts.js";
import {
  readStylexNextTypeScriptGraphReceipts,
  validateStylexNextAttemptPlan,
  type StylexNextAttemptHandle,
} from "./next-generation.js";

// The phase boundary below is immediately after these native writers and before
// webpack. A filename or a generated-looking comment alone never owns a type.
const NATIVE_INPUTS = {
  "dist/build/index.js": "52cb337f5b0037a81ff0452cfbeb55760d3eafd026a5d5dc5f1c6cc5c4fe35c4",
  "dist/build/webpack/plugins/next-types-plugin/index.js": "13423b82cc011e96aa60b086b3e48ed8e74773d87b7a8748ae99de844abd5eb8",
  "dist/lib/typescript/writeConfigurationDefaults.js": "a634ad2820c47afd37f26382bc1986ca6895cf8cb251d2023889893674d3704d",
  "dist/lib/typescript/writeAppTypeDeclarations.js": "bfaa647d1011ff22f39fac8f8bfdaac4637afe784826ec56f6fb53a757d5baeb",
  "dist/server/lib/router-utils/route-types-utils.js": "d3a25af9b04fa6551d3961f88d4899d69c4cf0144262822ac1c8890f6ee11098",
  "dist/server/lib/router-utils/typegen.js": "5671ce0ea3fc6fc5fdc0fe7d2a98bf8cd77aff67b0d101375973dbc47a06d447",
  "dist/server/lib/router-utils/cache-life-type-utils.js": "81d55d26cd176ebb6e81e864e8acef656ad1d601802c839e8e32aa5053bf2caa",
} as const;

type Artifact = Readonly<{ path: string; bytes: number; sha256: string }>;
type Snapshot = Readonly<{ source: string | null; mode: number | null }>;
type Lifecycle = Readonly<{
  attemptDirectory: string;
  defaultSeed: Artifact;
  nextEnv: Snapshot;
  planSha256: string;
}>;
type Projection = Readonly<{
  authoredConfig: string;
  authoredConfigExisted: boolean;
  configFiles: readonly Artifact[];
  distDir: string;
  expectedNextEnv: string;
  planSha256: string;
  projectedConfig: Artifact;
  seed: Artifact | null;
  sourceFiles: readonly string[];
  stateDirectory: string;
}>;
type TypeInventory = Readonly<{
  artifacts: readonly Artifact[];
  distDir: string;
  kind: "hraness-next-generated-types";
  mode: StylexNextProductionMode;
  nextVersion: typeof STYLEX_NEXT_REQUIRED_VERSION;
  planSha256: string;
  schemaVersion: 1;
}>;
export type StylexNextTypeScriptLifecycle = Readonly<{
  attempt: StylexNextAttemptHandle;
  lockSource: string;
  root: string;
}>;

const LOCK_NAME = ".hraness-stylex-next-typescript.lock";

function hash(source: Uint8Array | string): string {
  return createHash("sha256").update(source).digest("hex");
}

function compareArtifacts(left: Artifact, right: Artifact): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function record(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], description: string): void {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${description} has unknown or missing keys`);
}

function string(value: unknown, description: string): string {
  assert.equal(typeof value, "string", `${description} must be a string`);
  return value as string;
}

function inputPath(value: unknown): string {
  const path = string(value, "TypeScript input path");
  assert.ok(path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0"), "TypeScript input path must be relative");
  return path;
}

function logical(root: string, path: string): string {
  return inputPath(relative(root, resolve(path)).split(sep).join("/"));
}

function ordinary(path: string): Buffer {
  const value = lstatSync(path);
  assert.ok(value.isFile() && !value.isSymbolicLink(), `TypeScript input must be an ordinary file: ${path}`);
  assert.ok(value.size <= 128 * 1024 * 1024, `TypeScript input exceeds the bounded file limit: ${path}`);
  assert.equal(realpathSync(path), resolve(path), `TypeScript input must not traverse a symlink: ${path}`);
  return readFileSync(path);
}

function artifact(root: string, path: string): Artifact {
  const source = ordinary(path);
  return { path: logical(root, path), bytes: source.byteLength, sha256: hash(source) };
}

function parseArtifact(value: unknown): Artifact {
  const item = record(value, "TypeScript artifact");
  exactKeys(item, ["path", "bytes", "sha256"], "TypeScript artifact");
  assert.ok(Number.isSafeInteger(item.bytes) && (item.bytes as number) >= 0, "TypeScript artifact size is invalid");
  assert.match(string(item.sha256, "TypeScript artifact hash"), /^[a-f0-9]{64}$/u);
  return { path: inputPath(item.path), bytes: item.bytes as number, sha256: item.sha256 as string };
}

function artifacts(value: unknown): readonly Artifact[] {
  assert.ok(Array.isArray(value) && value.length <= 100_000, "TypeScript artifact list is invalid or unbounded");
  const result = value.map(parseArtifact);
  assert.deepEqual(result.map(({ path }) => path), [...new Set(result.map(({ path }) => path))].sort(), "TypeScript artifacts must be unique and ordered");
  return result;
}

/** Generated paths never inherit TypeScript's legitimate ../ config semantics. */
function generatedArtifact(value: unknown): Artifact {
  const file = parseArtifact(value);
  return { ...file, path: normalizeLogicalPath(file.path, "Generated TypeScript artifact path") };
}

function generatedArtifacts(value: unknown): readonly Artifact[] {
  return artifacts(value).map(generatedArtifact);
}

function verifyArtifact(root: string, expected: Artifact): void {
  assert.deepEqual(artifact(root, resolve(root, expected.path)), expected, `TypeScript input changed: ${expected.path}`);
}

function canonical(path: string, value: unknown): void {
  const source = `${canonicalJson(value)}\n`;
  try {
    writeFileSync(path, source, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    assert.equal(ordinary(path).toString(), source, `TypeScript phase record collision: ${path}`);
  }
}

function json(path: string): unknown {
  const source = ordinary(path).toString();
  const result: unknown = JSON.parse(source);
  assert.equal(source, `${canonicalJson(result)}\n`, `TypeScript record is not canonical: ${path}`);
  return result;
}

function directory(path: string): void {
  const missing: string[] = [];
  let parent = resolve(path);
  while (!existsSync(parent)) {
    missing.unshift(parent);
    parent = dirname(parent);
  }
  for (const current of [parent, ...missing]) {
    if (current !== parent) mkdirSync(current, { mode: 0o755 });
    assert.ok(lstatSync(current).isDirectory() && !lstatSync(current).isSymbolicLink(), "TypeScript phase directory must be ordinary");
    assert.equal(realpathSync(current), current, "TypeScript phase directory must not traverse a symlink");
  }
}

function lifecycleDirectory(attempt: StylexNextAttemptHandle): string {
  return join(attempt.directory, "typescript");
}

function phaseDirectory(attempt: StylexNextAttemptHandle, mode: StylexNextProductionMode): string {
  return join(lifecycleDirectory(attempt), mode);
}

function snapshot(path: string): Snapshot {
  if (!existsSync(path)) return { source: null, mode: null };
  return { source: ordinary(path).toString(), mode: lstatSync(path).mode & 0o777 };
}

function parseSnapshot(value: unknown): Snapshot {
  const item = record(value, "Next environment snapshot");
  exactKeys(item, ["source", "mode"], "Next environment snapshot");
  assert.ok(item.source === null || typeof item.source === "string");
  assert.ok(item.mode === null || (Number.isSafeInteger(item.mode) && (item.mode as number) >= 0 && (item.mode as number) <= 0o777));
  assert.equal(item.source === null, item.mode === null);
  return item as Snapshot;
}

function loadLifecycle(root: string, attempt: StylexNextAttemptHandle): Lifecycle {
  assert.equal(realpathSync(root), root, "TypeScript lifecycle requires the physical project root");
  const attemptPath = normalizeLogicalPath(logical(root, attempt.directory), "TypeScript attempt directory");
  assert.equal(hash(ordinary(join(attempt.directory, "plan.json"))), attempt.planSha256, "TypeScript lifecycle plan changed");
  const lockSource = `${canonicalJson({ attemptDirectory: attemptPath, planSha256: attempt.planSha256 })}\n`;
  assert.equal(ordinary(join(root, LOCK_NAME)).toString(), lockSource, "TypeScript lifecycle has no matching project-root owner");
  const item = record(json(join(lifecycleDirectory(attempt), "lifecycle.json")), "TypeScript lifecycle");
  exactKeys(item, ["attemptDirectory", "defaultSeed", "nextEnv", "planSha256"], "TypeScript lifecycle");
  assert.equal(item.attemptDirectory, attemptPath);
  assert.equal(item.planSha256, attempt.planSha256);
  const result: Lifecycle = {
    attemptDirectory: attemptPath,
    defaultSeed: parseArtifact(item.defaultSeed),
    nextEnv: parseSnapshot(item.nextEnv),
    planSha256: attempt.planSha256,
  };
  assert.equal(result.defaultSeed.path, logical(root, join(lifecycleDirectory(attempt), "default-seed.json")), "TypeScript seed escaped its owning attempt");
  verifyArtifact(root, result.defaultSeed);
  return result;
}

function installed(root: string): Readonly<{ require: NodeJS.Require; ts: typeof TypeScript }> {
  const require = createRequire(join(root, "package.json"));
  const packagePath = require.resolve("next/package.json");
  const manifest = record(JSON.parse(ordinary(realpathSync(packagePath)).toString()) as unknown, "Installed Next package");
  assert.equal(manifest.name, "next");
  assert.equal(manifest.version, STYLEX_NEXT_REQUIRED_VERSION);
  const nextRoot = dirname(realpathSync(packagePath));
  for (const [path, expected] of Object.entries(NATIVE_INPUTS)) {
    assert.equal(hash(ordinary(join(nextRoot, path))), expected, `Next TypeScript producer changed: ${path}`);
  }
  const ts = require("typescript") as typeof TypeScript;
  assert.ok(typeof ts.getParsedCommandLineOfConfigFile === "function" && typeof ts.version === "string", "Next TypeScript lifecycle requires the installed TypeScript API");
  assert.equal(ts.version, "6.0.3", "StyleX Next requires exactly TypeScript 6.0.3");
  return { require, ts };
}

/** The root lease protects next-env.d.ts even when output/state directories differ. */
export async function beginStylexNextTypeScriptLifecycle(
  root: string,
  attempt: StylexNextAttemptHandle,
  outputDirectory: string,
): Promise<StylexNextTypeScriptLifecycle> {
  assert.equal(realpathSync(root), root, "TypeScript lifecycle requires the physical project root");
  const attemptDirectory = normalizeLogicalPath(logical(root, attempt.directory), "TypeScript attempt directory");
  assert.equal(hash(ordinary(join(attempt.directory, "plan.json"))), attempt.planSha256);
  const lockSource = `${canonicalJson({ attemptDirectory, planSha256: attempt.planSha256 })}\n`;
  writeFileSync(join(root, LOCK_NAME), lockSource, { flag: "wx", mode: 0o644 });
  try {
    const nextEnv = snapshot(join(root, "next-env.d.ts"));
    const { require, ts } = installed(root);
    directory(lifecycleDirectory(attempt));
    const seed = join(lifecycleDirectory(attempt), "default-seed.json");
    writeFileSync(seed, "{}\n", { flag: "wx", mode: 0o644 });
    const native = require("next/dist/lib/typescript/writeConfigurationDefaults") as Readonly<{
      writeConfigurationDefaults(version: string, path: string, first: boolean, app: boolean, dist: string, pages: boolean, strict: boolean): Promise<void>;
    }>;
    await native.writeConfigurationDefaults(ts.version, seed, false, true, outputDirectory, false, false);
    canonical(join(lifecycleDirectory(attempt), "lifecycle.json"), {
      attemptDirectory, defaultSeed: artifact(root, seed), nextEnv, planSha256: attempt.planSha256,
    } satisfies Lifecycle);
    return { root, attempt, lockSource };
  } catch (error) {
    assert.equal(ordinary(join(root, LOCK_NAME)).toString(), lockSource);
    unlinkSync(join(root, LOCK_NAME));
    throw error;
  }
}

export function endStylexNextTypeScriptLifecycle(lifecycle: StylexNextTypeScriptLifecycle): void {
  const loaded = loadLifecycle(lifecycle.root, lifecycle.attempt);
  assert.deepEqual(snapshot(join(lifecycle.root, "next-env.d.ts")), loaded.nextEnv, "Next environment was not restored before releasing TypeScript ownership");
  assert.equal(ordinary(join(lifecycle.root, LOCK_NAME)).toString(), lifecycle.lockSource);
  unlinkSync(join(lifecycle.root, LOCK_NAME));
}

function parseConfig(root: string, path: string, ts: typeof TypeScript): Readonly<{
  configFiles: readonly Artifact[];
  parsed: TypeScript.ParsedCommandLine;
}> {
  const reads = new Map<string, Artifact>();
  const errors: TypeScript.Diagnostic[] = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(path, undefined, {
    ...ts.sys,
    getCurrentDirectory: () => root,
    readFile(file): string | undefined {
      if (!existsSync(file)) return undefined;
      const source = ordinary(file).toString();
      reads.set(logical(root, file), artifact(root, file));
      assert.ok(reads.size <= 256, "TypeScript configuration inheritance exceeds the bounded input limit");
      return source;
    },
    onUnRecoverableConfigFileDiagnostic: (error) => errors.push(error),
  });
  assert.ok(parsed !== undefined, "TypeScript configuration could not be parsed");
  errors.push(...parsed.errors.filter(({ code }) => code !== 18003));
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  assert.ok(parsed.fileNames.length <= 100_000, "TypeScript source census exceeds the bounded input limit");
  return { configFiles: [...reads.values()].sort(compareArtifacts), parsed };
}

function parseInventory(value: unknown): TypeInventory {
  const item = record(value, "Generated TypeScript inventory");
  exactKeys(item, ["artifacts", "distDir", "kind", "mode", "nextVersion", "planSha256", "schemaVersion"], "Generated TypeScript inventory");
  assert.equal(item.kind, "hraness-next-generated-types");
  assert.equal(item.nextVersion, STYLEX_NEXT_REQUIRED_VERSION);
  assert.equal(item.schemaVersion, 1);
  assert.ok(item.mode === "discovery" || item.mode === "delivery");
  assert.match(string(item.planSha256, "TypeScript inventory plan hash"), /^[a-f0-9]{64}$/u);
  const distDir = normalizeLogicalPath(item.distDir, "TypeScript inventory output directory");
  const result = generatedArtifacts(item.artifacts);
  for (const file of result) assert.ok(file.path.startsWith(`${distDir}/types/`), "TypeScript inventory escaped the exact native type directory");
  return { artifacts: result, distDir, kind: "hraness-next-generated-types", mode: item.mode, nextVersion: STYLEX_NEXT_REQUIRED_VERSION, planSha256: item.planSha256 as string, schemaVersion: 1 };
}

const NATIVE_TYPE_NAMES = ["cache-life.d.ts", "link.d.ts", "routes.d.ts", "validator.ts"] as const;

function nativeObservation(value: unknown, planSha256: string, mode: StylexNextProductionMode, distDir: string): readonly Artifact[] {
  const item = record(value, "Next native type writer observation");
  exactKeys(item, ["artifacts", "distDir", "kind", "mode", "nativeInputs", "nextVersion", "planSha256", "schemaVersion"], "Next native type writer observation");
  assert.equal(item.kind, "hraness-next-native-type-writers");
  assert.equal(item.schemaVersion, 1);
  assert.equal(item.planSha256, planSha256);
  assert.equal(item.nextVersion, STYLEX_NEXT_REQUIRED_VERSION);
  assert.equal(item.mode, mode);
  assert.equal(item.distDir, distDir);
  assert.deepEqual(item.nativeInputs, NATIVE_INPUTS, "Next native type writer pins changed");
  const files = generatedArtifacts(item.artifacts);
  const allowed = new Set(NATIVE_TYPE_NAMES.map((name) => `${distDir}/types/${name}`));
  assert.ok(files.length >= 2 && files.length <= 4 && files.every(({ path }) => allowed.has(path)), "Native type writer observation contains an unknown artifact");
  for (const name of ["routes.d.ts", "validator.ts"]) assert.ok(files.some(({ path }) => path === `${distDir}/types/${name}`), "Native type writer observation is incomplete");
  return files;
}

/** Validate only retained evidence. Historical authored/package/module/output JS
 * inputs may legitimately change or disappear before a later native build. */
function historicalTypes(root: string, stateDirectory: string, prior: string, mode: StylexNextProductionMode): TypeInventory {
  const phase = join(prior, "typescript", mode);
  const inventory = parseInventory(json(join(phase, "types.json")));
  const plan = validateStylexNextAttemptPlan(json(join(prior, "plan.json")));
  const planSha256 = hash(ordinary(join(prior, "plan.json")));
  const priorPath = normalizeLogicalPath(logical(root, prior), "Historical TypeScript attempt path");
  assert.equal(priorPath, `${stateDirectory}/${plan.attemptId}`, "Historical attempt identity differs from its state directory");
  const distDir = mode === "delivery" ? plan.outputDirectory : `${priorPath}/next-discovery`;
  assert.equal(inventory.planSha256, planSha256, "Generated TypeScript inventory lost its exact attempt provenance");
  assert.equal(inventory.mode, mode);
  assert.equal(inventory.distDir, distDir, "Generated TypeScript inventory output differs from its actual plan");
  const projection = parseProjection(json(join(phase, "projection.json")));
  assert.equal(projection.planSha256, planSha256);
  assert.equal(projection.distDir, distDir, "Historical TypeScript projection output differs from plan");
  assert.equal(projection.stateDirectory, stateDirectory);
  const lifecycle = record(json(join(prior, "typescript", "lifecycle.json")), "Historical TypeScript lifecycle");
  exactKeys(lifecycle, ["attemptDirectory", "defaultSeed", "nextEnv", "planSha256"], "Historical TypeScript lifecycle");
  assert.equal(lifecycle.attemptDirectory, priorPath);
  assert.equal(lifecycle.planSha256, planSha256);
  parseSnapshot(lifecycle.nextEnv); // Retained original bytes, never the live root next-env file.
  const defaultSeed = generatedArtifact(lifecycle.defaultSeed);
  assert.equal(defaultSeed.path, `${priorPath}/typescript/default-seed.json`);
  verifyArtifact(root, defaultSeed);
  const authoredParent = dirname(projection.authoredConfig);
  const suffix = `${planSha256.slice(0, 16)}-${mode}`;
  const sibling = (name: string) => normalizeLogicalPath(authoredParent === "." ? name : `${authoredParent}/${name}`);
  assert.equal(projection.projectedConfig.path, sibling(`.hraness-stylex-next-${suffix}.json`), "Historical TypeScript projected config escaped its exact sibling path");
  assert.equal(projection.authoredConfigExisted, projection.seed === null);
  if (projection.seed !== null) {
    assert.equal(projection.seed.path, sibling(`.hraness-stylex-next-${suffix}-seed.json`));
    assert.deepEqual({ bytes: projection.seed.bytes, sha256: projection.seed.sha256 }, { bytes: defaultSeed.bytes, sha256: defaultSeed.sha256 });
    verifyArtifact(root, projection.seed);
  }
  verifyArtifact(root, projection.projectedConfig);
  const projected = record(json(resolve(root, projection.projectedConfig.path)), "Historical projected config");
  exactKeys(projected, ["extends", "files", "include", "exclude", ...(Object.hasOwn(projected, "references") ? ["references"] : [])], "Historical projected config");
  const fromProjection = (path: string) => relative(resolve(root, authoredParent), resolve(root, path)).split(sep).join("/");
  const selected = projection.seed?.path ?? projection.authoredConfig;
  assert.equal(projected.extends, `./${fromProjection(selected)}`);
  assert.deepEqual(projected.files, [...projection.sourceFiles.map(fromProjection), fromProjection("next-env.d.ts")]);
  assert.deepEqual(projected.include, [`${fromProjection(`${distDir}/types`)}/**/*.ts`]);
  assert.deepEqual(projected.exclude, []);
  assert.ok(projection.configFiles.some(({ path }) => path === selected), "Historical projection lost its selected configuration record");
  const owned = new Map(nativeObservation(json(join(phase, "before-webpack.json")), planSha256, mode, distDir).map((file) => [file.path, file]));
  for (const target of STYLEX_NEXT_TARGETS) {
    const targetDirectory = join(prior, mode, target);
    const graph = validateStylexNextGraphReceipt(json(join(targetDirectory, "graph.json")));
    assert.equal(graph.attemptId, plan.attemptId);
    assert.equal(graph.mode, mode);
    assert.equal(graph.target, target);
    assert.equal(graph.graphId, graphIdForStylexNextTarget(target, plan.graphMap));
    assert.equal(graph.outputDirectory, distDir);
    assert.deepEqual(graph.packages, plan.packageManifests.map(({ identity }) => identity));
    assert.deepEqual(graph.modules.map(({ path }) => path), plan.requiredSources[target], "Historical graph source census differs from plan");
    const moduleDirectory = join(targetDirectory, "modules");
    assert.equal(realpathSync(moduleDirectory), moduleDirectory, "Historical module receipt directory must be physical");
    const names = readdirSync(moduleDirectory).sort();
    assert.ok(names.length <= 100_000);
    assert.deepEqual(names, graph.modules.map(({ path }) => `${hash(path)}.json`).sort(), "Historical module directory differs from its exact graph census");
    for (const identity of graph.modules) {
      const path = join(moduleDirectory, `${hash(identity.path)}.json`);
      const module = validateStylexNextModuleReceipt(json(path));
      assert.equal(hash(ordinary(path)), identity.receiptSha256, "Historical module receipt hash changed");
      assert.equal(module.input.path, identity.path);
      assert.equal(module.mode, mode);
      assert.equal(module.target, target);
      assert.equal(module.attemptId, plan.attemptId);
      assert.equal(module.graphId, graph.graphId);
      // Intentionally no read of module.input, emitted JS, maps, or packages.
    }
    for (const output of graph.outputs.filter(({ path }) => path.startsWith("types/"))) {
      const file = generatedArtifact({ ...output, path: `${distDir}/${output.path}` });
      const previous = owned.get(file.path);
      if (previous !== undefined) assert.deepEqual(previous, file, "Historical native type producers disagree");
      owned.set(file.path, file);
    }
  }
  assert.deepEqual(inventory.artifacts, [...owned.values()].sort(compareArtifacts), "Historical native type inventory differs from its complete writer/graph union");
  return inventory;
}

function knownTypes(root: string, stateDirectory: string): ReadonlySet<string> {
  const state = resolve(root, normalizeLogicalPath(stateDirectory, "TypeScript state directory"));
  const candidates = new Map<string, Artifact[]>();
  if (!existsSync(state)) return new Set();
  assert.equal(realpathSync(state), state, "TypeScript state must not traverse a symlink");
  const entries = readdirSync(state, { withFileTypes: true });
  let artifactCount = 0;
  assert.ok(entries.length <= 10_000, "TypeScript attempt history exceeds the bounded input limit");
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)) continue;
    const prior = join(state, entry.name);
    for (const mode of ["discovery", "delivery"] as const) {
      const receipt = join(prior, "typescript", mode, "types.json");
      if (!existsSync(receipt)) continue;
      const inventory = historicalTypes(root, stateDirectory, prior, mode);
      for (const file of inventory.artifacts) {
        assert.ok(++artifactCount <= 1_000_000, "TypeScript artifact history exceeds the bounded input limit");
        const versions = candidates.get(file.path) ?? [];
        versions.push(file);
        candidates.set(file.path, versions);
      }
    }
  }
  const matched = new Set<string>();
  for (const [path, versions] of candidates) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    const live = artifact(root, absolute);
    assert.ok(versions.some((version) => version.bytes === live.bytes && version.sha256 === live.sha256), `Historical generated TypeScript bytes changed without a matching receipt: ${path}`);
    matched.add(path);
  }
  return matched;
}

function sourceCensus(root: string, parsed: TypeScript.ParsedCommandLine, generated: ReadonlySet<string>): readonly string[] {
  return [...new Set(parsed.fileNames.map((path) => logical(root, path)))]
    .filter((path) => path !== "next-env.d.ts" && !generated.has(path)).sort();
}

function parseProjection(value: unknown): Projection {
  const item = record(value, "TypeScript input projection");
  exactKeys(item, ["authoredConfig", "authoredConfigExisted", "configFiles", "distDir", "expectedNextEnv", "planSha256", "projectedConfig", "seed", "sourceFiles", "stateDirectory"], "TypeScript input projection");
  assert.equal(typeof item.authoredConfigExisted, "boolean");
  assert.ok(Array.isArray(item.sourceFiles));
  const sourceFiles = item.sourceFiles.map(inputPath);
  assert.deepEqual(sourceFiles, [...new Set(sourceFiles)].sort());
  assert.match(string(item.planSha256, "TypeScript projection plan hash"), /^[a-f0-9]{64}$/u);
  return {
    authoredConfig: normalizeLogicalPath(item.authoredConfig, "Authored TypeScript configuration"),
    authoredConfigExisted: item.authoredConfigExisted as boolean,
    configFiles: artifacts(item.configFiles),
    distDir: normalizeLogicalPath(item.distDir, "Projected Next output directory"),
    expectedNextEnv: string(item.expectedNextEnv, "Expected Next environment"),
    planSha256: item.planSha256 as string,
    projectedConfig: generatedArtifact(item.projectedConfig),
    seed: item.seed === null ? null : generatedArtifact(item.seed),
    sourceFiles,
    stateDirectory: normalizeLogicalPath(item.stateDirectory, "Projected TypeScript state directory"),
  };
}

function expectedNextEnv(config: Readonly<Record<string, unknown>>, distDir: string, prior: Snapshot): string {
  const images = config.images === undefined ? {} : record(config.images, "Next images configuration");
  const experimental = config.experimental === undefined ? {} : record(config.experimental, "Next experimental configuration");
  for (const [name, value] of [["disableStaticImages", images.disableStaticImages], ["strictRouteTypes", experimental.strictRouteTypes], ["typedRoutes", config.typedRoutes]] as const) {
    assert.ok(value === undefined || typeof value === "boolean", `Next ${name} must be boolean`);
  }
  const lines = ['/// <reference types="next" />'];
  if (images.disableStaticImages !== true) lines.push('/// <reference types="next/image-types/global" />');
  lines.push(`import "./${distDir}/types/routes.d.ts";`);
  if (experimental.strictRouteTypes === true) {
    lines.push(`import "./${distDir}/types/cache-life.d.ts";`, `import "./${distDir}/types/validator.ts";`);
    if (config.typedRoutes === true) lines.push(`import "./${distDir}/types/link.d.ts";`);
  }
  lines.push("", "// NOTE: This file should not be edited", "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.");
  const firstNewline = prior.source?.indexOf("\n", 1) ?? -1;
  const eol = firstNewline > 0 && prior.source?.[firstNewline - 1] === "\r" ? "\r\n" : "\n";
  return `${lines.join(eol)}${eol}`;
}

/** Preserve native source selection, then add only this pass's future type roots. */
export function projectStylexNextTypeScript(options: Readonly<{
  attempt: StylexNextAttemptHandle;
  config: Readonly<Record<string, unknown>>;
  distDir: string;
  mode: StylexNextProductionMode;
  root: string;
  stateDirectory: string;
}>): string {
  const { attempt, config, distDir, mode, root, stateDirectory } = options;
  const lifecycle = loadLifecycle(root, attempt);
  assert.notEqual(config.cleanDistDir, false, "StyleX Next TypeScript lifecycle requires native active-output cleaning");
  assert.ok(!existsSync(join(root, "pages")) && !existsSync(join(root, "src", "pages")), "StyleX Next TypeScript lifecycle supports App Router only");
  const typescript = config.typescript === undefined ? {} : record(config.typescript, "Next TypeScript configuration");
  assert.ok(typescript.ignoreBuildErrors === undefined || typescript.ignoreBuildErrors === false, "StyleX Next never bypasses native TypeScript errors");
  const authoredConfig = normalizeLogicalPath(typescript.tsconfigPath ?? "tsconfig.json", "Authored TypeScript configuration");
  const authoredPath = resolve(root, authoredConfig);
  const phase = phaseDirectory(attempt, mode);
  directory(phase);
  const receiptPath = join(phase, "projection.json");
  const environment = expectedNextEnv(config, distDir, lifecycle.nextEnv);
  if (existsSync(receiptPath)) {
    const prior = parseProjection(json(receiptPath));
    assert.equal(prior.authoredConfig, authoredConfig);
    assert.equal(prior.planSha256, attempt.planSha256);
    assert.equal(prior.distDir, distDir);
    assert.equal(prior.stateDirectory, stateDirectory);
    assert.equal(prior.expectedNextEnv, environment);
    for (const file of prior.configFiles) verifyArtifact(root, file);
    verifyArtifact(root, prior.projectedConfig);
    if (prior.seed !== null) verifyArtifact(root, prior.seed);
    return normalizeLogicalPath(prior.projectedConfig.path, "Projected TypeScript configuration");
  }
  const { ts } = installed(root);
  const authoredConfigExisted = existsSync(authoredPath);
  assert.equal(realpathSync(dirname(authoredPath)), dirname(authoredPath), "TypeScript config parent must be a physical directory");
  const suffix = `${attempt.planSha256.slice(0, 16)}-${mode}`;
  const seedPath = join(dirname(authoredPath), `.hraness-stylex-next-${suffix}-seed.json`);
  if (!authoredConfigExisted) {
    writeFileSync(seedPath, ordinary(resolve(root, lifecycle.defaultSeed.path)), { flag: "wx", mode: 0o644 });
  }
  const selected = authoredConfigExisted ? authoredPath : seedPath;
  const { configFiles, parsed } = parseConfig(root, selected, ts);
  const sourceFiles = sourceCensus(root, parsed, knownTypes(root, stateDirectory));
  const projectedPath = join(dirname(authoredPath), `.hraness-stylex-next-${suffix}.json`);
  const fromProjection = (path: string): string => relative(dirname(projectedPath), resolve(root, path)).split(sep).join("/");
  const raw = record(parsed.raw as unknown, "Parsed TypeScript configuration");
  const references = parsed.projectReferences?.map((reference) => ({
    path: fromProjection(logical(root, reference.path)),
    ...(reference.prepend === undefined ? {} : { prepend: reference.prepend }),
    ...(reference.circular === undefined ? {} : { circular: reference.circular }),
  }));
  assert.ok(raw.references === undefined || references !== undefined, "TypeScript references could not be preserved");
  canonical(projectedPath, {
    extends: `./${relative(dirname(projectedPath), selected).split(sep).join("/")}`,
    files: [...sourceFiles.map(fromProjection), fromProjection("next-env.d.ts")],
    include: [`${fromProjection(`${distDir}/types`)}/**/*.ts`],
    exclude: [],
    ...(references === undefined ? {} : { references }),
  });
  canonical(receiptPath, {
    authoredConfig, authoredConfigExisted, configFiles, distDir,
    expectedNextEnv: environment, planSha256: attempt.planSha256,
    projectedConfig: artifact(root, projectedPath),
    seed: authoredConfigExisted ? null : artifact(root, seedPath),
    sourceFiles, stateDirectory,
  } satisfies Projection);
  return normalizeLogicalPath(logical(root, projectedPath), "Projected TypeScript configuration");
}

/** Called before the user's webpack callback, after pinned Next's type writers. */
export function observeStylexNextTypeScriptInputs(
  root: string,
  attempt: StylexNextAttemptHandle,
  mode: StylexNextProductionMode,
): void {
  loadLifecycle(root, attempt);
  const phase = phaseDirectory(attempt, mode);
  const projection = parseProjection(json(join(phase, "projection.json")));
  installed(root);
  const files = ["cache-life.d.ts", "routes.d.ts", "validator.ts", "link.d.ts"]
    .map((name) => join(root, projection.distDir, "types", name)).filter(existsSync);
  assert.ok(files.some((path) => path.endsWith("/routes.d.ts")) && files.some((path) => path.endsWith("/validator.ts")), "Next did not create active native route types before webpack");
  canonical(join(phase, "before-webpack.json"), {
    artifacts: files.map((path) => artifact(root, path)).sort(compareArtifacts), distDir: projection.distDir,
    kind: "hraness-next-native-type-writers", mode, nativeInputs: NATIVE_INPUTS,
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION, planSha256: attempt.planSha256, schemaVersion: 1,
  });
}

function filesBelow(root: string, path: string, budget = { count: 0 }): Artifact[] {
  if (!existsSync(path)) return [];
  assert.ok(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(), "Native TypeScript output must be an ordinary directory");
  assert.equal(realpathSync(path), resolve(path));
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(++budget.count <= 100_000, "Native TypeScript output exceeds the bounded inventory limit");
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(root, child, budget) : [artifact(root, child)];
  }).sort(compareArtifacts);
}

function restoreNextEnv(root: string, prior: Snapshot, expected: string): void {
  const path = join(root, "next-env.d.ts");
  const current = snapshot(path);
  if (current.source === prior.source) {
    assert.deepEqual(current, prior, "Next environment file mode changed unexpectedly");
    return;
  }
  assert.equal(current.source, expected, "Next environment changed outside the exact native writer; preserving unexpected bytes");
  if (prior.source === null) unlinkSync(path);
  else {
    assert.equal(current.mode, prior.mode, "Next environment mode changed outside the native writer");
    const descriptor = openSync(path, "r+");
    try {
      const opened = fstatSync(descriptor);
      const live = lstatSync(path);
      assert.ok(opened.isFile() && !live.isSymbolicLink() && opened.ino === live.ino && opened.dev === live.dev, "Next environment inode changed before restoration");
      assert.equal(readFileSync(descriptor).toString(), expected, "Next environment changed before restoration");
      // readFile moved the descriptor offset; writeFile with a path would race a
      // pathname replacement. Positional write retains the verified open inode.
      const source = Buffer.from(prior.source);
      let offset = 0;
      while (offset < source.byteLength) {
        const written = writeSync(descriptor, source, offset, source.byteLength - offset, offset);
        assert.ok(written > 0, "Next environment restoration made no progress");
        offset += written;
      }
      ftruncateSync(descriptor, source.byteLength);
    } finally { closeSync(descriptor); }
  }
  assert.deepEqual(snapshot(path), prior, "Next environment restoration was not byte/mode exact");
}

/** Runs after terminal child collection on success, failure, and cancellation. */
export async function settleStylexNextTypeScriptPass(
  lifecycle: StylexNextTypeScriptLifecycle,
  mode: StylexNextProductionMode,
): Promise<void> {
  const { root, attempt } = lifecycle;
  const initial = loadLifecycle(root, attempt);
  const phase = phaseDirectory(attempt, mode);
  const projectionPath = join(phase, "projection.json");
  if (!existsSync(projectionPath)) {
    assert.deepEqual(snapshot(join(root, "next-env.d.ts")), initial.nextEnv, "Next changed its environment before TypeScript projection");
    return;
  }
  const projection = parseProjection(json(projectionPath));
  let failure: unknown;
  try {
    for (const file of projection.configFiles) verifyArtifact(root, file);
    verifyArtifact(root, projection.projectedConfig);
    assert.equal(existsSync(resolve(root, projection.authoredConfig)), projection.authoredConfigExisted, "Authored TypeScript configuration presence changed");
    const beforePath = join(phase, "before-webpack.json");
    const graphPaths = STYLEX_NEXT_TARGETS.map((target) => join(attempt.directory, mode, target, "graph.json"));
    const observed = filesBelow(root, join(root, projection.distDir, "types"));
    // Failed/partial compilers retain a census, never an exclusion authority.
    canonical(join(phase, "observed-types.json"), { artifacts: observed, semantics: "observation-only" });
    if (existsSync(beforePath) && graphPaths.every(existsSync)) {
      const owned = new Map(nativeObservation(json(beforePath), attempt.planSha256, mode, projection.distDir).map((file) => [file.path, file]));
      for (const graph of await readStylexNextTypeScriptGraphReceipts(attempt, root, mode)) {
        assert.equal(graph.outputDirectory, projection.distDir);
        for (const output of graph.outputs.filter(({ path }) => path.startsWith("types/"))) {
          const file = { ...output, path: `${projection.distDir}/${output.path}` };
          const previous = owned.get(file.path);
          if (previous !== undefined) assert.deepEqual(file, previous, "Native type producers disagree");
          owned.set(file.path, file);
        }
      }
      const inventory = [...owned.values()].sort(compareArtifacts);
      assert.deepEqual(observed, inventory, "Native type inventory has an unowned, missing, or changed artifact");
      canonical(join(phase, "types.json"), {
        artifacts: inventory, distDir: projection.distDir, kind: "hraness-next-generated-types", mode,
        nextVersion: STYLEX_NEXT_REQUIRED_VERSION, planSha256: attempt.planSha256, schemaVersion: 1,
      } satisfies TypeInventory);
    }
    const selected = resolve(root, projection.seed?.path ?? projection.authoredConfig);
    const { parsed, configFiles } = parseConfig(root, selected, installed(root).ts);
    assert.deepEqual(configFiles, projection.configFiles, "TypeScript configuration inheritance changed during the native pass");
    assert.deepEqual(sourceCensus(root, parsed, knownTypes(root, projection.stateDirectory)), projection.sourceFiles, "Authored TypeScript source selection changed during the native pass");
  } catch (error) {
    failure = error;
  }
  try {
    restoreNextEnv(root, initial.nextEnv, projection.expectedNextEnv);
  } catch (error) {
    failure = failure === undefined ? error : new AggregateError([failure, error], "TypeScript phase validation and environment preservation both failed");
  }
  if (failure !== undefined) throw failure;
}
