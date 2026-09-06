import assert from "node:assert/strict";
import { COPYFILE_EXCL } from "node:constants";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
  link,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ErrorCodes,
  html,
  parse,
  type DefaultTreeAdapterMap,
  type ParserError,
} from "parse5";

import {
  STYLEX_COMPLETE_RECORD_SCHEMA_VERSION,
  STYLEX_GENERATION_SCHEMA_VERSION,
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
  type CreateStylexGenerationOptions,
  type FinalizeStylexGenerationOptions,
  type StylexArtifactV1,
  type StylexCompleteRecordV1,
  type StylexGenerationHandleV1,
  type StylexGenerationPlanV1,
  type StylexGraphEdgeV1,
  type StylexGraphExpectationV1,
  type StylexGraphReceiptV1,
  type StylexPackageIdentityV1,
  type StylexPackageManifestV1,
  type StylexTemplateV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  canonicalJson,
  canonicalizeStylexRules,
  compilerContract,
  compilerSha256,
  normalizeLogicalPath,
  parseStylexRules,
  readStylexPackageManifest,
  resolveRootRelativeInput,
  serializeStylexRules,
  sha256,
  stylexRulesSha256,
  validateStylexPackageManifest,
} from "./compiler.js";

const CONTROL = ".stylex-generation";
const PLAN = `${CONTROL}/plan.json`;
const PACKAGES = `${CONTROL}/packages`;
const PACKAGE_INPUTS = `${CONTROL}/package-inputs`;
const RECEIPTS = `${CONTROL}/receipts`;
const GRAPHS = `${CONTROL}/graphs`;
const TEMPLATE_INPUTS = `${CONTROL}/template-inputs`;
const PRODUCED_TEMPLATES = `${CONTROL}/produced-templates`;
const PRODUCED_TEMPLATE_RECEIPTS = `${CONTROL}/produced-template-receipts`;
const PAYLOAD = "payload";
const COMPLETE_RECORD = "stylex-complete.json";
const MUTATION_LOCK = `${CONTROL}/mutation.lock`;
const FINALIZE_LOCK = `${CONTROL}/finalize.lock`;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function keys(record: Record<string, unknown>, required: readonly string[], description: string, optional: readonly string[] = []): void {
  const allowed = [...required, ...optional];
  assert.deepEqual(Object.keys(record).filter((key) => !allowed.includes(key)).sort(), [], `${description} contains unknown keys`);
  for (const key of required) assert.ok(Object.hasOwn(record, key), `${description} is missing ${key}`);
}

function string(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), `${description} must be a nonempty printable string`);
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${description} must be lowercase SHA-256`);
  return value;
}

function segment(value: unknown, description: string): string {
  const candidate = string(value, description);
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(candidate) && candidate !== "." && candidate !== "..", `${description} must be a safe path segment`);
  return candidate;
}

function rootRelativeLocator(rootDirectory: string, value: unknown, description: string): string {
  const locator = string(value, description);
  const absolutePath = isAbsolute(locator);
  if (!absolutePath && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(locator)) {
    return normalizeLogicalPath(locator, description);
  }
  let absolute: string;
  if (absolutePath) {
    // On Windows, drive-letter paths also match the URI-scheme grammar. Native
    // absolute-path recognition must win so C:\\... is not misparsed as c:.
    absolute = locator;
  } else {
    const url = new URL(locator);
    assert.equal(url.protocol, "file:", `${description} URL must use the file protocol`);
    assert.equal(url.search, "", `${description} URL must not contain a query`);
    assert.equal(url.hash, "", `${description} URL must not contain a fragment`);
    absolute = fileURLToPath(url);
  }
  const logical = relative(rootDirectory, resolve(absolute)).split(sep).join("/");
  return normalizeLogicalPath(logical, description);
}

function strings(
  value: unknown,
  description: string,
  paths = false,
  canonicalize = false,
): readonly string[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((item, index) => paths ? normalizeLogicalPath(item, `${description}[${String(index)}]`) : string(item, `${description}[${String(index)}]`));
  const sorted = [...output].sort();
  if (!canonicalize) {
    assert.deepEqual(output, sorted, `${description} must be sorted`);
  }
  assert.equal(new Set(output).size, output.length, `${description} must be unique`);
  return canonicalize ? sorted : output;
}

function parseArtifact(value: unknown, description: string): StylexArtifactV1 {
  const record = object(value, description);
  keys(record, ["bytes", "path", "sha256"], description);
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0, `${description}.bytes must be nonnegative`);
  return { bytes: record.bytes as number, path: normalizeLogicalPath(record.path, `${description}.path`), sha256: sha(record.sha256, `${description}.sha256`) };
}

function parseArtifacts(value: unknown, description: string): readonly StylexArtifactV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const result = value.map((item, index) => parseArtifact(item, `${description}[${String(index)}]`));
  assert.deepEqual(result.map(({ path }) => path), result.map(({ path }) => path).sort(), `${description} must be path sorted`);
  assert.equal(new Set(result.map(({ path }) => path)).size, result.length, `${description} paths must be unique`);
  return result;
}

function parseIdentity(value: unknown, description: string): StylexPackageIdentityV1 {
  const record = object(value, description);
  keys(record, ["manifestSha256", "name", "version"], description);
  return { manifestSha256: sha(record.manifestSha256, `${description}.manifestSha256`), name: string(record.name, `${description}.name`), version: string(record.version, `${description}.version`) };
}

function identities(value: unknown, description: string): readonly StylexPackageIdentityV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const result = value.map((item, index) => parseIdentity(item, `${description}[${String(index)}]`));
  assert.deepEqual(result, [...result].sort((a, b) => compareStrings(canonicalJson(a), canonicalJson(b))), `${description} must be canonical sorted`);
  assert.equal(new Set(result.map((item) => `${item.name}\0${item.version}\0${item.manifestSha256}`)).size, result.length, `${description} must be unique`);
  const byPackage = new Map<string, StylexPackageIdentityV1>();
  for (const identity of result) {
    const previous = byPackage.get(identity.name);
    assert.equal(
      previous,
      undefined,
      `${description} contains more than one identity for package ${identity.name}`,
    );
    byPackage.set(identity.name, identity);
  }
  return result;
}

function expectation(
  value: unknown,
  description: string,
  canonicalizeEntrypoints = false,
): StylexGraphExpectationV1 {
  const record = object(value, description);
  keys(record, ["adapter", "entrypoints", "id", "kind"], description);
  assert.ok(record.adapter === "bun" || record.adapter === "vite", `${description}.adapter is invalid`);
  assert.ok(record.kind === "client" || record.kind === "ssr", `${description}.kind is invalid`);
  const entrypoints = strings(
    record.entrypoints,
    `${description}.entrypoints`,
    true,
    canonicalizeEntrypoints,
  );
  assert.ok(entrypoints.length > 0, `${description} must have entrypoints`);
  return { adapter: record.adapter, entrypoints, id: segment(record.id, `${description}.id`), kind: record.kind };
}

function template(value: unknown, description: string): StylexTemplateV1 {
  const record = object(value, description);
  keys(record, ["cssHref", "outputPath", "sourcePath", "stylesheetGraphId"], description, ["graphId"]);
  const cssHref = string(record.cssHref, `${description}.cssHref`);
  assert.ok(
    !/[?#%]/u.test(cssHref)
      && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(cssHref)
      && !cssHref.includes("\\")
      && cssHref.trim() === cssHref,
    `${description}.cssHref must be an unencoded local path without query or fragment`,
  );
  const result: { cssHref: string; graphId?: string; outputPath: string; sourcePath: string; stylesheetGraphId: string } = {
    cssHref,
    outputPath: normalizeLogicalPath(record.outputPath, `${description}.outputPath`),
    sourcePath: normalizeLogicalPath(record.sourcePath, `${description}.sourcePath`),
    stylesheetGraphId: segment(record.stylesheetGraphId, `${description}.stylesheetGraphId`),
  };
  if (record.graphId !== undefined) result.graphId = segment(record.graphId, `${description}.graphId`);
  return result;
}

function parsePlan(value: unknown): StylexGenerationPlanV1 {
  const record = object(value, "generation plan");
  keys(record, ["compiler", "compilerSha256", "expectedGraphs", "finalCssPath", "generationId", "kind", "packages", "schemaVersion", "templates"], "generation plan");
  assert.equal(record.kind, "hraness-stylex-generation");
  assert.equal(record.schemaVersion, STYLEX_GENERATION_SCHEMA_VERSION);
  assert.equal(canonicalJson(record.compiler), canonicalJson(compilerContract), "Generation compiler contract is stale");
  assert.equal(record.compilerSha256, compilerSha256, "Generation compiler hash is stale");
  assert.ok(Array.isArray(record.expectedGraphs), "expectedGraphs must be an array");
  const expectedGraphs = record.expectedGraphs.map((item, index) => expectation(item, `expectedGraphs[${String(index)}]`));
  assert.deepEqual(expectedGraphs, [...expectedGraphs].sort((a, b) => compareStrings(a.id, b.id)), "expectedGraphs must be ID sorted");
  assert.equal(new Set(expectedGraphs.map(({ id }) => id)).size, expectedGraphs.length, "Graph IDs must be unique");
  assert.ok(expectedGraphs.length > 0, "At least one graph is required");
  const packages = identities(record.packages, "generation packages");
  assert.ok(packages.length > 0, "At least one package manifest is required");
  assert.ok(Array.isArray(record.templates), "templates must be an array");
  const templates = record.templates.map((item, index) => template(item, `templates[${String(index)}]`));
  assert.deepEqual(templates, [...templates].sort((a, b) => compareStrings(a.outputPath, b.outputPath)), "templates must be output sorted");
  assert.equal(new Set(templates.map(({ outputPath }) => outputPath)).size, templates.length, "Template outputs must be unique");
  const graphIds = new Set(expectedGraphs.map(({ id }) => id));
  for (const item of templates) {
    if (item.graphId !== undefined) assert.ok(graphIds.has(item.graphId), `Template ${item.outputPath} cites an unexpected producer graph: ${item.graphId}`);
    assert.ok(graphIds.has(item.stylesheetGraphId), `Template ${item.outputPath} cites an unexpected stylesheet graph: ${item.stylesheetGraphId}`);
  }
  return {
    compiler: compilerContract, compilerSha256, expectedGraphs,
    finalCssPath: normalizeLogicalPath(record.finalCssPath, "finalCssPath"),
    generationId: segment(record.generationId, "generationId"), kind: "hraness-stylex-generation",
    packages, schemaVersion: STYLEX_GENERATION_SCHEMA_VERSION, templates,
  };
}

function parseEdge(value: unknown, description: string): StylexGraphEdgeV1 {
  const record = object(value, description);
  keys(record, ["external", "from", "kind", "to"], description);
  assert.ok(typeof record.external === "boolean", `${description}.external must be boolean`);
  return {
    external: record.external,
    from: graphReference(record.from, `${description}.from`),
    kind: string(record.kind, `${description}.kind`),
    to: graphReference(record.to, `${description}.to`),
  };
}

function graphReference(value: unknown, description: string): string {
  const reference = string(value, description);
  if (reference === "$entry") return reference;
  const separator = reference.indexOf(":");
  if (separator < 0) return normalizeLogicalPath(reference, description);
  const namespace = reference.slice(0, separator);
  const payload = reference.slice(separator + 1);
  assert.ok(["external", "input", "output", "package", "resource", "virtual"].includes(namespace), `${description} has an unsupported namespace`);
  if (namespace === "resource" || namespace === "virtual") sha(payload, `${description} payload`);
  else if (namespace === "input" || namespace === "output" || namespace === "package") normalizeLogicalPath(payload, `${description} payload`);
  else {
    string(payload, `${description} payload`);
    assert.ok(
      !payload.includes("\\")
        && !payload.startsWith("/")
        && !/^[A-Za-z]:\//u.test(payload)
        && !payload.startsWith("./")
        && !payload.startsWith("../")
        && !payload.toLowerCase().startsWith("file:"),
      `${description} external payload must not identify a local path`,
    );
  }
  return `${namespace}:${payload}`;
}

function parseReceipt(value: unknown): StylexGraphReceiptV1 {
  const record = object(value, "graph receipt");
  keys(record, ["adapter", "compilerSha256", "edges", "entrypoints", "generationId", "graphId", "inputs", "kind", "outputRoot", "outputs", "packages", "planSha256", "rules", "rulesSha256", "schemaVersion", "state", "target"], "graph receipt");
  assert.equal(record.kind, "hraness-stylex-graph-receipt");
  assert.equal(record.schemaVersion, STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION);
  assert.equal(record.state, "complete");
  assert.ok(record.adapter === "bun" || record.adapter === "vite", "graph receipt adapter is invalid");
  assert.ok(record.target === "client" || record.target === "ssr", "graph receipt target is invalid");
  assert.ok(Array.isArray(record.edges), "graph receipt edges must be an array");
  const edges = record.edges.map((item, index) => parseEdge(item, `edges[${String(index)}]`));
  assert.deepEqual(edges, [...edges].sort((a, b) => compareStrings(canonicalJson(a), canonicalJson(b))), "Graph edges must be canonical sorted");
  assert.equal(new Set(edges.map(canonicalJson)).size, edges.length, "Graph edges must be unique");
  const rules = canonicalizeStylexRules(parseStylexRules(record.rules));
  assert.equal(canonicalJson(rules), canonicalJson(record.rules), "Graph rules must be canonical and deduplicated");
  const rulesSha256 = stylexRulesSha256(rules);
  assert.equal(record.rulesSha256, rulesSha256, "Graph rule hash is stale");
  const inputs = parseArtifacts(record.inputs, "receipt inputs");
  const outputs = parseArtifacts(record.outputs, "receipt outputs");
  assert.ok(inputs.length > 0, "Graph receipt must contain at least one input");
  assert.ok(outputs.length > 0, "Graph receipt must contain at least one output");
  return {
    adapter: record.adapter, compilerSha256: sha(record.compilerSha256, "compilerSha256"), edges,
    entrypoints: strings(record.entrypoints, "receipt entrypoints", true),
    generationId: segment(record.generationId, "receipt generationId"), graphId: segment(record.graphId, "receipt graphId"),
    inputs, kind: "hraness-stylex-graph-receipt",
    outputRoot: normalizeLogicalPath(record.outputRoot, "receipt outputRoot"), outputs,
    packages: identities(record.packages, "receipt packages"), planSha256: sha(record.planSha256, "receipt planSha256"),
    rules, rulesSha256, schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION, state: "complete", target: record.target,
  };
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error: unknown) => {
    if (objectErrorCode(error) === "ENOENT") return false;
    throw error;
  });
}

function objectErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function writeCanonicalExclusive(
  path: string,
  value: unknown,
  revalidateBeforeCommit?: () => Promise<void>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let committed = false;
  let created = false;
  let operationError: unknown;
  try {
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`);
      await handle.sync();
    } catch (error) {
      operationError = error;
    }
    try {
      await handle.close();
    } catch (error) {
      operationError = operationError === undefined
        ? error
        : new AggregateError(
          [operationError, error],
          `Canonical temporary write and close both failed: ${temporary}`,
        );
    }
    if (operationError !== undefined) throw operationError;
    await revalidateBeforeCommit?.();
    await link(temporary, path);
    committed = true;
  } catch (error) {
    operationError = error;
  }

  if (created) {
    try {
      await rm(temporary, { force: true });
    } catch (cleanupError) {
      const message = committed
        ? `Canonical target was committed but temporary cleanup failed: ${path}`
        : `Canonical write failed and temporary cleanup also failed: ${path}`;
      throw operationError === undefined
        ? new AggregateError([cleanupError], message)
        : new AggregateError([operationError, cleanupError], message);
    }
  }
  if (operationError !== undefined) throw operationError;
}

async function withMutationLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const path = join(directory, MUTATION_LOCK);
  const handle = await open(path, "wx", 0o600);
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  const cleanupErrors: unknown[] = [];
  try {
    await handle.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await unlink(path);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      operationError === undefined ? cleanupErrors : [operationError, ...cleanupErrors],
      `StyleX mutation lock cleanup failed: ${path}`,
    );
  }
  if (operationError !== undefined) throw operationError;
  return result as T;
}

type PublicationHandle = Readonly<{ close: () => Promise<void> }>;
type UnlinkPublicationLock = (path: string) => Promise<void>;

export async function cleanupFailedPublicationLock(
  path: string,
  handle: PublicationHandle | undefined,
  owned: boolean,
  operationError: unknown,
  unlinkPath: UnlinkPublicationLock = unlink,
): Promise<never> {
  const errors: unknown[] = [operationError];
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (owned) {
    try {
      await unlinkPath(path);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `StyleX publication failed and publication lock cleanup also failed: ${path}`,
      { cause: operationError },
    );
  }
  throw operationError;
}

async function writeSyncAndClose(
  handle: Awaited<ReturnType<typeof open>>,
  source: string,
  description: string,
): Promise<void> {
  let operationError: unknown;
  try {
    await handle.writeFile(source);
    await handle.sync();
  } catch (error) {
    operationError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    throw operationError === undefined
      ? error
      : new AggregateError([operationError, error], `${description} write and close both failed`);
  }
  if (operationError !== undefined) throw operationError;
}

async function filesBelow(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (prefix.length > 0) assert.ok(entries.length > 0, `Output must not contain an unowned empty directory: ${prefix}`);
    for (const entry of entries) {
      const logical = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      normalizeLogicalPath(logical, "graph output path");
      const absolute = join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `Graph output must not contain symlinks: ${logical}`);
      if (entry.isDirectory()) await visit(absolute, logical);
      else {
        assert.ok(entry.isFile(), `Graph output must contain only ordinary files: ${logical}`);
        files.push(logical);
      }
    }
  }
  await visit(root, "");
  return files.sort();
}

function templateInputName(templateValue: StylexTemplateV1): string {
  assert.equal(templateValue.graphId, undefined, "Graph-produced templates do not have preparation-time inputs");
  return `${sha256(templateValue.sourcePath)}.template`;
}

function producedTemplateName(templateValue: StylexTemplateV1): string {
  assert.ok(templateValue.graphId !== undefined, "Produced templates must declare a producer graph");
  return sha256(canonicalJson({
    graphId: templateValue.graphId,
    outputPath: templateValue.outputPath,
    sourcePath: templateValue.sourcePath,
  }));
}

function producedTemplateForOutput(plan: StylexGenerationPlanV1, outputPath: unknown): StylexTemplateV1 & { graphId: string } {
  const normalized = normalizeLogicalPath(outputPath, "produced template outputPath");
  const result = plan.templates.find((item) => item.outputPath === normalized);
  assert.ok(result !== undefined && result.graphId !== undefined, `No graph-produced template is registered for ${normalized}`);
  return result as StylexTemplateV1 & { graphId: string };
}

type ProducedTemplateReceipt = Readonly<{
  artifact: StylexArtifactV1;
  graphId: string;
  kind: "hraness-stylex-produced-template-receipt";
  outputPath: string;
  planSha256: string;
  sourcePath: string;
  state: "complete";
}>;

function parseProducedTemplateReceipt(value: unknown): ProducedTemplateReceipt {
  const record = object(value, "produced template receipt");
  keys(record, ["artifact", "graphId", "kind", "outputPath", "planSha256", "sourcePath", "state"], "produced template receipt");
  assert.equal(record.kind, "hraness-stylex-produced-template-receipt");
  assert.equal(record.state, "complete");
  return {
    artifact: parseArtifact(record.artifact, "produced template receipt artifact"),
    graphId: segment(record.graphId, "produced template receipt graphId"),
    kind: "hraness-stylex-produced-template-receipt",
    outputPath: normalizeLogicalPath(record.outputPath, "produced template receipt outputPath"),
    planSha256: sha(record.planSha256, "produced template receipt planSha256"),
    sourcePath: normalizeLogicalPath(record.sourcePath, "produced template receipt sourcePath"),
    state: "complete",
  };
}

export type LoadedStylexGeneration = Readonly<{
  expectedGraph(id: string): StylexGraphExpectationV1;
  packageManifests: readonly StylexPackageManifestV1[];
  plan: StylexGenerationPlanV1;
}>;

type LivePackageFoundation = Readonly<{
  artifact: StylexArtifactV1;
  compilerFoundation: string;
  packageName: string;
}>;

function packageInputIdentity(path: string): Readonly<{ name: string; path: string }> | undefined {
  const parts = path.split("/");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex === -1 || nodeModulesIndex + 1 >= parts.length) return undefined;
  const first = parts[nodeModulesIndex + 1]!;
  const scoped = first.startsWith("@");
  const nameEnd = nodeModulesIndex + (scoped ? 3 : 2);
  if (nameEnd > parts.length) return undefined;
  const name = parts.slice(nodeModulesIndex + 1, nameEnd).join("/");
  const packagePath = parts.slice(nameEnd).join("/");
  if (packagePath.length === 0) return undefined;
  return { name, path: packagePath };
}

export async function loadStylexGeneration(handle: StylexGenerationHandleV1): Promise<LoadedStylexGeneration> {
  const handleRecord = object(handle, "generation handle");
  keys(handleRecord, ["directory", "planSha256"], "generation handle");
  const directoryValue = string(handleRecord.directory, "generation handle directory");
  assert.equal(resolve(directoryValue), directoryValue, "Generation directory must be absolute");
  const directory = await realDirectory(directoryValue, "generation directory");
  const planSha256 = sha(handleRecord.planSha256, "generation handle planSha256");
  const source = await readFile(join(directory, PLAN), "utf8");
  const plan = parsePlan(JSON.parse(source) as unknown);
  assert.equal(source, `${canonicalJson(plan)}\n`, "Generation plan must be canonical JSON");
  assert.equal(sha256(source), planSha256, "Generation handle plan hash is stale");
  const expectedPackageRecords = plan.packages.map(({ manifestSha256 }) => `${manifestSha256}.json`).sort();
  const expectedPackageInputs = plan.packages.map(({ manifestSha256 }) => `${manifestSha256}.path`).sort();
  const expectedTemplateInputs = [...new Set(plan.templates.filter(({ graphId }) => graphId === undefined).map(templateInputName))].sort();
  assert.deepEqual((await readdir(join(directory, PACKAGES))).sort(), expectedPackageRecords, "Staged package manifest inventory is missing or unexpected");
  assert.deepEqual((await readdir(join(directory, PACKAGE_INPUTS))).sort(), expectedPackageInputs, "Staged package input inventory is missing or unexpected");
  assert.deepEqual((await readdir(join(directory, TEMPLATE_INPUTS))).sort(), expectedTemplateInputs, "Staged template input inventory is missing or unexpected");
  const packageManifests = await Promise.all(plan.packages.map(async (identity) => {
    const manifestSource = await readFile(join(directory, PACKAGES, `${identity.manifestSha256}.json`), "utf8");
    const manifest = validateStylexPackageManifest(JSON.parse(manifestSource) as unknown);
    assert.equal(manifestSource, `${canonicalJson(manifest)}\n`, "Staged package manifest is not canonical");
    assert.equal(sha256(manifestSource), identity.manifestSha256, "Staged package manifest identity changed");
    assert.deepEqual(manifest.package, { name: identity.name, version: identity.version }, "Staged package identity changed");
    return manifest;
  }));
  return {
    expectedGraph(id) {
      const graph = plan.expectedGraphs.find((item) => item.id === id);
      assert.ok(graph !== undefined, `Unexpected graph ID: ${id}`);
      return graph;
    },
    packageManifests,
    plan,
  };
}

async function verifyLivePackageInputs(rootDirectory: string, directory: string, loaded: LoadedStylexGeneration): Promise<void> {
  for (const identity of loaded.plan.packages) {
    const locatorSource = await readFile(join(directory, PACKAGE_INPUTS, `${identity.manifestSha256}.path`), "utf8");
    assert.equal(locatorSource.endsWith("\n"), true, `Package input locator is malformed for ${identity.name}@${identity.version}`);
    const manifestPath = normalizeLogicalPath(locatorSource.slice(0, -1), `Package input for ${identity.name}@${identity.version}`);
    assert.equal(locatorSource, `${manifestPath}\n`, `Package input locator is noncanonical for ${identity.name}@${identity.version}`);
    const absolute = await resolveRootRelativeInput(rootDirectory, manifestPath);
    const manifest = await readStylexPackageManifest(absolute);
    const manifestSource = `${canonicalJson(manifest)}\n`;
    assert.equal(sha256(manifestSource), identity.manifestSha256, `Package manifest changed after generation preparation: ${identity.name}@${identity.version}`);
    assert.deepEqual(manifest.package, { name: identity.name, version: identity.version }, `Package identity changed after generation preparation: ${identity.name}@${identity.version}`);
  }
}

async function livePackageFoundations(
  rootDirectory: string,
  directory: string,
  loaded: LoadedStylexGeneration,
): Promise<readonly LivePackageFoundation[]> {
  const foundations: LivePackageFoundation[] = [];
  for (const identity of loaded.plan.packages) {
    const locatorSource = await readFile(join(directory, PACKAGE_INPUTS, `${identity.manifestSha256}.path`), "utf8");
    assert.equal(locatorSource.endsWith("\n"), true, `Package input locator is malformed for ${identity.name}@${identity.version}`);
    const manifestPath = normalizeLogicalPath(locatorSource.slice(0, -1), `Package input for ${identity.name}@${identity.version}`);
    assert.equal(locatorSource, `${manifestPath}\n`, `Package input locator is noncanonical for ${identity.name}@${identity.version}`);
    const manifestAbsolute = await resolveRootRelativeInput(rootDirectory, manifestPath);
    const manifest = await readStylexPackageManifest(manifestAbsolute);
    assert.deepEqual(manifest.package, { name: identity.name, version: identity.version });
    const packageRoot = resolve(dirname(manifestAbsolute), "..");
    const foundationAbsolute = await resolveRootRelativeInput(packageRoot, manifest.compilerFoundation);
    const foundationPath = normalizeLogicalPath(
      relative(rootDirectory, foundationAbsolute).split(sep).join("/"),
      `Compiler foundation for ${identity.name}@${identity.version}`,
    );
    const foundation = manifest.stylesheets.find(({ path }) => path === manifest.compilerFoundation);
    assert.ok(foundation !== undefined, `Package manifest omits its compiler foundation: ${identity.name}@${identity.version}`);
    foundations.push({
      artifact: { ...foundation, path: foundationPath },
      compilerFoundation: manifest.compilerFoundation,
      packageName: identity.name,
    });
  }
  return foundations;
}

function assertGraphIncludesPackageFoundations(
  receipt: StylexGraphReceiptV1,
  foundations: readonly LivePackageFoundation[],
): void {
  for (const foundation of foundations) {
    const matches = receipt.inputs.filter(({ path }) => {
      if (path === foundation.artifact.path) return true;
      const identity = packageInputIdentity(path);
      return identity?.name === foundation.packageName
        && identity.path === foundation.compilerFoundation;
    });
    assert.equal(
      matches.length,
      1,
      `Stylesheet graph ${receipt.graphId} must include the compiler foundation for ${foundation.packageName}: ${foundation.artifact.path}`,
    );
    assert.deepEqual(
      matches[0] === undefined
        ? undefined
        : { bytes: matches[0].bytes, sha256: matches[0].sha256 },
      { bytes: foundation.artifact.bytes, sha256: foundation.artifact.sha256 },
      `Stylesheet graph ${receipt.graphId} compiler foundation differs from ${foundation.packageName}'s manifest`,
    );
  }
}

function linkedOutputTarget(outputPath: string, href: string): string {
  assert.ok(
    !/[?#]/u.test(href)
      && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(href)
      && !href.startsWith("//")
      && !href.includes("\\")
      && !href.includes("%")
      && href.trim() === href
      && !/[\u0000-\u001f\u007f]/u.test(href),
    "Registered stylesheet href must be an unencoded local path without query or fragment",
  );
  const raw = href.startsWith("/")
    ? href.slice(1)
    : posix.join(posix.dirname(outputPath), href);
  return normalizeLogicalPath(posix.normalize(raw), "template stylesheet target");
}

function hrefTarget(templateValue: StylexTemplateV1): string {
  return linkedOutputTarget(templateValue.outputPath, templateValue.cssHref);
}

export async function createStylexGeneration(options: CreateStylexGenerationOptions): Promise<StylexGenerationHandleV1> {
  const rawOptions = object(options, "createStylexGeneration options");
  keys(rawOptions, ["expectedGraphs", "generationId", "outputDirectory", "packageManifests", "rootDirectory"], "createStylexGeneration options", ["finalCssPath", "templates"]);
  const rootDirectory = await realDirectory(string(rawOptions.rootDirectory, "rootDirectory"), "rootDirectory");
  const generationId = segment(rawOptions.generationId, "generationId");
  const finalCssPath = normalizeLogicalPath(rawOptions.finalCssPath ?? "stylex.css", "finalCssPath");
  assert.ok(Array.isArray(rawOptions.expectedGraphs) && rawOptions.expectedGraphs.length > 0, "expectedGraphs must be nonempty");
  const expectedGraphs = rawOptions.expectedGraphs
    .map((item, index) => expectation(item, `expectedGraphs[${String(index)}]`, true))
    .sort((a, b) => compareStrings(a.id, b.id));
  assert.equal(new Set(expectedGraphs.map(({ id }) => id)).size, expectedGraphs.length, "Graph IDs must be unique");
  const rawTemplates = rawOptions.templates ?? [];
  assert.ok(Array.isArray(rawTemplates), "templates must be an array");
  const templates = rawTemplates.map((item, index) => template(item, `templates[${String(index)}]`)).sort((a, b) => compareStrings(a.outputPath, b.outputPath));
  assert.equal(new Set(templates.map(({ outputPath }) => outputPath)).size, templates.length, "Template outputs must be unique");
  assert.ok(templates.every((item) => item.outputPath !== finalCssPath && hrefTarget(item) === finalCssPath), "Every template must link the exact final CSS path without colliding with it");
  const graphIds = new Set(expectedGraphs.map(({ id }) => id));
  for (const item of templates) {
    if (item.graphId !== undefined) assert.ok(graphIds.has(item.graphId), `Template ${item.outputPath} cites an unexpected producer graph: ${item.graphId}`);
    assert.ok(graphIds.has(item.stylesheetGraphId), `Template ${item.outputPath} cites an unexpected stylesheet graph: ${item.stylesheetGraphId}`);
  }
  assert.ok(Array.isArray(rawOptions.packageManifests) && rawOptions.packageManifests.length > 0, "packageManifests must be nonempty");
  const packageManifestPaths = rawOptions.packageManifests.map((item, index) =>
    rootRelativeLocator(rootDirectory, item, `packageManifests[${String(index)}]`)
  );
  assert.equal(new Set(packageManifestPaths).size, packageManifestPaths.length, "packageManifests must be unique");
  await mkdir(resolve(string(rawOptions.outputDirectory, "outputDirectory")), { recursive: true });
  const outputDirectory = await realDirectory(string(rawOptions.outputDirectory, "outputDirectory"), "outputDirectory");
  assert.equal(await exists(join(outputDirectory, generationId)), false, "Generation output already exists");
  const directory = await mkdtemp(join(outputDirectory, `.hraness-stylex-${generationId}-`));
  try {
    await Promise.all([
      mkdir(join(directory, GRAPHS), { recursive: true }),
      mkdir(join(directory, PACKAGES), { recursive: true }),
      mkdir(join(directory, PACKAGE_INPUTS), { recursive: true }),
      mkdir(join(directory, RECEIPTS), { recursive: true }),
      mkdir(join(directory, PRODUCED_TEMPLATES), { recursive: true }),
      mkdir(join(directory, PRODUCED_TEMPLATE_RECEIPTS), { recursive: true }),
      mkdir(join(directory, TEMPLATE_INPUTS), { recursive: true }),
      mkdir(join(directory, PAYLOAD), { recursive: true }),
    ]);
    const loadedPackages = await Promise.all(packageManifestPaths.map(async (manifestPath) => {
      const absolute = await resolveRootRelativeInput(rootDirectory, manifestPath);
      const manifest = await readStylexPackageManifest(absolute);
      const source = `${canonicalJson(manifest)}\n`;
      return { identity: { manifestSha256: sha256(source), ...manifest.package }, manifest, manifestPath, source };
    }));
    loadedPackages.sort((a, b) => compareStrings(canonicalJson(a.identity), canonicalJson(b.identity)));
    assert.equal(new Set(loadedPackages.map(({ identity }) => canonicalJson(identity))).size, loadedPackages.length, "Package manifests must be unique");
    const packageIdentities = new Map<string, StylexPackageIdentityV1>();
    const standalonePrefixes = new Map<string, string>();
    for (const item of loadedPackages) {
      const previous = packageIdentities.get(item.identity.name);
      assert.equal(
        previous,
        undefined,
        `More than one identity was supplied for package ${item.identity.name}`,
      );
      packageIdentities.set(item.identity.name, item.identity);
      const prefix = item.manifest.standaloneSerializer.prefix;
      const overlappingPrefix = [...standalonePrefixes.entries()].find(([registered]) =>
        registered === prefix
          || registered.startsWith(`${prefix}.`)
          || prefix.startsWith(`${registered}.`)
      );
      assert.equal(
        overlappingPrefix,
        undefined,
        `Packages ${overlappingPrefix?.[1] ?? "<unknown>"} and ${item.identity.name} have overlapping standalone StyleX namespaces: ${overlappingPrefix?.[0] ?? prefix} and ${prefix}`,
      );
      standalonePrefixes.set(prefix, item.identity.name);
      await writeFile(join(directory, PACKAGES, `${item.identity.manifestSha256}.json`), item.source, { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, PACKAGE_INPUTS, `${item.identity.manifestSha256}.path`), `${item.manifestPath}\n`, { flag: "wx", mode: 0o600 });
    }
    const stagedTemplateInputs = new Map<string, string>();
    for (const item of templates) {
      if (item.graphId !== undefined) continue;
      const name = templateInputName(item);
      const previous = stagedTemplateInputs.get(name);
      if (previous !== undefined) {
        assert.equal(item.sourcePath, previous, "Template input digest collision");
        continue;
      }
      const source = await readFile(await resolveRootRelativeInput(rootDirectory, item.sourcePath));
      await writeFile(join(directory, TEMPLATE_INPUTS, name), source, { flag: "wx", mode: 0o600 });
      stagedTemplateInputs.set(name, item.sourcePath);
    }
    const plan: StylexGenerationPlanV1 = {
      compiler: compilerContract, compilerSha256, expectedGraphs, finalCssPath, generationId,
      kind: "hraness-stylex-generation", packages: loadedPackages.map(({ identity }) => identity),
      schemaVersion: STYLEX_GENERATION_SCHEMA_VERSION, templates,
    };
    const planSource = `${canonicalJson(parsePlan(plan))}\n`;
    await writeFile(join(directory, PLAN), planSource, { flag: "wx", mode: 0o600 });
    return { directory, planSha256: sha256(planSource) };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`StyleX generation preparation failed; evidence retained at ${directory}${detail}`, { cause: error });
  }
}

async function realDirectory(path: string, description: string): Promise<string> {
  const absolute = resolve(path);
  const stat = await lstat(absolute);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${description} must be an ordinary directory`);
  const physical = await realpath(absolute);
  assert.equal(physical, absolute, `${description} must not traverse a symlink`);
  return physical;
}

export type PreparedStylexGraph = Readonly<{ outputDirectory: string; outputRoot: string }>;

export async function prepareStylexGraph(generation: StylexGenerationHandleV1, graphId: string): Promise<PreparedStylexGraph> {
  const loaded = await loadStylexGeneration(generation);
  const graph = loaded.expectedGraph(segment(graphId, "graphId"));
  const outputRoot = `${GRAPHS}/${graph.id}/output`;
  const outputDirectory = join(generation.directory, ...outputRoot.split("/"));
  await withMutationLock(generation.directory, async () => {
    assert.equal(await exists(join(generation.directory, FINALIZE_LOCK)), false, "Generation finalization already started; graph metadata is late");
    assert.equal(await exists(join(generation.directory, RECEIPTS, `${graph.id}.json`)), false, "Graph receipt already exists");
    await mkdir(join(generation.directory, GRAPHS, graph.id), { recursive: false });
    await mkdir(outputDirectory, { recursive: false });
  });
  return { outputDirectory, outputRoot };
}

export type PreparedStylexProducedTemplate = Readonly<{
  outputPath: string;
  sourcePath: string;
}>;

async function requireTemplateProducerReceipt(
  generation: StylexGenerationHandleV1,
  loaded: LoadedStylexGeneration,
  templateValue: StylexTemplateV1 & { graphId: string },
): Promise<StylexGraphReceiptV1> {
  const { receipt } = await loadReceipt(generation.directory, templateValue.graphId);
  const expected = loaded.expectedGraph(templateValue.graphId);
  assert.equal(receipt.generationId, loaded.plan.generationId, "Produced template graph receipt belongs to another generation");
  assert.equal(receipt.planSha256, generation.planSha256, "Produced template graph receipt has a stale plan hash");
  assert.equal(receipt.compilerSha256, compilerSha256, "Produced template graph receipt has a stale compiler hash");
  assert.equal(receipt.adapter, expected.adapter, "Produced template graph receipt has the wrong adapter");
  assert.equal(receipt.target, expected.kind, "Produced template graph receipt has the wrong target");
  assert.deepEqual(receipt.entrypoints, expected.entrypoints, "Produced template graph receipt has stale entrypoints");
  assert.deepEqual(receipt.packages, loaded.plan.packages, "Produced template graph receipt has stale packages");
  assert.ok(
    !receipt.outputs.some(({ path }) => path === templateValue.sourcePath),
    `Produced template source must not alias the sealed graph output inventory: ${templateValue.sourcePath}`,
  );
  return receipt;
}

export async function prepareStylexProducedTemplate(
  generation: StylexGenerationHandleV1,
  outputPath: string,
): Promise<PreparedStylexProducedTemplate> {
  const loaded = await loadStylexGeneration(generation);
  const templateValue = producedTemplateForOutput(loaded.plan, outputPath);
  const name = producedTemplateName(templateValue);
  const templateRoot = join(generation.directory, PRODUCED_TEMPLATES, name);
  const sourcePath = join(templateRoot, ...templateValue.sourcePath.split("/"));
  await withMutationLock(generation.directory, async () => {
    assert.equal(await exists(join(generation.directory, FINALIZE_LOCK)), false, "Generation finalization already started; produced template preparation is late");
    await requireTemplateProducerReceipt(generation, loaded, templateValue);
    await mkdir(templateRoot, { recursive: false });
    await mkdir(dirname(sourcePath), { recursive: true });
    assert.equal(await exists(sourcePath), false, "Produced template source already exists");
  });
  return { outputPath: templateValue.outputPath, sourcePath };
}

export async function sealStylexProducedTemplate(
  generation: StylexGenerationHandleV1,
  outputPath: string,
): Promise<StylexArtifactV1> {
  const loaded = await loadStylexGeneration(generation);
  const templateValue = producedTemplateForOutput(loaded.plan, outputPath);
  const name = producedTemplateName(templateValue);
  const templateRoot = join(generation.directory, PRODUCED_TEMPLATES, name);
  return withMutationLock(generation.directory, async () => {
    assert.equal(await exists(join(generation.directory, FINALIZE_LOCK)), false, "Generation finalization already started; produced template receipt is late");
    await requireTemplateProducerReceipt(generation, loaded, templateValue);
    assert.deepEqual(await filesBelow(templateRoot), [templateValue.sourcePath], "Produced template staging differs from its declared source path");
    const artifact = await artifactForFile(templateRoot, templateValue.sourcePath);
    const receipt: ProducedTemplateReceipt = {
      artifact,
      graphId: templateValue.graphId,
      kind: "hraness-stylex-produced-template-receipt",
      outputPath: templateValue.outputPath,
      planSha256: generation.planSha256,
      sourcePath: templateValue.sourcePath,
      state: "complete",
    };
    await writeCanonicalExclusive(join(generation.directory, PRODUCED_TEMPLATE_RECEIPTS, `${name}.json`), receipt);
    return artifact;
  });
}

async function verifyArtifact(root: string, artifact: StylexArtifactV1): Promise<void> {
  const actual = await artifactForFile(root, artifact.path);
  assert.deepEqual(actual, artifact, `Artifact changed: ${artifact.path}`);
}

async function auditCssInputs(
  rootDirectory: string,
  inputs: readonly StylexArtifactV1[],
  manifests: readonly StylexPackageManifestV1[],
  description: string,
): Promise<void> {
  for (const input of inputs.filter(({ path }) => path.endsWith(".css"))) {
    const ordinary = await resolveRootRelativeInput(rootDirectory, input.path);
    const bytes = await readFile(ordinary);
    assert.deepEqual(
      { bytes: bytes.byteLength, sha256: sha256(bytes) },
      { bytes: input.bytes, sha256: input.sha256 },
      `CSS input changed while reconstructing its audit receipt: ${input.path}`,
    );
    const css = bytes.toString("utf8");
    auditCssWithoutStandaloneRecipes(css, manifests, description);
  }
}

export type WriteStylexGraphReceiptOptions = Readonly<{
  generation: StylexGenerationHandleV1;
  receipt: unknown;
  revalidateBeforeCommit?: () => Promise<void>;
  rootDirectory: string;
}>;

export async function writeStylexGraphReceipt(options: WriteStylexGraphReceiptOptions): Promise<StylexGraphReceiptV1> {
  const rawOptions = object(options, "writeStylexGraphReceipt options");
  keys(
    rawOptions,
    ["generation", "receipt", "rootDirectory"],
    "writeStylexGraphReceipt options",
    ["revalidateBeforeCommit"],
  );
  assert.ok(
    rawOptions.revalidateBeforeCommit === undefined || typeof rawOptions.revalidateBeforeCommit === "function",
    "writeStylexGraphReceipt options.revalidateBeforeCommit must be a function",
  );
  const revalidateBeforeCommit = rawOptions.revalidateBeforeCommit as (() => Promise<void>) | undefined;
  const generation = rawOptions.generation as StylexGenerationHandleV1;
  const loaded = await loadStylexGeneration(generation);
  const receipt = parseReceipt(rawOptions.receipt);
  const expected = loaded.expectedGraph(receipt.graphId);
  assert.equal(receipt.generationId, loaded.plan.generationId);
  assert.equal(receipt.planSha256, generation.planSha256);
  assert.equal(receipt.compilerSha256, compilerSha256);
  assert.equal(receipt.adapter, expected.adapter);
  assert.equal(receipt.target, expected.kind);
  assert.deepEqual(receipt.entrypoints, expected.entrypoints);
  const inputPaths = new Set(receipt.inputs.map(({ path }) => path));
  for (const entrypoint of expected.entrypoints) assert.ok(inputPaths.has(entrypoint), `Graph receipt omits entrypoint input ${entrypoint}`);
  assert.deepEqual(receipt.packages, loaded.plan.packages);
  assert.equal(receipt.outputRoot, `${GRAPHS}/${receipt.graphId}/output`, "Graph outputRoot is not the owned staging root");
  const rootDirectory = await realDirectory(string(rawOptions.rootDirectory, "rootDirectory"), "rootDirectory");
  await Promise.all(receipt.inputs.map((item) => verifyArtifact(rootDirectory, item)));
  if (loaded.plan.templates.some(({ stylesheetGraphId }) => stylesheetGraphId === receipt.graphId)) {
    assertGraphIncludesPackageFoundations(
      receipt,
      await livePackageFoundations(rootDirectory, generation.directory, loaded),
    );
  }
  await auditCssInputs(
    rootDirectory,
    receipt.inputs,
    loaded.packageManifests,
    `Graph ${receipt.graphId} inputs`,
  );
  const graphRoot = join(generation.directory, ...receipt.outputRoot.split("/"));
  assert.deepEqual(await readdir(join(generation.directory, GRAPHS, receipt.graphId)), ["output"], "Graph staging contains unexpected entries");
  assert.deepEqual(await filesBelow(graphRoot), receipt.outputs.map(({ path }) => path), "Graph receipt outputs differ from the settled graph output inventory");
  await Promise.all(receipt.outputs.map((item) => verifyArtifact(graphRoot, item)));
  for (const css of receipt.outputs.filter(({ path }) => path.endsWith(".css"))) {
    const bytes = await readFile(join(graphRoot, ...css.path.split("/")));
    assert.deepEqual(
      { bytes: bytes.byteLength, sha256: sha256(bytes) },
      { bytes: css.bytes, sha256: css.sha256 },
      `Graph CSS output changed while reconstructing its audit receipt: ${css.path}`,
    );
    const source = bytes.toString("utf8");
    auditCssWithoutStandaloneRecipes(
      source,
      loaded.packageManifests,
      `Graph ${receipt.graphId} output`,
    );
    auditCssWithoutStylexRules(source, receipt.rules, `Graph ${receipt.graphId}`);
  }
  await withMutationLock(generation.directory, async () => {
    assert.equal(await exists(join(generation.directory, FINALIZE_LOCK)), false, "Generation finalization already started; graph receipt is late");
    await writeCanonicalExclusive(
      join(generation.directory, RECEIPTS, `${receipt.graphId}.json`),
      receipt,
      async () => {
        await Promise.all(receipt.inputs.map((item) => verifyArtifact(rootDirectory, item)));
        await Promise.all(receipt.outputs.map((item) => verifyArtifact(graphRoot, item)));
        await revalidateBeforeCommit?.();
      },
    );
  });
  return receipt;
}

async function loadReceipt(directory: string, graphId: string): Promise<{ receipt: StylexGraphReceiptV1; source: string }> {
  const path = join(directory, RECEIPTS, `${graphId}.json`);
  const source = await readFile(path, "utf8");
  const receipt = parseReceipt(JSON.parse(source) as unknown);
  assert.equal(source, `${canonicalJson(receipt)}\n`, `Receipt ${graphId} is not canonical`);
  assert.equal(receipt.graphId, graphId, `Receipt filename does not match graph ID ${graphId}`);
  return { receipt, source };
}

async function loadProducedTemplateReceipt(
  directory: string,
  templateValue: StylexTemplateV1 & { graphId: string },
): Promise<ProducedTemplateReceipt> {
  const name = producedTemplateName(templateValue);
  const source = await readFile(join(directory, PRODUCED_TEMPLATE_RECEIPTS, `${name}.json`), "utf8");
  const receipt = parseProducedTemplateReceipt(JSON.parse(source) as unknown);
  assert.equal(source, `${canonicalJson(receipt)}\n`, `Produced template receipt is not canonical: ${templateValue.outputPath}`);
  return receipt;
}

async function copyExclusive(source: string, destinationRoot: string, logicalPath: string): Promise<StylexArtifactV1> {
  const path = normalizeLogicalPath(logicalPath);
  const destination = join(destinationRoot, ...path.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, COPYFILE_EXCL);
  return artifactForFile(destinationRoot, path);
}

type ParsedLinkAttribute = Readonly<{
  quoted: boolean;
  value?: string;
}>;

function htmlAsciiWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/u.test(character);
}

function parseHtmlAttributes(
  tag: string,
  elementName: "link" | "template",
): ReadonlyMap<string, ParsedLinkAttribute> {
  const prefix = new RegExp(`^<${elementName}(?=[\\t\\n\\f\\r />])`, "i").exec(tag);
  assert.ok(prefix !== null, `Registered ${elementName} tag has an invalid name boundary`);
  const attributes = new Map<string, ParsedLinkAttribute>();
  let index = prefix[0].length;
  while (index < tag.length) {
    let separated = false;
    while (htmlAsciiWhitespace(tag[index])) {
      separated = true;
      index += 1;
    }
    if (tag[index] === ">" && index === tag.length - 1) return attributes;
    if (tag[index] === "/" && tag[index + 1] === ">" && index === tag.length - 2) return attributes;
    assert.equal(separated, true, `Registered ${elementName} attributes must be separated by HTML whitespace`);
    const nameStart = index;
    while (
      index < tag.length
      && !htmlAsciiWhitespace(tag[index])
      && tag[index] !== "="
      && tag[index] !== "/"
      && tag[index] !== ">"
    ) {
      index += 1;
    }
    assert.ok(index > nameStart, `Registered ${elementName} contains an invalid attribute name`);
    const name = tag.slice(nameStart, index).toLowerCase();
    assert.equal(/["'<`\u0000]/u.test(name), false, `Registered ${elementName} contains an invalid attribute name`);
    assert.equal(attributes.has(name), false, `Registered ${elementName} must not repeat its ${name} attribute`);
    while (htmlAsciiWhitespace(tag[index])) index += 1;
    if (tag[index] !== "=") {
      attributes.set(name, { quoted: false });
      continue;
    }
    index += 1;
    while (htmlAsciiWhitespace(tag[index])) index += 1;
    const quote = tag[index] === "\"" || tag[index] === "'" ? tag[index] : undefined;
    let value: string;
    if (quote !== undefined) {
      index += 1;
      const valueStart = index;
      while (index < tag.length && tag[index] !== quote) index += 1;
      assert.ok(index < tag.length, `Registered ${elementName} ${name} attribute has an unterminated quoted value`);
      value = tag.slice(valueStart, index);
      index += 1;
      assert.ok(
        htmlAsciiWhitespace(tag[index]) || tag[index] === "/" || tag[index] === ">",
        `Registered ${elementName} attributes must be separated by HTML whitespace`,
      );
    } else {
      const valueStart = index;
      while (index < tag.length && !htmlAsciiWhitespace(tag[index]) && tag[index] !== ">") index += 1;
      value = tag.slice(valueStart, index);
      assert.ok(value.length > 0, `Registered ${elementName} ${name} attribute must have a value`);
      assert.equal(/["'<=`\u0000]/u.test(value), false, `Registered ${elementName} ${name} attribute has an invalid unquoted value`);
    }
    attributes.set(name, { quoted: quote !== undefined, value });
  }
  throw new Error(`Registered ${elementName} tag is not terminated canonically`);
}

function parseLinkAttributes(tag: string): ReadonlyMap<string, ParsedLinkAttribute> {
  return parseHtmlAttributes(tag, "link");
}

function linkAttribute(
  attributes: ReadonlyMap<string, ParsedLinkAttribute>,
  name: string,
): Readonly<{ quoted: boolean; value: string }> | undefined {
  const attribute = attributes.get(name);
  if (attribute === undefined) return undefined;
  assert.ok(attribute.value !== undefined, `Registered link ${name} attribute must have a valid value`);
  const { value } = attribute;
  assert.equal(
    value.includes("&"),
    false,
    `Registered link ${name} attribute must not contain HTML character references`,
  );
  return {
    quoted: attribute.quoted,
    value,
  };
}

type ActiveHtmlTag = Readonly<{ name: string; source: string }>;

function htmlTagEnd(
  source: string,
  attributeStart: number,
): Readonly<{ end: number; selfClosing: boolean }> {
  let state:
    | "after-attribute-name"
    | "after-quoted-value"
    | "attribute-name"
    | "before-attribute-name"
    | "before-attribute-value"
    | "self-closing"
    | "single-quoted-value"
    | "double-quoted-value"
    | "unquoted-value" = "before-attribute-name";
  for (let index = attributeStart; index < source.length; index += 1) {
    const character = source[index];
    if (state === "double-quoted-value") {
      if (character === "\"") state = "after-quoted-value";
      continue;
    }
    if (state === "single-quoted-value") {
      if (character === "'") state = "after-quoted-value";
      continue;
    }
    if (state === "unquoted-value") {
      if (character === ">") return { end: index, selfClosing: false };
      if (htmlAsciiWhitespace(character)) state = "before-attribute-name";
      continue;
    }
    if (state === "before-attribute-value") {
      if (htmlAsciiWhitespace(character)) continue;
      if (character === ">") return { end: index, selfClosing: false };
      if (character === "\"") state = "double-quoted-value";
      else if (character === "'") state = "single-quoted-value";
      else state = "unquoted-value";
      continue;
    }
    if (state === "self-closing") {
      if (character === ">") return { end: index, selfClosing: true };
      state = "before-attribute-name";
    }
    if (state === "after-quoted-value") {
      if (htmlAsciiWhitespace(character)) {
        state = "before-attribute-name";
        continue;
      }
      if (character === "/") {
        state = "self-closing";
        continue;
      }
      if (character === ">") return { end: index, selfClosing: false };
      state = "attribute-name";
      continue;
    }
    if (state === "before-attribute-name" || state === "after-attribute-name") {
      if (htmlAsciiWhitespace(character)) continue;
      if (character === "/") {
        state = "self-closing";
        continue;
      }
      if (character === ">") return { end: index, selfClosing: false };
      if (state === "after-attribute-name" && character === "=") {
        state = "before-attribute-value";
        continue;
      }
      state = "attribute-name";
      continue;
    }
    if (state === "attribute-name") {
      if (htmlAsciiWhitespace(character)) state = "after-attribute-name";
      else if (character === "/") state = "self-closing";
      else if (character === "=") state = "before-attribute-value";
      else if (character === ">") return { end: index, selfClosing: false };
    }
  }
  throw new Error("Registered template contains an unterminated HTML tag");
}

function lexicallyValidatedHtmlTags(source: string): readonly ActiveHtmlTag[] {
  const tags: ActiveHtmlTag[] = [];
  const inertElements = new Set(["noscript", "template"]);
  const rawTextElements = new Set([
    "iframe",
    "noembed",
    "noframes",
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
  ]);
  const inertStack: string[] = [];
  const foreignStack: string[] = [];
  let framesetDepth = 0;
  let selectDepth = 0;
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("<", index);
    if (start < 0) break;
    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      const noncanonicalEnd = source.indexOf("--!>", start + 4);
      assert.equal(
        source.startsWith("<!-->", start)
          || source.startsWith("<!--->", start)
          || (noncanonicalEnd >= 0 && (end < 0 || noncanonicalEnd < end)),
        false,
        "Registered template contains a noncanonical HTML comment close",
      );
      assert.ok(end >= 0, "Registered template contains an unterminated HTML comment");
      index = end + 3;
      continue;
    }
    const match = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\t\n\f\r />])/u.exec(source.slice(start));
    if (match === null) {
      const doctype = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(source.slice(start));
      if (doctype !== null) {
        index = start + doctype[0].length;
        continue;
      }
      throw new Error("Registered template contains unsupported or malformed markup");
    }
    const { end, selfClosing } = htmlTagEnd(source, start + match[0].length);
    const tag = source.slice(start, end + 1);
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    if (closing) {
      const wasInert = inertStack.length > 0;
      if (inertElements.has(name)) {
        assert.equal(
          inertStack.at(-1),
          name,
          `Registered template contains a mismatched ${name} inert closing element`,
        );
        inertStack.pop();
      }
      if (wasInert) {
        index = end + 1;
        continue;
      }
      if (foreignStack.length > 0) {
        const matchingForeign = foreignStack.lastIndexOf(name);
        if (matchingForeign >= 0) foreignStack.length = matchingForeign;
        index = end + 1;
        continue;
      }
      if (name === "select" && selectDepth > 0) selectDepth -= 1;
      if (name === "frameset" && framesetDepth > 0) framesetDepth -= 1;
      index = end + 1;
      continue;
    }
    assert.notEqual(
      name,
      "plaintext",
      "Registered templates do not support plaintext elements",
    );
    assert.equal(
      (inertElements.has(name) || rawTextElements.has(name)) && selfClosing,
      false,
      `Registered template does not support self-closing ${name} elements`,
    );
    const active = inertStack.length === 0;
    if (active && foreignStack.length > 0) {
      assert.notEqual(
        name,
        "link",
        "Registered stylesheet links must be HTML-namespace elements",
      );
      if (!selfClosing) foreignStack.push(name);
      index = end + 1;
      continue;
    }
    if (active && (name === "svg" || name === "math")) {
      tags.push({ name, source: tag });
      if (!selfClosing) foreignStack.push(name);
      index = end + 1;
      continue;
    }
    if (active && name === "link") {
      assert.equal(selectDepth, 0, "Registered stylesheet links may not appear in select insertion mode");
      assert.equal(framesetDepth, 0, "Registered stylesheet links may not appear in frameset insertion mode");
    }
    if (active && name === "template") {
      assert.equal(
        parseHtmlAttributes(tag, "template").has("shadowrootmode"),
        false,
        "Registered templates do not support declarative shadow roots",
      );
    }
    if (active) tags.push({ name, source: tag });
    if (inertElements.has(name)) inertStack.push(name);
    if (active && name === "select") selectDepth += 1;
    if (active && name === "frameset") framesetDepth += 1;
    if (rawTextElements.has(name)) {
      const closingPattern = new RegExp(`<\\/${name}(?=[\\t\\n\\f\\r />])`, "gi");
      closingPattern.lastIndex = end + 1;
      const closingMatch = closingPattern.exec(source);
      assert.ok(closingMatch !== null, `Registered template contains an unterminated ${name} element`);
      const { end: closingEnd } = htmlTagEnd(source, closingPattern.lastIndex);
      const closingTag = source.slice(closingMatch.index, closingEnd + 1);
      assert.match(
        closingTag,
        new RegExp(`^<\\/${name}[\\t\\n\\f\\r ]*>$`, "i"),
        `Registered template contains a noncanonical ${name} closing element`,
      );
      index = closingEnd + 1;
      continue;
    }
    index = end + 1;
  }
  assert.deepEqual(inertStack, [], "Registered template contains an unterminated inert element");
  assert.deepEqual(foreignStack, [], "Registered template contains unterminated foreign content");
  return tags;
}

function activeHtmlTags(source: string): readonly ActiveHtmlTag[] {
  // Keep the deliberately strict lexical pass as a canonical-source fence, but
  // never use its flat token stream as the browser topology authority.
  void lexicallyValidatedHtmlTags(source);

  const errors: ParserError[] = [];
  const document = parse(source, {
    onParseError(error) {
      if (error.code !== ErrorCodes.missingDoctype) errors.push(error);
    },
    scriptingEnabled: true,
    sourceCodeLocationInfo: true,
  });
  const [firstError] = errors;
  assert.equal(
    firstError,
    undefined,
    firstError === undefined
      ? "Registered template must parse as canonical HTML"
      : `Registered template contains HTML parse error ${firstError.code} at ${firstError.startLine}:${firstError.startCol}`,
  );

  const tags: ActiveHtmlTag[] = [];
  const visit = (nodes: readonly DefaultTreeAdapterMap["childNode"][]): void => {
    for (const node of nodes) {
      if (!("tagName" in node)) continue;
      const name = node.tagName.toLowerCase();
      const htmlElement = node.namespaceURI === html.NS.HTML;
      if (name === "link" && !htmlElement) {
        throw new Error("Registered stylesheet links must be HTML-namespace elements");
      }
      if (name === "style" && !htmlElement) {
        tags.push({ name, source: "" });
      }
      if (htmlElement) {
        if (name === "template") {
          assert.equal(
            node.attrs.some((attribute) => attribute.name === "shadowrootmode"),
            false,
            "Registered templates do not support declarative shadow roots",
          );
          // Ordinary template contents are inert and live on `content`, not in
          // the active document tree. Do not traverse or count them.
          continue;
        }
        assert.notEqual(
          name,
          "plaintext",
          "Registered templates do not support plaintext elements",
        );
        if (["base", "link", "noscript", "style"].includes(name)) {
          const startTag = node.sourceCodeLocation?.startTag;
          assert.ok(startTag !== undefined, `Registered ${name} element has no source location`);
          tags.push({
            name,
            source: source.slice(startTag.startOffset, startTag.endOffset),
          });
        }
      }
      visit(node.childNodes);
    }
  };
  visit(document.childNodes);
  return tags;
}

function stylesheetLinks(source: string): readonly string[] {
  const links: string[] = [];
  const tags = activeHtmlTags(source);
  assert.equal(tags.some(({ name }) => name === "base"), false, "Registered templates do not support an active base element");
  assert.equal(tags.some(({ name }) => name === "style"), false, "Registered templates do not support active inline style elements");
  assert.equal(tags.some(({ name }) => name === "noscript"), false, "Registered templates do not support script-dependent stylesheet topology through noscript");
  for (const { name, source: tag } of tags) {
    if (name !== "link") continue;
    const attributes = parseLinkAttributes(tag);
    const relAttribute = linkAttribute(attributes, "rel");
    assert.ok(relAttribute !== undefined && relAttribute.quoted, "Registered link must have exactly one quoted rel attribute");
    const hrefAttribute = linkAttribute(attributes, "href");
    if (hrefAttribute !== undefined) {
      assert.ok(hrefAttribute.quoted, "Registered link href attributes must be quoted");
    }
    const rel = relAttribute.value
      .split(/[\t\n\f\r ]+/u)
      .filter((value) => value.length > 0)
      .map((value) => value.toLowerCase());
    if (!rel.includes("stylesheet")) continue;
    assert.deepEqual(rel, ["stylesheet"], "Registered stylesheet links must use the exact stylesheet relationship");
    assert.equal(attributes.has("disabled"), false, "Registered stylesheet links must not be disabled");
    assert.equal(attributes.has("media"), false, "Registered stylesheet links must not be conditional");
    assert.equal(attributes.has("integrity"), false, "Registered stylesheet link integrity is not modeled by this generation");
    const typeAttribute = linkAttribute(attributes, "type");
    if (typeAttribute !== undefined) {
      assert.ok(typeAttribute.quoted && typeAttribute.value.toLowerCase() === "text/css", "Registered stylesheet link type must be quoted text/css");
    }
    assert.ok(hrefAttribute !== undefined && hrefAttribute.value.length > 0, "Registered stylesheet link must have one nonempty quoted href");
    links.push(hrefAttribute.value);
  }
  return links;
}

function assertRenderedTemplateLinks(
  source: string,
  templateValue: StylexTemplateV1,
  finalCssPath: string,
  allowedGraphStylesheets: ReadonlySet<string>,
  requiredGraphStylesheets: ReadonlySet<string>,
): void {
  const links = stylesheetLinks(source);
  assert.equal(links.filter((href) => href === templateValue.cssHref).length, 1, "Rendered template must link the finalized CSS exactly once");
  const finalStylesheetIndex = links.indexOf(templateValue.cssHref);
  assert.ok(finalStylesheetIndex >= 0, "Rendered template must link the finalized CSS");
  const graphTargets: string[] = [];
  for (const [index, href] of links.entries()) {
    const target = linkedOutputTarget(templateValue.outputPath, href);
    if (href === templateValue.cssHref) {
      assert.equal(target, finalCssPath, "Rendered template final stylesheet target changed");
      continue;
    }
    assert.ok(allowedGraphStylesheets.has(target), `Registered template links an unregistered stylesheet: ${href}`);
    assert.ok(
      index < finalStylesheetIndex,
      `Rendered template graph stylesheet must precede the finalized CSS: ${href}`,
    );
    graphTargets.push(target);
  }
  for (const required of requiredGraphStylesheets) {
    assert.equal(
      graphTargets.filter((target) => target === required).length,
      1,
      `Rendered template must link required graph stylesheet exactly once: ${required}`,
    );
  }
}

function injectFailure(failAfter: FinalizeStylexGenerationOptions["failAfter"], boundary: NonNullable<FinalizeStylexGenerationOptions["failAfter"]>): void {
  if (failAfter === boundary) throw new Error(`Injected StyleX generation failure after ${boundary}`);
}

export async function finalizeStylexGeneration(options: FinalizeStylexGenerationOptions): Promise<string> {
  const rawOptions = object(options, "finalizeStylexGeneration options");
  keys(rawOptions, ["generation", "outputDirectory", "rootDirectory"], "finalizeStylexGeneration options", ["failAfter"]);
  assert.ok(
    rawOptions.failAfter === undefined || ["artifacts", "complete-record", "css", "promotion", "templates"].includes(String(rawOptions.failAfter)),
    "finalizeStylexGeneration failAfter is invalid",
  );
  const failAfter = rawOptions.failAfter as FinalizeStylexGenerationOptions["failAfter"];
  const parsedOptions = {
    generation: rawOptions.generation as StylexGenerationHandleV1,
    outputDirectory: string(rawOptions.outputDirectory, "outputDirectory"),
    rootDirectory: string(rawOptions.rootDirectory, "rootDirectory"),
  };
  const rootDirectory = await realDirectory(parsedOptions.rootDirectory, "rootDirectory");
  const outputDirectory = await realDirectory(parsedOptions.outputDirectory, "outputDirectory");
  const loaded = await loadStylexGeneration(parsedOptions.generation);
  assert.equal(dirname(parsedOptions.generation.directory), outputDirectory, "Generation does not belong to outputDirectory");
  const finalDirectory = join(outputDirectory, loaded.plan.generationId);
  assert.equal(await exists(finalDirectory), false, "Generation output already exists");
  await withMutationLock(parsedOptions.generation.directory, async () => {
    const finalizeLock = await open(join(parsedOptions.generation.directory, FINALIZE_LOCK), "wx", 0o600);
    await writeSyncAndClose(finalizeLock, "finalizing\n", "StyleX finalize lock marker");
  });
  const publicationLock = join(outputDirectory, `.hraness-stylex-${loaded.plan.generationId}.publish.lock`);
  let publicationHandle: Awaited<ReturnType<typeof open>> | undefined;
  let publicationLockOwned = false;
  let promoted = false;
  try {
    assert.deepEqual(await readdir(join(parsedOptions.generation.directory, PAYLOAD)), [], "Generation payload contains stale or unexpected entries");
    await verifyLivePackageInputs(rootDirectory, parsedOptions.generation.directory, loaded);
    const receiptEntries = (await readdir(join(parsedOptions.generation.directory, RECEIPTS))).sort();
    const expectedEntries = loaded.plan.expectedGraphs.map(({ id }) => `${id}.json`).sort();
    assert.deepEqual(receiptEntries, expectedEntries, "Graph receipts are missing or unexpected");
    assert.deepEqual((await readdir(join(parsedOptions.generation.directory, GRAPHS))).sort(), loaded.plan.expectedGraphs.map(({ id }) => id).sort(), "Graph staging directories are missing or unexpected");
    const loadedReceipts = await Promise.all(loaded.plan.expectedGraphs.map(({ id }) => loadReceipt(parsedOptions.generation.directory, id)));
    const packageFoundations = await livePackageFoundations(
      rootDirectory,
      parsedOptions.generation.directory,
      loaded,
    );
    assert.deepEqual(
      loadedReceipts.map(({ receipt }) => receipt.graphId).sort(compareStrings),
      loaded.plan.expectedGraphs.map(({ id }) => id).sort(compareStrings),
      "Final graph receipt IDs are missing, duplicated, or unexpected",
    );
    const combinedRules = canonicalizeStylexRules(
      ...loaded.packageManifests.map(({ rules }) => rules),
      ...loadedReceipts.map(({ receipt }) => receipt.rules),
    );
    const producedTemplates = loaded.plan.templates.filter(
      (item): item is StylexTemplateV1 & { graphId: string } => item.graphId !== undefined,
    );
    const producedTemplateNames = producedTemplates.map(producedTemplateName).sort();
    assert.deepEqual(
      (await readdir(join(parsedOptions.generation.directory, PRODUCED_TEMPLATES))).sort(),
      producedTemplateNames,
      "Produced template staging is missing or unexpected",
    );
    assert.deepEqual(
      (await readdir(join(parsedOptions.generation.directory, PRODUCED_TEMPLATE_RECEIPTS))).sort(),
      producedTemplateNames.map((name) => `${name}.json`),
      "Produced template receipts are missing or unexpected",
    );
    const artifacts: StylexArtifactV1[] = [];
    const graphStylesheetsById = new Map<string, Set<string>>();
    const occupied = new Set<string>([loaded.plan.finalCssPath, COMPLETE_RECORD]);
    const verifiedGraphOutputs: {
      graphId: string;
      graphRoot: string;
      outputs: readonly StylexArtifactV1[];
    }[] = [];
    for (const item of loadedReceipts) {
      const receipt = item.receipt;
      const expected = loaded.expectedGraph(receipt.graphId);
      assert.equal(receipt.generationId, loaded.plan.generationId);
      assert.equal(receipt.planSha256, parsedOptions.generation.planSha256);
      assert.equal(receipt.compilerSha256, compilerSha256);
      assert.equal(receipt.adapter, expected.adapter);
      assert.equal(receipt.target, expected.kind);
      assert.deepEqual(receipt.entrypoints, expected.entrypoints);
      assert.deepEqual(receipt.packages, loaded.plan.packages);
      assert.equal(
        receipt.outputRoot,
        `${GRAPHS}/${receipt.graphId}/output`,
        `Graph ${receipt.graphId} outputRoot is not the owned staging root`,
      );
      const inputPaths = new Set(receipt.inputs.map(({ path }) => path));
      for (const entrypoint of expected.entrypoints) assert.ok(inputPaths.has(entrypoint), `Graph receipt omits entrypoint input ${entrypoint}`);
      await Promise.all(receipt.inputs.map((artifact) => verifyArtifact(rootDirectory, artifact)));
      if (loaded.plan.templates.some(({ stylesheetGraphId }) => stylesheetGraphId === receipt.graphId)) {
        assertGraphIncludesPackageFoundations(receipt, packageFoundations);
      }
      await auditCssInputs(
        rootDirectory,
        receipt.inputs,
        loaded.packageManifests,
        `Graph ${receipt.graphId} inputs`,
      );
      const graphRoot = join(parsedOptions.generation.directory, ...receipt.outputRoot.split("/"));
      assert.deepEqual(await readdir(join(parsedOptions.generation.directory, GRAPHS, receipt.graphId)), ["output"], `Graph ${receipt.graphId} staging contains unexpected entries`);
      assert.deepEqual(await filesBelow(graphRoot), receipt.outputs.map(({ path }) => path), `Graph ${receipt.graphId} output inventory changed after receipt`);
      await Promise.all(receipt.outputs.map((artifact) => verifyArtifact(graphRoot, artifact)));
      const graphStylesheets = new Set<string>();
      for (const output of receipt.outputs.filter(({ path }) => path.endsWith(".css"))) {
        const publishedPath = normalizeLogicalPath(`graphs/${receipt.graphId}/${output.path}`, "published graph output path");
        const bytes = await readFile(join(graphRoot, ...output.path.split("/")));
        assert.deepEqual(
          { bytes: bytes.byteLength, sha256: sha256(bytes) },
          { bytes: output.bytes, sha256: output.sha256 },
          `Graph CSS output changed while reconstructing its audit receipt: ${output.path}`,
        );
        const css = bytes.toString("utf8");
        auditCssWithoutStandaloneRecipes(
          css,
          loaded.packageManifests,
          `Graph ${receipt.graphId} output`,
        );
        auditCssWithoutStylexRules(css, combinedRules, `Graph ${receipt.graphId}`);
        graphStylesheets.add(publishedPath);
      }
      if (graphStylesheets.size > 0) graphStylesheetsById.set(receipt.graphId, graphStylesheets);
      for (const output of receipt.outputs) {
        const publishedPath = normalizeLogicalPath(`graphs/${receipt.graphId}/${output.path}`, "published graph output path");
        assert.equal(occupied.has(publishedPath), false, `Output collision: ${publishedPath}`);
        occupied.add(publishedPath);
      }
      verifiedGraphOutputs.push({ graphId: receipt.graphId, graphRoot, outputs: receipt.outputs });
    }
    for (const { graphId, graphRoot, outputs } of verifiedGraphOutputs) {
      for (const output of outputs) {
        const publishedPath = normalizeLogicalPath(`graphs/${graphId}/${output.path}`, "published graph output path");
        const published = await copyExclusive(
          join(graphRoot, ...output.path.split("/")),
          join(parsedOptions.generation.directory, PAYLOAD),
          publishedPath,
        );
        assert.deepEqual(
          { bytes: published.bytes, sha256: published.sha256 },
          { bytes: output.bytes, sha256: output.sha256 },
          `Graph ${graphId} output changed while publishing: ${output.path}`,
        );
        artifacts.push(published);
      }
    }
    injectFailure(failAfter, "artifacts");
    const css = serializeStylexRules(combinedRules);
    const cssDestination = join(parsedOptions.generation.directory, PAYLOAD, ...loaded.plan.finalCssPath.split("/"));
    await mkdir(dirname(cssDestination), { recursive: true });
    await writeFile(cssDestination, css, { flag: "wx" });
    const finalCss = await artifactForFile(join(parsedOptions.generation.directory, PAYLOAD), loaded.plan.finalCssPath);
    injectFailure(failAfter, "css");
    for (const templateValue of loaded.plan.templates) {
      assert.equal(occupied.has(templateValue.outputPath), false, `Template output collision: ${templateValue.outputPath}`);
      occupied.add(templateValue.outputPath);
      let currentSource: Buffer;
      if (templateValue.graphId === undefined) {
        currentSource = await readFile(await resolveRootRelativeInput(rootDirectory, templateValue.sourcePath));
        const preparedSource = await readFile(join(parsedOptions.generation.directory, TEMPLATE_INPUTS, templateInputName(templateValue)));
        assert.ok(currentSource.equals(preparedSource), `Template input changed after generation preparation: ${templateValue.sourcePath}`);
      } else {
        const producedTemplate = { ...templateValue, graphId: templateValue.graphId };
        const receipt = await loadProducedTemplateReceipt(parsedOptions.generation.directory, producedTemplate);
        assert.equal(receipt.graphId, templateValue.graphId, `Produced template receipt has the wrong graph: ${templateValue.outputPath}`);
        assert.equal(receipt.outputPath, templateValue.outputPath, `Produced template receipt has the wrong output path: ${templateValue.outputPath}`);
        assert.equal(receipt.sourcePath, templateValue.sourcePath, `Produced template receipt has the wrong source path: ${templateValue.outputPath}`);
        assert.equal(receipt.planSha256, parsedOptions.generation.planSha256, `Produced template receipt has a stale plan hash: ${templateValue.outputPath}`);
        assert.equal(receipt.artifact.path, templateValue.sourcePath, `Produced template receipt has the wrong artifact path: ${templateValue.outputPath}`);
        const templateRoot = join(parsedOptions.generation.directory, PRODUCED_TEMPLATES, producedTemplateName(templateValue));
        assert.deepEqual(await filesBelow(templateRoot), [templateValue.sourcePath], `Produced template staging changed after receipt: ${templateValue.outputPath}`);
        currentSource = await readFile(join(templateRoot, ...templateValue.sourcePath.split("/")));
        assert.deepEqual(
          { bytes: currentSource.byteLength, sha256: sha256(currentSource) },
          { bytes: receipt.artifact.bytes, sha256: receipt.artifact.sha256 },
          `Produced template changed after receipt: ${templateValue.outputPath}`,
        );
      }
      const source = currentSource.toString("utf8");
      assert.equal(source.split(STYLEX_TEMPLATE_CSS_PLACEHOLDER).length - 1, 1, `Template must contain exactly one ${STYLEX_TEMPLATE_CSS_PLACEHOLDER}`);
      const rendered = source.replace(STYLEX_TEMPLATE_CSS_PLACEHOLDER, templateValue.cssHref);
      const requiredGraphStylesheets = graphStylesheetsById.get(
        templateValue.stylesheetGraphId,
      ) ?? new Set<string>();
      assert.ok(
        requiredGraphStylesheets.size > 0,
        `Template ${templateValue.outputPath} stylesheet graph ${templateValue.stylesheetGraphId} emitted no CSS`,
      );
      assertRenderedTemplateLinks(
        rendered,
        templateValue,
        loaded.plan.finalCssPath,
        requiredGraphStylesheets,
        requiredGraphStylesheets,
      );
      const inputHash = sha256(currentSource);
      assert.ok(!rendered.includes(STYLEX_TEMPLATE_CSS_PLACEHOLDER));
      const renderedArtifact = await copyRenderedTemplate(rendered, parsedOptions.generation.directory, templateValue.outputPath);
      assert.notEqual(renderedArtifact.sha256, inputHash, "Template placeholder replacement must change its bytes");
      artifacts.push(renderedArtifact);
    }
    injectFailure(failAfter, "templates");
    artifacts.sort((a, b) => compareStrings(a.path, b.path));
    assert.deepEqual(
      await filesBelow(join(parsedOptions.generation.directory, PAYLOAD)),
      [...artifacts.map(({ path }) => path), finalCss.path].sort(compareStrings),
      "Generation payload differs from its expected artifact inventory",
    );
    const complete: StylexCompleteRecordV1 = {
      artifacts, compilerSha256, finalCss, generationId: loaded.plan.generationId,
      graphs: loadedReceipts.map(({ receipt, source }) => ({ id: receipt.graphId, receiptSha256: sha256(source) })).sort((a, b) => compareStrings(a.id, b.id)),
      kind: "hraness-stylex-complete-generation", packages: loaded.plan.packages,
      planSha256: parsedOptions.generation.planSha256, schemaVersion: STYLEX_COMPLETE_RECORD_SCHEMA_VERSION, state: "complete",
    };
    await writeCanonicalExclusive(join(parsedOptions.generation.directory, PAYLOAD, COMPLETE_RECORD), complete);
    assert.deepEqual(
      await filesBelow(join(parsedOptions.generation.directory, PAYLOAD)),
      [...artifacts.map(({ path }) => path), COMPLETE_RECORD, finalCss.path].sort(compareStrings),
      "Complete generation payload differs from its recorded artifact inventory",
    );
    injectFailure(failAfter, "complete-record");
    publicationHandle = await open(publicationLock, "wx", 0o600);
    publicationLockOwned = true;
    assert.equal(await exists(finalDirectory), false, "Generation output appeared during finalization");
    injectFailure(failAfter, "promotion");
    await rename(join(parsedOptions.generation.directory, PAYLOAD), finalDirectory);
    promoted = true;
    await publicationHandle.close();
    publicationHandle = undefined;
    await unlink(publicationLock);
    publicationLockOwned = false;
    await rm(parsedOptions.generation.directory, { recursive: true, force: true });
    return finalDirectory;
  } catch (error) {
    let retainedError: unknown;
    try {
      await cleanupFailedPublicationLock(
        publicationLock,
        publicationHandle,
        publicationLockOwned,
        error,
      );
    } catch (cleanupError) {
      retainedError = cleanupError;
    }
    const detail = error instanceof Error ? `: ${error.message}` : "";
    if (promoted) {
      throw new Error(`StyleX generation was promoted to ${finalDirectory}, but post-promotion cleanup failed${detail}`, { cause: retainedError });
    }
    throw new Error(`StyleX generation failed; evidence retained at ${parsedOptions.generation.directory}${detail}`, { cause: retainedError });
  }
}

async function copyRenderedTemplate(rendered: string, directory: string, logicalPath: string): Promise<StylexArtifactV1> {
  const output = join(directory, PAYLOAD, ...logicalPath.split("/"));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, rendered, { flag: "wx" });
  return artifactForFile(join(directory, PAYLOAD), logicalPath);
}
