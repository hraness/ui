import assert from "node:assert/strict";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { isBuiltin } from "node:module";
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
  hasAttributes: boolean;
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

type BareInputWitnesses = Readonly<{
  exact: ReadonlyMap<string, ReadonlySet<string>>;
  specifiers: ReadonlySet<string>;
}>;

type BareInputFallbackPolicy = Readonly<{
  enabled: boolean;
  packageName: string | undefined;
  pathPatterns: readonly string[];
}>;

type RawBareInputFallbackUse = Readonly<{
  fileSnapshots: readonly LoadedInputFileSnapshot[];
  from: string;
  installationRoot: string;
  packageName: string;
  scopeSnapshots: readonly ResolutionFileSnapshot[];
  specifier: string;
  target: string;
}>;

type PackageScope = Readonly<{
  files: readonly ResolutionFileSnapshot[];
  name: string | undefined;
  valid: boolean;
}>;

type ResolutionFileSnapshot = Readonly<
  | { kind: "file"; bytes: number; mode: number; path: string; sha256: string; source: Uint8Array }
  | { kind: "missing"; path: string }
  | { kind: "other"; mode: number; path: string }
  | { kind: "symlink"; path: string; target: string }
>;

type LoadedInputFileSnapshot = Readonly<{
  resolvedPath: string;
  snapshot: ResolutionFileSnapshot;
}>;

type ElidedPackageInputSnapshot = Readonly<{
  bytes: number;
  mode: number;
  path: string;
  sha256: string;
}>;

type ObservedElidedPackageInputSnapshot = ElidedPackageInputSnapshot;

type PromotedNativeCssUrlInputs = Readonly<{
  inputs: ReadonlyMap<string, ElidedPackageInputSnapshot>;
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>;
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
  const output: { external: boolean; hasAttributes: boolean; kind: string; original?: string; path: string } = {
    external: record.external === true,
    hasAttributes: record.with !== undefined,
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

function typescriptRuntimeInputTarget(
  imported: ParsedImport,
  from: string,
  known: ReadonlySet<string>,
  buildTarget: "browser" | "bun",
): string | undefined {
  if (
    imported.original !== undefined
    || (!imported.path.startsWith("./") && !imported.path.startsWith("../"))
  ) return undefined;
  const candidate = posix.normalize(posix.join(posix.dirname(from), imported.path));
  if (candidate === ".." || candidate.startsWith("../")) return undefined;
  const insideNodeModules = packageBelowNodeModules(candidate) !== undefined;
  const extensionOrder = (() => {
    switch (imported.kind) {
      case "import-statement":
      case "dynamic-import":
        return insideNodeModules
          ? [".mjs", ".jsx", ".mts", ".js", ".cjs", ".tsx", ".ts", ".cts", ".json"]
          : [".tsx", ".jsx", ".mts", ".ts", ".mjs", ".js", ".cts", ".cjs", ".json"];
      case "require-call":
      case "require-resolve": {
        const order = insideNodeModules
          ? [".jsx", ".cjs", ".js", ".mjs", ".mts", ".tsx", ".ts", ".cts", ".json"]
          : [".tsx", ".ts", ".jsx", ".cts", ".cjs", ".js", ".mjs", ".mts", ".json"];
        return buildTarget === "bun" ? [...order, ".node"] : order;
      }
      default: return undefined;
    }
  })();
  if (extensionOrder === undefined) return undefined;
  const appended = extensionOrder.map((extension) => `${candidate}${extension}`).find((path) => known.has(path));
  if (appended !== undefined) return appended;
  const extension = posix.extname(candidate);
  let substitutions: readonly string[];
  switch (extension) {
    case ".js":
    case ".jsx": substitutions = [".ts", ".tsx", ".mts"]; break;
    case ".mjs": substitutions = insideNodeModules ? [] : [".mts"]; break;
    default: substitutions = [];
  }
  if (substitutions.length === 0) return undefined;
  const stem = candidate.slice(0, -extension.length);
  return substitutions.map((replacement) => `${stem}${replacement}`).find((path) => known.has(path));
}

function observedPathLikeInputTarget(
  imported: ParsedImport,
  from: string,
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  buildTarget: "browser" | "bun",
): string | undefined {
  if (imported.external || !pathLikeImport(imported.path)) return undefined;
  const withoutOriginal: ParsedImport = {
    external: imported.external,
    hasAttributes: imported.hasAttributes,
    kind: imported.kind,
    path: imported.path,
  };
  const target = inputTarget(imported.path, from, known, aliases)
    ?? typescriptRuntimeInputTarget(withoutOriginal, from, known, buildTarget);
  if (
    target === undefined
    || imported.original === undefined
    || !pathLikeImport(imported.original)
  ) return target;
  const original = { ...withoutOriginal, path: imported.original };
  const originalTarget = inputTarget(original.path, from, known, aliases)
    ?? typescriptRuntimeInputTarget(original, from, known, buildTarget);
  return originalTarget === target ? target : undefined;
}

function pathLikeImport(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || isAbsolute(value);
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

function strictBarePackageRoot(value: string): string | undefined {
  return /^(?:@[a-z\d][a-z\d._~-]*\/)?[a-z\d][a-z\d._~-]*$/u.test(value)
    ? value
    : undefined;
}

function missingPath(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

async function resolutionFileSnapshot(
  rootDirectory: string,
  path: string,
): Promise<ResolutionFileSnapshot> {
  const absolute = resolve(rootDirectory, path);
  let stat;
  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (missingPath(error)) return { kind: "missing", path };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: "symlink", path, target: await readlink(absolute) };
  if (!stat.isFile()) return { kind: "other", mode: stat.mode, path };
  const bytes = await readFile(absolute);
  return {
    bytes: bytes.byteLength,
    kind: "file",
    mode: stat.mode,
    path,
    sha256: sha256(bytes),
    source: new Uint8Array(bytes),
  };
}

function rootResolutionFileSnapshots(rootDirectory: string): Promise<readonly ResolutionFileSnapshot[]> {
  return Promise.all(
    ["jsconfig.json", "package.json", "tsconfig.json"].map((path) =>
      resolutionFileSnapshot(rootDirectory, path)
    ),
  );
}

function strictJsonObjectFromSnapshot(
  snapshot: ResolutionFileSnapshot,
): Readonly<{ exists: boolean; record?: Record<string, unknown>; valid: boolean }> {
  if (snapshot.kind === "missing") return { exists: false, valid: true };
  if (snapshot.kind !== "file") return { exists: true, valid: false };
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.source);
    const parsed: unknown = JSON.parse(source);
    return { exists: true, record: plainObject(parsed, snapshot.path), valid: true };
  } catch {
    return { exists: true, valid: false };
  }
}

function rootResolutionSnapshot(
  snapshots: readonly ResolutionFileSnapshot[],
  path: string,
): ResolutionFileSnapshot {
  const matches = snapshots.filter((snapshot) => snapshot.path === path);
  assert.equal(matches.length, 1, `Root resolution snapshot is missing ${path}`);
  return matches[0]!;
}

function bareInputFallbackPolicy(
  rootSnapshots: readonly ResolutionFileSnapshot[],
): BareInputFallbackPolicy {
  const disabled = { enabled: false, packageName: undefined, pathPatterns: [] } as const;
  const packageJson = strictJsonObjectFromSnapshot(rootResolutionSnapshot(rootSnapshots, "package.json"));
  if (!packageJson.valid) return disabled;
  let packageName: string | undefined;
  if (packageJson.record !== undefined && Object.hasOwn(packageJson.record, "name")) {
    const candidate = packageJson.record.name;
    if (typeof candidate !== "string" || strictBarePackageRoot(candidate) !== candidate) return disabled;
    packageName = candidate;
  }

  const tsconfig = strictJsonObjectFromSnapshot(rootResolutionSnapshot(rootSnapshots, "tsconfig.json"));
  const config = tsconfig.exists
    ? tsconfig
    : strictJsonObjectFromSnapshot(rootResolutionSnapshot(rootSnapshots, "jsconfig.json"));
  if (!config.valid) return disabled;
  const record = config.record;
  if (record === undefined) return { enabled: true, packageName, pathPatterns: [] };
  if (Object.hasOwn(record, "extends")) return disabled;
  if (record.compilerOptions === undefined) return { enabled: true, packageName, pathPatterns: [] };
  let compilerOptions: Record<string, unknown>;
  try {
    compilerOptions = plainObject(record.compilerOptions, "compilerOptions");
  } catch {
    return disabled;
  }
  if (Object.hasOwn(compilerOptions, "baseUrl")) return disabled;
  if (compilerOptions.paths === undefined) return { enabled: true, packageName, pathPatterns: [] };
  let paths: Record<string, unknown>;
  try {
    paths = plainObject(compilerOptions.paths, "compilerOptions.paths");
  } catch {
    return disabled;
  }
  const pathPatterns: string[] = [];
  for (const pattern of Object.keys(paths).sort()) {
    if (
      pattern.length === 0
      || /[\u0000-\u001f\u007f]/u.test(pattern)
      || (pattern.match(/\*/gu)?.length ?? 0) > 1
    ) return disabled;
    const targets = paths[pattern];
    if (
      !Array.isArray(targets)
      || targets.length === 0
      || !targets.every((target) =>
        typeof target === "string"
        && target.length > 0
        && !/[\u0000-\u001f\u007f]/u.test(target)
      )
    ) return disabled;
    pathPatterns.push(pattern);
  }
  return { enabled: true, packageName, pathPatterns };
}

function pathPatternMatches(pattern: string, specifier: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier;
  return specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
}

async function captureNearestPackageScope(rootDirectory: string, from: string): Promise<PackageScope> {
  const files: ResolutionFileSnapshot[] = [];
  let directory = posix.dirname(from);
  while (true) {
    const logical = posix.join(directory === "." ? "" : directory, "package.json");
    const snapshot = await resolutionFileSnapshot(rootDirectory, logical);
    files.push(snapshot);
    const candidate = strictJsonObjectFromSnapshot(snapshot);
    if (candidate.exists) {
      if (!candidate.valid || candidate.record === undefined) return { files, name: undefined, valid: false };
      if (!Object.hasOwn(candidate.record, "name")) return { files, name: undefined, valid: true };
      const name = candidate.record.name;
      return typeof name === "string" && strictBarePackageRoot(name) === name
        ? { files, name, valid: true }
        : { files, name: undefined, valid: false };
    }
    if (directory === ".") return { files, name: undefined, valid: true };
    directory = posix.dirname(directory);
  }
}

function captureImporterPackageScope(
  rootDirectory: string,
  from: string,
  cache: Map<string, Promise<PackageScope>>,
): Promise<PackageScope> {
  const existing = cache.get(from);
  if (existing !== undefined) return existing;
  const pending = captureNearestPackageScope(rootDirectory, from);
  cache.set(from, pending);
  return pending;
}

async function nearestPhysicalPackageInstallation(
  rootDirectory: string,
  from: string,
  packageName: string,
): Promise<string | undefined> {
  let directory = posix.dirname(from);
  while (true) {
    if (posix.basename(directory) !== "node_modules") {
      const logical = posix.join(directory === "." ? "" : directory, "node_modules", packageName);
      const absolute = resolve(rootDirectory, ...logical.split("/"));
      let stat;
      try {
        stat = await lstat(absolute);
      } catch (error) {
        if (!missingPath(error)) return undefined;
        stat = undefined;
      }
      if (stat !== undefined) {
        if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
        const settled = await realpath(absolute).catch(() => undefined);
        if (settled !== absolute) return undefined;
        return normalizeLogicalPath(logical, "resolver-visible package installation");
      }
    }
    if (directory === ".") return undefined;
    directory = posix.dirname(directory);
  }
}

function resolverVisibleInstallation(
  rootDirectory: string,
  from: string,
  packageName: string,
  cache: Map<string, Promise<string | undefined>>,
): Promise<string | undefined> {
  const key = JSON.stringify([from, packageName]);
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const pending = nearestPhysicalPackageInstallation(rootDirectory, from, packageName);
  cache.set(key, pending);
  return pending;
}

function bareImportWitnessKey(kind: string, specifier: string): string {
  return JSON.stringify([kind, specifier]);
}

function witnessedBareInputTargets(
  inputs: ReadonlyMap<string, ParsedInput>,
  aliases: ReadonlyMap<string, string>,
): BareInputWitnesses {
  const known = new Set(inputs.keys());
  const witnesses = new Map<string, Set<string>>();
  const specifiers = new Set<string>();
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
      specifiers.add(imported.original);
    }
  }
  return { exact: witnesses, specifiers };
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

type PackageRootExportBranch = Readonly<
  | { kind: "invalid" }
  | { branch: unknown; kind: "match" }
  | { kind: "no-match" }
>;

function validPackageExportSubpathKey(key: string): boolean {
  return key === "."
    || (
      key.startsWith("./")
      && !key.includes("\\")
      && !key.includes("?")
      && !key.includes("#")
      && !key.includes("%")
      && !/[\u0000-\u001f\u007f]/u.test(key)
      && (key.match(/\*/gu)?.length ?? 0) <= 1
    );
}

function packageRootExportBranch(value: unknown): PackageRootExportBranch {
  const record = jsonRecord(value);
  if (record === undefined) return { branch: value, kind: "match" };
  const keys = Object.keys(record);
  const subpaths = keys.filter((key) => key.startsWith("."));
  if (subpaths.length === 0) return { branch: value, kind: "match" };
  if (
    subpaths.length !== keys.length
    || keys.some((key) => !validPackageExportSubpathKey(key))
  ) return { kind: "invalid" };
  return Object.hasOwn(record, ".")
    ? { branch: record["."], kind: "match" }
    : { kind: "no-match" };
}

type ConditionalPackageExportResolution = Readonly<
  | { kind: "invalid" }
  | { kind: "match"; target: string }
  | { kind: "no-match" }
>;

function conditionalPackageExportTarget(
  value: unknown,
  activeConditions: ReadonlySet<string>,
  depth = 0,
): ConditionalPackageExportResolution {
  if (typeof value === "string") return { kind: "match", target: value };
  if (depth >= 32) return { kind: "invalid" };
  const record = jsonRecord(value);
  if (record === undefined) return { kind: "invalid" };
  const keys = Object.keys(record);
  if (keys.length === 0) return { kind: "no-match" };
  if (
    keys.some((key) =>
      key.startsWith(".")
      || key.length === 0
      || /[\u0000-\u001f\u007f]/u.test(key)
    )
  ) return { kind: "invalid" };
  for (const key of keys) {
    if (key !== "default" && !activeConditions.has(key)) continue;
    const resolution = conditionalPackageExportTarget(record[key], activeConditions, depth + 1);
    if (resolution.kind === "no-match") continue;
    return resolution;
  }
  return { kind: "no-match" };
}

function canonicalPackageRootTarget(
  installationRoot: string,
  target: string,
  allowLegacyBareTarget = false,
): string | undefined {
  if (!allowLegacyBareTarget && !target.startsWith("./")) return undefined;
  const relativeTarget = target.startsWith("./") ? target : `./${target}`;
  if (
    !relativeTarget.startsWith("./")
    || relativeTarget.includes("\\")
    || relativeTarget.includes("*")
    || relativeTarget.includes("?")
    || relativeTarget.includes("#")
    || relativeTarget.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(relativeTarget)
  ) return undefined;
  const segments = relativeTarget.slice(2).split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  const candidate = posix.join(installationRoot, ...segments);
  return candidate.startsWith(`${installationRoot}/`)
      && packageInstallationRoot(candidate) === installationRoot
    ? candidate
    : undefined;
}

function browserMapPreservesPackageRoot(
  value: unknown,
  installationRoot: string,
  candidate: string,
): boolean {
  const mappings = jsonRecord(value);
  if (mappings === undefined || Object.keys(mappings).length > 128) return false;
  // Only explicit package-local JavaScript files are understood here. Bare,
  // extensionless, directory, non-ASCII, and malformed mappings need native
  // resolution evidence instead of an inferred zero-witness package-root edge.
  // ASCII avoids filesystem Unicode-normalization aliases; case aliases are
  // checked separately because supported hosts may be case-insensitive.
  const javascriptPath = /^[\x20-\x7e]+\.(?:c|m)?js$/u;
  if (!javascriptPath.test(candidate)) return false;
  for (const [key, value] of Object.entries(mappings)) {
    const source = canonicalPackageRootTarget(installationRoot, key);
    if (
      source === undefined
      || !javascriptPath.test(source)
      || source.toLowerCase() === candidate.toLowerCase()
    ) return false;
    if (value === false) continue;
    if (typeof value !== "string") return false;
    const target = canonicalPackageRootTarget(installationRoot, value);
    if (target === undefined || !javascriptPath.test(target)) return false;
  }
  return true;
}

function capturedPackageRootExportTarget(
  packageName: string,
  installationRoot: string,
  known: ReadonlySet<string>,
  rootDirectory: string,
  inputFileSnapshots: ReadonlyMap<string, LoadedInputFileSnapshot>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
): string | undefined {
  const manifest = packageScopeSnapshots.get(posix.join(installationRoot, "package.json"));
  if (manifest === undefined) return undefined;
  const parsed = strictJsonObjectFromSnapshot(manifest);
  const record = parsed.record;
  if (
    !parsed.valid
    || record === undefined
    || record.name !== packageName
  ) return undefined;
  let candidate: string | undefined;
  if (Object.hasOwn(record, "exports")) {
    const rootBranch = packageRootExportBranch(record.exports);
    if (rootBranch.kind !== "match") return undefined;
    const activeConditions = new Set([
      ...buildConditions,
      "import",
      ...(buildTarget === "browser" ? ["browser"] : ["bun", "node-addons", "node"]),
    ]);
    const resolution = conditionalPackageExportTarget(rootBranch.branch, activeConditions);
    candidate = resolution.kind === "match"
      ? canonicalPackageRootTarget(installationRoot, resolution.target)
      : undefined;
  } else {
    const declaredFields = (["module", "main"] as const).filter((field) =>
      Object.hasOwn(record, field)
    );
    const declaredCandidates: string[] = [];
    for (const field of declaredFields) {
      const value = record[field];
      if (typeof value !== "string") return undefined;
      const declared = canonicalPackageRootTarget(installationRoot, value, true);
      if (declared === undefined || !javascriptFilter.test(declared)) return undefined;
      declaredCandidates.push(declared);
    }
    if (declaredCandidates.length === 0) {
      const implicit = canonicalPackageRootTarget(installationRoot, "./index.js");
      assert.ok(implicit !== undefined);
      declaredCandidates.push(implicit);
    }
    const distinctCandidates = [...new Set(declaredCandidates)];
    const knownCandidates = distinctCandidates.filter((target) => known.has(target));
    if (knownCandidates.length !== 1) return undefined;
    candidate = knownCandidates[0];
    if (
      candidate === undefined
      || capturedJavascriptInputFileSnapshot(candidate, rootDirectory, inputFileSnapshots) === undefined
      || distinctCandidates.some((target) =>
        target !== candidate
        && capturedJavascriptInputFileSnapshot(target, rootDirectory, inputFileSnapshots) !== undefined
      )
    ) return undefined;
  }
  if (
    candidate === undefined
    || !candidate.startsWith(`${installationRoot}/`)
    || packageInstallationRoot(candidate) !== installationRoot
    || !known.has(candidate)
    || (buildTarget === "browser" && Object.hasOwn(record, "browser")
      && !browserMapPreservesPackageRoot(record.browser, installationRoot, candidate))
  ) return undefined;
  return candidate;
}

function capturedJavascriptInputFileSnapshot(
  target: string,
  rootDirectory: string,
  inputFileSnapshots: ReadonlyMap<string, LoadedInputFileSnapshot>,
): LoadedInputFileSnapshot | undefined {
  if (!javascriptFilter.test(target)) return undefined;
  const captured = inputFileSnapshots.get(target);
  return captured !== undefined
      && captured.snapshot.kind === "file"
      && captured.snapshot.path === target
      && captured.resolvedPath === resolve(rootDirectory, ...target.split("/"))
    ? captured
    : undefined;
}

function capturedPackageSubpathExportTarget(
  packageName: string,
  installationRoot: string,
  specifier: string,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
): string | undefined {
  if (
    strictBarePackageRoot(packageName) !== packageName
    || barePackageName(specifier) !== packageName
    || !specifier.startsWith(`${packageName}/`)
  ) return undefined;
  const subpathSegments = specifier.slice(packageName.length + 1).split("/");
  if (
    subpathSegments.length === 0
    || subpathSegments.some((segment) =>
      segment.length === 0
      || segment === "."
      || segment === ".."
      || segment.includes("\\")
      || segment.includes("*")
      || segment.includes("?")
      || segment.includes("#")
      || segment.includes("%")
      || /[\u0000-\u001f\u007f]/u.test(segment)
    )
  ) return undefined;

  const manifest = packageScopeSnapshots.get(posix.join(installationRoot, "package.json"));
  if (manifest === undefined) return undefined;
  const parsed = strictJsonObjectFromSnapshot(manifest);
  const exportsRecord = parsed.record === undefined ? undefined : jsonRecord(parsed.record.exports);
  if (
    !parsed.valid
    || parsed.record === undefined
    || parsed.record.name !== packageName
    || !Object.hasOwn(parsed.record, "exports")
    || exportsRecord === undefined
  ) return undefined;
  const exportKeys = Object.keys(exportsRecord);
  if (
    exportKeys.length === 0
    || exportKeys.some((key) =>
      key !== "."
      && (
        !key.startsWith("./")
        || key.includes("\\")
        || key.includes("?")
        || key.includes("#")
        || key.includes("%")
        || /[\u0000-\u001f\u007f]/u.test(key)
        || (key.match(/\*/gu)?.length ?? 0) > 1
      )
    )
  ) return undefined;

  const subpath = `./${subpathSegments.join("/")}`;
  let branch: unknown;
  let replacement: string | undefined;
  if (Object.hasOwn(exportsRecord, subpath)) {
    branch = exportsRecord[subpath];
  } else {
    const matches = exportKeys.flatMap((key) => {
      const star = key.indexOf("*");
      if (star === -1) return [];
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return [];
      const value = subpath.slice(prefix.length, subpath.length - suffix.length);
      return value.length === 0 ? [] : [{ branch: exportsRecord[key], replacement: value }];
    });
    if (matches.length !== 1) return undefined;
    branch = matches[0]!.branch;
    replacement = matches[0]!.replacement;
  }

  const activeConditions = new Set([
    ...buildConditions,
    "import",
    ...(buildTarget === "browser" ? ["browser"] : ["bun", "node-addons", "node"]),
  ]);
  const resolution = conditionalPackageExportTarget(branch, activeConditions);
  let target = resolution.kind === "match" ? resolution.target : undefined;
  if (target === undefined) return undefined;
  const targetStars = target.match(/\*/gu)?.length ?? 0;
  if (replacement === undefined ? targetStars !== 0 : targetStars !== 1) return undefined;
  if (replacement !== undefined) {
    const star = target.indexOf("*");
    target = `${target.slice(0, star)}${replacement}${target.slice(star + 1)}`;
  }
  if (
    !target.startsWith("./")
    || target.includes("\\")
    || target.includes("*")
    || target.includes("?")
    || target.includes("#")
    || target.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(target)
  ) return undefined;
  const targetSegments = target.slice(2).split("/");
  if (targetSegments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return undefined;
  }
  const candidate = posix.join(installationRoot, ...targetSegments);
  return candidate.startsWith(`${installationRoot}/`)
      && packageInstallationRoot(candidate) === installationRoot
      && packageBelowNodeModules(candidate) === packageName
    ? candidate
    : undefined;
}

function capturedAuthoritativePackageSubpathExportTarget(
  packageName: string,
  installationRoot: string,
  specifier: string,
  known: ReadonlySet<string>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
): string | undefined {
  const manifestPath = posix.join(installationRoot, "package.json");
  const capturedManifest = packageScopeSnapshots.get(manifestPath);
  if (capturedManifest === undefined) return undefined;
  const parsedManifest = strictJsonObjectFromSnapshot(capturedManifest);
  if (
    !parsedManifest.valid
    || parsedManifest.record === undefined
    || parsedManifest.record.name !== packageName
    || Object.hasOwn(parsedManifest.record, "browser")
  ) return undefined;
  const candidate = capturedPackageSubpathExportTarget(
    packageName,
    installationRoot,
    specifier,
    packageScopeSnapshots,
    buildConditions,
    buildTarget,
  );
  if (candidate === undefined || !known.has(candidate)) return undefined;
  const targetScope = packageScopes.get(candidate);
  const targetManifest = targetScope?.files.at(-1);
  if (
    targetScope === undefined
    || !targetScope.valid
    || targetScope.name !== packageName
    || targetManifest === undefined
    || targetManifest.kind !== "file"
    || targetManifest.path !== manifestPath
  ) return undefined;
  assert.deepEqual(
    targetManifest,
    capturedManifest,
    `Bun authoritative package scope differs for ${candidate}`,
  );
  return candidate;
}

type TransparentCommonJsSelectorTarget = Readonly<{
  fileSnapshots: readonly LoadedInputFileSnapshot[];
  scopeSnapshots: readonly ResolutionFileSnapshot[];
  target: string;
}>;

function canonicalCommonJsRequireTarget(
  wrapper: string,
  literal: string,
  packageName: string,
  installationRoot: string,
): string | undefined {
  if (
    !(literal.startsWith("./") || literal.startsWith("../"))
    || literal.includes("\\")
    || literal.includes("?")
    || literal.includes("#")
    || literal.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(literal)
  ) return undefined;
  const normalizedLiteral = posix.normalize(literal);
  const canonicalLiteral = normalizedLiteral.startsWith("../")
    ? normalizedLiteral
    : `./${normalizedLiteral}`;
  if (canonicalLiteral !== literal) return undefined;
  const candidate = posix.normalize(posix.join(posix.dirname(wrapper), literal));
  return candidate.startsWith(`${installationRoot}/`)
      && packageInstallationRoot(candidate) === installationRoot
      && packageBelowNodeModules(candidate) === packageName
      && javascriptFilter.test(candidate)
    ? candidate
    : undefined;
}

function transparentCommonJsSelectorBranches(
  snapshot: ResolutionFileSnapshot,
  productionEnvironmentDefine: string,
): Readonly<{ development: string; production: string }> | undefined {
  if (
    snapshot.kind !== "file"
    || productionEnvironmentDefine !== JSON.stringify("production")
  ) return undefined;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.source);
  } catch {
    return undefined;
  }
  const match = /^(?:\s*(?:"use strict"|'use strict');)?\s*if\s*\(\s*process\.env\.NODE_ENV\s*===\s*(?:"production"|'production')\s*\)\s*\{\s*module\.exports\s*=\s*require\s*\(\s*(?:"([^"\\\r\n]+)"|'([^'\\\r\n]+)')\s*\)\s*;\s*\}\s*else\s*\{\s*module\.exports\s*=\s*require\s*\(\s*(?:"([^"\\\r\n]+)"|'([^'\\\r\n]+)')\s*\)\s*;\s*\}\s*$/u.exec(source);
  if (match === null) return undefined;
  const production = match[1] ?? match[2];
  const development = match[3] ?? match[4];
  return production === undefined || development === undefined
    ? undefined
    : { development, production };
}

function capturedTransparentCommonJsPackageSubpathTarget(
  packageName: string,
  installationRoot: string,
  specifier: string,
  known: ReadonlySet<string>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  inputFileSnapshots: ReadonlyMap<string, LoadedInputFileSnapshot>,
  rootDirectory: string,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
  productionEnvironmentDefine: string,
): TransparentCommonJsSelectorTarget | undefined {
  if (
    packageName !== "use-sync-external-store"
    || specifier !== "use-sync-external-store/shim/index.js"
  ) return undefined;
  const manifestPath = posix.join(installationRoot, "package.json");
  const capturedManifest = packageScopeSnapshots.get(manifestPath);
  if (capturedManifest === undefined) return undefined;
  const parsedManifest = strictJsonObjectFromSnapshot(capturedManifest);
  if (
    !parsedManifest.valid
    || parsedManifest.record === undefined
    || parsedManifest.record.name !== packageName
    || Object.hasOwn(parsedManifest.record, "browser")
    || (parsedManifest.record.type !== undefined && parsedManifest.record.type !== "commonjs")
  ) return undefined;
  const wrapper = capturedPackageSubpathExportTarget(
    packageName,
    installationRoot,
    specifier,
    packageScopeSnapshots,
    buildConditions,
    buildTarget,
  );
  if (
    wrapper === undefined
    || wrapper !== posix.join(installationRoot, "shim/index.js")
    || known.has(wrapper)
    || !javascriptFilter.test(wrapper)
  ) return undefined;
  const wrapperSnapshot = inputFileSnapshots.get(wrapper);
  if (
    wrapperSnapshot === undefined
    || wrapperSnapshot.snapshot.kind !== "file"
    || wrapperSnapshot.resolvedPath !== resolve(rootDirectory, ...wrapper.split("/"))
  ) return undefined;
  const wrapperScope = packageScopes.get(wrapper);
  if (wrapperScope === undefined) return undefined;
  const wrapperScopeSnapshots = matchingCapturedPackageScopeSnapshots(
    wrapperScope,
    packageScopeSnapshots,
    `Bun raw CommonJS selector wrapper ${wrapper}`,
  );
  if (
    wrapperScopeSnapshots === undefined
    || packageScopeHasBrowserRemap(wrapperScopeSnapshots)
  ) return undefined;
  const branches = transparentCommonJsSelectorBranches(
    wrapperSnapshot.snapshot,
    productionEnvironmentDefine,
  );
  if (branches === undefined) return undefined;
  const productionTarget = canonicalCommonJsRequireTarget(
    wrapper,
    branches.production,
    packageName,
    installationRoot,
  );
  const developmentTarget = canonicalCommonJsRequireTarget(
    wrapper,
    branches.development,
    packageName,
    installationRoot,
  );
  if (
    productionTarget === undefined
    || developmentTarget === undefined
    || productionTarget === wrapper
    || developmentTarget === wrapper
    || !known.has(productionTarget)
  ) return undefined;
  const installationInputs = [...known]
    .filter((path) => packageInstallationRoot(path) === installationRoot)
    .sort();
  if (installationInputs.length !== 1 || installationInputs[0] !== productionTarget) return undefined;
  const targetSnapshot = inputFileSnapshots.get(productionTarget);
  const targetScope = packageScopes.get(productionTarget);
  if (
    targetSnapshot === undefined
    || targetSnapshot.snapshot.kind !== "file"
    || targetSnapshot.resolvedPath !== resolve(rootDirectory, ...productionTarget.split("/"))
    || targetScope === undefined
  ) return undefined;
  const targetScopeSnapshots = matchingCapturedPackageScopeSnapshots(
    targetScope,
    packageScopeSnapshots,
    `Bun raw CommonJS selector target ${productionTarget}`,
  );
  if (
    targetScopeSnapshots === undefined
    || packageScopeHasBrowserRemap(targetScopeSnapshots)
  ) return undefined;
  const targetManifest = targetScopeSnapshots.at(-1);
  const wrapperManifest = wrapperScopeSnapshots.at(-1);
  if (
    targetManifest === undefined
    || wrapperManifest === undefined
    || targetManifest.path !== manifestPath
    || wrapperManifest.path !== manifestPath
  ) return undefined;
  assert.deepEqual(wrapperManifest, capturedManifest, `Bun raw CommonJS selector wrapper scope differs for ${wrapper}`);
  assert.deepEqual(targetManifest, capturedManifest, `Bun raw CommonJS selector target scope differs for ${productionTarget}`);
  return {
    fileSnapshots: [wrapperSnapshot, targetSnapshot],
    scopeSnapshots: wrapperScopeSnapshots,
    target: productionTarget,
  };
}

function matchingCapturedPackageScopeSnapshots(
  scope: PackageScope,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  description: string,
): readonly ResolutionFileSnapshot[] | undefined {
  if (!scope.valid || scope.files.length === 0) return undefined;
  const captured: ResolutionFileSnapshot[] = [];
  for (const snapshot of scope.files) {
    const matching = packageScopeSnapshots.get(snapshot.path);
    if (matching === undefined) return undefined;
    assert.deepEqual(snapshot, matching, `${description} differs from its captured package scope`);
    captured.push(matching);
  }
  return captured;
}

function packageScopeHasBrowserRemap(
  snapshots: readonly ResolutionFileSnapshot[],
): boolean {
  const manifest = snapshots.at(-1);
  if (manifest === undefined) return true;
  const parsed = strictJsonObjectFromSnapshot(manifest);
  return !parsed.valid
    || (parsed.record !== undefined && Object.hasOwn(parsed.record, "browser"));
}

function retainRawBareInputFallbackUse(
  uses: RawBareInputFallbackUse[],
  imported: ParsedImport,
  from: string,
  target: string | undefined,
  packageName: string,
  installationRoot: string,
  importerScopeSnapshots: readonly ResolutionFileSnapshot[],
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  additionalScopeSnapshots: readonly ResolutionFileSnapshot[] = [],
  fileSnapshots: readonly LoadedInputFileSnapshot[] = [],
): string | undefined {
  if (target === undefined) return undefined;
  const targetScope = packageScopes.get(target);
  if (targetScope === undefined) return undefined;
  const targetScopeSnapshots = matchingCapturedPackageScopeSnapshots(
    targetScope,
    packageScopeSnapshots,
    `Bun raw fallback target ${target}`,
  );
  if (targetScopeSnapshots === undefined) return undefined;
  const byPath = new Map<string, ResolutionFileSnapshot>();
  for (const snapshot of [...importerScopeSnapshots, ...targetScopeSnapshots, ...additionalScopeSnapshots]) {
    const previous = byPath.get(snapshot.path);
    if (previous === undefined) byPath.set(snapshot.path, snapshot);
    else assert.deepEqual(snapshot, previous, `Bun raw fallback package scope ${snapshot.path} is inconsistent`);
  }
  uses.push({
    fileSnapshots,
    from,
    installationRoot,
    packageName,
    scopeSnapshots: [...byPath.values()].sort(({ path: left }, { path: right }) =>
      left < right ? -1 : left > right ? 1 : 0
    ),
    specifier: imported.path,
    target,
  });
  return target;
}

async function resolvedInputTarget(
  imported: ParsedImport,
  from: string,
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  installations: ReadonlyMap<string, ReadonlySet<string>>,
  witnesses: BareInputWitnesses,
  rootDirectory: string,
  fallbackPolicy: BareInputFallbackPolicy,
  resolverCache: Map<string, Promise<string | undefined>>,
  rawFallbackUses: RawBareInputFallbackUse[],
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  inputFileSnapshots: ReadonlyMap<string, LoadedInputFileSnapshot>,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
  productionEnvironmentDefine: string,
): Promise<string | undefined> {
  if (imported.external) return undefined;
  const direct = imported.original !== undefined || pathLikeImport(imported.path)
    ? inputTarget(imported.path, from, known, aliases)
    : undefined;
  if (direct !== undefined) return direct;
  const typescriptRuntime = typescriptRuntimeInputTarget(imported, from, known, buildTarget);
  if (typescriptRuntime !== undefined) return typescriptRuntime;
  const packageName = barePackageName(imported.path);
  if (packageName === undefined) return undefined;
  const installationRoots = [...(installations.get(packageName) ?? [])].sort();
  assert.ok(
    installationRoots.length <= 1,
    `Bun metafile bare import target is ambiguous for ${imported.path}; in-graph package installations: ${installationRoots.join(", ")}`,
  );
  const candidates = [...(witnesses.exact.get(bareImportWitnessKey(imported.kind, imported.path)) ?? [])].sort();
  assert.ok(
    candidates.length <= 1,
    `Bun metafile bare import target is ambiguous for ${imported.path}: ${candidates.join(", ")}`,
  );
  const target = candidates[0];
  if (target !== undefined) {
    assert.equal(
      packageBelowNodeModules(target),
      packageName,
      `Bun metafile bare import witness has the wrong package identity for ${imported.path}`,
    );
    const installationRoot = installationRoots[0];
    if (
      installationRoot === undefined
      || packageInstallationRoot(target) !== installationRoot
      || await resolverVisibleInstallation(
        rootDirectory,
        from,
        packageName,
        resolverCache,
      ) !== installationRoot
    ) return undefined;
    return target;
  }
  if (
    imported.original !== undefined
    || imported.hasAttributes
    || witnesses.specifiers.has(imported.path)
    || imported.path === "bun"
    || isBuiltin(imported.path)
    || imported.kind !== "import-statement"
    || installationRoots.length !== 1
    || !fallbackPolicy.enabled
    || fallbackPolicy.packageName === packageName
    || fallbackPolicy.pathPatterns.some((pattern) => pathPatternMatches(pattern, imported.path))
  ) return undefined;
  const scope = packageScopes.get(from);
  assert.ok(scope !== undefined, `Bun input has no settled package scope: ${from}`);
  if (!scope.valid || scope.name === packageName) return undefined;
  const importerScopeSnapshots = matchingCapturedPackageScopeSnapshots(
    scope,
    packageScopeSnapshots,
    `Bun raw fallback importer ${from}`,
  );
  if (
    importerScopeSnapshots === undefined
    || packageScopeHasBrowserRemap(importerScopeSnapshots)
  ) return undefined;
  const installationRoot = installationRoots[0]!;
  const resolverVisible = await resolverVisibleInstallation(
    rootDirectory,
    from,
    packageName,
    resolverCache,
  );
  if (resolverVisible !== installationRoot) return undefined;
  if (strictBarePackageRoot(imported.path) !== packageName) {
    const authoritative = capturedAuthoritativePackageSubpathExportTarget(
      packageName,
      installationRoot,
      imported.path,
      known,
      packageScopes,
      packageScopeSnapshots,
      buildConditions,
      buildTarget,
    );
    const selector = authoritative === undefined
      ? capturedTransparentCommonJsPackageSubpathTarget(
        packageName,
        installationRoot,
        imported.path,
        known,
        packageScopes,
        packageScopeSnapshots,
        inputFileSnapshots,
        rootDirectory,
        buildConditions,
        buildTarget,
        productionEnvironmentDefine,
      )
      : undefined;
    return retainRawBareInputFallbackUse(
      rawFallbackUses,
      imported,
      from,
      authoritative ?? selector?.target,
      packageName,
      installationRoot,
      importerScopeSnapshots,
      packageScopes,
      packageScopeSnapshots,
      selector?.scopeSnapshots,
      selector?.fileSnapshots,
    );
  }
  const rawTarget = capturedPackageRootExportTarget(
    packageName,
    installationRoot,
    known,
    rootDirectory,
    inputFileSnapshots,
    packageScopeSnapshots,
    buildConditions,
    buildTarget,
  );
  const rawTargetSnapshot = rawTarget === undefined
    ? undefined
    : capturedJavascriptInputFileSnapshot(rawTarget, rootDirectory, inputFileSnapshots);
  return retainRawBareInputFallbackUse(
    rawFallbackUses,
    imported,
    from,
    rawTargetSnapshot === undefined ? undefined : rawTarget,
    packageName,
    installationRoot,
    importerScopeSnapshots,
    packageScopes,
    packageScopeSnapshots,
    [],
    rawTargetSnapshot === undefined ? [] : [rawTargetSnapshot],
  );
}

async function revalidateRawBareInputFallbackUses(
  rootDirectory: string,
  rootResolutionSnapshots: readonly ResolutionFileSnapshot[],
  uses: readonly RawBareInputFallbackUse[],
  boundary: "after edge settlement" | "before graph receipt commit",
): Promise<void> {
  if (uses.length === 0) return;
  assert.deepEqual(
    await rootResolutionFileSnapshots(rootDirectory),
    rootResolutionSnapshots,
    boundary === "after edge settlement"
      ? "Bun root resolution configuration changed after raw fallback edge settlement"
      : "Bun root resolution configuration changed before graph receipt commit",
  );
  for (const use of uses) {
    assert.equal(
      await nearestPhysicalPackageInstallation(rootDirectory, use.from, use.packageName),
      use.installationRoot,
      `Bun raw fallback resolver-visible installation changed for ${use.specifier} from ${use.from}`,
    );
    assert.equal(
      packageInstallationRoot(use.target),
      use.installationRoot,
      `Bun raw fallback target left its captured installation: ${use.target}`,
    );
    for (const snapshot of use.scopeSnapshots) {
      assert.deepEqual(
        await resolutionFileSnapshot(rootDirectory, snapshot.path),
        snapshot,
        `Bun raw fallback package scope changed ${boundary}: ${snapshot.path}`,
      );
    }
    for (const snapshot of use.fileSnapshots) {
      const absolute = resolve(rootDirectory, ...snapshot.snapshot.path.split("/"));
      assert.equal(
        await realpath(absolute),
        snapshot.resolvedPath,
        `Bun raw fallback source realpath changed ${boundary}: ${snapshot.snapshot.path}`,
      );
      assert.deepEqual(
        await resolutionFileSnapshot(rootDirectory, snapshot.snapshot.path),
        snapshot.snapshot,
        `Bun raw fallback source changed ${boundary}: ${snapshot.snapshot.path}`,
      );
    }
  }
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

async function exactOrdinaryDirectory(rootDirectory: string, path: string): Promise<boolean> {
  const absolute = resolve(rootDirectory, ...path.split("/"));
  const stat = await lstat(absolute).catch(() => undefined);
  return stat !== undefined
    && stat.isDirectory()
    && !stat.isSymbolicLink()
    && await realpath(absolute).catch(() => undefined) === absolute;
}

async function exactOrdinaryFileSnapshot(
  rootDirectory: string,
  path: string,
): Promise<ElidedPackageInputSnapshot | undefined> {
  const absolute = resolve(rootDirectory, ...path.split("/"));
  const before = await lstat(absolute).catch(() => undefined);
  if (
    before === undefined
    || !before.isFile()
    || before.isSymbolicLink()
    || await realpath(absolute).catch(() => undefined) !== absolute
  ) return undefined;
  const source = await readFile(absolute);
  const after = await lstat(absolute).catch(() => undefined);
  assert.deepEqual(
    after === undefined
      ? undefined
      : { dev: after.dev, ino: after.ino, mode: after.mode, size: after.size },
    { dev: before.dev, ino: before.ino, mode: before.mode, size: before.size },
    `Bun elided package input changed while it was captured: ${path}`,
  );
  assert.equal(source.byteLength, before.size, `Bun elided package input size changed while it was captured: ${path}`);
  return {
    bytes: source.byteLength,
    mode: before.mode,
    path,
    sha256: sha256(source),
  };
}

function isExactNativeCssUrlInputWitness(
  rootDirectory: string,
  imported: ParsedImport,
  from: string,
  importerFormat: ParsedInput["format"],
  path: string,
): boolean {
  if (
    importerFormat !== "css"
    || imported.kind !== "url-token"
    || imported.external
    || imported.hasAttributes
    || imported.original === undefined
    || (!imported.original.startsWith("./") && !imported.original.startsWith("../"))
    || /[\\?#%\u0000-\u001f\u007f]/u.test(imported.original)
  ) return false;
  const absolute = resolve(rootDirectory, ...path.split("/"));
  if (!isAbsolute(imported.path) || resolve(imported.path) !== imported.path || imported.path !== absolute) return false;
  const relativeFromImporter = posix.relative(posix.dirname(from), path);
  const expectedOriginal = relativeFromImporter.startsWith("../")
    ? relativeFromImporter
    : `./${relativeFromImporter}`;
  return imported.original === expectedOriginal;
}

async function promoteObservedNativeCssUrlInputs(
  rootDirectory: string,
  inputMetadata: Map<string, ParsedInput>,
  inputAliases: Map<string, string>,
  inputSnapshots: ReadonlyMap<string, Readonly<{ bytes: number; sha256: string }>>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  knownOutputs: ReadonlySet<string>,
): Promise<PromotedNativeCssUrlInputs> {
  const authoritativeInputs = [...inputMetadata.entries()];
  const observedNativePaths = [...inputSnapshots.keys()]
    .filter((path) => !inputMetadata.has(path))
    .filter((path) => !javascriptFilter.test(path) && !path.endsWith(".css"))
    .filter((path) => nativeLoaderFor(path) === "file")
    .sort();
  const observedAliases = new Map(inputAliases);
  for (const path of observedNativePaths) {
    const absolute = resolve(rootDirectory, ...path.split("/"));
    const relativeToProcess = relative(process.cwd(), absolute).split(sep).join("/");
    for (const alias of [path, absolute, relativeToProcess]) {
      const previous = observedAliases.get(alias);
      assert.ok(
        previous === undefined || previous === path,
        `Bun observed native CSS URL input alias is ambiguous: ${alias}`,
      );
      observedAliases.set(alias, path);
    }
  }

  const promoted = new Map<string, ElidedPackageInputSnapshot>();
  const promotedPackageScopeSnapshots = new Map<string, ResolutionFileSnapshot>();
  for (const [from, metadata] of authoritativeInputs) {
    if (metadata.format !== "css") continue;
    for (const imported of metadata.imports) {
      if (
        imported.kind !== "url-token"
        || !isAbsolute(imported.path)
      ) continue;
      const original = imported.original;
      if (original === undefined) continue;
      const path = observedAliases.get(imported.path);
      if (
        path === undefined
        || !isExactNativeCssUrlInputWitness(rootDirectory, imported, from, metadata.format, path)
        || inputMetadata.has(path)
        || nativeLoaderFor(path) !== "file"
        || outputTarget(imported.path, from, knownOutputs) !== undefined
        || outputTarget(original, from, knownOutputs) !== undefined
      ) continue;
      const snapshot = inputSnapshots.get(path);
      const scope = packageScopes.get(path);
      const dependencyPackage = packageBelowNodeModules(path);
      const installationRoot = packageInstallationRoot(path);
      const terminalScopeSnapshot = scope?.files.at(-1);
      if (
        snapshot === undefined
        || scope?.valid !== true
        || (
          dependencyPackage !== undefined
          && (
            installationRoot === undefined
            || scope.name !== dependencyPackage
            || terminalScopeSnapshot?.kind !== "file"
            || terminalScopeSnapshot.path !== posix.join(installationRoot, "package.json")
          )
        )
      ) continue;
      const current = await exactOrdinaryFileSnapshot(rootDirectory, path);
      if (current === undefined) continue;
      assert.deepEqual(
        { bytes: current.bytes, sha256: current.sha256 },
        snapshot,
        `Bun observed native CSS URL input changed after its completed load: ${path}`,
      );
      const previous = promoted.get(path);
      if (previous === undefined) promoted.set(path, current);
      else assert.deepEqual(current, previous, `Bun observed native CSS URL input changed between edges: ${path}`);
      for (const scopeSnapshot of scope.files) {
        retainResolutionFileSnapshot(promotedPackageScopeSnapshots, scopeSnapshot);
      }
    }
  }

  for (const [path, snapshot] of [...promoted.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    assert.equal(inputMetadata.has(path), false, `Bun observed native CSS URL input collides with a metafile input: ${path}`);
    inputMetadata.set(path, { bytes: snapshot.bytes, imports: [] });
    const absolute = resolve(rootDirectory, ...path.split("/"));
    const relativeToProcess = relative(process.cwd(), absolute).split(sep).join("/");
    for (const alias of [path, absolute, relativeToProcess]) {
      const previous = inputAliases.get(alias);
      assert.ok(
        previous === undefined || previous === path,
        `Bun promoted native CSS URL input alias is ambiguous: ${alias}`,
      );
      inputAliases.set(alias, path);
    }
  }
  return {
    inputs: promoted,
    packageScopeSnapshots: promotedPackageScopeSnapshots,
  };
}

function retainResolutionFileSnapshot(
  snapshots: Map<string, ResolutionFileSnapshot>,
  snapshot: ResolutionFileSnapshot,
): void {
  const previous = snapshots.get(snapshot.path);
  if (previous === undefined) snapshots.set(snapshot.path, snapshot);
  else assert.deepEqual(snapshot, previous, `Bun elided package scope ${snapshot.path} changed between edges`);
}

function packageDeclaresJavaScriptSideEffectFree(manifest: Record<string, unknown>): boolean {
  const sideEffects = manifest.sideEffects;
  if (sideEffects === false) return true;
  if (!Array.isArray(sideEffects) || sideEffects.length === 0) return false;
  return sideEffects.every((pattern) => {
    if (
      typeof pattern !== "string"
      || pattern.length === 0
      || pattern.startsWith("/")
      || pattern.includes("\\")
      || pattern.includes("?")
      || pattern.includes("#")
      || pattern.includes("%")
      || /[\u0000-\u001f\u007f]/u.test(pattern)
    ) return false;
    const relativePattern = pattern.startsWith("./") ? pattern.slice(2) : pattern;
    const segments = relativePattern.split("/");
    if (
      segments.length === 0
      || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) return false;
    return segments.every((segment, index) =>
      index < segments.length - 1
        ? segment === "**" || /^[A-Za-z0-9@._-]+$/u.test(segment)
        : /^(?:\*|[A-Za-z0-9@_-][A-Za-z0-9@._-]*)\.css$/u.test(segment)
    );
  });
}

function hasIndependentAuthoritativePackageInputEdge(
  candidate: string,
  elidedFrom: string,
  inputMetadata: ReadonlyMap<string, ParsedInput>,
  knownInputs: ReadonlySet<string>,
  inputAliases: ReadonlyMap<string, string>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  buildTarget: "browser" | "bun",
): boolean {
  const installationRoot = packageInstallationRoot(candidate);
  const packageName = packageBelowNodeModules(candidate);
  const candidateScope = packageScopes.get(candidate);
  const candidateManifest = candidateScope?.files.at(-1);
  if (
    installationRoot === undefined
    || packageName === undefined
    || candidateScope === undefined
    || !candidateScope.valid
    || candidateScope.name !== packageName
    || candidateManifest === undefined
    || candidateManifest.kind !== "file"
  ) return false;

  for (const [from, metadata] of inputMetadata) {
    if (
      from === elidedFrom
      || from === candidate
      || metadata.format !== "esm"
      || packageInstallationRoot(from) !== installationRoot
      || packageBelowNodeModules(from) !== packageName
    ) continue;
    const importerScope = packageScopes.get(from);
    const importerManifest = importerScope?.files.at(-1);
    if (
      importerScope === undefined
      || !importerScope.valid
      || importerScope.name !== packageName
      || importerManifest === undefined
      || importerManifest.kind !== "file"
      || importerManifest.path !== candidateManifest.path
    ) continue;
    for (const imported of metadata.imports) {
      const witnessSpecifier = imported.original ?? imported.path;
      if (
        imported.external
        || imported.hasAttributes
        || imported.kind !== "import-statement"
        || (!witnessSpecifier.startsWith("./") && !witnessSpecifier.startsWith("../"))
      ) continue;
      const canonicalOriginal = posix.relative(posix.dirname(from), candidate);
      const explicitCanonicalOriginal = canonicalOriginal.startsWith("../")
        ? canonicalOriginal
        : `./${canonicalOriginal}`;
      if (
        witnessSpecifier === explicitCanonicalOriginal
        && observedPathLikeInputTarget(imported, from, knownInputs, inputAliases, buildTarget) === candidate
      ) return true;
    }
  }
  return false;
}

async function captureRelativeElidedPackageInput(
  imported: ParsedImport,
  from: string,
  importerMetadata: ParsedInput,
  rootDirectory: string,
  inputMetadata: ReadonlyMap<string, ParsedInput>,
  knownInputs: ReadonlySet<string>,
  inputAliases: ReadonlyMap<string, string>,
  knownOutputs: ReadonlySet<string>,
  observedAliases: ReadonlyMap<string, string>,
  observedSnapshots: ReadonlyMap<string, Readonly<{ bytes: number; sha256: string }>>,
  speculativeInputs: ReadonlySet<string>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  targetScopeCaptures: Map<string, Promise<PackageScope>>,
  capturedTargets: Map<string, ElidedPackageInputSnapshot>,
  capturedScopeSnapshots: Map<string, ResolutionFileSnapshot>,
  capturedInstallationRoots: Set<string>,
  buildTarget: "browser" | "bun",
): Promise<boolean> {
  if (
    importerMetadata.format !== "esm"
    || imported.hasAttributes
    || imported.original !== undefined
    || imported.kind !== "import-statement"
    || (!imported.path.startsWith("./") && !imported.path.startsWith("../"))
    || imported.path.includes("\\")
    || imported.path.includes("?")
    || imported.path.includes("#")
    || imported.path.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(imported.path)
  ) return false;

  const installationRoot = packageInstallationRoot(from);
  const packageName = packageBelowNodeModules(from);
  if (installationRoot === undefined || packageName === undefined) return false;
  const candidate = posix.normalize(posix.join(posix.dirname(from), imported.path));
  const canonicalRelative = posix.relative(posix.dirname(from), candidate);
  const explicitCanonicalRelative = canonicalRelative.startsWith("../")
    ? canonicalRelative
    : `./${canonicalRelative}`;
  const authoritativeTarget = knownInputs.has(candidate);
  const candidateAliases = [
    imported.path,
    candidate,
    resolve(rootDirectory, ...candidate.split("/")),
  ];
  if (
    candidate === "."
    || candidate === ".."
    || candidate.startsWith("../")
    || imported.path !== explicitCanonicalRelative
    || !candidate.startsWith(`${installationRoot}/`)
    || packageInstallationRoot(candidate) !== installationRoot
    || packageBelowNodeModules(candidate) !== packageName
    || !/\.(?:c|m)?js$/u.test(candidate)
    || speculativeInputs.has(candidate)
    || knownOutputs.has(candidate)
    || outputTarget(imported.path, from, knownOutputs) !== undefined
    || candidateAliases.some((alias) => {
      const target = observedAliases.get(alias);
      return authoritativeTarget ? target !== undefined && target !== candidate : target !== undefined;
    })
  ) return false;

  const manifestPath = posix.join(installationRoot, "package.json");
  const importerScope = packageScopes.get(from);
  const observedSnapshot = observedSnapshots.get(candidate);
  if (!imported.external && observedSnapshot === undefined) return false;
  if (
    authoritativeTarget
    && (
      !imported.external
      || observedSnapshot === undefined
      || !hasIndependentAuthoritativePackageInputEdge(
        candidate,
        from,
        inputMetadata,
        knownInputs,
        inputAliases,
        packageScopes,
        buildTarget,
      )
    )
  ) return false;
  const observedTargetScope = observedSnapshot === undefined ? undefined : packageScopes.get(candidate);
  const importerManifest = importerScope?.files.at(-1);
  const capturedManifest = packageScopeSnapshots.get(manifestPath);
  if (
    importerScope === undefined
    || !importerScope.valid
    || importerScope.name !== packageName
    || importerManifest === undefined
    || importerManifest.path !== manifestPath
    || importerManifest.kind !== "file"
    || capturedManifest === undefined
    || (observedSnapshot !== undefined && observedTargetScope === undefined)
  ) return false;
  assert.deepEqual(importerManifest, capturedManifest, `Bun importer package scope differs for ${from}`);
  const parsedManifest = strictJsonObjectFromSnapshot(capturedManifest);
  if (
    !parsedManifest.valid
    || parsedManifest.record === undefined
    || parsedManifest.record.name !== packageName
    || !Object.hasOwn(parsedManifest.record, "sideEffects")
    || !packageDeclaresJavaScriptSideEffectFree(parsedManifest.record)
    || !await exactOrdinaryDirectory(rootDirectory, installationRoot)
  ) return false;

  const targetDirectory = posix.dirname(candidate);
  let pendingTargetScope = targetScopeCaptures.get(targetDirectory);
  if (pendingTargetScope === undefined) {
    pendingTargetScope = captureNearestPackageScope(rootDirectory, candidate);
    targetScopeCaptures.set(targetDirectory, pendingTargetScope);
  }
  const targetScope = await pendingTargetScope;
  const targetManifest = targetScope.files.at(-1);
  if (
    !targetScope.valid
    || targetScope.name !== packageName
    || targetManifest === undefined
    || targetManifest.path !== manifestPath
    || targetManifest.kind !== "file"
  ) return false;
  assert.deepEqual(targetManifest, capturedManifest, `Bun elided target package scope differs for ${candidate}`);
  if (observedTargetScope !== undefined) {
    assert.deepEqual(
      observedTargetScope,
      targetScope,
      `Bun observed relative elided target package scope changed after its completed load: ${candidate}`,
    );
  }

  const targetSnapshot = await exactOrdinaryFileSnapshot(rootDirectory, candidate);
  if (targetSnapshot === undefined) return false;
  if (observedSnapshot !== undefined) {
    assert.deepEqual(
      { bytes: targetSnapshot.bytes, sha256: targetSnapshot.sha256 },
      observedSnapshot,
      `Bun observed relative elided package input differs from its completed load: ${candidate}`,
    );
  }
  const previousTarget = capturedTargets.get(candidate);
  if (previousTarget === undefined) capturedTargets.set(candidate, targetSnapshot);
  else assert.deepEqual(targetSnapshot, previousTarget, `Bun relative elided package input changed between edges: ${candidate}`);
  for (const snapshot of importerScope.files) retainResolutionFileSnapshot(capturedScopeSnapshots, snapshot);
  for (const snapshot of targetScope.files) retainResolutionFileSnapshot(capturedScopeSnapshots, snapshot);
  capturedInstallationRoots.add(installationRoot);
  return true;
}

async function captureObservedElidedPackageInput(
  imported: ParsedImport,
  from: string,
  importerMetadata: ParsedInput,
  rootDirectory: string,
  knownInputs: ReadonlySet<string>,
  knownOutputs: ReadonlySet<string>,
  observedAliases: ReadonlyMap<string, string>,
  observedSnapshots: ReadonlyMap<string, Readonly<{ bytes: number; sha256: string }>>,
  speculativeInputs: ReadonlySet<string>,
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  capturedTargets: Map<string, ObservedElidedPackageInputSnapshot>,
  capturedScopeSnapshots: Map<string, ResolutionFileSnapshot>,
  capturedInstallationRoots: Set<string>,
  resolverCache: Map<string, Promise<string | undefined>>,
  buildConditions: readonly string[],
  buildTarget: "browser" | "bun",
): Promise<boolean> {
  if (
    importerMetadata.format !== "esm"
    || imported.external
    || imported.hasAttributes
    || imported.original === undefined
    || imported.kind !== "import-statement"
    || !isAbsolute(imported.path)
    || resolve(imported.path) !== imported.path
    || imported.path.includes("?")
    || imported.path.includes("#")
    || imported.path.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(imported.path)
  ) return false;

  const original = imported.original;
  if (
    isAbsolute(original)
    || original.includes("\\")
    || original.includes("?")
    || original.includes("#")
    || original.includes("%")
    || /[\u0000-\u001f\u007f]/u.test(original)
  ) return false;

  const relativeCandidate = relative(rootDirectory, imported.path).split(sep).join("/");
  if (
    relativeCandidate.length === 0
    || relativeCandidate === ".."
    || relativeCandidate.startsWith("../")
  ) return false;
  let candidate: string;
  try {
    candidate = normalizeLogicalPath(relativeCandidate, "Bun observed elided package input");
  } catch {
    return false;
  }
  const importerInstallationRoot = packageInstallationRoot(from);
  const importerPackageName = packageBelowNodeModules(from);
  const candidateInstallationRoot = packageInstallationRoot(candidate);
  const candidatePackageName = packageBelowNodeModules(candidate);
  const relativeOriginal = original.startsWith("./") || original.startsWith("../");
  const bareOriginalPackage = relativeOriginal ? undefined : barePackageName(original);
  const canonicalOriginal = posix.relative(posix.dirname(from), candidate);
  const explicitCanonicalOriginal = canonicalOriginal.startsWith("../")
    ? canonicalOriginal
    : `./${canonicalOriginal}`;
  if (
    resolve(rootDirectory, ...candidate.split("/")) !== imported.path
    || !/\.(?:c|m)?js$/u.test(candidate)
    || knownInputs.has(candidate)
    || speculativeInputs.has(candidate)
    || knownOutputs.has(candidate)
    || outputTarget(imported.path, from, knownOutputs) !== undefined
    || outputTarget(original, from, knownOutputs) !== undefined
    || observedAliases.has(imported.path)
    || observedAliases.has(original)
    || observedAliases.has(candidate)
    || importerInstallationRoot === undefined
    || importerPackageName === undefined
    || candidateInstallationRoot === undefined
    || candidatePackageName === undefined
  ) return false;

  if (relativeOriginal) {
    if (
      canonicalOriginal.length === 0
      || original !== explicitCanonicalOriginal
      || posix.normalize(posix.join(posix.dirname(from), original)) !== candidate
      || candidateInstallationRoot !== importerInstallationRoot
      || candidatePackageName !== importerPackageName
    ) return false;
  } else {
    if (
      bareOriginalPackage === undefined
      || bareOriginalPackage === importerPackageName
      || bareOriginalPackage !== candidatePackageName
      || original === "bun"
      || isBuiltin(original)
      || await resolverVisibleInstallation(
        rootDirectory,
        from,
        candidatePackageName,
        resolverCache,
      ) !== candidateInstallationRoot
      || capturedPackageSubpathExportTarget(
        candidatePackageName,
        candidateInstallationRoot,
        original,
        packageScopeSnapshots,
        buildConditions,
        buildTarget,
      ) !== candidate
    ) return false;
  }

  const observedSnapshot = observedSnapshots.get(candidate);
  const importerScope = packageScopes.get(from);
  const targetScope = packageScopes.get(candidate);
  if (
    observedSnapshot === undefined
    || importerScope === undefined
    || targetScope === undefined
  ) return false;

  const importerManifestPath = posix.join(importerInstallationRoot, "package.json");
  const targetManifestPath = posix.join(candidateInstallationRoot, "package.json");
  const importerManifest = importerScope.files.at(-1);
  const targetManifest = targetScope.files.at(-1);
  const capturedImporterManifest = packageScopeSnapshots.get(importerManifestPath);
  const capturedTargetManifest = packageScopeSnapshots.get(targetManifestPath);
  if (
    !importerScope.valid
    || importerScope.name !== importerPackageName
    || !targetScope.valid
    || targetScope.name !== candidatePackageName
    || importerManifest === undefined
    || importerManifest.path !== importerManifestPath
    || importerManifest.kind !== "file"
    || targetManifest === undefined
    || targetManifest.path !== targetManifestPath
    || targetManifest.kind !== "file"
    || capturedImporterManifest === undefined
    || capturedTargetManifest === undefined
  ) return false;
  assert.deepEqual(importerManifest, capturedImporterManifest, `Bun importer package scope differs for ${from}`);
  assert.deepEqual(targetManifest, capturedTargetManifest, `Bun observed elided target package scope differs for ${candidate}`);
  const parsedManifest = strictJsonObjectFromSnapshot(capturedTargetManifest);
  if (
    !parsedManifest.valid
    || parsedManifest.record === undefined
    || parsedManifest.record.name !== candidatePackageName
    || !Object.hasOwn(parsedManifest.record, "sideEffects")
    || !packageDeclaresJavaScriptSideEffectFree(parsedManifest.record)
    || !await exactOrdinaryDirectory(rootDirectory, candidateInstallationRoot)
  ) return false;

  const targetSnapshot = await exactOrdinaryFileSnapshot(rootDirectory, candidate);
  if (targetSnapshot === undefined) return false;
  assert.deepEqual(
    { bytes: targetSnapshot.bytes, sha256: targetSnapshot.sha256 },
    observedSnapshot,
    `Bun observed elided package input differs from its completed load: ${candidate}`,
  );
  const previousTarget = capturedTargets.get(candidate);
  if (previousTarget === undefined) capturedTargets.set(candidate, targetSnapshot);
  else assert.deepEqual(targetSnapshot, previousTarget, `Bun observed elided package input changed between edges: ${candidate}`);
  for (const snapshot of importerScope.files) retainResolutionFileSnapshot(capturedScopeSnapshots, snapshot);
  for (const snapshot of targetScope.files) retainResolutionFileSnapshot(capturedScopeSnapshots, snapshot);
  capturedInstallationRoots.add(candidateInstallationRoot);
  return true;
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

async function importTargetsStylexRuntime(
  dependency: ParsedImport,
  from: string,
  knownInputs: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  installations: ReadonlyMap<string, ReadonlySet<string>>,
  witnesses: BareInputWitnesses,
  rootDirectory: string,
  fallbackPolicy: BareInputFallbackPolicy,
  resolverCache: Map<string, Promise<string | undefined>>,
  rawFallbackUses: RawBareInputFallbackUse[],
  packageScopes: ReadonlyMap<string, PackageScope>,
  packageScopeSnapshots: ReadonlyMap<string, ResolutionFileSnapshot>,
  inputFileSnapshots: ReadonlyMap<string, LoadedInputFileSnapshot>,
  buildConditions: readonly string[],
  knownOutputs: ReadonlySet<string>,
  outputMetadata: ReadonlyMap<string, ParsedOutput>,
  buildTarget: "browser" | "bun",
  productionEnvironmentDefine: string,
): Promise<boolean> {
  const pathLike = pathLikeImport(dependency.path);
  if (dependency.path === "@stylexjs/stylex" || dependency.path.startsWith("@stylexjs/stylex/")) return true;
  if (dependency.external && !pathLike) return false;
  let target = await resolvedInputTarget(
    dependency,
    from,
    knownInputs,
    aliases,
    installations,
    witnesses,
    rootDirectory,
    fallbackPolicy,
    resolverCache,
    rawFallbackUses,
    packageScopes,
    packageScopeSnapshots,
    inputFileSnapshots,
    buildConditions,
    buildTarget,
    productionEnvironmentDefine,
  );
  if (target === undefined && pathLike) {
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
  const target = expected.kind === "client" ? "browser" : "bun";
  const buildConditions = buildOptions.conditions === undefined
    ? expected.kind === "client" ? ["browser", "module", "production"] : ["module", "node", "production"]
    : [...buildOptions.conditions];
  const productionEnvironmentDefine = JSON.stringify("production");
  const logicalEntrypoints = [...expected.entrypoints].map((path) => normalizeLogicalPath(path, "Bun entrypoint")).sort();
  assert.equal(new Set(logicalEntrypoints).size, logicalEntrypoints.length, "Bun entrypoints must be unique");
  const entrypoints = await Promise.all(logicalEntrypoints.map((path) => resolveRootRelativeInput(rootDirectory, path)));

  const prepared = await prepareStylexGraph(generation, graphId);
  assert.deepEqual(await readdir(prepared.outputDirectory), [], "Prepared Bun graph output directory must be empty");
  const collector = createStylexTransformCollector(rootDirectory);
  // onLoad is an observation superset: Bun may load package modules that it
  // later tree-shakes out of the authoritative metafile graph.
  const inputSnapshots = new Map<string, Readonly<{ bytes: number; sha256: string }>>();
  const inputFileSnapshots = new Map<string, LoadedInputFileSnapshot>();
  const transformedInputs = new Set<string>();
  const transformedRules = new Map<string, readonly StylexRuleV1[]>();
  const packageScopeCaptures = new Map<string, Promise<PackageScope>>();
  let activeTransforms = 0;
  const escapedRoot = rootDirectory.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const plugin: Bun.BunPlugin = {
    name: `hraness-ui-stylex-${graphId}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${escapedRoot}/.*\\.[cm]?[jt]sx?$`, "u") }, async ({ path }) => {
        const logical = relativeBelow(rootDirectory, resolve(path), "StyleX transform path");
        await captureImporterPackageScope(rootDirectory, logical, packageScopeCaptures);
        activeTransforms += 1;
        try {
          const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
          const source = await readFile(ordinary, "utf8");
          const snapshot = { bytes: Buffer.byteLength(source), sha256: sha256(source) };
          const previous = inputSnapshots.get(logical);
          if (previous === undefined) inputSnapshots.set(logical, snapshot);
          else assert.deepEqual(snapshot, previous, `Bun input changed between loads: ${logical}`);
          const fileSnapshot = await resolutionFileSnapshot(rootDirectory, logical);
          assert.ok(fileSnapshot.kind === "file", `Bun loaded input is no longer an ordinary file: ${logical}`);
          assert.deepEqual(
            { bytes: fileSnapshot.bytes, sha256: fileSnapshot.sha256 },
            snapshot,
            `Bun loaded input changed while capturing its file identity: ${logical}`,
          );
          const loadedFileSnapshot = { resolvedPath: ordinary, snapshot: fileSnapshot };
          const previousFileSnapshot = inputFileSnapshots.get(logical);
          if (previousFileSnapshot === undefined) inputFileSnapshots.set(logical, loadedFileSnapshot);
          else assert.deepEqual(loadedFileSnapshot, previousFileSnapshot, `Bun input file identity changed between loads: ${logical}`);
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
        await captureImporterPackageScope(rootDirectory, logical, packageScopeCaptures);
        const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
        const source = await readFile(ordinary, "utf8");
        auditCssWithoutStandaloneRecipes(source, loaded.packageManifests, `Bun CSS input ${logical}`);
        const snapshot = { bytes: Buffer.byteLength(source), sha256: sha256(source) };
        const previous = inputSnapshots.get(logical);
        if (previous === undefined) inputSnapshots.set(logical, snapshot);
        else assert.deepEqual(snapshot, previous, `Bun input changed between loads: ${logical}`);
        return { contents: source, loader: "css" };
      });
      build.onLoad({ filter: /.*/u }, async ({ path }) => {
        const logical = relativeBelow(rootDirectory, resolve(path), "Bun input path");
        await captureImporterPackageScope(rootDirectory, logical, packageScopeCaptures);
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
    conditions: buildConditions,
    define: {
      "process.env.NODE_ENV": productionEnvironmentDefine,
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
    target,
    throw: false,
  };
  if (buildOptions.jsx !== undefined) bunConfig.jsx = { ...buildOptions.jsx };
  const rootResolutionBefore = await rootResolutionFileSnapshots(rootDirectory);
  const result = await Bun.build(bunConfig);
  const rootResolutionAfter = await rootResolutionFileSnapshots(rootDirectory);
  assert.deepEqual(
    rootResolutionAfter,
    rootResolutionBefore,
    "Bun root resolution configuration changed during build",
  );
  const inputFallbackPolicy = bareInputFallbackPolicy(rootResolutionBefore);
  const settledPackageScopes = new Map<string, PackageScope>();
  const packageScopeSnapshots = new Map<string, ResolutionFileSnapshot>();
  for (const [path, pending] of [...packageScopeCaptures.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )) {
    const scope = await pending;
    settledPackageScopes.set(path, scope);
    for (const snapshot of scope.files) {
      const previous = packageScopeSnapshots.get(snapshot.path);
      if (previous === undefined) packageScopeSnapshots.set(snapshot.path, snapshot);
      else assert.deepEqual(snapshot, previous, `Bun package scope ${snapshot.path} changed between input loads`);
    }
  }
  const packageScopeBefore = [...packageScopeSnapshots.values()].sort(({ path: left }, { path: right }) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const packageScopeAfter = await Promise.all(
    packageScopeBefore.map(({ path }) => resolutionFileSnapshot(rootDirectory, path)),
  );
  assert.deepEqual(
    packageScopeAfter,
    packageScopeBefore,
    "Bun package scope configuration changed during build",
  );
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
  const promotedNativeCssUrlInputs = await promoteObservedNativeCssUrlInputs(
    rootDirectory,
    inputMetadata,
    inputAliases,
    inputSnapshots,
    settledPackageScopes,
    outputSet,
  );
  for (const entrypoint of logicalEntrypoints) {
    assert.ok(inputMetadata.has(entrypoint), `Bun metafile omitted registered entrypoint ${entrypoint}`);
  }
  const knownInputs = new Set(inputMetadata.keys());
  const inputPackageInstallations = packageInstallations(knownInputs);
  const inputWitnesses = witnessedBareInputTargets(inputMetadata, inputAliases);
  const resolverCache = new Map<string, Promise<string | undefined>>();
  const rawFallbackUses: RawBareInputFallbackUse[] = [];
  assert.deepEqual(
    [...knownInputs].filter((path) => !settledPackageScopes.has(path)).sort(),
    [],
    "Bun omitted package-scope capture for a reachable input",
  );
  for (const [path, metadata] of inputMetadata) {
    const dependencyPackage = packageBelowNodeModules(path);
    if (dependencyPackage === undefined || dependencyPackage === "@stylexjs/stylex") continue;
    let importsStylexRuntime = false;
    for (const dependency of metadata.imports) {
      if (await importTargetsStylexRuntime(
        dependency,
        path,
        knownInputs,
        inputAliases,
        inputPackageInstallations,
        inputWitnesses,
        rootDirectory,
        inputFallbackPolicy,
        resolverCache,
        rawFallbackUses,
        settledPackageScopes,
        packageScopeSnapshots,
        inputFileSnapshots,
        buildConditions,
        outputSet,
        outputMetadata,
        target,
        productionEnvironmentDefine,
      )) {
        importsStylexRuntime = true;
        break;
      }
    }
    if (importsStylexRuntime) {
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
  const speculativeInputSet = new Set(speculativeTransforms);
  const speculativeInputAliases = new Map<string, string>();
  for (const path of speculativeTransforms) {
    speculativeInputAliases.set(path, path);
    speculativeInputAliases.set(resolve(rootDirectory, ...path.split("/")), path);
  }
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
      const cssBytes = await readFile(resolve(rootDirectory, path));
      assert.deepEqual(
        { bytes: cssBytes.byteLength, sha256: sha256(cssBytes) },
        { bytes: artifact.bytes, sha256: artifact.sha256 },
        `Bun CSS input changed while reconstructing its audit receipt: ${path}`,
      );
      const css = cssBytes.toString("utf8");
      auditCssWithoutStandaloneRecipes(css, loaded.packageManifests, `Bun graph ${graphId} input ${path}`);
      auditCssWithoutStylexRules(css, rules, "Compiler graph");
    }
  }

  const outputs: StylexArtifactV1[] = [];
  for (const [path] of [...outputMetadata.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const artifact = await artifactForFile(prepared.outputDirectory, path);
    const emitted = emittedByResult.get(path)!;
    const emittedBytes = new Uint8Array(await emitted.arrayBuffer());
    assert.equal(emittedBytes.byteLength, artifact.bytes, `Bun output blob byte count differs for ${path}`);
    assert.equal(
      sha256(emittedBytes),
      artifact.sha256,
      `Bun output blob bytes differ from the settled file for ${path}`,
    );
    outputs.push(artifact);
    if (emitted.loader === "css" || path.endsWith(".css")) {
      assertNotStandaloneRecipeArtifact(artifact, loaded.packageManifests);
      const cssBytes = await readFile(resolve(prepared.outputDirectory, path));
      assert.deepEqual(
        { bytes: cssBytes.byteLength, sha256: sha256(cssBytes) },
        { bytes: artifact.bytes, sha256: artifact.sha256 },
        `Bun CSS output changed while reconstructing its audit receipt: ${path}`,
      );
      const css = cssBytes.toString("utf8");
      auditCssWithoutStandaloneRecipes(css, loaded.packageManifests, `Bun graph ${graphId} output ${path}`);
      auditCssWithoutStylexRules(css, rules, "Bun graph output");
    }
  }

  const inputSet = new Set(inputMetadata.keys());
  const observedInputSet = new Set([...inputSet, ...speculativeInputSet]);
  const observedInputAliases = new Map(inputAliases);
  for (const [alias, path] of speculativeInputAliases) {
    assert.equal(
      observedInputAliases.has(alias),
      false,
      `Bun speculative input alias collides with an authoritative input: ${alias}`,
    );
    observedInputAliases.set(alias, path);
  }
  const relativeElidedTargetScopeCaptures = new Map<string, Promise<PackageScope>>();
  const relativeElidedPackageInputs = new Map<string, ElidedPackageInputSnapshot>();
  const relativeElidedPackageScopeSnapshots = new Map<string, ResolutionFileSnapshot>();
  const relativeElidedPackageInstallationRoots = new Set<string>();
  const observedElidedPackageInputs = new Map<string, ObservedElidedPackageInputSnapshot>();
  const observedElidedPackageScopeSnapshots = new Map<string, ResolutionFileSnapshot>();
  const observedElidedPackageInstallationRoots = new Set<string>();
  const edges: StylexGraphEdgeV1[] = [];
  for (const [from, metadata] of inputMetadata) {
    for (const imported of metadata.imports) {
      const pathLike = pathLikeImport(imported.path);
      if (imported.external && !pathLike) {
        edges.push({
          external: true,
          from: `input:${from}`,
          kind: imported.kind,
          to: canonicalExternal(imported.path),
        });
        continue;
      }
      const observedInput = pathLike
        ? observedPathLikeInputTarget(
          imported,
          from,
          observedInputSet,
          observedInputAliases,
          target,
        )
        : undefined;
      const speculativeInput = observedInput !== undefined && speculativeInputSet.has(observedInput)
        ? observedInput
        : undefined;
      let input = observedInput !== undefined && inputSet.has(observedInput)
        ? observedInput
        : observedInput === undefined
          ? await resolvedInputTarget(
            imported,
            from,
            inputSet,
            inputAliases,
            inputPackageInstallations,
            inputWitnesses,
            rootDirectory,
            inputFallbackPolicy,
            resolverCache,
            rawFallbackUses,
            settledPackageScopes,
            packageScopeSnapshots,
            inputFileSnapshots,
            buildConditions,
            target,
            productionEnvironmentDefine,
          )
          : undefined;
      const output = input === undefined && pathLike
        ? outputTarget(imported.path, from, outputSet)
        : undefined;
      if (input === undefined && output !== undefined) {
        const outputEntrypoint = outputMetadata.get(output)?.entryPoint;
        if (outputEntrypoint !== undefined) {
          input = inputAliases.get(outputEntrypoint)
            ?? inputAliases.get(posix.normalize(outputEntrypoint).replace(/^\.\//u, ""));
        }
      }
      if (input !== undefined && promotedNativeCssUrlInputs.inputs.has(input)) {
        assert.ok(
          isExactNativeCssUrlInputWitness(rootDirectory, imported, from, metadata.format, input),
          `Bun promoted native CSS URL input has a noncanonical inbound edge from ${from}: ${imported.path}`,
        );
      }
      if (
        input === undefined
        && output === undefined
        && speculativeInput === undefined
        && await captureRelativeElidedPackageInput(
          imported,
          from,
          metadata,
          rootDirectory,
          inputMetadata,
          inputSet,
          inputAliases,
          outputSet,
          observedInputAliases,
          inputSnapshots,
          speculativeInputSet,
          settledPackageScopes,
          packageScopeSnapshots,
          relativeElidedTargetScopeCaptures,
          relativeElidedPackageInputs,
          relativeElidedPackageScopeSnapshots,
          relativeElidedPackageInstallationRoots,
          target,
        )
      ) continue;
      if (
        input === undefined
        && output === undefined
        && speculativeInput === undefined
        && await captureObservedElidedPackageInput(
          imported,
          from,
          metadata,
          rootDirectory,
          inputSet,
          outputSet,
          observedInputAliases,
          inputSnapshots,
          speculativeInputSet,
          settledPackageScopes,
          packageScopeSnapshots,
          observedElidedPackageInputs,
          observedElidedPackageScopeSnapshots,
          observedElidedPackageInstallationRoots,
          resolverCache,
          buildConditions,
          target,
        )
      ) continue;
      assert.ok(
        input !== undefined || output !== undefined || speculativeInput !== undefined,
        `Bun metafile import from ${from} is unresolved: ${imported.path}`,
      );
      // Bun can retain an absolute import record for a barrel export whose
      // module it loaded and then removed from the authoritative metafile.
      // The completed transform inventory proves that exact local target was
      // observed; because it is absent from inputMetadata, it contributes no
      // published graph edge or StyleX rules.
      if (speculativeInput !== undefined) continue;
      edges.push({
        external: false,
        from: `input:${from}`,
        kind: imported.kind,
        to: input !== undefined
          ? `input:${input}`
          : output !== undefined
            ? `output:${output}`
            : assert.fail("Bun input edge settlement lost its resolved target"),
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

  const revalidateEdgeSettlement = async (
    boundary: "during edge settlement" | "before graph receipt commit",
  ): Promise<void> => {
    await revalidateRawBareInputFallbackUses(
      rootDirectory,
      rootResolutionBefore,
      rawFallbackUses,
      boundary === "during edge settlement" ? "after edge settlement" : boundary,
    );

    for (const [path, snapshot] of observedElidedPackageInputs) {
      assert.equal(
        inputMetadata.has(path),
        false,
        `Bun observed elided package input became authoritative ${boundary}: ${path}`,
      );
      assert.deepEqual(
        inputSnapshots.get(path),
        { bytes: snapshot.bytes, sha256: snapshot.sha256 },
        `Bun observed elided package input lost its completed load snapshot: ${path}`,
      );
      assert.equal(
        inputs.some((input) => input.path === path)
          || edges.some((edge) => edge.to === `input:${path}`),
        false,
        `Bun observed elided package input entered the published graph: ${path}`,
      );
    }

    for (const installationRoot of [...relativeElidedPackageInstallationRoots].sort()) {
      assert.ok(
        await exactOrdinaryDirectory(rootDirectory, installationRoot),
        `Bun relative elided package installation changed ${boundary}: ${installationRoot}`,
      );
    }
    for (const [path, before] of [...relativeElidedPackageScopeSnapshots].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      assert.deepEqual(
        await resolutionFileSnapshot(rootDirectory, path),
        before,
        `Bun relative elided package scope changed ${boundary}: ${path}`,
      );
    }
    for (const [path, before] of [...relativeElidedPackageInputs].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      assert.deepEqual(
        await exactOrdinaryFileSnapshot(rootDirectory, path),
        before,
        `Bun relative elided package input changed ${boundary}: ${path}`,
      );
    }
    for (const installationRoot of [...observedElidedPackageInstallationRoots].sort()) {
      assert.ok(
        await exactOrdinaryDirectory(rootDirectory, installationRoot),
        `Bun observed elided package installation changed ${boundary}: ${installationRoot}`,
      );
    }
    for (const [path, before] of [...observedElidedPackageScopeSnapshots].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      assert.deepEqual(
        await resolutionFileSnapshot(rootDirectory, path),
        before,
        `Bun observed elided package scope changed ${boundary}: ${path}`,
      );
    }
    for (const [path, before] of [...observedElidedPackageInputs].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      assert.deepEqual(
        await exactOrdinaryFileSnapshot(rootDirectory, path),
        before,
        `Bun observed elided package input changed ${boundary}: ${path}`,
      );
    }
    for (const [path, before] of [...promotedNativeCssUrlInputs.packageScopeSnapshots].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      assert.deepEqual(
        await resolutionFileSnapshot(rootDirectory, path),
        before,
        `Bun promoted native CSS URL input package scope changed ${boundary}: ${path}`,
      );
    }
    for (const [path, before] of promotedNativeCssUrlInputs.inputs) {
      assert.deepEqual(
        await exactOrdinaryFileSnapshot(rootDirectory, path),
        before,
        `Bun promoted native CSS URL input changed ${boundary}: ${path}`,
      );
    }
    const packageScopeCurrent = await Promise.all(
      packageScopeBefore.map(({ path }) => resolutionFileSnapshot(rootDirectory, path)),
    );
    assert.deepEqual(
      packageScopeCurrent,
      packageScopeBefore,
      `Bun package scope configuration changed ${boundary}`,
    );
  };

  await revalidateEdgeSettlement("during edge settlement");

  return writeStylexGraphReceipt({
    generation,
    revalidateBeforeCommit: () => revalidateEdgeSettlement("before graph receipt commit"),
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
