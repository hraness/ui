import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";

import {
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
  type StylexArtifactV1,
  type StylexGenerationHandleV1,
  type StylexGraphEdgeV1,
  type StylexGraphReceiptV1,
  type StylexPackageManifestV1,
  type StylexRuleV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  canonicalJson,
  canonicalizeStylexRules,
  compilerSha256,
  createStylexTransformCollector,
  normalizeLogicalPath,
  resolveRootRelativeInput,
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import {
  loadStylexGeneration,
  prepareStylexGraph,
  writeStylexGraphReceipt,
} from "./generation.js";

export const STYLEX_BUN_ADAPTER_VERSION = "1.3.14" as const;

export type BunStylexBuildOptions = Readonly<{
  conditions?: readonly string[];
  define?: Readonly<Record<string, string>>;
  jsx?: Readonly<{
    development?: boolean;
    factory?: string;
    fragment?: string;
    importSource?: string;
    runtime?: "automatic" | "classic";
    sideEffects?: boolean;
  }>;
  minify?: Bun.BuildConfig["minify"];
  sourcemap?: false | "inline" | "none";
}>;

export type CollectBunStylexGraphOptions = Readonly<{
  build?: BunStylexBuildOptions;
  generation: StylexGenerationHandleV1;
  graphId: string;
  rootDirectory: string;
}>;

type ParsedImport = Readonly<{
  external: boolean;
  kind: string;
  original?: string;
  path: string;
}>;

type ParsedInput = Readonly<{
  bytes: number;
  format?: "cjs" | "css" | "esm" | "json";
  imports: readonly ParsedImport[];
}>;

type ParsedOutput = Readonly<{
  bytes: number;
  cssBundle?: string;
  entryPoint?: string;
  inputs: readonly string[];
  imports: readonly ParsedImport[];
}>;

type ParsedMetafile = Readonly<{
  inputs: ReadonlyMap<string, ParsedInput>;
  outputs: ReadonlyMap<string, ParsedOutput>;
}>;

const javascriptFilter = /\.[cm]?[jt]sx?$/u;
const outputNaming = {
  asset: "assets/[name]-[hash].[ext]",
  chunk: "chunks/[name]-[hash].[ext]",
  entry: "entries/[name]-[hash].[ext]",
} as const;

function plainObject(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  description: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key)).sort();
  assert.deepEqual(unknown, [], `${description} contains unsupported or adapter-owned keys`);
}

function printableString(value: unknown, description: string): string {
  assert.ok(
    typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value),
    `${description} must be a nonempty printable string`,
  );
  return value;
}

function booleanValue(value: unknown, description: string): boolean {
  assert.ok(typeof value === "boolean", `${description} must be boolean`);
  return value;
}

function parseStringRecord(value: unknown, description: string): Record<string, string> {
  const record = plainObject(value, description);
  const output: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    assert.ok(key.length > 0 && !/[\u0000-\u001f\u007f]/u.test(key), `${description} contains an invalid key`);
    output[key] = printableString(record[key], `${description}.${key}`);
  }
  return output;
}

function parseBuildOptions(value: unknown): BunStylexBuildOptions {
  if (value === undefined) return {};
  const record = plainObject(value, "Bun build options");
  exactKeys(record, ["conditions", "define", "jsx", "minify", "sourcemap"], "Bun build options");
  const output: {
    conditions?: string[];
    define?: Record<string, string>;
    jsx?: NonNullable<Bun.BuildConfig["jsx"]>;
    minify?: NonNullable<Bun.BuildConfig["minify"]>;
    sourcemap?: false | "inline" | "none";
  } = {};
  if (record.conditions !== undefined) {
    assert.ok(Array.isArray(record.conditions), "Bun build options.conditions must be an array");
    const conditions = record.conditions.map((item, index) =>
      printableString(item, `Bun build options.conditions[${String(index)}]`)
    );
    assert.equal(new Set(conditions).size, conditions.length, "Bun build options.conditions must be unique");
    output.conditions = [...conditions].sort();
  }
  if (record.define !== undefined) {
    const define = parseStringRecord(record.define, "Bun build options.define");
    assert.equal(
      Object.hasOwn(define, "process.env.NODE_ENV"),
      false,
      "Bun build options.define may not override the adapter-owned production environment",
    );
    output.define = define;
  }
  if (record.jsx !== undefined) {
    const jsx = plainObject(record.jsx, "Bun build options.jsx");
    exactKeys(jsx, ["development", "factory", "fragment", "importSource", "runtime", "sideEffects"], "Bun build options.jsx");
    const parsed: NonNullable<Bun.BuildConfig["jsx"]> = {};
    if (jsx.development !== undefined) parsed.development = booleanValue(jsx.development, "Bun build options.jsx.development");
    if (jsx.factory !== undefined) parsed.factory = printableString(jsx.factory, "Bun build options.jsx.factory");
    if (jsx.fragment !== undefined) parsed.fragment = printableString(jsx.fragment, "Bun build options.jsx.fragment");
    if (jsx.importSource !== undefined) parsed.importSource = printableString(jsx.importSource, "Bun build options.jsx.importSource");
    if (jsx.runtime !== undefined) {
      assert.ok(jsx.runtime === "automatic" || jsx.runtime === "classic", "Bun build options.jsx.runtime is unsupported");
      parsed.runtime = jsx.runtime;
    }
    if (jsx.sideEffects !== undefined) parsed.sideEffects = booleanValue(jsx.sideEffects, "Bun build options.jsx.sideEffects");
    output.jsx = parsed;
  }
  if (record.minify !== undefined) {
    if (typeof record.minify === "boolean") output.minify = record.minify;
    else {
      const minify = plainObject(record.minify, "Bun build options.minify");
      exactKeys(minify, ["identifiers", "keepNames", "syntax", "whitespace"], "Bun build options.minify");
      const parsed: Exclude<NonNullable<Bun.BuildConfig["minify"]>, boolean> = {};
      if (minify.identifiers !== undefined) parsed.identifiers = booleanValue(minify.identifiers, "Bun build options.minify.identifiers");
      if (minify.keepNames !== undefined) parsed.keepNames = booleanValue(minify.keepNames, "Bun build options.minify.keepNames");
      if (minify.syntax !== undefined) parsed.syntax = booleanValue(minify.syntax, "Bun build options.minify.syntax");
      if (minify.whitespace !== undefined) parsed.whitespace = booleanValue(minify.whitespace, "Bun build options.minify.whitespace");
      output.minify = parsed;
    }
  }
  if (record.sourcemap !== undefined) {
    assert.ok(
      record.sourcemap === false || record.sourcemap === "inline" || record.sourcemap === "none",
      'Bun build options.sourcemap supports only false, "inline", or "none"',
    );
    output.sourcemap = record.sourcemap;
  }
  return output;
}

function nonnegativeInteger(value: unknown, description: string): number {
  assert.ok(Number.isSafeInteger(value) && (value as number) >= 0, `${description} must be a nonnegative safe integer`);
  return value as number;
}

function parseImport(value: unknown, description: string): ParsedImport {
  const record = plainObject(value, description);
  exactKeys(record, ["external", "kind", "original", "path", "with"], description);
  if (record.original !== undefined) printableString(record.original, `${description}.original`);
  if (record.with !== undefined) parseStringRecord(record.with, `${description}.with`);
  assert.ok(record.external === undefined || typeof record.external === "boolean", `${description}.external must be boolean`);
  const output: { external: boolean; kind: string; original?: string; path: string } = {
    external: record.external === true,
    kind: printableString(record.kind, `${description}.kind`),
    path: printableString(record.path, `${description}.path`),
  };
  if (record.original !== undefined) output.original = record.original as string;
  return output;
}

function parseMetafile(value: unknown): ParsedMetafile {
  const record = plainObject(value, "Bun metafile");
  exactKeys(record, ["inputs", "outputs"], "Bun metafile");
  const rawInputs = plainObject(record.inputs, "Bun metafile.inputs");
  const inputs = new Map<string, ParsedInput>();
  for (const key of Object.keys(rawInputs).sort()) {
    const item = plainObject(rawInputs[key], `Bun metafile.inputs.${key}`);
    exactKeys(item, ["bytes", "format", "imports"], `Bun metafile.inputs.${key}`);
    assert.ok(Array.isArray(item.imports), `Bun metafile.inputs.${key}.imports must be an array`);
    assert.ok(item.format === undefined || ["cjs", "css", "esm", "json"].includes(String(item.format)), `Bun metafile.inputs.${key}.format is unsupported`);
    const parsed: { bytes: number; format?: Exclude<ParsedInput["format"], undefined>; imports: ParsedImport[] } = {
      bytes: nonnegativeInteger(item.bytes, `Bun metafile.inputs.${key}.bytes`),
      imports: item.imports.map((entry, index) => parseImport(entry, `Bun metafile.inputs.${key}.imports[${String(index)}]`)),
    };
    if (item.format !== undefined) parsed.format = item.format as Exclude<ParsedInput["format"], undefined>;
    inputs.set(key, parsed);
  }
  const rawOutputs = plainObject(record.outputs, "Bun metafile.outputs");
  const outputs = new Map<string, ParsedOutput>();
  for (const key of Object.keys(rawOutputs).sort()) {
    const item = plainObject(rawOutputs[key], `Bun metafile.outputs.${key}`);
    exactKeys(item, ["bytes", "cssBundle", "entryPoint", "exports", "imports", "inputs"], `Bun metafile.outputs.${key}`);
    assert.ok(Array.isArray(item.exports) && item.exports.every((name) => typeof name === "string"), `Bun metafile.outputs.${key}.exports must be strings`);
    assert.ok(Array.isArray(item.imports), `Bun metafile.outputs.${key}.imports must be an array`);
    if (item.entryPoint !== undefined) printableString(item.entryPoint, `Bun metafile.outputs.${key}.entryPoint`);
    if (item.cssBundle !== undefined) printableString(item.cssBundle, `Bun metafile.outputs.${key}.cssBundle`);
    const contributions = plainObject(item.inputs, `Bun metafile.outputs.${key}.inputs`);
    for (const input of Object.keys(contributions)) {
      const contribution = plainObject(contributions[input], `Bun metafile.outputs.${key}.inputs.${input}`);
      exactKeys(contribution, ["bytesInOutput"], `Bun metafile.outputs.${key}.inputs.${input}`);
      nonnegativeInteger(contribution.bytesInOutput, `Bun metafile.outputs.${key}.inputs.${input}.bytesInOutput`);
    }
    const parsed: {
      bytes: number;
      cssBundle?: string;
      entryPoint?: string;
      inputs: string[];
      imports: ParsedImport[];
    } = {
      bytes: nonnegativeInteger(item.bytes, `Bun metafile.outputs.${key}.bytes`),
      inputs: Object.keys(contributions).sort(),
      imports: item.imports.map((entry, index) => parseImport(entry, `Bun metafile.outputs.${key}.imports[${String(index)}]`)),
    };
    if (item.cssBundle !== undefined) parsed.cssBundle = item.cssBundle as string;
    if (item.entryPoint !== undefined) parsed.entryPoint = item.entryPoint as string;
    outputs.set(key, parsed);
  }
  assert.ok(inputs.size > 0, "Bun metafile must contain inputs");
  assert.ok(outputs.size > 0, "Bun metafile must contain outputs");
  return { inputs, outputs };
}

function relativeBelow(root: string, absolute: string, description: string): string {
  const path = relative(root, absolute).split(sep).join("/");
  assert.ok(path !== ".." && !path.startsWith("../"), `${description} escapes its owned root`);
  return normalizeLogicalPath(path, description);
}

async function canonicalInputKey(root: string, raw: string): Promise<string> {
  const candidates = isAbsolute(raw)
    ? [resolve(raw)]
    : [resolve(root, raw), resolve(process.cwd(), raw)];
  for (const absolute of [...new Set(candidates)]) {
    const path = relative(root, absolute).split(sep).join("/");
    if (path === ".." || path.startsWith("../") || path.length === 0) continue;
    const ordinary = await lstat(absolute).then(
      (stat) => stat.isFile() && !stat.isSymbolicLink(),
      () => false,
    );
    if (ordinary) return normalizeLogicalPath(path, "Bun metafile input path");
  }
  throw new Error(`Bun metafile input is not one ordinary file below rootDirectory: ${raw}`);
}

function canonicalOutputKey(outputDirectory: string, raw: string, known: ReadonlySet<string>): string {
  if (isAbsolute(raw)) return relativeBelow(outputDirectory, resolve(raw), "Bun metafile output path");
  const normalized = posix.normalize(raw).replace(/^\.\//u, "");
  if (known.has(normalized)) return normalizeLogicalPath(normalized, "Bun metafile output path");
  const matches = [...known].filter((path) => normalized === path || normalized.endsWith(`/${path}`));
  assert.equal(matches.length, 1, `Bun metafile output path does not identify exactly one emitted artifact: ${raw}`);
  return matches[0]!;
}

function canonicalExternal(value: string): string {
  assert.ok(!value.includes("\\") && !/[\u0000-\u001f\u007f]/u.test(value), "external import contains forbidden characters");
  assert.ok(
    !isAbsolute(value)
      && !/^[A-Za-z]:\//u.test(value)
      && !value.startsWith("./")
      && !value.startsWith("../")
      && !value.toLowerCase().startsWith("file:"),
    `relative or absolute files cannot be externalized from a complete graph: ${value}`,
  );
  return `external:${value}`;
}

function inputTarget(
  raw: string,
  from: string,
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const alias = aliases.get(raw);
  if (alias !== undefined) return alias;
  const candidate = raw.startsWith("./") || raw.startsWith("../")
    ? posix.normalize(posix.join(posix.dirname(from), raw))
    : posix.normalize(raw).replace(/^\.\//u, "");
  return known.has(candidate) ? candidate : undefined;
}

function barePackageName(value: string): string | undefined {
  if (
    value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith("/")
    || value.startsWith("#")
    || value.includes("\\")
    || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
  ) return undefined;
  const parts = value.split("/");
  const name = parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (name === undefined || name.length === 0 || (name.startsWith("@") && !name.includes("/"))) return undefined;
  return name;
}

function bareImportWitnessKey(kind: string, specifier: string): string {
  return JSON.stringify([kind, specifier]);
}

function witnessedBareInputTargets(
  inputs: ReadonlyMap<string, ParsedInput>,
  aliases: ReadonlyMap<string, string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const known = new Set(inputs.keys());
  const witnesses = new Map<string, Set<string>>();
  for (const [from, metadata] of inputs) {
    for (const imported of metadata.imports) {
      if (imported.external || imported.original === undefined) continue;
      const packageName = barePackageName(imported.original);
      if (packageName === undefined) continue;
      const target = inputTarget(imported.path, from, known, aliases);
      if (target === undefined || packageBelowNodeModules(target) !== packageName) continue;
      const witnessKey = bareImportWitnessKey(imported.kind, imported.original);
      const targets = witnesses.get(witnessKey) ?? new Set<string>();
      targets.add(target);
      witnesses.set(witnessKey, targets);
    }
  }
  return witnesses;
}

function resolvedInputTarget(
  imported: ParsedImport,
  from: string,
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  installations: ReadonlyMap<string, ReadonlySet<string>>,
  witnesses: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined {
  if (imported.external) return undefined;
  const direct = inputTarget(imported.path, from, known, aliases);
  if (direct !== undefined) return direct;
  const packageName = barePackageName(imported.path);
  if (packageName === undefined) return undefined;
  const installationRoots = [...(installations.get(packageName) ?? [])].sort();
  assert.ok(
    installationRoots.length <= 1,
    `Bun metafile bare import target is ambiguous for ${imported.path}; in-graph package installations: ${installationRoots.join(", ")}`,
  );
  const candidates = [...(witnesses.get(bareImportWitnessKey(imported.kind, imported.path)) ?? [])].sort();
  assert.ok(
    candidates.length <= 1,
    `Bun metafile bare import target is ambiguous for ${imported.path}: ${candidates.join(", ")}`,
  );
  const target = candidates[0];
  if (target === undefined) return undefined;
  assert.equal(
    packageBelowNodeModules(target),
    packageName,
    `Bun metafile bare import witness has the wrong package identity for ${imported.path}`,
  );
  return target;
}

function outputTarget(raw: string, from: string, known: ReadonlySet<string>): string | undefined {
  const candidate = raw.startsWith("./") || raw.startsWith("../")
    ? posix.normalize(posix.join(posix.dirname(from), raw))
    : posix.normalize(raw).replace(/^\.\//u, "");
  if (known.has(candidate)) return candidate;
  const matches = [...known].filter((path) => candidate === path || candidate.endsWith(`/${path}`));
  return matches.length === 1 ? matches[0] : undefined;
}

function loaderFor(path: string): "js" | "jsx" | "ts" | "tsx" {
  switch (extname(path)) {
    case ".cts":
    case ".mts":
    case ".ts": return "ts";
    case ".ctsx":
    case ".mtsx":
    case ".tsx": return "tsx";
    case ".cjsx":
    case ".jsx":
    case ".mjsx": return "jsx";
    default: return "js";
  }
}

function nativeLoaderFor(path: string): Bun.Loader {
  switch (extname(path).toLowerCase()) {
    case ".json": return "json";
    case ".jsonc": return "jsonc";
    case ".toml": return "toml";
    case ".yaml":
    case ".yml": return "yaml";
    case ".txt": return "text";
    case ".html": return "html";
    case ".node": return "napi";
    case ".wasm": return "wasm";
    default: return "file";
  }
}

function packageBelowNodeModules(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const first = parts[index + 1]!;
  if (first.startsWith("@") && index + 2 < parts.length) return `${first}/${parts[index + 2]!}`;
  return first;
}

function packageInstallationRoot(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const packageSegments = parts[index + 1]!.startsWith("@") ? 2 : 1;
  const end = index + 1 + packageSegments;
  return end <= parts.length ? parts.slice(0, end).join("/") : undefined;
}

function packageInstallations(paths: ReadonlySet<string>): ReadonlyMap<string, ReadonlySet<string>> {
  const installations = new Map<string, Set<string>>();
  for (const path of paths) {
    const packageName = packageBelowNodeModules(path);
    const root = packageInstallationRoot(path);
    if (packageName === undefined || root === undefined) continue;
    const roots = installations.get(packageName) ?? new Set<string>();
    roots.add(root);
    installations.set(packageName, roots);
  }
  return installations;
}

function packageRelativePath(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const packageSegments = parts[index + 1]!.startsWith("@") ? 2 : 1;
  const start = index + 1 + packageSegments;
  return start < parts.length ? parts.slice(start).join("/") : undefined;
}

async function filesBelow(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Bun output must not contain symlinks: ${relativeBelow(root, absolute, "output path")}`);
      if (entry.isDirectory()) await visit(absolute);
      else {
        assert.ok(entry.isFile(), `Bun output must contain only ordinary files: ${relativeBelow(root, absolute, "output path")}`);
        output.push(relativeBelow(root, absolute, "output path"));
      }
    }
  }
  await visit(root);
  return output.sort();
}

function sortedEdges(edges: readonly StylexGraphEdgeV1[]): readonly StylexGraphEdgeV1[] {
  const unique = new Map<string, StylexGraphEdgeV1>();
  for (const edge of edges) unique.set(canonicalJson(edge), edge);
  return [...unique.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, edge]) => edge);
}

function assertNotStandaloneRecipeArtifact(
  artifact: StylexArtifactV1,
  manifests: readonly StylexPackageManifestV1[],
): void {
  for (const manifest of manifests) {
    assert.ok(
      artifact.bytes !== manifest.standaloneCss.bytes || artifact.sha256 !== manifest.standaloneCss.sha256,
      `Compiler graph contains the standalone recipe artifact from ${manifest.package.name}@${manifest.package.version}: ${artifact.path}`,
    );
  }
}

function verifyRegisteredPackageInput(
  path: string,
  artifact: StylexArtifactV1,
  manifests: readonly StylexPackageManifestV1[],
): void {
  const packageName = packageBelowNodeModules(path);
  const packagePath = packageRelativePath(path);
  if (packageName === undefined || packagePath === undefined) return;
  const manifest = manifests.find((item) => item.package.name === packageName);
  if (manifest === undefined) return;
  assert.ok(
    !manifest.buildTools.some((item) => item.path === packagePath),
    `Package build tool entered the production graph: ${path}`,
  );
  const runtime = manifest.runtime.find((item) => item.path === packagePath);
  const stylesheet = manifest.stylesheets.find((item) => item.path === packagePath);
  if (javascriptFilter.test(packagePath)) {
    assert.ok(runtime !== undefined, `Package runtime is not bound by its manifest: ${path}`);
  }
  if (packagePath.endsWith(".css")) {
    assert.ok(
      stylesheet !== undefined || manifest.standaloneCss.path === packagePath,
      `Package stylesheet is not bound by its manifest: ${path}`,
    );
  }
  if (runtime !== undefined) {
    assert.deepEqual(
      { bytes: artifact.bytes, sha256: artifact.sha256 },
      { bytes: runtime.bytes, sha256: runtime.sha256 },
      `Installed package runtime differs from its manifest: ${path}`,
    );
  }
  const expectedStylesheet = stylesheet
    ?? (manifest.standaloneCss.path === packagePath ? manifest.standaloneCss : undefined);
  if (expectedStylesheet !== undefined) {
    assert.deepEqual(
      { bytes: artifact.bytes, sha256: artifact.sha256 },
      { bytes: expectedStylesheet.bytes, sha256: expectedStylesheet.sha256 },
      `Installed package stylesheet differs from its manifest: ${path}`,
    );
  }
}

function importTargetsStylexRuntime(
  dependency: ParsedImport,
  from: string,
  knownInputs: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  installations: ReadonlyMap<string, ReadonlySet<string>>,
  witnesses: ReadonlyMap<string, ReadonlySet<string>>,
  knownOutputs: ReadonlySet<string>,
  outputMetadata: ReadonlyMap<string, ParsedOutput>,
): boolean {
  if (dependency.path === "@stylexjs/stylex" || dependency.path.startsWith("@stylexjs/stylex/")) return true;
  let target = resolvedInputTarget(dependency, from, knownInputs, aliases, installations, witnesses);
  if (target === undefined) {
    const output = outputTarget(dependency.path, from, knownOutputs);
    const entrypoint = output === undefined ? undefined : outputMetadata.get(output)?.entryPoint;
    if (entrypoint !== undefined) {
      target = aliases.get(entrypoint)
        ?? aliases.get(posix.normalize(entrypoint).replace(/^\.\//u, ""));
    }
  }
  return target !== undefined && packageBelowNodeModules(target) === "@stylexjs/stylex";
}

export async function collectBunStylexGraph(options: CollectBunStylexGraphOptions): Promise<StylexGraphReceiptV1> {
  assert.equal(
    Bun.version,
    STYLEX_BUN_ADAPTER_VERSION,
    `Bun StyleX graph adapter requires Bun ${STYLEX_BUN_ADAPTER_VERSION}`,
  );
  const rawOptions = plainObject(options, "collectBunStylexGraph options");
  exactKeys(rawOptions, ["build", "generation", "graphId", "rootDirectory"], "collectBunStylexGraph options");
  const graphId = printableString(rawOptions.graphId, "graphId");
  const rootDirectory = await realpath(printableString(rawOptions.rootDirectory, "rootDirectory"));
  const rootStat = await lstat(rootDirectory);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "rootDirectory must be an ordinary directory");
  const buildOptions = parseBuildOptions(rawOptions.build);
  const generation = rawOptions.generation as StylexGenerationHandleV1;
  const loaded = await loadStylexGeneration(generation);
  const expected = loaded.expectedGraph(graphId);
  assert.equal(expected.adapter, "bun", `Graph ${graphId} is not registered for the Bun adapter`);
  const logicalEntrypoints = [...expected.entrypoints].map((path) => normalizeLogicalPath(path, "Bun entrypoint")).sort();
  assert.equal(new Set(logicalEntrypoints).size, logicalEntrypoints.length, "Bun entrypoints must be unique");
  const entrypoints = await Promise.all(logicalEntrypoints.map((path) => resolveRootRelativeInput(rootDirectory, path)));

  const prepared = await prepareStylexGraph(generation, graphId);
  assert.deepEqual(await readdir(prepared.outputDirectory), [], "Prepared Bun graph output directory must be empty");
  const collector = createStylexTransformCollector(rootDirectory);
  const inputSnapshots = new Map<string, Readonly<{ bytes: number; sha256: string }>>();
  const transformedInputs = new Set<string>();
  const transformedRules = new Map<string, readonly StylexRuleV1[]>();
  let activeTransforms = 0;
  const escapedRoot = rootDirectory.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const plugin: Bun.BunPlugin = {
    name: `hraness-ui-stylex-${graphId}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${escapedRoot}/.*\\.[cm]?[jt]sx?$`, "u") }, async ({ path }) => {
        const logical = relativeBelow(rootDirectory, resolve(path), "StyleX transform path");
        activeTransforms += 1;
        try {
          const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
          const source = await readFile(ordinary, "utf8");
          const snapshot = { bytes: Buffer.byteLength(source), sha256: sha256(source) };
          const previous = inputSnapshots.get(logical);
          if (previous === undefined) inputSnapshots.set(logical, snapshot);
          else assert.deepEqual(snapshot, previous, `Bun input changed between loads: ${logical}`);
          const dependencyPackage = packageBelowNodeModules(logical);
          if (dependencyPackage !== undefined) {
            return { contents: source, loader: loaderFor(ordinary) };
          }
          assert.equal(transformedInputs.has(logical), false, `Bun loaded ${logical} for StyleX transformation more than once`);
          transformedInputs.add(logical);
          const transformed = await collector.transform(source, ordinary);
          transformedRules.set(logical, transformed.rules);
          return { contents: transformed.code, loader: loaderFor(ordinary) };
        } finally {
          activeTransforms -= 1;
        }
      });
      build.onLoad({ filter: new RegExp(`^${escapedRoot}/.*\\.css$`, "u") }, async ({ path }) => {
        const logical = relativeBelow(rootDirectory, resolve(path), "CSS input path");
        const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
        const source = await readFile(ordinary, "utf8");
        auditCssWithoutStandaloneRecipes(source, loaded.packageManifests);
        const snapshot = { bytes: Buffer.byteLength(source), sha256: sha256(source) };
        const previous = inputSnapshots.get(logical);
        if (previous === undefined) inputSnapshots.set(logical, snapshot);
        else assert.deepEqual(snapshot, previous, `Bun input changed between loads: ${logical}`);
        return { contents: source, loader: "css" };
      });
      build.onLoad({ filter: /.*/u }, async ({ path }) => {
        const logical = relativeBelow(rootDirectory, resolve(path), "Bun input path");
        const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
        const bytes = await readFile(ordinary);
        const snapshot = { bytes: bytes.byteLength, sha256: sha256(bytes) };
        const previous = inputSnapshots.get(logical);
        if (previous === undefined) inputSnapshots.set(logical, snapshot);
        else assert.deepEqual(snapshot, previous, `Bun input changed between loads: ${logical}`);
        return { contents: bytes, loader: nativeLoaderFor(ordinary) };
      });
    },
  };

  const bunConfig: Bun.BuildConfig = {
    conditions: buildOptions.conditions === undefined
      ? expected.kind === "client" ? ["browser", "module", "production"] : ["module", "node", "production"]
      : [...buildOptions.conditions],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      ...buildOptions.define,
    },
    entrypoints,
    env: "disable",
    format: "esm",
    metafile: true,
    minify: buildOptions.minify ?? false,
    naming: outputNaming,
    outdir: prepared.outputDirectory,
    plugins: [plugin],
    root: rootDirectory,
    sourcemap: buildOptions.sourcemap ?? "none",
    splitting: true,
    target: expected.kind === "client" ? "browser" : "bun",
    throw: false,
  };
  if (buildOptions.jsx !== undefined) bunConfig.jsx = { ...buildOptions.jsx };
  const result = await Bun.build(bunConfig);
  assert.equal(activeTransforms, 0, "Bun returned before StyleX transforms settled");
  assert.ok(result.success, `Bun graph ${graphId} failed:\n${result.logs.map(String).join("\n")}`);
  // Seal the collector exactly once so conflicts among every completed transform
  // still fail closed. Bun may speculatively invoke onLoad for a tree-shaken
  // barrel export, so the published graph inventory is settled separately below
  // against the authoritative metafile reachability set.
  const allTransformedRules = collector.seal();
  const metafile = parseMetafile(result.metafile as unknown);

  const emittedByResult = new Map<string, Bun.BuildArtifact>();
  for (const artifact of result.outputs) {
    const logical = relativeBelow(prepared.outputDirectory, resolve(artifact.path), "Bun output path");
    assert.ok(!emittedByResult.has(logical), `Bun emitted duplicate output ${logical}`);
    emittedByResult.set(logical, artifact);
  }
  const actualOutputPaths = await filesBelow(prepared.outputDirectory);
  assert.deepEqual([...emittedByResult.keys()].sort(), actualOutputPaths, "Bun result outputs differ from settled output files");
  const outputSet = new Set(actualOutputPaths);
  const outputMetadata = new Map<string, ParsedOutput>();
  for (const [raw, metadata] of metafile.outputs) {
    const logical = canonicalOutputKey(prepared.outputDirectory, raw, outputSet);
    assert.ok(!outputMetadata.has(logical), `Bun metafile contains duplicate output ${logical}`);
    outputMetadata.set(logical, metadata);
  }
  assert.deepEqual([...outputMetadata.keys()].sort(), actualOutputPaths, "Bun metafile outputs differ from settled output files");

  const inputMetadata = new Map<string, ParsedInput>();
  const inputAliases = new Map<string, string>();
  for (const [raw, metadata] of metafile.inputs) {
    const logical = await canonicalInputKey(rootDirectory, raw);
    assert.ok(!inputMetadata.has(logical), `Bun metafile contains duplicate input ${logical}`);
    inputMetadata.set(logical, metadata);
    inputAliases.set(raw, logical);
    inputAliases.set(posix.normalize(raw).replace(/^\.\//u, ""), logical);
    inputAliases.set(resolve(rootDirectory, ...logical.split("/")), logical);
  }
  for (const entrypoint of logicalEntrypoints) {
    assert.ok(inputMetadata.has(entrypoint), `Bun metafile omitted registered entrypoint ${entrypoint}`);
  }
  const knownInputs = new Set(inputMetadata.keys());
  const inputPackageInstallations = packageInstallations(knownInputs);
  const inputWitnesses = witnessedBareInputTargets(inputMetadata, inputAliases);
  for (const [path, metadata] of inputMetadata) {
    const dependencyPackage = packageBelowNodeModules(path);
    if (dependencyPackage === undefined || dependencyPackage === "@stylexjs/stylex") continue;
    if (metadata.imports.some((dependency) => importTargetsStylexRuntime(
      dependency,
      path,
      knownInputs,
      inputAliases,
      inputPackageInstallations,
      inputWitnesses,
      outputSet,
      outputMetadata,
    ))) {
      assert.ok(
        loaded.packageManifests.some((manifest) => manifest.package.name === dependencyPackage),
        `StyleX dependency ${dependencyPackage} has no verified package manifest`,
      );
    }
  }
  const expectedTransforms = [...inputMetadata.keys()].filter((path) => javascriptFilter.test(path) && packageBelowNodeModules(path) === undefined).sort();
  assert.deepEqual(
    expectedTransforms.filter((path) => !transformedInputs.has(path)),
    [],
    "Bun omitted a reachable JavaScript/TypeScript input from StyleX transformation",
  );
  const speculativeTransforms = [...transformedInputs]
    .filter((path) => !inputMetadata.has(path))
    .sort();
  assert.deepEqual(
    speculativeTransforms.filter((path) => !javascriptFilter.test(path) || packageBelowNodeModules(path) !== undefined),
    [],
    "Bun speculative transform settlement contains an unsupported input",
  );
  assert.deepEqual(
    [...transformedRules.keys()].sort(),
    [...transformedInputs].sort(),
    "Bun transformed rule settlement differs from its completed transform inventory",
  );
  assert.deepEqual(
    allTransformedRules,
    canonicalizeStylexRules(...[...transformedRules.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, inventory]) => inventory)),
    "Bun collector seal differs from its per-input transform inventories",
  );
  const expectedSnapshots = [...inputMetadata.keys()].sort();
  assert.deepEqual(
    expectedSnapshots.filter((path) => !inputSnapshots.has(path)),
    [],
    "Bun omitted a reachable input from its settled source snapshots",
  );
  assert.deepEqual(
    [...transformedInputs].filter((path) => !inputSnapshots.has(path)).sort(),
    [],
    "Bun completed a StyleX transform without a settled source snapshot",
  );
  assert.deepEqual(
    [...inputSnapshots.keys()]
      .filter((path) => !inputMetadata.has(path))
      .filter((path) => javascriptFilter.test(path) && packageBelowNodeModules(path) === undefined)
      .filter((path) => !transformedInputs.has(path))
      .sort(),
    [],
    "Bun observed an unexplained speculative local JavaScript/TypeScript input",
  );
  const rules = canonicalizeStylexRules(...expectedTransforms.map((path) => {
    const inventory = transformedRules.get(path);
    assert.ok(inventory !== undefined, `Bun reachable transform has no settled StyleX rules: ${path}`);
    return inventory;
  }));
  const emittedEntrypoints: string[] = [];
  for (const [path, metadata] of outputMetadata) {
    for (const rawInput of metadata.inputs) {
      const input = inputAliases.get(rawInput) ?? inputAliases.get(posix.normalize(rawInput).replace(/^\.\//u, ""));
      assert.ok(input !== undefined && inputMetadata.has(input), `Bun output ${path} cites an unknown input: ${rawInput}`);
    }
    if (metadata.entryPoint !== undefined) {
      const entrypoint = inputAliases.get(metadata.entryPoint)
        ?? inputAliases.get(posix.normalize(metadata.entryPoint).replace(/^\.\//u, ""));
      assert.ok(entrypoint !== undefined && inputMetadata.has(entrypoint), `Bun output ${path} cites an unknown entrypoint input`);
      if (path.startsWith("entries/")) {
        assert.ok(logicalEntrypoints.includes(entrypoint), `Bun output ${path} cites an unregistered graph entrypoint`);
        emittedEntrypoints.push(entrypoint);
      }
    }
    if (metadata.cssBundle !== undefined) {
      const cssBundle = canonicalOutputKey(prepared.outputDirectory, metadata.cssBundle, outputSet);
      assert.ok(cssBundle.endsWith(".css"), `Bun output ${path} has a non-CSS cssBundle`);
    }
  }
  assert.deepEqual([...new Set(emittedEntrypoints)].sort(), logicalEntrypoints, "Bun output topology does not contain every registered entrypoint");

  const inputs: StylexArtifactV1[] = [];
  for (const [path, metadata] of [...inputMetadata.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const artifact = await artifactForFile(rootDirectory, path);
    const snapshot = inputSnapshots.get(path);
    assert.ok(snapshot !== undefined, `Bun input was not snapshotted during compilation: ${path}`);
    assert.deepEqual({ bytes: artifact.bytes, sha256: artifact.sha256 }, snapshot, `Bun input changed during compilation: ${path}`);
    if (!javascriptFilter.test(path) && !path.endsWith(".css")) {
      assert.equal(artifact.bytes, metadata.bytes, `Bun metafile input byte count differs for natively loaded input ${path}`);
    }
    inputs.push(artifact);
    verifyRegisteredPackageInput(path, artifact, loaded.packageManifests);
    if (metadata.format === "css" || path.endsWith(".css")) {
      assertNotStandaloneRecipeArtifact(artifact, loaded.packageManifests);
      const css = await readFile(resolve(rootDirectory, path), "utf8");
      auditCssWithoutStandaloneRecipes(css, loaded.packageManifests);
      auditCssWithoutStylexRules(css, rules);
    }
  }

  const outputs: StylexArtifactV1[] = [];
  for (const [path] of [...outputMetadata.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const artifact = await artifactForFile(prepared.outputDirectory, path);
    const emitted = emittedByResult.get(path)!;
    assert.equal(emitted.size, artifact.bytes, `Bun output blob byte count differs for ${path}`);
    assert.equal(
      sha256(new Uint8Array(await emitted.arrayBuffer())),
      artifact.sha256,
      `Bun output blob bytes differ from the settled file for ${path}`,
    );
    outputs.push(artifact);
    if (emitted.loader === "css" || path.endsWith(".css")) {
      assertNotStandaloneRecipeArtifact(artifact, loaded.packageManifests);
      const css = await readFile(resolve(prepared.outputDirectory, path), "utf8");
      auditCssWithoutStandaloneRecipes(css, loaded.packageManifests);
      auditCssWithoutStylexRules(css, rules);
    }
  }

  const inputSet = new Set(inputMetadata.keys());
  const edges: StylexGraphEdgeV1[] = [];
  for (const [from, metadata] of inputMetadata) {
    for (const imported of metadata.imports) {
      let input = resolvedInputTarget(
        imported,
        from,
        inputSet,
        inputAliases,
        inputPackageInstallations,
        inputWitnesses,
      );
      const output = input === undefined ? outputTarget(imported.path, from, outputSet) : undefined;
      if (input === undefined && output !== undefined) {
        const outputEntrypoint = outputMetadata.get(output)?.entryPoint;
        if (outputEntrypoint !== undefined) {
          input = inputAliases.get(outputEntrypoint)
            ?? inputAliases.get(posix.normalize(outputEntrypoint).replace(/^\.\//u, ""));
        }
      }
      const external = input === undefined && output === undefined;
      const pathLike = imported.path.startsWith("./") || imported.path.startsWith("../") || isAbsolute(imported.path);
      assert.ok(!external || (imported.external && !pathLike), `Bun metafile import from ${from} is unresolved: ${imported.path}`);
      edges.push({
        external,
        from: `input:${from}`,
        kind: imported.kind,
        to: input !== undefined
          ? `input:${input}`
          : output !== undefined
            ? `output:${output}`
            : canonicalExternal(imported.path),
      });
    }
  }
  for (const [from, metadata] of outputMetadata) {
    for (const imported of metadata.imports) {
      const external = imported.external;
      const target = external
        ? undefined
        : outputTarget(imported.path, from, outputSet);
      assert.ok(external || target !== undefined, `Bun output import from ${from} is unresolved: ${imported.path}`);
      edges.push({
        external,
        from: `output:${from}`,
        kind: imported.kind,
        to: external ? canonicalExternal(imported.path) : `output:${target!}`,
      });
    }
  }

  return writeStylexGraphReceipt({
    generation,
    rootDirectory,
    receipt: {
      adapter: "bun",
      compilerSha256,
      edges: sortedEdges(edges),
      entrypoints: logicalEntrypoints,
      generationId: loaded.plan.generationId,
      graphId,
      inputs,
      kind: "hraness-stylex-graph-receipt",
      outputRoot: prepared.outputRoot,
      outputs,
      packages: loaded.plan.packages,
      planSha256: generation.planSha256,
      rules,
      rulesSha256: stylexRulesSha256(rules),
      schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
      state: "complete",
      target: expected.kind,
    },
  });
}
