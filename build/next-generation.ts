import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import type { StylexArtifactV1, StylexPackageIdentityV1, StylexPackageManifestV1, StylexRuleV1 } from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStylexUnionNamespace,
  canonicalJson,
  canonicalizeStylexRules,
  compilerSha256,
  normalizeLogicalPath,
  readStylexPackageManifest,
  resolveRootRelativeInput,
  serializeStylexRuleUnionV1,
  sha256,
  stylexRulesSha256,
  stylexUnionPolicySha256,
} from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_BUILD_SCHEMA_VERSION,
  STYLEX_NEXT_REQUIRED_VERSION,
  STYLEX_NEXT_FRAMEWORK_INPUTS,
  STYLEX_NEXT_EMPTY_ENTRY_INPUTS,
  STYLEX_NEXT_TARGETS,
  compareStylexNextStrings,
  defaultStylexNextGraphMap,
  defineStylexNextGraphMap,
  graphIdForStylexNextTarget,
  stylexNextDeliveryCssOwnerNames,
  stylexNextReceiptSha256,
  stylexNextFrameworkRole,
  validateStylexNextFrameworkPayload,
  validateStylexNextEmptyEntryBootstrap,
  validateStylexNextEmptyEntryPayload,
  validateStylexNextBuildRecord,
  validateStylexNextPostprocessingReceipt,
  validateStylexNextGraphReceipt,
  validateStylexNextModuleReceipt,
  type StylexNextBuildRecordV2,
  type StylexNextEntrypointV1,
  type StylexNextGraphIdentityV1,
  type StylexNextGraphMapV1,
  type StylexNextGraphReceiptV1,
  type StylexNextFrameworkAssetV1,
  type StylexNextFrameworkRole,
  type StylexNextEmptyEntryBootstrapV1,
  type StylexNextEmptyEntryGraphV1,
  type StylexNextMode,
  type StylexNextModuleReceiptV1,
  type StylexNextProductionMode,
  type StylexNextPostprocessingReceiptV1,
  type StylexNextSsgPostprocessingV1,
  type StylexNextTarget,
  type StylexNextAuxiliaryTraceAssetV1,
  type StylexNextAuxiliaryTraceSnapshotV1,
} from "./next-contracts.js";
import { proveStylexNextSsgPostprocessing } from "./next-ssg.js";
import { observeStylexNextAuxiliaryTraceSnapshot } from "./next-auxiliary.js";

const PLAN_SCHEMA_VERSION = 2 as const;
export const STYLEX_NEXT_GENERATED_ENTRY_SOURCE = 'import "./stylex.css";\n' as const;

export type StylexNextAttemptPlanV1 = Readonly<{
  adapterVersion: typeof STYLEX_NEXT_ADAPTER_VERSION;
  attemptId: string;
  compilerSha256: string;
  graphMap: StylexNextGraphMapV1;
  kind: "hraness-stylex-next-attempt";
  nextVersion: typeof STYLEX_NEXT_REQUIRED_VERSION;
  outputDirectory: string;
  packageManifests: readonly Readonly<{
    artifact: StylexArtifactV1;
    identity: StylexPackageIdentityV1;
  }>[];
  requiredSources: Readonly<Record<StylexNextTarget, readonly string[]>>;
  schemaVersion: 1;
}>;

export type StylexNextAttemptPlanV2 = Readonly<Omit<StylexNextAttemptPlanV1, "schemaVersion"> & {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  unionPolicySha256: string;
}>;

export type StylexNextAttemptHandle = Readonly<{
  directory: string;
  planSha256: string;
}>;

export type StylexNextOutputLease = Readonly<{
  path: string;
  source: string;
}>;

export type PrepareStylexNextAttemptOptions = Readonly<{
  attemptId: string;
  graphMap?: StylexNextGraphMapV1;
  outputDirectory?: string;
  packageManifests: readonly string[];
  requiredSources: Readonly<Record<StylexNextTarget, readonly string[]>>;
  rootDirectory: string;
  stateDirectory?: string;
}>;

export type WriteStylexNextModuleReceiptOptions = Readonly<{
  attempt: StylexNextAttemptHandle;
  mode: StylexNextMode;
  receipt: StylexNextModuleReceiptV1;
  rootDirectory: string;
}>;

export type WriteStylexNextGraphReceiptOptions = Readonly<{
  attempt: StylexNextAttemptHandle;
  auxiliaryTraceAssets: readonly StylexNextAuxiliaryTraceAssetV1[];
  cssInputs: readonly StylexArtifactV1[];
  entrypoints: readonly StylexNextEntrypointV1[];
  emptyEntryBootstraps: readonly StylexNextEmptyEntryBootstrapV1[];
  frameworkAssets: readonly StylexNextFrameworkAssetV1[];
  javascriptChunks: readonly string[];
  mode: StylexNextProductionMode;
  outputDirectory: string;
  outputs: readonly StylexArtifactV1[];
  rootDirectory: string;
  sourceMaps: readonly StylexArtifactV1[];
  target: StylexNextTarget;
  webpackVersion: string;
}>;

function plainObject(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, names: readonly string[], description: string): void {
  assert.deepEqual(Object.keys(record).sort(), [...names].sort(), `${description} has an unexpected shape`);
}

function segment(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value), `${description} must be a normalized segment`);
  return value;
}

function digest(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${description} must be a lowercase SHA-256`);
  return value;
}

function relativeBelow(root: string, path: string, description: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(value.length > 0 && value !== ".." && !value.startsWith("../") && !value.startsWith("/"), `${description} escapes its root`);
  return normalizeLogicalPath(value, description);
}

async function ordinaryDirectory(path: string, description: string): Promise<string> {
  const stat = await lstat(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${description} must be an ordinary nonsymlink directory`);
  const physical = await realpath(path);
  assert.equal(physical, resolve(path), `${description} must not traverse a symlink`);
  return physical;
}

export function stylexNextOutputLeasePath(rootDirectory: string, outputDirectory: string): string {
  const root = resolve(rootDirectory);
  const output = normalizeLogicalPath(outputDirectory, "Next output lease directory");
  return join(root, `.hraness-stylex-next-output-${sha256(output)}.lock`);
}

export async function acquireStylexNextOutputLease(
  rootDirectory: string,
  outputDirectory: string,
  attemptId: string,
): Promise<StylexNextOutputLease> {
  const path = stylexNextOutputLeasePath(rootDirectory, outputDirectory);
  const source = `${segment(attemptId, "Next output lease attemptId")}\n`;
  await writeFile(path, source, { flag: "wx", mode: 0o644 });
  return { path, source };
}

export async function releaseStylexNextOutputLease(lease: StylexNextOutputLease): Promise<void> {
  assert.equal(await readFile(lease.path, "utf8"), lease.source, "StyleX Next output lease ownership changed");
  await unlink(lease.path);
}

async function canonicalFile<T>(path: string, validate: (value: unknown) => T, description: string): Promise<Readonly<{ source: string; value: T }>> {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${description} must be an ordinary nonsymlink file`);
  const source = await readFile(path, "utf8");
  const value = validate(JSON.parse(source) as unknown);
  assert.equal(source, `${canonicalJson(value)}\n`, `${description} is not canonical JSON`);
  return { source, value };
}

function artifact(value: unknown, description: string): StylexArtifactV1 {
  const record = plainObject(value, description);
  exactKeys(record, ["bytes", "path", "sha256"], description);
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0, `${description}.bytes is invalid`);
  return {
    bytes: record.bytes as number,
    path: normalizeLogicalPath(record.path, `${description}.path`),
    sha256: digest(record.sha256, `${description}.sha256`),
  };
}

export function validateStylexNextAttemptPlan(value: unknown): StylexNextAttemptPlanV2 {
  const record = plainObject(value, "Next attempt plan");
  exactKeys(record, [
    "adapterVersion", "attemptId", "compilerSha256", "graphMap", "kind", "nextVersion",
    "outputDirectory", "packageManifests", "requiredSources", "schemaVersion", "unionPolicySha256",
  ], "Next attempt plan");
  assert.equal(record.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
  assert.equal(record.compilerSha256, compilerSha256);
  assert.equal(record.unionPolicySha256, stylexUnionPolicySha256, "Next attempt union policy is stale");
  assert.equal(record.kind, "hraness-stylex-next-attempt");
  assert.equal(record.nextVersion, STYLEX_NEXT_REQUIRED_VERSION);
  assert.equal(record.schemaVersion, PLAN_SCHEMA_VERSION);
  assert.ok(Array.isArray(record.packageManifests) && record.packageManifests.length > 0, "Next attempt plan requires package manifests");
  const packageManifests = record.packageManifests.map((item, index) => {
    const manifestRecord = plainObject(item, `Next attempt packageManifests[${String(index)}]`);
    exactKeys(manifestRecord, ["artifact", "identity"], `Next attempt packageManifests[${String(index)}]`);
    const identityRecord = plainObject(manifestRecord.identity, `Next attempt packageManifests[${String(index)}].identity`);
    exactKeys(identityRecord, ["manifestSha256", "name", "version"], `Next attempt packageManifests[${String(index)}].identity`);
    assert.ok(typeof identityRecord.name === "string" && identityRecord.name.length > 0, "Next package name is invalid");
    assert.ok(typeof identityRecord.version === "string" && identityRecord.version.length > 0, "Next package version is invalid");
    return {
      artifact: artifact(manifestRecord.artifact, `Next attempt packageManifests[${String(index)}].artifact`),
      identity: {
        manifestSha256: digest(identityRecord.manifestSha256, `Next attempt packageManifests[${String(index)}].identity.manifestSha256`),
        name: identityRecord.name,
        version: identityRecord.version,
      },
    };
  });
  assert.deepEqual(
    packageManifests.map(({ identity }) => identity.name),
    [...packageManifests].map(({ identity }) => identity.name).sort(),
    "Next attempt packages must be name sorted",
  );
  assert.equal(new Set(packageManifests.map(({ identity }) => identity.name)).size, packageManifests.length, "Next attempt package names must be unique");
  const requiredRecord = plainObject(record.requiredSources, "Next attempt requiredSources");
  exactKeys(requiredRecord, [...STYLEX_NEXT_TARGETS], "Next attempt requiredSources");
  const requiredSourcePaths = (target: StylexNextTarget): readonly string[] => {
    const value = requiredRecord[target];
    assert.ok(Array.isArray(value), `Next attempt requiredSources.${target} must be an array`);
    const paths = value.map((path, index) => normalizeLogicalPath(path, `Next attempt requiredSources.${target}[${String(index)}]`));
    assert.deepEqual(paths, [...paths].sort(), `Next attempt requiredSources.${target} must be sorted`);
    assert.equal(new Set(paths).size, paths.length, `Next attempt requiredSources.${target} must be unique`);
    return paths;
  };
  const requiredSources: Readonly<Record<StylexNextTarget, readonly string[]>> = {
    client: requiredSourcePaths("client"),
    "edge-rsc": requiredSourcePaths("edge-rsc"),
    "node-rsc": requiredSourcePaths("node-rsc"),
  };
  assert.ok(
    STYLEX_NEXT_TARGETS.reduce((count, target) => count + requiredSources[target].length, 0) > 0,
    "Next attempt requiredSources must inventory at least one repository-owned production source",
  );
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: segment(record.attemptId, "Next attemptId"),
    compilerSha256,
    graphMap: defineStylexNextGraphMap(record.graphMap),
    kind: "hraness-stylex-next-attempt",
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory: normalizeLogicalPath(record.outputDirectory, "Next outputDirectory"),
    packageManifests,
    requiredSources,
    schemaVersion: PLAN_SCHEMA_VERSION,
    unionPolicySha256: stylexUnionPolicySha256,
  };
}

async function loadAttempt(handle: StylexNextAttemptHandle): Promise<Readonly<{ plan: StylexNextAttemptPlanV2; root: string }>> {
  const record = plainObject(handle, "Next attempt handle");
  exactKeys(record, ["directory", "planSha256"], "Next attempt handle");
  assert.ok(typeof record.directory === "string" && resolve(record.directory) === record.directory, "Next attempt directory must be absolute");
  const root = await ordinaryDirectory(record.directory, "Next attempt directory");
  const loaded = await canonicalFile(join(root, "plan.json"), validateStylexNextAttemptPlan, "Next attempt plan");
  assert.equal(sha256(loaded.source), digest(record.planSha256, "Next attempt plan hash"), "Next attempt plan hash changed");
  return { plan: loaded.value, root };
}

async function writeCanonicalExclusive(
  path: string,
  value: unknown,
  description: string,
  revalidateBeforeCommit?: () => Promise<void>,
): Promise<string> {
  const source = `${canonicalJson(value)}\n`;
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let created = false;
  let operationError: unknown;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(source);
      await handle.sync();
    } catch (error) {
      operationError = error;
    }
    try {
      await handle.close();
    } catch (error) {
      operationError = operationError === undefined
        ? error
        : new AggregateError([operationError, error], `Next canonical temporary write and close both failed: ${temporary}`);
    }
    if (operationError !== undefined) throw operationError;
    await revalidateBeforeCommit?.();
    try {
      await link(temporary, path);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      assert.equal(await readFile(path, "utf8"), source, `${description} collision differs from the existing record`);
    }
  } catch (error) {
    operationError = error;
  }
  if (created) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      throw operationError === undefined
        ? cleanupError
        : new AggregateError([operationError, cleanupError], `Next canonical write failed and temporary cleanup also failed: ${path}`);
    }
  }
  if (operationError !== undefined) throw operationError;
  return sha256(source);
}

export async function prepareStylexNextAttempt(options: PrepareStylexNextAttemptOptions): Promise<StylexNextAttemptHandle> {
  const root = await ordinaryDirectory(resolve(options.rootDirectory), "Next rootDirectory");
  const attemptId = segment(options.attemptId, "Next attemptId");
  const stateDirectory = normalizeLogicalPath(options.stateDirectory ?? ".stylex-next", "Next stateDirectory");
  const outputDirectory = normalizeLogicalPath(options.outputDirectory ?? ".next", "Next outputDirectory");
  assert.ok(
    stateDirectory !== outputDirectory
      && !stateDirectory.startsWith(`${outputDirectory}/`)
      && !outputDirectory.startsWith(`${stateDirectory}/`),
    "Next state and output directories must be path-disjoint",
  );
  assert.ok(options.packageManifests.length > 0, "Next attempt requires at least one package manifest");
  const packageManifests = await Promise.all(options.packageManifests.map(async (logicalPath) => {
    const path = normalizeLogicalPath(logicalPath, "Next package manifest path");
    const absolute = await resolveRootRelativeInput(root, path);
    const source = await readFile(absolute);
    const manifest = await readStylexPackageManifest(absolute, resolve(dirname(absolute), ".."));
    return {
      artifact: { bytes: source.byteLength, path, sha256: sha256(source) },
      identity: {
        manifestSha256: sha256(source),
        name: manifest.package.name,
        version: manifest.package.version,
      },
    };
  }));
  packageManifests.sort((left, right) => compareStylexNextStrings(left.identity.name, right.identity.name));
  assert.equal(new Set(packageManifests.map(({ identity }) => identity.name)).size, packageManifests.length, "Next package manifests contain duplicate package names");
  const plan = validateStylexNextAttemptPlan({
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId,
    compilerSha256,
    graphMap: defineStylexNextGraphMap(options.graphMap ?? defaultStylexNextGraphMap),
    kind: "hraness-stylex-next-attempt",
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory,
    packageManifests,
    requiredSources: {
      client: [...options.requiredSources.client].sort(),
      "edge-rsc": [...options.requiredSources["edge-rsc"]].sort(),
      "node-rsc": [...options.requiredSources["node-rsc"]].sort(),
    },
    schemaVersion: PLAN_SCHEMA_VERSION,
    unionPolicySha256: stylexUnionPolicySha256,
  });
  const stateRoot = resolve(root, ...stateDirectory.split("/"));
  await mkdir(stateRoot, { recursive: true, mode: 0o755 });
  assert.equal(await realpath(stateRoot), stateRoot, "Next stateDirectory must not traverse a symlink");
  const directory = join(stateRoot, attemptId);
  await mkdir(directory, { recursive: false, mode: 0o755 });
  for (const mode of ["discovery", "delivery"] as const) {
    for (const target of STYLEX_NEXT_TARGETS) {
      await mkdir(join(directory, mode, target, "modules"), { recursive: true, mode: 0o755 });
    }
  }
  await mkdir(join(directory, "generated"), { mode: 0o755 });
  const source = `${canonicalJson(plan)}\n`;
  await writeFile(join(directory, "plan.json"), source, { flag: "wx", mode: 0o644 });
  return { directory, planSha256: sha256(source) };
}

async function verifyPlanPackages(rootDirectory: string, plan: StylexNextAttemptPlanV2): Promise<readonly StylexPackageManifestV1[]> {
  const manifests: StylexPackageManifestV1[] = [];
  for (const expected of plan.packageManifests) {
    const absolute = await resolveRootRelativeInput(rootDirectory, expected.artifact.path);
    const source = await readFile(absolute);
    assert.deepEqual(
      { bytes: source.byteLength, sha256: sha256(source) },
      { bytes: expected.artifact.bytes, sha256: expected.artifact.sha256 },
      `Next package manifest changed: ${expected.artifact.path}`,
    );
    const manifest = await readStylexPackageManifest(absolute, resolve(dirname(absolute), ".."));
    assert.deepEqual(
      { manifestSha256: sha256(source), name: manifest.package.name, version: manifest.package.version },
      expected.identity,
      `Next package identity changed: ${expected.identity.name}`,
    );
    manifests.push(manifest);
  }
  return manifests;
}

async function verifyGeneratedEntry(attemptRoot: string): Promise<void> {
  const path = join(attemptRoot, "generated", "entry.mjs");
  const entryStat = await lstat(path);
  assert.ok(entryStat.isFile() && !entryStat.isSymbolicLink(), "Next generated entry must be an ordinary nonsymlink file");
  assert.equal(await realpath(path), path, "Next generated entry must not traverse a symlink");
  assert.equal(await readFile(path, "utf8"), STYLEX_NEXT_GENERATED_ENTRY_SOURCE, "Next generated entry bytes changed");
}

async function verifyNextPackageFoundations(
  root: string,
  plan: StylexNextAttemptPlanV2,
  manifests: readonly StylexPackageManifestV1[],
  graphs: readonly Readonly<{ receipt: StylexNextGraphReceiptV1; receiptSha256: string }>[],
): Promise<void> {
  const client = graphs.find(({ receipt }) => receipt.target === "client");
  assert.ok(client !== undefined, "Next union requires the client stylesheet graph");
  for (const manifest of manifests) {
    const registered = plan.packageManifests.find(({ identity }) => identity.name === manifest.package.name);
    assert.ok(registered !== undefined, "Next union package is absent from its plan");
    const manifestPath = await resolveRootRelativeInput(root, registered.artifact.path);
    const packageRoot = resolve(dirname(manifestPath), "..");
    const foundation = manifest.stylesheets.find(({ path }) => path === manifest.compilerFoundation);
    assert.ok(foundation !== undefined, `Next package omitted its compiler foundation: ${manifest.package.name}`);
    const path = relativeBelow(root, await resolveRootRelativeInput(packageRoot, manifest.compilerFoundation), "Next package compiler foundation");
    const matches: readonly StylexArtifactV1[] = client.receipt.cssInputs.filter((input) => input.path === path);
    assert.deepEqual(matches, [{ ...foundation, path }], `Next client stylesheet graph must include the exact compiler foundation for ${manifest.package.name}`);
  }
}

export async function verifyStylexNextGeneratedEntry(attempt: StylexNextAttemptHandle): Promise<void> {
  const loaded = await loadAttempt(attempt);
  await verifyGeneratedEntry(loaded.root);
}

export async function writeStylexNextModuleReceipt(options: WriteStylexNextModuleReceiptOptions): Promise<string> {
  const loaded = await loadAttempt(options.attempt);
  const rootDirectory = await ordinaryDirectory(resolve(options.rootDirectory), "Next module rootDirectory");
  const receipt = validateStylexNextModuleReceipt(options.receipt);
  assert.equal(receipt.attemptId, loaded.plan.attemptId, "Next module attempt differs from plan");
  assert.equal(receipt.mode, options.mode, "Next module mode differs from writer mode");
  assert.equal(receipt.graphId, graphIdForStylexNextTarget(receipt.target, loaded.plan.graphMap), "Next module graph ID differs from plan");
  const sourcePath = await resolveRootRelativeInput(rootDirectory, receipt.input.path);
  const verifyInput = async (): Promise<void> => {
    const source = await readFile(sourcePath);
    assert.deepEqual(
      { bytes: source.byteLength, sha256: sha256(source) },
      { bytes: receipt.input.bytes, sha256: receipt.input.sha256 },
      `Next module input changed before receipt commit: ${receipt.input.path}`,
    );
  };
  await verifyInput();
  const path = join(loaded.root, receipt.mode, receipt.target, "modules", `${sha256(receipt.input.path)}.json`);
  return await writeCanonicalExclusive(path, receipt, `Next module ${receipt.input.path}`, verifyInput);
}

async function loadModuleReceipts(
  loaded: Readonly<{ plan: StylexNextAttemptPlanV2; root: string }>,
  rootDirectory: string,
  mode: StylexNextMode,
  target: StylexNextTarget,
): Promise<readonly Readonly<{ receipt: StylexNextModuleReceiptV1; receiptSha256: string }>[]> {
  const directory = join(loaded.root, mode, target, "modules");
  const names = (await readdir(directory)).sort();
  assert.ok(names.every((name) => /^[a-f0-9]{64}\.json$/u.test(name)), `Next ${mode} ${target} module directory contains an unexpected entry`);
  const output = await Promise.all(names.map(async (name) => {
    const loadedReceipt = await canonicalFile(join(directory, name), validateStylexNextModuleReceipt, `Next ${mode} ${target} module receipt`);
    const receipt = loadedReceipt.value;
    assert.equal(receipt.attemptId, loaded.plan.attemptId, "Next module attempt differs from plan");
    assert.equal(receipt.mode, mode, "Next module mode differs from directory");
    assert.equal(receipt.target, target, "Next module target differs from directory");
    assert.equal(receipt.graphId, graphIdForStylexNextTarget(target, loaded.plan.graphMap), "Next module graph differs from plan");
    assert.equal(name, `${sha256(receipt.input.path)}.json`, "Next module receipt filename is stale");
    const source = await readFile(await resolveRootRelativeInput(rootDirectory, receipt.input.path));
    assert.deepEqual(
      { bytes: source.byteLength, sha256: sha256(source) },
      { bytes: receipt.input.bytes, sha256: receipt.input.sha256 },
      `Next module source drifted: ${receipt.input.path}`,
    );
    return { receipt, receiptSha256: sha256(loadedReceipt.source) };
  }));
  assert.equal(new Set(output.map(({ receipt }) => receipt.input.path)).size, output.length, "Next module receipts contain duplicate paths");
  return output.sort((left, right) => compareStylexNextStrings(left.receipt.input.path, right.receipt.input.path));
}

function moduleStableIdentity(receipt: StylexNextModuleReceiptV1): unknown {
  return {
    compilerSha256: receipt.compilerSha256,
    graphId: receipt.graphId,
    input: receipt.input,
    output: receipt.output,
    rules: receipt.rules,
    rulesSha256: receipt.rulesSha256,
    sourceMap: receipt.sourceMap,
    target: receipt.target,
  };
}

export async function writeStylexNextGraphReceipt(options: WriteStylexNextGraphReceiptOptions): Promise<StylexNextGraphReceiptV1> {
  const loaded = await loadAttempt(options.attempt);
  const rootDirectory = await ordinaryDirectory(resolve(options.rootDirectory), "Next graph rootDirectory");
  const packages = loaded.plan.packageManifests.map(({ identity }) => identity);
  await verifyPlanPackages(rootDirectory, loaded.plan);
  const modules = await loadModuleReceipts(loaded, rootDirectory, options.mode, options.target);
  assert.deepEqual(
    modules.map(({ receipt }) => receipt.input.path),
    loaded.plan.requiredSources[options.target],
    `Next ${options.mode} ${options.target} module receipts differ from the verified source census`,
  );
  if (options.mode === "delivery") {
    const discovery = await loadModuleReceipts(loaded, rootDirectory, "discovery", options.target);
    assert.deepEqual(
      modules.map(({ receipt }) => moduleStableIdentity(receipt)),
      discovery.map(({ receipt }) => moduleStableIdentity(receipt)),
      `Next ${options.target} source, transform, rule, or map drifted between discovery and delivery`,
    );
  }
  const moduleIdentities = modules.map(({ receipt, receiptSha256 }) => ({ path: receipt.input.path, receiptSha256 }));
  const rules = canonicalizeStylexRules(...modules.map(({ receipt }) => receipt.rules));
  const receipt = validateStylexNextGraphReceipt({
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: loaded.plan.attemptId,
    auxiliaryTraceAssets: options.auxiliaryTraceAssets,
    compilerSha256,
    cssInputs: options.cssInputs,
    entrypoints: options.entrypoints,
    emptyEntryBootstraps: options.emptyEntryBootstraps,
    frameworkAssets: options.frameworkAssets,
    graphId: graphIdForStylexNextTarget(options.target, loaded.plan.graphMap),
    kind: "hraness-stylex-next-graph",
    javascriptChunks: options.javascriptChunks,
    mode: options.mode,
    modules: moduleIdentities,
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory: normalizeLogicalPath(options.outputDirectory, "Next graph outputDirectory"),
    outputs: options.outputs,
    packages,
    rules,
    rulesSha256: stylexRulesSha256(rules),
    schemaVersion: 1,
    sourceMaps: options.sourceMaps,
    sourcesSha256: sha256(canonicalJson(moduleIdentities)),
    target: options.target,
    webpackVersion: options.webpackVersion,
  });
  const verifyCssInputs = async (): Promise<void> => {
    if (receipt.emptyEntryBootstraps.length > 0) {
      const inputs = await readStylexNextEmptyEntryInputs(rootDirectory);
      for (const bootstrap of receipt.emptyEntryBootstraps) assert.deepEqual(inputs, bootstrap.inputs, "Next empty entry creator changed before graph receipt commit");
    }
    for (const framework of receipt.frameworkAssets) assert.deepEqual(await readNextFrameworkInput(rootDirectory, framework.role), framework.input, "Next framework input changed before graph receipt commit");
    for (const input of receipt.cssInputs) {
      assert.deepEqual(
        await artifactForFile(rootDirectory, input.path),
        input,
        `Next ${options.mode} ${options.target} CSS input changed before receipt commit: ${input.path}`,
      );
    }
  };
  await verifyCssInputs();
  await writeCanonicalExclusive(
    join(loaded.root, options.mode, options.target, "graph.json"),
    receipt,
    `Next ${options.mode} ${options.target} graph`,
    async () => {
      const currentAttempt = await loadAttempt(options.attempt);
      assert.deepEqual(currentAttempt.plan, loaded.plan, "Next attempt plan changed before graph receipt commit");
      await verifyPlanPackages(rootDirectory, currentAttempt.plan);
      const currentModules = await loadModuleReceipts(currentAttempt, rootDirectory, options.mode, options.target);
      assert.deepEqual(
        currentModules.map(({ receipt: moduleReceipt, receiptSha256 }) => ({ path: moduleReceipt.input.path, receiptSha256 })),
        receipt.modules,
        `Next ${options.mode} ${options.target} module receipts changed before graph receipt commit`,
      );
      assert.deepEqual(
        canonicalizeStylexRules(...currentModules.map(({ receipt: moduleReceipt }) => moduleReceipt.rules)),
        receipt.rules,
        `Next ${options.mode} ${options.target} rules changed before graph receipt commit`,
      );
      if (options.mode === "delivery") {
        const currentDiscovery = await loadModuleReceipts(currentAttempt, rootDirectory, "discovery", options.target);
        assert.deepEqual(
          currentModules.map(({ receipt: moduleReceipt }) => moduleStableIdentity(moduleReceipt)),
          currentDiscovery.map(({ receipt: moduleReceipt }) => moduleStableIdentity(moduleReceipt)),
          `Next ${options.target} discovery evidence changed before delivery graph receipt commit`,
        );
      }
      await verifyCssInputs();
    },
  );
  return receipt;
}

async function readNextFrameworkInput(root: string, role: StylexNextFrameworkRole): Promise<StylexArtifactV1> {
  const metadata: unknown = JSON.parse(await readFile(await resolveRootRelativeInput(root, "node_modules/next/package.json"), "utf8"));
  const next = plainObject(metadata, "Next framework package metadata");
  assert.equal(next.name, "next");
  assert.equal(next.version, STYLEX_NEXT_REQUIRED_VERSION, "Next framework package version differs from its pinned emitter contract");
  const [path, hash] = STYLEX_NEXT_FRAMEWORK_INPUTS[role];
  const input = await artifactForFile(root, `node_modules/next/${path}`);
  assert.equal(input.sha256, hash, "Next framework input differs from its pinned original bytes");
  return input;
}

export async function readStylexNextEmptyEntryInputs(root: string): Promise<readonly StylexArtifactV1[]> {
  const metadata = plainObject(JSON.parse(await readFile(await resolveRootRelativeInput(root, "node_modules/next/package.json"), "utf8")) as unknown, "Next empty entry package metadata");
  assert.equal(metadata.name, "next");
  assert.equal(metadata.version, STYLEX_NEXT_REQUIRED_VERSION, "Next empty entry package version changed");
  return await Promise.all(STYLEX_NEXT_EMPTY_ENTRY_INPUTS.map(async ([path, hash]) => {
    const input = await artifactForFile(root, `node_modules/next/${path}`);
    assert.equal(input.sha256, hash, "Next empty entry creator differs from pinned original bytes");
    return input;
  }));
}

export async function proveStylexNextEmptyEntryBootstrap(
  root: string,
  target: StylexNextTarget,
  graph: StylexNextEmptyEntryGraphV1,
  output: StylexArtifactV1,
  source: Uint8Array,
): Promise<StylexNextEmptyEntryBootstrapV1> {
  assert.equal(target, "client", "Only Next client graphs may contain empty entry bootstraps");
  assert.deepEqual({ bytes: source.byteLength, sha256: sha256(source) }, { bytes: output.bytes, sha256: output.sha256 }, "Next empty entry output bytes changed");
  const text = Buffer.from(source).toString("utf8");
  assert.ok(Buffer.from(text).equals(Buffer.from(source)), "Next empty entry must retain exact UTF-8 bytes");
  validateStylexNextEmptyEntryPayload(graph, text);
  return validateStylexNextEmptyEntryBootstrap({ graph, inputs: await readStylexNextEmptyEntryInputs(root), output });
}

export async function verifySettledStylexNextEmptyEntryBootstrap(
  root: string,
  outputRoot: string,
  target: StylexNextTarget,
  value: StylexNextEmptyEntryBootstrapV1,
): Promise<void> {
  const recorded = validateStylexNextEmptyEntryBootstrap(value);
  const output = await artifactForFile(outputRoot, recorded.output.path);
  assert.deepEqual(output, recorded.output, "Next empty entry output changed after compilation");
  const source = await readFile(await resolveRootRelativeInput(outputRoot, recorded.output.path));
  assert.deepEqual(await proveStylexNextEmptyEntryBootstrap(root, target, recorded.graph, output, source), recorded, "Next empty entry provenance changed after compilation");
}

/** Classify only non-chunk JavaScript after the compiler has required chunk maps. */
export async function proveStylexNextFrameworkAsset(
  root: string,
  target: StylexNextTarget,
  output: StylexArtifactV1,
  source: Uint8Array,
): Promise<StylexNextFrameworkAssetV1> {
  const role = stylexNextFrameworkRole(output.path, target);
  assert.ok(role !== undefined, `Unmapped Next JavaScript has no reviewed framework role: ${output.path}`);
  assert.deepEqual({ bytes: source.byteLength, sha256: sha256(source) }, { bytes: output.bytes, sha256: output.sha256 }, "Next framework output bytes differ from the emitted asset");
  const input = await readNextFrameworkInput(root, role);
  const text = Buffer.from(source).toString("utf8");
  assert.ok(Buffer.from(text).equals(Buffer.from(source)), "Next framework JavaScript must retain exact UTF-8 bytes");
  validateStylexNextFrameworkPayload(role, output.path, text);
  if (role === "polyfill-nomodule") assert.deepEqual({ bytes: output.bytes, sha256: output.sha256 }, { bytes: input.bytes, sha256: input.sha256 }, "Next framework polyfill differs from the pinned package input");
  return { input, output, role };
}

export async function verifySettledStylexNextFrameworkAsset(
  root: string,
  outputRoot: string,
  target: StylexNextTarget,
  recorded: StylexNextFrameworkAssetV1,
): Promise<void> {
  const output = await artifactForFile(outputRoot, recorded.output.path);
  assert.deepEqual(output, recorded.output, "Next framework output changed after compilation");
  const source = await readFile(await resolveRootRelativeInput(outputRoot, recorded.output.path));
  assert.deepEqual(await proveStylexNextFrameworkAsset(root, target, output, source), recorded, "Next framework output provenance changed after compilation");
}

async function graphReceipts(
  loaded: Readonly<{ plan: StylexNextAttemptPlanV2; root: string }>,
  mode: StylexNextProductionMode,
): Promise<readonly Readonly<{ receipt: StylexNextGraphReceiptV1; receiptSha256: string }>[]> {
  return await Promise.all(STYLEX_NEXT_TARGETS.map(async (target) => {
    const graph = await canonicalFile(join(loaded.root, mode, target, "graph.json"), validateStylexNextGraphReceipt, `Next ${mode} ${target} graph receipt`);
    assert.equal(graph.value.attemptId, loaded.plan.attemptId, "Next graph attempt differs from plan");
    assert.equal(graph.value.mode, mode, "Next graph mode differs from directory");
    assert.equal(graph.value.target, target, "Next graph target differs from directory");
    assert.equal(graph.value.graphId, graphIdForStylexNextTarget(target, loaded.plan.graphMap), "Next graph ID differs from plan");
    assert.deepEqual(graph.value.packages, loaded.plan.packageManifests.map(({ identity }) => identity), "Next graph package inventory differs from plan");
    assert.deepEqual(
      graph.value.modules.map(({ path }) => path),
      loaded.plan.requiredSources[target],
      `Next ${mode} ${target} graph differs from the verified source census`,
    );
    return { receipt: graph.value, receiptSha256: sha256(graph.source) };
  }));
}

async function verifySettledGraphOutputs(
  root: string,
  loaded: Readonly<{ plan: StylexNextAttemptPlanV2; root: string }>,
  mode: StylexNextProductionMode,
  graphs: readonly Readonly<{ receipt: StylexNextGraphReceiptV1; receiptSha256: string }>[],
): Promise<StylexNextPostprocessingReceiptV1> {
  const outputDirectory = mode === "delivery"
    ? loaded.plan.outputDirectory
    : relativeBelow(root, join(loaded.root, "next-discovery"), "Next discovery output directory");
  const outputRoot = resolve(root, ...outputDirectory.split("/"));
  const union = new Map<string, StylexArtifactV1>();
  const ssg: StylexNextSsgPostprocessingV1[] = [];
  const auxiliaryTraceSnapshots: StylexNextAuxiliaryTraceSnapshotV1[] = [];
  for (const { receipt } of graphs) {
    assert.equal(receipt.outputDirectory, outputDirectory, `Next ${mode} ${receipt.target} output directory differs from the attempt`);
    for (const asset of receipt.auxiliaryTraceAssets) {
      assert.ok(!auxiliaryTraceSnapshots.some((snapshot) => snapshot.asset.initial.path === asset.initial.path), "Next auxiliary trace has competing graph owners");
      if (asset.entrypoint === "proxy") {
        for (const path of ["server/middleware.js", "server/middleware.js.nft.json"]) {
          assert.ok(!graphs.some(({ receipt }) => receipt.outputs.some((output) => output.path === path)), "Next proxy rename destination has a competing graph owner");
        }
      }
      auxiliaryTraceSnapshots.push(await observeStylexNextAuxiliaryTraceSnapshot(root, outputRoot, asset, asset.entrypoint === "proxy" ? receipt : undefined));
    }
    for (const framework of receipt.frameworkAssets) {
      if (framework.role === "ssg-manifest") {
        assert.equal(receipt.target, "client", "Only the Next client graph owns native SSG postprocessing");
        assert.equal(ssg.length, 0, "Next graphs contain competing SSG postprocessing owners");
        ssg.push(await proveStylexNextSsgPostprocessing(root, outputRoot, framework));
      } else await verifySettledStylexNextFrameworkAsset(root, outputRoot, receipt.target, framework);
    }
    for (const bootstrap of receipt.emptyEntryBootstraps) await verifySettledStylexNextEmptyEntryBootstrap(root, outputRoot, receipt.target, bootstrap);
    for (const output of receipt.outputs) {
      const previous = union.get(output.path);
      if (previous === undefined) union.set(output.path, output);
      else assert.deepEqual(output, previous, `Next ${mode} graphs emitted conflicting bytes for ${output.path}`);
    }
  }
  for (const expected of union.values()) {
    const postprocessed = ssg.find(({ initial }) => initial.output.path === expected.path);
    const auxiliary = auxiliaryTraceSnapshots.find(({ asset }) => asset.initial.path === expected.path);
    const proxy = auxiliaryTraceSnapshots.find(({ proxyRename }) => proxyRename?.initial.path === expected.path)?.proxyRename;
    assert.ok(postprocessed === undefined || auxiliary === undefined, "A proven framework asset cannot be auxiliary metadata");
    assert.ok(proxy === undefined || (postprocessed === undefined && auxiliary === undefined), "A mapped proxy chunk cannot be framework or auxiliary metadata");
    if (postprocessed !== undefined) assert.deepEqual(expected, postprocessed.initial.output, "Next SSG postprocessing does not match the immutable compiled graph");
    if (auxiliary !== undefined) assert.deepEqual(expected, auxiliary.asset.initial, "Next auxiliary observation lost its original graph artifact");
    if (proxy !== undefined) assert.deepEqual(expected, proxy.initial, "Next proxy native rename differs from its immutable compiled graph");
    const settled = postprocessed?.output ?? auxiliary?.output ?? proxy?.output ?? expected;
    assert.deepEqual(
      await artifactForFile(outputRoot, settled.path),
      settled,
      `Next ${mode} output changed or disappeared after compilation: ${expected.path}`,
    );
  }
  return validateStylexNextPostprocessingReceipt({
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: loaded.plan.attemptId,
    auxiliaryTraceSnapshots: auxiliaryTraceSnapshots.sort((left, right) => compareStylexNextStrings(left.output.path, right.output.path)),
    compilerSha256,
    graphs: graphs.map(({ receipt, receiptSha256 }) => ({ graphId: receipt.graphId, receiptSha256, target: receipt.target })),
    kind: "hraness-stylex-next-postprocessing",
    mode,
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory,
    planSha256: sha256(`${canonicalJson(loaded.plan)}\n`),
    schemaVersion: 1,
    ssg,
  });
}

async function verifySettledGraphCssInputs(
  root: string,
  mode: StylexNextProductionMode,
  graphs: readonly Readonly<{ receipt: StylexNextGraphReceiptV1; receiptSha256: string }>[],
  generatedCssPath: string,
): Promise<void> {
  const union = new Map<string, StylexArtifactV1>();
  let generatedOccurrences = 0;
  for (const { receipt } of graphs) {
    for (const input of receipt.cssInputs) {
      if (input.path === generatedCssPath) {
        assert.ok(
          mode === "delivery" && receipt.target === "client",
          `Only the Next delivery client graph may contain generated StyleX CSS: ${receipt.target}`,
        );
        generatedOccurrences += 1;
      }
      const previous = union.get(input.path);
      if (previous === undefined) union.set(input.path, input);
      else assert.deepEqual(input, previous, `Next ${mode} graphs observed conflicting CSS input bytes for ${input.path}`);
    }
  }
  assert.equal(
    generatedOccurrences,
    mode === "delivery" ? 1 : 0,
    `Next ${mode} graphs must contain ${mode === "delivery" ? "exactly one" : "no"} generated StyleX CSS input`,
  );
  for (const expected of union.values()) {
    const bytes = await readFile(await resolveRootRelativeInput(root, expected.path));
    assert.deepEqual(
      { bytes: bytes.byteLength, path: expected.path, sha256: sha256(bytes) },
      expected,
      `Next ${mode} CSS input changed or disappeared after compilation: ${expected.path}`,
    );
    if (expected.path !== generatedCssPath) {
      auditCssWithoutStylexUnionNamespace(bytes.toString("utf8"), `Next ${mode} CSS input ${expected.path}`);
    }
  }
}

export async function finalizeStylexNextDiscovery(
  attempt: StylexNextAttemptHandle,
  rootDirectory: string,
): Promise<Readonly<{ cssPath: string; entryPath: string; rules: readonly StylexRuleV1[]; rulesSha256: string }>> {
  const loaded = await loadAttempt(attempt);
  const root = await ordinaryDirectory(resolve(rootDirectory), "Next discovery rootDirectory");
  const manifests = await verifyPlanPackages(root, loaded.plan);
  const graphs = await graphReceipts(loaded, "discovery");
  await verifyNextPackageFoundations(root, loaded.plan, manifests, graphs);
  const client = graphs.find(({ receipt }) => receipt.target === "client")!.receipt;
  stylexNextDeliveryCssOwnerNames(client.entrypoints.map(({ name }) => name));
  const postprocessing = await verifySettledGraphOutputs(root, loaded, "discovery", graphs);
  const generatedCssLogical = relativeBelow(root, join(loaded.root, "generated", "stylex.css"), "Next generated CSS");
  await verifySettledGraphCssInputs(root, "discovery", graphs, generatedCssLogical);
  await writeCanonicalExclusive(join(loaded.root, "discovery", "postprocessing.json"), postprocessing, "Next discovery postprocessing receipt", async () => {
    const current = await loadAttempt(attempt);
    await verifyPlanPackages(root, current.plan);
    const currentGraphs = await graphReceipts(current, "discovery");
    assert.deepEqual(await verifySettledGraphOutputs(root, current, "discovery", currentGraphs), postprocessing, "Next discovery postprocessing changed before settlement");
    await verifySettledGraphCssInputs(root, "discovery", currentGraphs, generatedCssLogical);
  });
  const rules = canonicalizeStylexRules(
    ...manifests.map(({ rules: packageRules }) => packageRules),
    ...graphs.map(({ receipt }) => receipt.rules),
  );
  const css = serializeStylexRuleUnionV1(rules, manifests.map(({ standaloneSerializer }) => standaloneSerializer));
  const cssPath = join(loaded.root, "generated", "stylex.css");
  const entryPath = join(loaded.root, "generated", "entry.mjs");
  await writeFile(cssPath, css, { flag: "wx", mode: 0o644 });
  await writeFile(entryPath, STYLEX_NEXT_GENERATED_ENTRY_SOURCE, { flag: "wx", mode: 0o644 });
  return { cssPath, entryPath, rules, rulesSha256: stylexRulesSha256(rules) };
}

async function validateStylexNextCompletion(
  attempt: StylexNextAttemptHandle,
  rootDirectory: string,
): Promise<Readonly<{ directory: string; record: StylexNextBuildRecordV2; deliveryPostprocessing: StylexNextPostprocessingReceiptV1 }>> {
  const loaded = await loadAttempt(attempt);
  const root = await ordinaryDirectory(resolve(rootDirectory), "Next completion rootDirectory");
  await verifyGeneratedEntry(loaded.root);
  const manifests = await verifyPlanPackages(root, loaded.plan);
  const discovery = await graphReceipts(loaded, "discovery");
  const delivery = await graphReceipts(loaded, "delivery");
  await verifyNextPackageFoundations(root, loaded.plan, manifests, discovery);
  await verifyNextPackageFoundations(root, loaded.plan, manifests, delivery);
  const discoveryPostprocessing = await verifySettledGraphOutputs(root, loaded, "discovery", discovery);
  const settledDiscovery = await canonicalFile(join(loaded.root, "discovery", "postprocessing.json"), validateStylexNextPostprocessingReceipt, "Next discovery postprocessing receipt");
  assert.deepEqual(settledDiscovery.value, discoveryPostprocessing, "Next discovery postprocessing changed after settlement");
  const deliveryPostprocessing = await verifySettledGraphOutputs(root, loaded, "delivery", delivery);
  assert.deepEqual(
    deliveryPostprocessing.ssg.map(({ locales, routes }) => ({ locales, routes })),
    discoveryPostprocessing.ssg.map(({ locales, routes }) => ({ locales, routes })),
    "Next SSG route projection drifted between discovery and delivery",
  );
  const postprocessingArtifact = (mode: StylexNextProductionMode, value: StylexNextPostprocessingReceiptV1): StylexArtifactV1 => {
    const source = `${canonicalJson(value)}\n`;
    return { bytes: Buffer.byteLength(source), path: relativeBelow(root, join(loaded.root, mode, "postprocessing.json"), "Next postprocessing receipt"), sha256: sha256(source) };
  };
  const generatedCssLogical = relativeBelow(root, join(loaded.root, "generated", "stylex.css"), "Next generated CSS");
  await verifySettledGraphCssInputs(root, "discovery", discovery, generatedCssLogical);
  await verifySettledGraphCssInputs(root, "delivery", delivery, generatedCssLogical);
  for (const target of STYLEX_NEXT_TARGETS) {
    const discoveryModules = await loadModuleReceipts(loaded, root, "discovery", target);
    const deliveryModules = await loadModuleReceipts(loaded, root, "delivery", target);
    assert.deepEqual(
      deliveryModules.map(({ receipt }) => moduleStableIdentity(receipt)),
      discoveryModules.map(({ receipt }) => moduleStableIdentity(receipt)),
      `Next ${target} source, transform, rule, or map drifted before completion`,
    );
    const expectedDiscovery = discoveryModules.map(({ receipt, receiptSha256 }) => ({ path: receipt.input.path, receiptSha256 }));
    const expectedDelivery = deliveryModules.map(({ receipt, receiptSha256 }) => ({ path: receipt.input.path, receiptSha256 }));
    assert.deepEqual(
      discovery.find(({ receipt }) => receipt.target === target)!.receipt.modules,
      expectedDiscovery,
      `Next discovery ${target} graph no longer matches its module receipts`,
    );
    assert.deepEqual(
      delivery.find(({ receipt }) => receipt.target === target)!.receipt.modules,
      expectedDelivery,
      `Next delivery ${target} graph no longer matches its module receipts`,
    );
  }
  const discoveryStable = discovery.map(({ receipt }) => ({
    graphId: receipt.graphId,
    modules: receipt.modules.map(({ path }) => path),
    packages: receipt.packages,
    rules: receipt.rules,
    target: receipt.target,
    webpackVersion: receipt.webpackVersion,
  }));
  const deliveryStable = delivery.map(({ receipt }) => ({
    graphId: receipt.graphId,
    modules: receipt.modules.map(({ path }) => path),
    packages: receipt.packages,
    rules: receipt.rules,
    target: receipt.target,
    webpackVersion: receipt.webpackVersion,
  }));
  assert.deepEqual(deliveryStable, discoveryStable, "Next graph inventory drifted between discovery and delivery");
  const rules = canonicalizeStylexRules(
    ...manifests.map(({ rules: packageRules }) => packageRules),
    ...discovery.map(({ receipt }) => receipt.rules),
  );
  const generatedCss = await readFile(join(loaded.root, "generated", "stylex.css"));
  assert.equal(generatedCss.toString("utf8"), serializeStylexRuleUnionV1(rules, manifests.map(({ standaloneSerializer }) => standaloneSerializer)), "Next finalized CSS drifted after discovery");
  const finalCss = await artifactForFile(root, generatedCssLogical);
  for (const target of STYLEX_NEXT_TARGETS) {
    const discoveryCss = discovery.find(({ receipt }) => receipt.target === target)!.receipt.cssInputs;
    const deliveryCss = delivery.find(({ receipt }) => receipt.target === target)!.receipt.cssInputs;
    if (target === "client") {
      assert.deepEqual(
        deliveryCss,
        [...discoveryCss, finalCss].sort((left, right) => compareStylexNextStrings(left.path, right.path)),
        "Next client CSS input inventory must add exactly the finalized StyleX CSS between discovery and delivery",
      );
    } else {
      assert.ok(!deliveryCss.some(({ path }) => path === generatedCssLogical), `Next ${target} graph imported generated StyleX CSS`);
      assert.deepEqual(deliveryCss, discoveryCss, `Next ${target} CSS input inventory drifted between discovery and delivery`);
    }
  }
  const discoveryClient = discovery.find(({ receipt }) => receipt.target === "client")!.receipt;
  const client = delivery.find(({ receipt }) => receipt.target === "client")!.receipt;
  assert.deepEqual(
    client.entrypoints.map(({ name }) => name),
    discoveryClient.entrypoints.map(({ name }) => name),
    "Next client entrypoint topology drifted between discovery and delivery",
  );
  const plannedOwners = stylexNextDeliveryCssOwnerNames(discoveryClient.entrypoints.map(({ name }) => name));
  assert.deepEqual(
    client.entrypoints.filter(({ stylexCss }) => stylexCss.length > 0).map(({ name }) => name),
    plannedOwners,
    "Next delivery generated StyleX CSS owners differ from the discovery App Router plan",
  );
  assert.deepEqual(
    client.cssInputs.filter(({ path }) => path === generatedCssLogical),
    [finalCss],
    "Next delivery client graph omitted or changed the finalized StyleX CSS input",
  );
  const graphIdentity = ({ receipt, receiptSha256 }: { receipt: StylexNextGraphReceiptV1; receiptSha256: string }): StylexNextGraphIdentityV1 => ({
    graphId: receipt.graphId,
    receiptSha256,
    target: receipt.target,
  });
  const record = validateStylexNextBuildRecord({
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: loaded.plan.attemptId,
    compilerSha256,
    delivery: delivery.map(graphIdentity),
    discovery: discovery.map(graphIdentity),
    finalCss,
    kind: "hraness-stylex-next-build",
    nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory: loaded.plan.outputDirectory,
    packages: loaded.plan.packageManifests.map(({ identity }) => identity),
    postprocessing: {
      delivery: postprocessingArtifact("delivery", deliveryPostprocessing),
      discovery: postprocessingArtifact("discovery", discoveryPostprocessing),
    },
    rulesSha256: stylexRulesSha256(rules),
    schemaVersion: STYLEX_NEXT_BUILD_SCHEMA_VERSION,
    unionPolicySha256: stylexUnionPolicySha256,
    state: "complete",
  });
  return { directory: loaded.root, record, deliveryPostprocessing };
}

export async function completeStylexNextBuild(
  attempt: StylexNextAttemptHandle,
  rootDirectory: string,
  revalidateBeforeCommit?: () => Promise<void>,
): Promise<StylexNextBuildRecordV2> {
  const completed = await validateStylexNextCompletion(attempt, rootDirectory);
  const deliveryPath = join(completed.directory, "delivery", "postprocessing.json");
  await writeCanonicalExclusive(deliveryPath, completed.deliveryPostprocessing, "Next delivery postprocessing receipt", async () => {
    const settled = await validateStylexNextCompletion(attempt, rootDirectory);
    assert.deepEqual(settled.record, completed.record, "Next build evidence changed before delivery settlement");
  });
  await writeCanonicalExclusive(
    join(completed.directory, "complete.json"),
    completed.record,
    "Next complete record",
    async () => {
      await revalidateBeforeCommit?.();
      const settled = await validateStylexNextCompletion(attempt, rootDirectory);
      assert.equal(settled.directory, completed.directory, "Next attempt directory changed before complete-record commit");
      assert.deepEqual(settled.record, completed.record, "Next build evidence changed before complete-record commit");
      const delivery = await canonicalFile(deliveryPath, validateStylexNextPostprocessingReceipt, "Next delivery postprocessing receipt");
      assert.deepEqual(delivery.value, settled.deliveryPostprocessing, "Next delivery postprocessing changed after settlement");
    },
  );
  return completed.record;
}

export async function readStylexNextAttemptPlan(attempt: StylexNextAttemptHandle): Promise<StylexNextAttemptPlanV2> {
  return (await loadAttempt(attempt)).plan;
}

export async function readStylexNextGraphReceipt(
  attempt: StylexNextAttemptHandle,
  mode: StylexNextProductionMode,
  target: StylexNextTarget,
): Promise<StylexNextGraphReceiptV1> {
  const loaded = await loadAttempt(attempt);
  return (await canonicalFile(join(loaded.root, mode, target, "graph.json"), validateStylexNextGraphReceipt, `Next ${mode} ${target} graph receipt`)).value;
}

/** Proves completed compiler ownership even when the later native typecheck fails. */
export async function readStylexNextTypeScriptGraphReceipts(
  attempt: StylexNextAttemptHandle,
  rootDirectory: string,
  mode: StylexNextProductionMode,
): Promise<readonly StylexNextGraphReceiptV1[]> {
  const loaded = await loadAttempt(attempt);
  const graphs = await graphReceipts(loaded, mode);
  for (const { receipt } of graphs) {
    const modules = await loadModuleReceipts(loaded, rootDirectory, mode, receipt.target);
    assert.deepEqual(
      modules.map(({ receipt: module, receiptSha256 }) => ({ path: module.input.path, receiptSha256 })),
      receipt.modules,
      `Next ${mode} ${receipt.target} TypeScript provenance lost its compiler source census`,
    );
  }
  return graphs.map(({ receipt }) => receipt);
}

export function nextGraphReceiptSha256(receipt: StylexNextGraphReceiptV1): string {
  return stylexNextReceiptSha256(validateStylexNextGraphReceipt(receipt));
}
