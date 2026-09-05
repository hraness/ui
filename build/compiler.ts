import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, relative, resolve, sep } from "node:path";

import { transformAsync, type ParserOptions } from "@babel/core";
import stylexPluginModule, {
  type Rule as UpstreamStylexRule,
  type StyleXTransformObj,
} from "@stylexjs/babel-plugin";
import { transform as transformCss } from "lightningcss";

import {
  STYLEX_COMPILER_CONTRACT_VERSION,
  STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION,
  type StylexArtifactV1,
  type StylexCompilerContractV1,
  type StylexPackageManifestV1,
  type StylexRuleV1,
  type StylexRuleValueV1,
} from "./contracts.js";

// StyleX 0.19 combines a CommonJS module.exports runtime with ESM-shaped declarations,
// so NodeNext needs this explicit checked boundary for the default binding.
function normalizeStylexPlugin(value: unknown): StyleXTransformObj {
  assert.equal(typeof value, "function", "Pinned StyleX Babel plugin must expose a callable CommonJS default");
  const plugin = value as {
    readonly processStylexRules?: unknown;
    readonly withOptions?: unknown;
  };
  assert.equal(typeof plugin.withOptions, "function", "Pinned StyleX Babel plugin must expose withOptions");
  assert.equal(
    typeof plugin.processStylexRules,
    "function",
    "Pinned StyleX Babel plugin must expose processStylexRules",
  );
  return plugin as unknown as StyleXTransformObj;
}

const stylexPlugin = normalizeStylexPlugin(stylexPluginModule);

export const compilerContract: StylexCompilerContractV1 = {
  compilerContractVersion: STYLEX_COMPILER_CONTRACT_VERSION,
  css: {
    filename: "stylex.css",
    layerPrelude: "complete-finite",
    topLevelLayers: ["base", "components"],
    targets: { chrome: 7143424, firefox: 7536640, ios_saf: 1049600, safari: 1049600 },
  },
  schemaVersion: 1,
  serializer: {
    enableLTRRTLComments: false,
    useLayers: {
      before: [
        "components.hraness-ui.legacy.base",
        "components.hraness-ui.legacy",
      ],
      prefix: "components.hraness-ui",
    },
  },
  tools: { babelCore: "7.29.7", lightningcss: "1.33.0", stylex: "0.19.0" },
  transform: {
    classNamePrefix: "x",
    dev: false,
    importSources: ["@stylexjs/stylex"],
    logicalRoot: "<graph-root>",
    moduleResolution: "commonJS",
    sourceType: "unambiguous",
    styleResolution: "property-specificity",
    sxPropName: false,
    treeshakeCompensation: true,
  },
};

function plainObject(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], description: string): void {
  const keys = Object.keys(record).sort();
  const allowed = [...required, ...optional].sort();
  assert.deepEqual(keys.filter((key) => !allowed.includes(key)), [], `${description} contains unknown keys`);
  for (const key of required) assert.ok(Object.hasOwn(record, key), `${description} is missing ${key}`);
}

function canonicalValue(value: unknown, trail: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${trail} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    assert.ok(Object.keys(value).every((key) => /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < value.length), `${trail} contains array properties or holes`);
    assert.equal(Object.keys(value).length, value.length, `${trail} contains array holes`);
    return value.map((item, index) => canonicalValue(item, `${trail}[${String(index)}]`));
  }
  const record = plainObject(value, trail);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    assert.ok(record[key] !== undefined, `${trail}.${key} is undefined`);
    output[key] = canonicalValue(record[key], `${trail}.${key}`);
  }
  return output;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, "value"));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const compilerSha256 = sha256(canonicalJson(compilerContract));

export function stylexRulesSha256(value: unknown): string {
  return sha256(canonicalJson(canonicalizeStylexRules(parseStylexRules(value))));
}

export function normalizeLogicalPath(value: unknown, description = "path"): string {
  assert.ok(typeof value === "string" && value.length > 0, `${description} must be a nonempty string`);
  assert.ok(!value.includes("\\") && !value.includes("\0") && !/[\u0000-\u001f\u007f]/u.test(value), `${description} contains forbidden characters`);
  assert.ok(!value.startsWith("/") && !/^[A-Za-z]:/u.test(value), `${description} must be relative`);
  const parts = value.split("/");
  assert.ok(parts.every((part) => part.length > 0 && part !== "." && part !== ".."), `${description} must be normalized and remain below its root`);
  return parts.join("/");
}

export async function resolveRootRelativeInput(rootDirectory: string, logicalPath: unknown): Promise<string> {
  const normalized = normalizeLogicalPath(logicalPath, "input path");
  const root = await realpath(rootDirectory);
  const absolute = resolve(root, ...normalized.split("/"));
  const unresolvedStat = await lstat(absolute);
  assert.ok(unresolvedStat.isFile() && !unresolvedStat.isSymbolicLink(), `input must be an ordinary nonsymlink file: ${normalized}`);
  const resolved = await realpath(absolute);
  const back = relative(root, resolved);
  assert.ok(back !== ".." && !back.startsWith(`..${sep}`), `input path escapes its root: ${normalized}`);
  return resolved;
}

function requiredString(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/u.test(value), `${description} must be a nonempty printable string`);
  return value;
}

function optionalString(value: unknown, description: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, description);
}

function parseRuleValue(value: unknown, description: string): StylexRuleValueV1 {
  const record = plainObject(value, description);
  exactKeys(record, ["ltr"], ["rtl", "constKey", "constVal"], description);
  const constKey = optionalString(record.constKey, `${description}.constKey`);
  const constVal = record.constVal;
  assert.ok(constVal === undefined || typeof constVal === "string" || (typeof constVal === "number" && Number.isFinite(constVal)), `${description}.constVal must be a finite number or string`);
  assert.equal(constKey !== undefined, constVal !== undefined, `${description} must provide constKey and constVal together`);
  const isConstant = constKey !== undefined;
  const ltr = record.ltr === "" && isConstant
    ? ""
    : requiredString(record.ltr, `${description}.ltr`);
  const rtl = record.rtl === null ? null : optionalString(record.rtl, `${description}.rtl`);
  if (ltr === "") {
    assert.equal(rtl, null, `${description} constant metadata must use a null rtl payload`);
  }
  const output: { ltr: string; rtl?: null | string; constKey?: string; constVal?: number | string } = { ltr };
  if (rtl !== undefined) output.rtl = rtl;
  if (constKey !== undefined) output.constKey = constKey;
  if (constVal !== undefined) output.constVal = constVal;
  return output;
}

export function parseStylexRules(value: unknown, description = "StyleX rules"): readonly StylexRuleV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  return value.map((item, index) => {
    assert.ok(Array.isArray(item) && item.length === 3 && Object.keys(item).length === 3, `${description}[${String(index)}] must be an exact three-item tuple`);
    const key = requiredString(item[0], `${description}[${String(index)}][0]`);
    const ruleValue = parseRuleValue(item[1], `${description}[${String(index)}][1]`);
    const priority = item[2];
    assert.ok(typeof priority === "number" && Number.isFinite(priority) && priority >= 0, `${description}[${String(index)}][2] must be a finite nonnegative priority`);
    return [key, ruleValue, priority] as const;
  });
}

export function canonicalizeStylexRules(...inventories: readonly (readonly StylexRuleV1[])[]): readonly StylexRuleV1[] {
  const byKey = new Map<string, StylexRuleV1>();
  for (const inventory of inventories) {
    for (const rule of parseStylexRules(inventory)) {
      const previous = byKey.get(rule[0]);
      if (previous !== undefined) assert.equal(canonicalJson(rule), canonicalJson(previous), `Conflicting StyleX rule for ${rule[0]}`);
      else byKey.set(rule[0], rule);
    }
  }
  return [...byKey.values()].sort((left, right) => {
    if (left[2] !== right[2]) return left[2] < right[2] ? -1 : 1;
    return compareStrings(left[0], right[0]) || compareStrings(canonicalJson(left[1]), canonicalJson(right[1]));
  });
}

function packageVersion(name: string): string {
  const require = createRequire(import.meta.url);
  let directory = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (manifest.name === name) return requiredString(manifest.version, `${name} version`);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `Could not resolve package manifest for ${name}`);
    directory = parent;
  }
}

export function verifyCompilerContract(): void {
  assert.equal(packageVersion("@babel/core"), compilerContract.tools.babelCore, "Pinned Babel version changed");
  assert.equal(packageVersion("@stylexjs/babel-plugin"), compilerContract.tools.stylex, "Pinned StyleX version changed");
  assert.equal(packageVersion("lightningcss"), compilerContract.tools.lightningcss, "Pinned Lightning CSS version changed");
  assert.equal(compilerSha256, sha256(canonicalJson(compilerContract)));
}

export type StylexTransformResult = Readonly<{ code: string; rules: readonly StylexRuleV1[] }>;
export type StylexTransformCollector = Readonly<{
  seal(): readonly StylexRuleV1[];
  transform(code: string, id: string): Promise<StylexTransformResult>;
}>;

function parserPluginsForPath(path: string): NonNullable<ParserOptions["plugins"]> {
  switch (extname(path).toLowerCase()) {
    case ".cts":
    case ".mts":
    case ".ts":
      return ["typescript"];
    case ".ctsx":
    case ".mtsx":
    case ".tsx":
      return ["typescript", "jsx"];
    case ".cjsx":
    case ".jsx":
    case ".mjsx":
      return ["jsx"];
    default:
      return [];
  }
}

export function createStylexTransformCollector(rootDirectory: string): StylexTransformCollector {
  verifyCompilerContract();
  const root = resolve(rootDirectory);
  const inventories: StylexRuleV1[][] = [];
  let sealed = false;
  return {
    async transform(source, id) {
      assert.equal(sealed, false, "StyleX collector is sealed");
      const absolute = resolve(id);
      const logical = relative(root, absolute).split(sep).join("/");
      normalizeLogicalPath(logical, "transform id");
      const result = await transformAsync(source, {
        ast: false,
        babelrc: false,
        code: true,
        configFile: false,
        filename: absolute,
        parserOpts: { plugins: parserPluginsForPath(logical) },
        plugins: [stylexPlugin.withOptions({
          classNamePrefix: compilerContract.transform.classNamePrefix,
          dev: compilerContract.transform.dev,
          importSources: [...compilerContract.transform.importSources],
          runtimeInjection: false,
          styleResolution: compilerContract.transform.styleResolution,
          sxPropName: compilerContract.transform.sxPropName,
          treeshakeCompensation: compilerContract.transform.treeshakeCompensation,
          unstable_moduleResolution: { rootDir: root, type: compilerContract.transform.moduleResolution },
        })],
        sourceMaps: false,
        sourceType: compilerContract.transform.sourceType,
      });
      assert.ok(result !== null && typeof result.code === "string", `Babel returned no code for ${logical}`);
      const metadata = plainObject(result.metadata, `${logical} metadata`);
      exactKeys(metadata, ["stylex"], [], `${logical} metadata`);
      const rules = [...parseStylexRules(metadata.stylex, `${logical} metadata.stylex`)];
      inventories.push(rules);
      return { code: result.code, rules };
    },
    seal() {
      assert.equal(sealed, false, "StyleX collector may be sealed only once");
      sealed = true;
      return canonicalizeStylexRules(...inventories);
    },
  };
}

export function serializeStylexRules(value: unknown): string {
  verifyCompilerContract();
  const rules = canonicalizeStylexRules(parseStylexRules(value));
  const prefix = compilerContract.serializer.useLayers.prefix;
  const legacyLayers = compilerContract.serializer.useLayers.before;
  const topLevelPrelude = `@layer ${compilerContract.css.topLevelLayers.join(", ")};`;
  if (rules.length === 0) return `${topLevelPrelude}\n@layer ${legacyLayers.join(", ")};\n`;
  const serialized = stylexPlugin.processStylexRules(
    rules.map((rule) => [rule[0], { ...rule[1] }, rule[2]] as UpstreamStylexRule),
    compilerContract.serializer,
  );
  const result = transformCss({
    code: Buffer.from(serialized),
    filename: compilerContract.css.filename,
    minify: false,
    targets: compilerContract.css.targets,
  });
  assert.equal(result.warnings.length, 0, "Lightning CSS emitted warnings for serialized StyleX rules");
  const css = Buffer.from(result.code).toString("utf8");
  const priorities: number[] = [];
  for (const layer of cssInventory(css, "Serialized StyleX rules").layers) {
    if (layer === prefix || legacyLayers.includes(layer as typeof legacyLayers[number])) continue;
    const match = new RegExp(`^${prefix.replaceAll(".", "\\.")}\\.priority([1-9]\\d*)$`, "u").exec(layer);
    assert.ok(match !== null, `Serialized StyleX rules emitted an unsupported layer: ${layer}`);
    priorities.push(Number(match[1]));
  }
  priorities.sort((left, right) => left - right);
  assert.deepEqual(
    priorities,
    Array.from({ length: priorities.length }, (_, index) => index + 1),
    "Serialized StyleX priority layers must be a contiguous finite inventory",
  );
  const names = [...legacyLayers, ...priorities.map((priority) => `${prefix}.priority${String(priority)}`)];
  const leading = /^@layer ([^;{}]+);\n*/u.exec(css);
  assert.ok(leading !== null, "Serialized StyleX CSS must begin with a layer inventory");
  const declared = leading[1]!.split(",").map((name) => name.trim());
  assert.ok(
    declared.every((name) => names.includes(name)),
    "Lightning CSS introduced a layer outside the complete StyleX inventory",
  );
  return `${topLevelPrelude}\n@layer ${names.join(", ")};\n${css.slice(leading[0].length)}`;
}

function parseArtifact(value: unknown, description: string): StylexArtifactV1 {
  const record = plainObject(value, description);
  exactKeys(record, ["bytes", "path", "sha256"], [], description);
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0, `${description}.bytes must be a nonnegative safe integer`);
  const path = normalizeLogicalPath(record.path, `${description}.path`);
  assert.ok(typeof record.sha256 === "string" && /^[a-f0-9]{64}$/u.test(record.sha256), `${description}.sha256 must be lowercase SHA-256`);
  return { bytes: record.bytes as number, path, sha256: record.sha256 };
}

function parseArtifacts(value: unknown, description: string): readonly StylexArtifactV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const artifacts = value.map((item, index) => parseArtifact(item, `${description}[${String(index)}]`));
  assert.deepEqual(artifacts.map((item) => item.path), [...artifacts].map((item) => item.path).sort(), `${description} must be sorted by path`);
  assert.equal(new Set(artifacts.map((item) => item.path)).size, artifacts.length, `${description} paths must be unique`);
  return artifacts;
}

function validateCompiler(value: unknown): StylexCompilerContractV1 {
  assert.equal(canonicalJson(value), canonicalJson(compilerContract), "Package manifest compiler contract differs from the pinned contract");
  return compilerContract;
}

export function validateStylexPackageManifest(value: unknown): StylexPackageManifestV1 {
  const record = plainObject(value, "package manifest");
  exactKeys(record, ["buildTools", "compiler", "compilerSha256", "kind", "package", "rules", "rulesSha256", "runtime", "schemaVersion", "standaloneCss", "stylesheets"], [], "package manifest");
  assert.equal(record.kind, "hraness-stylex-package-manifest");
  assert.equal(record.schemaVersion, STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION);
  const compiler = validateCompiler(record.compiler);
  assert.equal(record.compilerSha256, compilerSha256, "Package manifest compiler hash differs from the pinned contract");
  const rules = canonicalizeStylexRules(parseStylexRules(record.rules));
  assert.equal(canonicalJson(rules), canonicalJson(record.rules), "Package manifest rules must be canonical and deduplicated");
  const rulesSha256 = sha256(canonicalJson(rules));
  assert.equal(record.rulesSha256, rulesSha256, "Package manifest rules hash is stale");
  const packageRecord = plainObject(record.package, "package manifest package");
  exactKeys(packageRecord, ["name", "version"], [], "package manifest package");
  const packageName = requiredString(packageRecord.name, "package name");
  assert.ok(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(packageName), "Package name is invalid");
  const packageVersionValue = requiredString(packageRecord.version, "package version");
  const buildTools = parseArtifacts(record.buildTools, "package manifest buildTools");
  const runtime = parseArtifacts(record.runtime, "package manifest runtime");
  const standaloneCss = parseArtifact(record.standaloneCss, "package manifest standaloneCss");
  const stylesheets = parseArtifacts(record.stylesheets, "package manifest stylesheets");
  assert.ok(stylesheets.length > 0, "Package manifest must bind at least one compiler-adopter stylesheet");
  assert.ok(stylesheets.every(({ path }) => path.endsWith(".css")), "Package manifest stylesheets must contain only CSS paths");
  assert.ok(standaloneCss.path.endsWith(".css"), "Package manifest standaloneCss must be a CSS path");
  const paths = [...buildTools, ...runtime, standaloneCss, ...stylesheets].map((item) => item.path);
  assert.equal(new Set(paths).size, paths.length, "Package manifest artifact roles must not overlap");
  return {
    buildTools, compiler, compilerSha256, kind: "hraness-stylex-package-manifest",
    package: { name: packageName, version: packageVersionValue }, rules, rulesSha256,
    runtime, schemaVersion: STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION, standaloneCss, stylesheets,
  };
}

async function verifyArtifact(packageRoot: string, artifact: StylexArtifactV1): Promise<void> {
  const path = await resolveRootRelativeInput(packageRoot, artifact.path);
  const bytes = await readFile(path);
  assert.equal(bytes.byteLength, artifact.bytes, `Artifact byte count changed: ${artifact.path}`);
  assert.equal(sha256(bytes), artifact.sha256, `Artifact hash changed: ${artifact.path}`);
}

export async function artifactForFile(rootDirectory: string, logicalPath: unknown): Promise<StylexArtifactV1> {
  const path = normalizeLogicalPath(logicalPath, "artifact path");
  const absolute = await resolveRootRelativeInput(rootDirectory, path);
  const bytes = await readFile(absolute);
  return { bytes: bytes.byteLength, path, sha256: sha256(bytes) };
}

export async function readStylexPackageManifest(manifestPath: string, packageRoot = resolve(dirname(manifestPath), "..")): Promise<StylexPackageManifestV1> {
  const absoluteManifest = resolve(requiredString(manifestPath, "package manifest path"));
  const manifestStat = await lstat(absoluteManifest);
  assert.ok(manifestStat.isFile() && !manifestStat.isSymbolicLink(), "Package manifest must be an ordinary nonsymlink file");
  const root = resolve(requiredString(packageRoot, "package root"));
  const rootStat = await lstat(root);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Package root must be an ordinary nonsymlink directory");
  assert.equal(await realpath(root), root, "Package root must not traverse a symlink");
  const manifestPhysical = await realpath(absoluteManifest);
  const manifestRelative = relative(root, manifestPhysical);
  assert.ok(manifestRelative !== ".." && !manifestRelative.startsWith(`..${sep}`), "Package manifest must remain below its package root");
  const source = await readFile(manifestPhysical, "utf8");
  const parsed = validateStylexPackageManifest(JSON.parse(source) as unknown);
  assert.equal(source, `${canonicalJson(parsed)}\n`, "Package manifest must use canonical JSON with one trailing newline");
  const packageSource = await readFile(
    await resolveRootRelativeInput(root, "package.json"),
    "utf8",
  );
  const installedPackage = plainObject(
    JSON.parse(packageSource) as unknown,
    "installed package.json",
  );
  const installedName = requiredString(
    installedPackage.name,
    "installed package.json name",
  );
  const installedVersion = requiredString(
    installedPackage.version,
    "installed package.json version",
  );
  assert.deepEqual(
    { name: installedName, version: installedVersion },
    parsed.package,
    "Installed package.json identity differs from the StyleX package manifest",
  );
  await Promise.all(
    [...parsed.buildTools, ...parsed.runtime, parsed.standaloneCss, ...parsed.stylesheets]
      .map((artifact) => verifyArtifact(root, artifact)),
  );
  return parsed;
}

type CssInventory = Readonly<{
  classes: ReadonlySet<string>;
  imports: ReadonlySet<string>;
  layers: ReadonlySet<string>;
  registrations: ReadonlySet<string>;
  tailwindBridgeSha256: string | undefined;
}>;

const stylexCssAuditSourceBrand = Symbol("StylexCssAuditSource");
// Source and receipt witnesses are process-local capabilities. They are rebuilt
// from verified graph inputs and are never serialized into generation receipts.
const stylexCssAuditSources = new WeakSet<object>();

export type StylexCssAuditSource = Readonly<{
  [stylexCssAuditSourceBrand]: true;
  logicalPath: string;
  packageName: string;
  packagePath: string;
  stylesheetSha256: string;
}>;

const stylexCssAuditReceiptBrand = Symbol("StylexCssAuditReceipt");
const stylexCssAuditReceipts = new WeakSet<object>();

export type StylexCssAuditReceipt = Readonly<{
  [stylexCssAuditReceiptBrand]: true;
  tailwindBridgeSha256: string | undefined;
}>;

function cssAuditReceipt(tailwindBridgeSha256: string | undefined): StylexCssAuditReceipt {
  const receipt = { tailwindBridgeSha256 } as StylexCssAuditReceipt;
  Object.defineProperty(receipt, stylexCssAuditReceiptBrand, { value: true });
  Object.freeze(receipt);
  stylexCssAuditReceipts.add(receipt);
  return receipt;
}

function assertStylexCssAuditReceipt(receipt: StylexCssAuditReceipt): void {
  assert.ok(
    typeof receipt === "object"
      && receipt !== null
      && stylexCssAuditReceipts.has(receipt)
      && receipt[stylexCssAuditReceiptBrand] === true
      && Object.isFrozen(receipt),
    "CSS audit receipt was not produced by the pinned compiler",
  );
}

function cssAuditSource(
  logicalPath: string,
  packageName: string,
  stylesheetSha256: string,
): StylexCssAuditSource {
  const source = {
    logicalPath,
    packageName,
    packagePath: "src/tailwind.css",
    stylesheetSha256,
  } as StylexCssAuditSource;
  Object.defineProperty(source, stylexCssAuditSourceBrand, { value: true });
  Object.freeze(source);
  stylexCssAuditSources.add(source);
  return source;
}

function assertStylexCssAuditSource(source: StylexCssAuditSource): void {
  assert.ok(
    stylexCssAuditSources.has(source)
      && source[stylexCssAuditSourceBrand] === true
      && Object.isFrozen(source),
    "CSS audit source was not resolved by the pinned compiler",
  );
}

export const stylexCssAuditAtRules = {
  "custom-variant": { body: null, prelude: "*" },
  source: { body: null, prelude: "<string>" },
  theme: { body: "declaration-list", prelude: "<custom-ident>" },
} as const;

const stylexTailwindDarkVariantDirective = '@custom-variant dark (&:where(.dark, .dark *, [data-theme="dark"], [data-theme="dark"] *):not(:where([data-theme="light"], [data-theme="light"] *)));';

function isManifestBoundTailwindBridge(
  css: string,
  manifests: readonly StylexPackageManifestV1[],
  source: StylexCssAuditSource | undefined,
): boolean {
  if (source === undefined) return false;
  assertStylexCssAuditSource(source);
  if (source.packagePath !== "src/tailwind.css") return false;
  if (source.logicalPath !== `node_modules/${source.packageName}/src/tailwind.css`) return false;
  const candidates = manifests
    .filter((manifest) => manifest.package.name === source.packageName)
    .flatMap((manifest) => manifest.stylesheets)
    .filter((artifact) => artifact.path === source.packagePath);
  if (candidates.length !== 1) return false;
  const [artifact] = candidates;
  assert.ok(artifact !== undefined);
  return artifact.sha256 === source.stylesheetSha256
    && artifact.bytes === Buffer.byteLength(css)
    && artifact.sha256 === sha256(css);
}

export function stylexTailwindBridgeAuditSource(
  path: string,
  packageManifests: readonly StylexPackageManifestV1[],
): StylexCssAuditSource | undefined {
  const logicalPath = normalizeLogicalPath(path, "CSS audit source path");
  const candidates = packageManifests
    .map(validateStylexPackageManifest)
    .flatMap((manifest) => manifest.stylesheets
      .filter((artifact) => artifact.path === "src/tailwind.css")
      .map((artifact) => ({ artifact, manifest })))
    .filter(({ manifest }) => logicalPath === `node_modules/${manifest.package.name}/src/tailwind.css`);
  assert.ok(candidates.length <= 1, `CSS input matches multiple registered Tailwind bridges: ${path}`);
  const candidate = candidates[0];
  return candidate === undefined
    ? undefined
    : cssAuditSource(logicalPath, candidate.manifest.package.name, candidate.artifact.sha256);
}

function canonicalCustomVariantRule(serialized: string): string {
  const match = /^@custom-variant\s+dark\s+\((.*)\);?$/su.exec(serialized);
  const selector = match?.[1];
  if (selector === undefined || !selector.startsWith("&")) return serialized;
  try {
    const ruleTypes: string[] = [];
    const result = transformCss({
      code: Buffer.from(`.stylex-audit-root${selector.slice(1)}{--stylex-audit:1}`),
      filename: "stylex-tailwind-custom-variant-audit.css",
      minify: true,
      visitor: {
        Rule(rule) {
          ruleTypes.push(rule.type);
        },
      },
    });
    if (result.warnings.length !== 0 || ruleTypes.length !== 1 || ruleTypes[0] !== "style") {
      return serialized;
    }
    return `@custom-variant dark ${Buffer.from(result.code).toString("utf8")}`;
  } catch {
    return serialized;
  }
}

function canonicalTailwindBridgeRules(css: string, ruleCount: number): readonly string[] {
  return Array.from({ length: ruleCount }, (_, retainedIndex) => {
    let customRuleIndex = 0;
    let retainedName: string | undefined;
    const result = transformCss({
      code: Buffer.from(css),
      customAtRules: stylexCssAuditAtRules,
      filename: "stylex-tailwind-bridge-audit.css",
      minify: true,
      visitor: {
        Rule(rule) {
          if (rule.type !== "custom") return [];
          const retain = customRuleIndex === retainedIndex;
          customRuleIndex += 1;
          if (!retain) return [];
          const value = plainObject(rule.value as unknown, "Tailwind bridge canonicalization rule");
          assert.ok(typeof value.name === "string");
          retainedName = value.name;
          return undefined;
        },
      },
    });
    assert.equal(result.warnings.length, 0, "Tailwind bridge canonicalization emitted parser warnings");
    assert.equal(customRuleIndex, ruleCount, "Tailwind bridge canonicalization lost a directive");
    assert.ok(result.code.byteLength > 0, "Tailwind bridge canonicalization emitted an empty directive");
    const serialized = Buffer.from(result.code).toString("utf8");
    const canonical = retainedName === "custom-variant"
      ? canonicalCustomVariantRule(serialized)
      : serialized;
    return Buffer.from(canonical).toString("base64");
  });
}

const stylexTailwindDarkVariantRule = canonicalTailwindBridgeRules(
  stylexTailwindDarkVariantDirective,
  1,
)[0]!;

export function mergeStylexCssAuditReceipts(
  receipts: readonly StylexCssAuditReceipt[],
  description = "Compiler graph",
): StylexCssAuditReceipt {
  for (const receipt of receipts) assertStylexCssAuditReceipt(receipt);
  const bridges = receipts.filter(({ tailwindBridgeSha256 }) => tailwindBridgeSha256 !== undefined);
  assert.ok(
    bridges.length <= 1,
    `${description} contains more than one registered Tailwind bridge directive set`,
  );
  return cssAuditReceipt(bridges[0]?.tailwindBridgeSha256);
}

export function assertStylexCssAuditReceiptsEqual(
  actual: StylexCssAuditReceipt,
  expected: StylexCssAuditReceipt,
  description = "Compiler graph",
): void {
  assertStylexCssAuditReceipt(actual);
  assertStylexCssAuditReceipt(expected);
  assert.equal(
    actual.tailwindBridgeSha256,
    expected.tailwindBridgeSha256,
    `${description} Tailwind bridge directives differ from its verified graph inputs`,
  );
}

function collectSelectorClasses(value: unknown, classes: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSelectorClasses(item, classes);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (record.type === "class" && typeof record.name === "string") classes.add(record.name);
  for (const nested of Object.values(record)) collectSelectorClasses(nested, classes);
}

function cssInventory(
  css: string,
  description: string,
  packageManifests: readonly StylexPackageManifestV1[] = [],
  source?: StylexCssAuditSource,
  allowed?: StylexCssAuditReceipt,
): CssInventory {
  const classes = new Set<string>();
  const imports = new Set<string>();
  const layers = new Set<string>();
  const registrations = new Set<string>();
  const layerStack: string[] = [];
  const tailwindDirectiveNames: string[] = [];
  const nonBridgeTopLevelRuleTypes: string[] = [];
  const manifestBoundTailwindBridge = isManifestBoundTailwindBridge(css, packageManifests, source);
  if (allowed !== undefined) assertStylexCssAuditReceipt(allowed);
  let ruleDepth = 0;
  const result = transformCss({
    code: Buffer.from(css),
    customAtRules: stylexCssAuditAtRules,
    filename: "stylex-recipe-audit.css",
    minify: false,
    visitor: {
      Rule(rule) {
        if (ruleDepth === 0 && rule.type !== "custom") {
          nonBridgeTopLevelRuleTypes.push(rule.type);
        }
        if (rule.type === "custom") {
          assert.equal(ruleDepth, 0, `${description} Tailwind bridge directives must be top-level`);
          const value = plainObject(rule.value as unknown, `${description} custom at-rule`);
          const name = value.name;
          assert.ok(typeof name === "string", `${description} custom at-rule name must be a string`);
          assert.ok(
            manifestBoundTailwindBridge || allowed?.tailwindBridgeSha256 !== undefined,
            `${description} contains an unverified Tailwind bridge directive @${name}`,
          );
          tailwindDirectiveNames.push(name);
          const prelude = plainObject(value.prelude, `${description} Tailwind @${name} prelude`);
          if (name === "source") {
            assert.equal(value.body, null, `${description} Tailwind @source must not contain a block`);
            assert.deepEqual(
              prelude,
              { type: "string", value: "./" },
              `${description} Tailwind @source directive differs from the package bridge contract`,
            );
          } else if (name === "custom-variant") {
            assert.equal(value.body, null, `${description} Tailwind @custom-variant must not contain a block`);
            assert.equal(prelude.type, "token-list");
          } else {
            assert.equal(name, "theme");
            assert.deepEqual(
              prelude,
              { type: "custom-ident", value: "inline" },
              `${description} Tailwind @theme directive must use the inline contract`,
            );
            const body = plainObject(value.body, `${description} Tailwind @theme body`);
            assert.equal(body.type, "declaration-list");
            const declarations = plainObject(body.value, `${description} Tailwind @theme declarations`);
            assert.deepEqual(
              declarations.importantDeclarations,
              [],
              `${description} Tailwind @theme directive must not contain important declarations`,
            );
            assert.ok(Array.isArray(declarations.declarations) && declarations.declarations.length > 0);
            for (const [index, declaration] of declarations.declarations.entries()) {
              const record = plainObject(declaration, `${description} Tailwind @theme declaration ${String(index)}`);
              const declarationValue = plainObject(
                record.value,
                `${description} Tailwind @theme declaration ${String(index)} value`,
              );
              assert.ok(
                record.property === "custom"
                  && typeof declarationValue.name === "string"
                  && declarationValue.name.startsWith("--"),
                `${description} Tailwind @theme directive may contain only custom-property declarations`,
              );
            }
          }
        } else if (rule.type === "import") imports.add(rule.value.url);
        else if (rule.type === "keyframes") registrations.add(rule.value.name.value);
        else if (rule.type === "property") registrations.add(rule.value.name);
        else if (rule.type === "layer-statement") {
          for (const name of rule.value.names) layers.add([...layerStack, ...name].join("."));
        } else if (rule.type === "layer-block" && rule.value.name != null) {
          layers.add([...layerStack, ...rule.value.name].join("."));
          layerStack.push(...rule.value.name);
        }
        ruleDepth += 1;
      },
      Selector(selector) {
        collectSelectorClasses(selector, classes);
      },
      RuleExit(rule) {
        ruleDepth -= 1;
        assert.ok(ruleDepth >= 0, `${description} CSS traversal lost its rule depth`);
        if (rule.type === "layer-block" && rule.value.name != null) {
          const removed = layerStack.splice(-rule.value.name.length);
          assert.deepEqual(removed, rule.value.name, `${description} CSS layer traversal lost its nesting state`);
        }
      },
    },
  });
  assert.equal(ruleDepth, 0, `${description} CSS traversal did not settle its rule depth`);
  assert.equal(result.warnings.length, 0, `${description} CSS emitted parser warnings`);
  const canonicalBridgeRules = canonicalTailwindBridgeRules(css, tailwindDirectiveNames.length);
  for (const [index, name] of tailwindDirectiveNames.entries()) {
    if (name === "custom-variant") {
      assert.equal(
        canonicalBridgeRules[index],
        stylexTailwindDarkVariantRule,
        `${description} Tailwind @custom-variant differs from the dark selector contract`,
      );
    }
  }
  if (manifestBoundTailwindBridge) {
    assert.deepEqual(
      tailwindDirectiveNames,
      ["source", "custom-variant", "theme"],
      `${description} Tailwind bridge must contain exactly one @source, @custom-variant, and @theme directive in order`,
    );
    assert.deepEqual(
      nonBridgeTopLevelRuleTypes,
      [],
      `${description} manifest-bound Tailwind bridge stylesheet may contain only the verified @source, @custom-variant, and @theme rules`,
    );
  }
  const bridgeSha256 = canonicalBridgeRules.length === 0
    ? undefined
    : sha256(canonicalJson(canonicalBridgeRules));
  if (!manifestBoundTailwindBridge && bridgeSha256 !== undefined) {
    assert.equal(
      bridgeSha256,
      allowed?.tailwindBridgeSha256,
      `${description} Tailwind bridge directives differ from the verified graph inputs`,
    );
  }
  return { classes, imports, layers, registrations, tailwindBridgeSha256: bridgeSha256 };
}

export function auditCssWithoutStylexRules(
  css: string,
  rules: readonly StylexRuleV1[],
  description = "Compiler graph",
  allowed?: StylexCssAuditReceipt,
): void {
  assert.ok(typeof css === "string", `${description} CSS must be a string`);
  if (allowed !== undefined) assertStylexCssAuditReceipt(allowed);
  const graph = cssInventory(css, description, [], undefined, allowed);
  for (const layer of graph.layers) {
    assert.ok(
      !/^components\.hraness-ui\.priority(?:0|[1-9]\d*)(?:\.|$)/u.test(layer),
      `${description} must not emit an independently serialized recipe layer`,
    );
  }
  for (const rule of canonicalizeStylexRules(parseStylexRules(rules))) {
    assert.ok(
      !graph.classes.has(rule[0]),
      `${description} contains standalone recipe selector ${rule[0]}`,
    );
    for (const source of [rule[1].ltr, rule[1].rtl]) {
      if (source === null || source === undefined || source.length === 0) continue;
      for (const name of cssInventory(source, `${description} StyleX rule ${rule[0]}`).registrations) {
        assert.ok(
          !graph.registrations.has(name),
          `${description} contains standalone recipe registration ${name}`,
        );
      }
      assert.ok(!css.includes(source), `${description} contains partial standalone recipe rule ${rule[0]}`);
    }
  }
}

export function auditCssWithoutStandaloneRecipes(
  css: string,
  packageManifests: readonly StylexPackageManifestV1[],
  source?: StylexCssAuditSource,
  allowed?: StylexCssAuditReceipt,
): StylexCssAuditReceipt {
  assert.ok(typeof css === "string");
  const manifests = packageManifests.map(validateStylexPackageManifest);
  const graph = cssInventory(css, "Compiler graph", manifests, source, allowed);
  assert.ok(
    ![...graph.imports].some((url) => /(?:^|\/)stylex\.css(?:[?#]|$)/iu.test(url)),
    "Compiler graph must not import standalone recipe CSS",
  );
  const receipt = cssAuditReceipt(graph.tailwindBridgeSha256);
  auditCssWithoutStylexRules(css, manifests.flatMap(({ rules }) => rules), "Compiler graph", receipt);
  return receipt;
}
