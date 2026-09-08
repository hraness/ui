import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseAsync } from "@babel/core";

import {
  auditCssWithoutStandaloneRecipes,
  canonicalJson,
  canonicalizeStylexRules,
  compilerSha256,
  createStylexTransformCollector,
  normalizeLogicalPath,
  readStylexPackageManifest,
  serializeStylexRules,
  sha256,
  validateStylexPackageManifest,
  type StylexSourceMapV1,
} from "./compiler.js";
import type { StylexPackageManifestV1, StylexRuleV1 } from "./contracts.js";

export const STYLEX_NEXT_DEV_CSS_ENTRY = "/* @hraness/ui StyleX Next development stylesheet */\n";
export const STYLEX_NEXT_DEV_CONTEXT = "@hraness/ui/stylex-next-dev/compilation-v1";
export const STYLEX_NEXT_DEV_VERSION = "hraness-stylex-next-dev-v1";
export const STYLEX_NEXT_DEV_EXTENSIONS = Object.freeze([".js", ".mjs", ".tsx", ".ts", ".jsx", ".json", ".wasm"]);
export const STYLEX_NEXT_DEV_EXTENSION_ALIASES = Object.freeze({
  ".cjs": Object.freeze([".cts", ".cjs"]),
  ".js": Object.freeze([".ts", ".tsx", ".js", ".jsx"]),
  ".mjs": Object.freeze([".mts", ".mjs"]),
});

export function assertNextDevRuntime(versions: Readonly<Record<string, unknown>> = process.versions, hasBunGlobal = "Bun" in globalThis): void {
  assert.ok(!hasBunGlobal && versions.bun === undefined && typeof versions.node === "string" && /^24\./u.test(versions.node), "StyleX Next development requires genuine Node 24, not Bun's Node compatibility runtime");
}

export type StylexNextDevOptions = Readonly<{
  cssEntry: string;
  exclude?: readonly string[];
  packageManifests: readonly string[];
  rootDirectory: string;
  sourceDirectories: readonly string[];
}>;

export type NextDevOptions = Readonly<{
  cssEntry: string;
  exclude: readonly string[];
  packageManifests: readonly string[];
  rootDirectory: string;
  sourceDirectories: readonly string[];
}>;

export type NextDevSource = Readonly<{
  code: string;
  logicalPath: string;
  map: StylexSourceMapV1;
  sourceSha256: string;
}>;

export type NextDevSnapshot = Readonly<{
  css: string;
  cssEntry: string;
  directories: readonly string[];
  files: readonly string[];
  foundations: readonly string[];
  includedRevisions: readonly string[];
  manifests: readonly StylexPackageManifestV1[];
  packageInputs: readonly Readonly<{ logicalPath: string; role: "runtime" | "stylesheet"; sha256: string }>[];
  replacedRuleKeys: readonly string[];
  revision: string;
  rootDirectory: string;
  rules: readonly StylexRuleV1[];
  sources: readonly NextDevSource[];
}>;

export type NextDevPreparation = Readonly<{
  attemptedFiles: readonly string[];
  attemptedMissing: readonly string[];
  error: Error | null;
  lastGood: NextDevSnapshot | null;
  options: NextDevOptions;
  snapshot: NextDevSnapshot | null;
}>;

type AttemptedWatchInputs = Readonly<{
  files: Set<string>;
  missing: Set<string>;
}>;

const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const forbiddenDirectories = new Set(["node_modules", ".git", ".next", ".stylex-generation"]);
const MAX_DIRECTORIES = 4096;
const MAX_FILES = 4096;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

export function isNextDevSource(path: string): boolean {
  return extensions.has(extname(path)) && !/\.d\.(?:ts|mts|cts)$/u.test(path);
}

function list(value: unknown, description: string): readonly string[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((entry) => normalizeLogicalPath(entry, description));
  assert.equal(new Set(output).size, output.length, `${description} must be unique`);
  return Object.freeze(output.sort());
}

export function parseNextDevOptions(value: StylexNextDevOptions): NextDevOptions {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Next development options must be an object");
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "Next development options must be plain");
  assert.deepEqual(Object.keys(value).filter((key) => !["cssEntry", "exclude", "packageManifests", "rootDirectory", "sourceDirectories"].includes(key)), [], "Next development options contain unknown keys");
  assert.ok(typeof value.rootDirectory === "string" && isAbsolute(value.rootDirectory) && resolve(value.rootDirectory) === value.rootDirectory, "Next development root must be a normalized absolute directory");
  const sourceDirectories = list(value.sourceDirectories, "Next development source directories");
  assert.ok(sourceDirectories.length > 0, "Next development requires bounded source directories");
  for (const directory of sourceDirectories) {
    assert.ok(directory.split("/").every((part) => !forbiddenDirectories.has(part)), "Next development source directories include protected state");
    assert.ok(!sourceDirectories.some((other) => other !== directory && directory.startsWith(`${other}/`)), "Next development source directories overlap");
  }
  const exclude = list(value.exclude ?? [], "Next development exclusions");
  for (const entry of exclude) assert.ok(sourceDirectories.some((directory) => entry.startsWith(`${directory}/`)), "Next development exclusions must remain inside source directories");
  const packageManifests = list(value.packageManifests, "Next development package manifests");
  assert.ok(packageManifests.length > 0, "Next development requires registered package manifests");
  for (const manifest of packageManifests) assert.match(manifest, /^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/dist\/stylex-manifest\.json$/u, "Next development packages must be ordinary installed packages");
  const cssEntry = normalizeLogicalPath(value.cssEntry, "Next development CSS entry");
  assert.equal(extname(cssEntry), ".css", "Next development CSS entry must be a CSS file");
  assert.ok(!cssEntry.split("/").some((part) => forbiddenDirectories.has(part)), "Next development CSS entry cannot be protected state");
  return Object.freeze({ cssEntry, exclude, packageManifests, rootDirectory: value.rootDirectory, sourceDirectories });
}

export function nextDevLogicalPath(root: string, absolute: string): string {
  assert.ok(isAbsolute(absolute) && !/[?#]/u.test(absolute), "Next development resource must be a query-free absolute path");
  return normalizeLogicalPath(relative(root, absolute).split(sep).join("/"), "Next development resource");
}

function containedAbsolute(root: string, path: string, description: string): string {
  const absolute = resolve(path);
  const back = relative(root, absolute);
  assert.ok(back.length > 0 && back !== ".." && !back.startsWith(`..${sep}`) && !back.startsWith(sep), `${description} must remain below the Next development root`);
  return absolute;
}

async function recordAttempt(inputs: AttemptedWatchInputs, root: string, path: string, description: string): Promise<boolean> {
  const absolute = containedAbsolute(root, path, description);
  try {
    await lstat(absolute);
    inputs.files.add(absolute);
    inputs.missing.delete(absolute);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    inputs.files.delete(absolute);
    inputs.missing.add(absolute);
    return false;
  }
}

async function ordinary(root: string, logical: string, directory = false): Promise<string> {
  const parts = normalizeLogicalPath(logical).split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const info = await lstat(current);
    assert.ok(!info.isSymbolicLink(), `Next development input traverses a symlink: ${logical}`);
    assert.ok(index < parts.length - 1 || directory ? info.isDirectory() : info.isFile(), `Next development input is not ordinary: ${logical}`);
  }
  assert.equal(await realpath(current), current, `Next development input changed identity: ${logical}`);
  return current;
}

async function readSource(root: string, logical: string): Promise<string> {
  const absolute = await ordinary(root, logical);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.size <= MAX_FILE_BYTES, `Next development source exceeds its ordinary-file bound: ${logical}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assert.ok(bytes.byteLength <= MAX_FILE_BYTES && before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs, `Next development source changed while reading: ${logical}`);
    await ordinary(root, logical);
    const current = await lstat(absolute);
    assert.ok(current.ino === after.ino && current.dev === after.dev, `Next development source was replaced while reading: ${logical}`);
    const source = bytes.toString("utf8");
    assert.ok(Buffer.from(source).equals(bytes), `Next development source must be valid UTF-8: ${logical}`);
    return source;
  } finally { await handle.close(); }
}

async function assertBoundedImports(
  root: string,
  source: string,
  logical: string,
  paths: ReadonlySet<string>,
  attempted: AttemptedWatchInputs,
): Promise<void> {
  const extension = extname(logical);
  const ast = await parseAsync(source, {
    babelrc: false, configFile: false, filename: resolve(root, logical), sourceType: "unambiguous",
    parserOpts: { plugins: [...([".ts", ".tsx", ".mts", ".cts"].includes(extension) ? ["typescript" as const] : []), ...([".jsx", ".tsx"].includes(extension) ? ["jsx" as const] : [])] },
  });
  const references: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (typeof value !== "object" || value === null) return;
    const node = value as Record<string, unknown>;
    const literal = (entry: unknown): void => {
      if (typeof entry === "object" && entry !== null && "type" in entry && entry.type === "StringLiteral" && "value" in entry && typeof entry.value === "string") references.push(entry.value);
    };
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(String(node.type))) literal(node.source);
    if (node.type === "CallExpression" && typeof node.callee === "object" && node.callee !== null) {
      const callee = node.callee as Record<string, unknown>;
      if (callee.type === "Import" || (callee.type === "Identifier" && callee.name === "require")) literal(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
    }
    for (const [key, entry] of Object.entries(node)) if (!["loc", "start", "end", "comments", "tokens"].includes(key)) visit(entry);
  };
  visit(ast);
  for (const reference of references) {
    assert.ok(!isAbsolute(reference), `Next development source cannot import an absolute path: ${logical}`);
    assert.ok(!/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference) || reference.startsWith("node:"), `Next development source cannot import a resource URL: ${logical}`);
    if (!reference.startsWith(".")) continue;
    const target = nextDevLogicalPath(root, resolve(dirname(resolve(root, logical)), reference.split(/[?#]/u)[0]!));
    const aliases = STYLEX_NEXT_DEV_EXTENSION_ALIASES[extname(target) as keyof typeof STYLEX_NEXT_DEV_EXTENSION_ALIASES];
    const candidates = aliases === undefined
      ? [target, ...STYLEX_NEXT_DEV_EXTENSIONS.map((suffix) => `${target}${suffix}`), ...STYLEX_NEXT_DEV_EXTENSIONS.map((suffix) => `${target}/index${suffix}`)]
      : aliases.map((suffix) => `${target.slice(0, -extname(target).length)}${suffix}`);
    let selected: string | undefined;
    for (const candidate of candidates) {
      const absolute = resolve(root, candidate);
      if (!await recordAttempt(attempted, root, absolute, "Next development relative import candidate")) continue;
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        attempted.files.delete(absolute);
        continue;
      }
      await ordinary(root, candidate);
      selected = candidate;
      break;
    }
    // Follow the configured extension alias order, including a higher-priority
    // excluded file, rather than accepting any matching in-scope fallback.
    assert.ok(selected !== undefined, `Next development relative import cannot be resolved inside its root: ${logical} -> ${reference}`);
    assert.ok(!isNextDevSource(selected) || paths.has(selected), `Next development relative source import leaves its inventory: ${logical} -> ${reference}`);
  }
}

async function inventory(options: NextDevOptions, attempted?: AttemptedWatchInputs): Promise<Readonly<{
  directories: readonly string[];
  sources: readonly Readonly<{ logicalPath: string; source: string; sourceSha256: string }>[];
}>> {
  const rootInfo = await lstat(options.rootDirectory);
  assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), "Next development root must be ordinary");
  assert.equal(await realpath(options.rootDirectory), options.rootDirectory, "Next development root must not traverse a symlink");
  const directories: string[] = [];
  const sources: { logicalPath: string; source: string; sourceSha256: string }[] = [];
  let bytes = 0;
  const walk = async (logical: string): Promise<void> => {
    const directory = await ordinary(options.rootDirectory, logical, true);
    assert.ok(directories.length < MAX_DIRECTORIES, "Next development source inventory exceeds its directory bound");
    directories.push(directory);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const child = `${logical}/${entry.name}`;
      if (options.exclude.some((excluded) => child === excluded || child.startsWith(`${excluded}/`))) continue;
      assert.ok(!entry.isSymbolicLink(), `Next development source contains a symlink: ${child}`);
      assert.ok(entry.isDirectory() || entry.isFile(), `Next development source contains nonregular state: ${child}`);
      if (entry.isDirectory()) {
        assert.ok(!forbiddenDirectories.has(entry.name), `Next development source contains protected state: ${child}`);
        await walk(child);
      } else if (isNextDevSource(child)) {
        assert.ok(sources.length < MAX_FILES, "Next development source inventory exceeds its file bound");
        if (attempted !== undefined) await recordAttempt(attempted, options.rootDirectory, resolve(options.rootDirectory, child), "Next development source");
        const source = await readSource(options.rootDirectory, child);
        const length = Buffer.byteLength(source);
        bytes += length;
        assert.ok(length <= MAX_FILE_BYTES && bytes <= MAX_SOURCE_BYTES, "Next development source inventory exceeds its byte bound");
        sources.push({ logicalPath: child, source, sourceSha256: sha256(source) });
      }
    }
  };
  for (const directory of options.sourceDirectories) await walk(directory);
  return { directories: Object.freeze(directories.sort()), sources: Object.freeze(sources.sort((a, b) => a.logicalPath < b.logicalPath ? -1 : 1)) };
}

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function renderSnapshotCss(
  revision: string,
  includedRevisions: readonly string[],
  replacedRuleKeys: readonly string[],
  rules: readonly StylexRuleV1[],
  foundations: readonly string[],
): string {
  const union = serializeStylexRules(rules);
  const prelude = /^(?:@layer [^;{}]+;\n)+/u.exec(union);
  assert.ok(prelude !== null, "Next development union lacks its canonical layer prelude");
  const imports = foundations.map((foundation) => `@import ${JSON.stringify(foundation.startsWith(".") ? foundation : `./${foundation}`)};\n`).join("");
  const coverage = sha256(canonicalJson({ includedRevisions, replacedRuleKeys }));
  return `${prelude[0]}${imports}/* ${STYLEX_NEXT_DEV_VERSION} ${revision} coverage=${coverage} */\n${union.slice(prelude[0].length)}`;
}

/**
 * Builds the browser-facing transition sheet for one current compilation.
 * Old-only atomic identities are retained until every participating compiler
 * has attested the current graph. A changed rule with one stable identity
 * cannot represent both revisions, so that transition requires a dev restart.
 */
export function composeNextDevSnapshot(candidate: NextDevSnapshot, retainedValue: readonly NextDevSnapshot[]): NextDevSnapshot {
  const retained = [...new Map(retainedValue.filter((snapshot) => snapshot.revision !== candidate.revision).map((snapshot) => [snapshot.revision, snapshot] as const)).values()]
    .sort((left, right) => left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0);
  for (const snapshot of retained) {
    assert.equal(snapshot.rootDirectory, candidate.rootDirectory, "Next development transition snapshots must share one root");
    assert.equal(snapshot.cssEntry, candidate.cssEntry, "Next development transition snapshots must share one CSS entry");
  }
  const current = new Map(candidate.rules.map((rule) => [rule[0], rule]));
  const retainedOnly = new Map<string, StylexRuleV1>();
  const replacedRuleKeys = new Set<string>();
  for (const snapshot of retained) {
    for (const rule of snapshot.rules) {
      const currentRule = current.get(rule[0]);
      if (currentRule !== undefined) {
        if (canonicalJson(currentRule) !== canonicalJson(rule)) replacedRuleKeys.add(rule[0]);
        continue;
      }
      const previous = retainedOnly.get(rule[0]);
      assert.ok(previous === undefined || canonicalJson(previous) === canonicalJson(rule), `Conflicting retained StyleX rule for ${rule[0]}`);
      retainedOnly.set(rule[0], rule);
    }
  }
  assert.deepEqual(
    [...replacedRuleKeys],
    [],
    `Next development cannot hot-update stable StyleX defineVars/createTheme declarations; restart next dev (changed rule keys: ${[...replacedRuleKeys].sort().join(", ")})`,
  );
  const rules = canonicalizeStylexRules([...retainedOnly.values(), ...candidate.rules]);
  const includedRevisions = [...new Set([...retained.map(({ revision }) => revision), candidate.revision])].sort();
  const replaced = [...replacedRuleKeys].sort();
  return freeze({
    ...candidate,
    css: renderSnapshotCss(candidate.revision, includedRevisions, replaced, rules, candidate.foundations),
    includedRevisions,
    replacedRuleKeys: replaced,
  });
}

export function createNextDevSession(input: StylexNextDevOptions): Readonly<{
  options: NextDevOptions;
  prepare(): Promise<NextDevPreparation>;
}> {
  const options = parseNextDevOptions(input);
  let lastGood: NextDevSnapshot | null = null;
  let pending: Promise<NextDevPreparation> | null = null;
  const prepare = async (): Promise<NextDevPreparation> => {
    const attempted: AttemptedWatchInputs = { files: new Set(), missing: new Set() };
    const result = (error: Error | null, snapshot: NextDevSnapshot | null): NextDevPreparation => freeze({
      attemptedFiles: [...attempted.files].sort(),
      attemptedMissing: [...attempted.missing].sort(),
      error,
      lastGood,
      options,
      snapshot,
    });
    try {
      const inputs = await inventory(options, attempted);
      await recordAttempt(attempted, options.rootDirectory, resolve(options.rootDirectory, options.cssEntry), "Next development CSS entry");
      const cssEntry = await ordinary(options.rootDirectory, options.cssEntry);
      assert.equal(await readFile(cssEntry, "utf8"), STYLEX_NEXT_DEV_CSS_ENTRY, "Next development CSS entry must contain only its exact marker");
      const manifests: StylexPackageManifestV1[] = [];
      const foundations: string[] = [];
      const packageInputs: { logicalPath: string; role: "runtime" | "stylesheet"; sha256: string }[] = [];
      for (const path of options.packageManifests) {
        await recordAttempt(attempted, options.rootDirectory, resolve(options.rootDirectory, path), "Next development package manifest");
        const manifestPath = await ordinary(options.rootDirectory, path);
        const packageRoot = resolve(dirname(manifestPath), "..");
        const discovered = validateStylexPackageManifest(JSON.parse(await readSource(options.rootDirectory, path)) as unknown);
        await recordAttempt(attempted, options.rootDirectory, resolve(packageRoot, "package.json"), "Next development package identity");
        for (const artifact of [...discovered.runtime, ...discovered.buildTools, ...discovered.stylesheets, discovered.standaloneCss]) {
          await recordAttempt(attempted, options.rootDirectory, resolve(packageRoot, artifact.path), "Next development package artifact");
        }
        await recordAttempt(attempted, options.rootDirectory, resolve(packageRoot, discovered.compilerFoundation), "Next development compiler foundation");
        const manifest = await readStylexPackageManifest(manifestPath, packageRoot);
        assert.deepEqual(manifest, discovered, "Next development package manifest changed while discovering watch inputs");
        assert.ok(!manifests.some((entry) => entry.package.name === manifest.package.name), "Next development package identities must be unique");
        manifests.push(manifest);
        for (const artifact of manifest.runtime) packageInputs.push({ logicalPath: nextDevLogicalPath(options.rootDirectory, resolve(packageRoot, artifact.path)), role: "runtime", sha256: artifact.sha256 });
        for (const artifact of manifest.stylesheets) packageInputs.push({ logicalPath: nextDevLogicalPath(options.rootDirectory, resolve(packageRoot, artifact.path)), role: "stylesheet", sha256: artifact.sha256 });
        const foundation = await ordinary(options.rootDirectory, nextDevLogicalPath(options.rootDirectory, resolve(packageRoot, manifest.compilerFoundation)));
        auditCssWithoutStandaloneRecipes(await readFile(foundation, "utf8"), [manifest], "Next development foundation");
        foundations.push(relative(dirname(cssEntry), foundation).split(sep).join("/"));
      }
      const sourceIdentity = inputs.sources.map(({ logicalPath, sourceSha256 }) => ({ logicalPath, sourceSha256 }));
      const revision = sha256(canonicalJson({ compilerSha256, options: { ...options, rootDirectory: "<root>" }, packages: manifests.map((manifest) => sha256(canonicalJson(manifest))), sources: sourceIdentity }));
      if (lastGood?.revision === revision) return result(null, lastGood);
      const collector = createStylexTransformCollector(options.rootDirectory);
      const sources: NextDevSource[] = [];
      const sourcePaths = new Set(inputs.sources.map(({ logicalPath }) => logicalPath));
      for (const source of inputs.sources) await assertBoundedImports(options.rootDirectory, source.source, source.logicalPath, sourcePaths, attempted);
      for (const source of inputs.sources) {
        const absolute = resolve(options.rootDirectory, source.logicalPath);
        const transformed = await collector.transformWithMap(source.source, absolute, { logicalSourceFileName: source.logicalPath });
        sources.push(freeze({ code: transformed.code, logicalPath: source.logicalPath, map: transformed.map, sourceSha256: source.sourceSha256 }));
      }
      const rules = canonicalizeStylexRules(...manifests.map((manifest) => manifest.rules), collector.seal());
      const includedRevisions = [revision];
      const css = renderSnapshotCss(revision, includedRevisions, [], rules, foundations);
      // A source edit during extraction must never pair new JavaScript with old CSS.
      const settled = await inventory(options);
      assert.deepEqual(settled.sources.map(({ logicalPath, sourceSha256 }) => ({ logicalPath, sourceSha256 })), sourceIdentity, "Next development sources changed while preparing a revision");
      assert.deepEqual(settled.directories, inputs.directories, "Next development directory inventory changed while preparing a revision");
      for (const [index, path] of options.packageManifests.entries()) assert.deepEqual(await readStylexPackageManifest(await ordinary(options.rootDirectory, path)), manifests[index], "Next development package changed while preparing a revision");
      lastGood = freeze({
        css,
        cssEntry,
        directories: inputs.directories,
        files: [...attempted.files].sort(),
        foundations: [...foundations].sort(),
        includedRevisions,
        manifests,
        packageInputs,
        replacedRuleKeys: [],
        revision,
        rootDirectory: options.rootDirectory,
        rules,
        sources,
      });
      return result(null, lastGood);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return result(error, null);
    }
  };
  return Object.freeze({ options, prepare() {
    if (pending !== null) return pending;
    const attempt = prepare();
    pending = attempt;
    void attempt.finally(() => { if (pending === attempt) pending = null; });
    return attempt;
  } });
}

export type NextDevCompilerTarget = "client" | "edge-server" | "server";

export type NextDevRevisionCoordinator = Readonly<{
  complete(target: NextDevCompilerTarget, preparation: NextDevPreparation, relevant: boolean, succeeded: boolean): void;
  prepare(target: NextDevCompilerTarget): Promise<NextDevPreparation>;
  registerClientInvalidator(invalidate: () => boolean): void;
  validate(target: NextDevCompilerTarget, preparation: NextDevPreparation, relevant: boolean): Error | null;
}>;

/** Coordinates only compilers that have actually completed an owned graph. */
export function createNextDevRevisionCoordinator(session: Readonly<{ prepare(): Promise<NextDevPreparation> }>): NextDevRevisionCoordinator {
  const activeTargets = new Set<NextDevCompilerTarget>();
  const emitted = new Map<NextDevCompilerTarget, NextDevSnapshot>();
  const issued = new WeakMap<NextDevPreparation, NextDevCompilerTarget>();
  const completed = new WeakSet<NextDevPreparation>();
  let clientInvalidator: (() => boolean) | null = null;
  let invalidationKey: string | null = null;
  let pruneRevision: string | null = null;
  let published: NextDevSnapshot | null = null;

  const clone = (preparation: NextDevPreparation, values: Partial<Pick<NextDevPreparation, "error" | "snapshot">>): NextDevPreparation => freeze({
    ...preparation,
    ...values,
  });
  const requestClient = (key: string): void => {
    if (invalidationKey !== null) return;
    if (clientInvalidator?.() === true) invalidationKey = key;
  };
  const converged = (revision: string): boolean => activeTargets.has("client")
    && [...activeTargets].every((target) => emitted.get(target)?.revision === revision);
  const validationError = (target: NextDevCompilerTarget, preparation: NextDevPreparation, relevant: boolean): Error | null => {
    assert.equal(issued.get(preparation), target, "Next development validation does not match its prepared compiler target");
    if (!relevant || target === "client" || preparation.error !== null || preparation.snapshot === null) return null;
    const snapshot = requireNextDevSnapshot(preparation);
    if (published !== null && published.revision === snapshot.revision) return null;
    requestClient(`cohere:${snapshot.revision}`);
    return new Error(`Next development ${target} revision ${snapshot.revision} has no successfully published client stylesheet`);
  };
  const maybeRequestPrune = (): void => {
    if (pruneRevision !== null && published?.revision === pruneRevision && converged(pruneRevision)) {
      requestClient(`prune:${pruneRevision}`);
    }
  };

  return Object.freeze({
    complete(target: NextDevCompilerTarget, preparation: NextDevPreparation, relevant: boolean, succeeded: boolean) {
      assert.equal(issued.get(preparation), target, "Next development completion does not match its prepared compiler target");
      assert.ok(!completed.has(preparation), "Next development preparation completed more than once");
      completed.add(preparation);
      if (!succeeded) return;
      if (!relevant) {
        activeTargets.delete(target);
        emitted.delete(target);
        maybeRequestPrune();
        return;
      }
      const snapshot = requireNextDevSnapshot(preparation);
      const error = validationError(target, preparation, relevant);
      assert.equal(error, null, error?.message);
      activeTargets.add(target);
      emitted.set(target, snapshot);
      if (target === "client") {
        published = snapshot;
        pruneRevision = snapshot.includedRevisions.length > 1 ? snapshot.revision : null;
      }
      maybeRequestPrune();
    },
    async prepare(target: NextDevCompilerTarget) {
      const current = await session.prepare();
      let output: NextDevPreparation;
      if (current.error !== null || current.snapshot === null) output = clone(current, {});
      else if (target !== "client") output = published?.revision === current.snapshot.revision
        ? clone(current, { snapshot: published })
        : clone(current, {});
      else {
        invalidationKey = null;
        if (pruneRevision !== null && pruneRevision !== current.snapshot.revision) pruneRevision = null;
        const retained = pruneRevision === current.snapshot.revision && converged(current.snapshot.revision)
          ? []
          : [...emitted.values()];
        try {
          output = clone(current, { snapshot: composeNextDevSnapshot(current.snapshot, retained) });
        } catch (cause) {
          output = clone(current, { error: cause instanceof Error ? cause : new Error(String(cause)), snapshot: null });
        }
      }
      issued.set(output, target);
      return output;
    },
    registerClientInvalidator(invalidate: () => boolean) {
      assert.equal(typeof invalidate, "function", "Next development client invalidator must be a function");
      clientInvalidator = invalidate;
    },
    validate(target: NextDevCompilerTarget, preparation: NextDevPreparation, relevant: boolean) {
      return validationError(target, preparation, relevant);
    },
  });
}

export function requireNextDevSnapshot(preparation: NextDevPreparation): NextDevSnapshot {
  if (preparation.error !== null) throw preparation.error;
  assert.ok(preparation.snapshot !== null, "Next development compilation has no snapshot");
  return preparation.snapshot;
}

export async function transformNextDevSource(preparation: NextDevPreparation, resourcePath: string, source: string | Uint8Array, inputSourceMap?: unknown): Promise<NextDevSource> {
  const snapshot = requireNextDevSnapshot(preparation);
  assert.ok(inputSourceMap === undefined || inputSourceMap === null, "Next development source must reach the StyleX pre-loader before another mapped transform");
  const logical = nextDevLogicalPath(snapshot.rootDirectory, resourcePath);
  await ordinary(snapshot.rootDirectory, logical);
  const result = snapshot.sources.find((entry) => entry.logicalPath === logical);
  assert.ok(result !== undefined, `Next development source is outside the registered snapshot: ${logical}`);
  assert.equal(sha256(source), result.sourceSha256, `Next development source differs from its compilation snapshot: ${logical}`);
  return result;
}

export function renderNextDevCss(preparation: NextDevPreparation, resourcePath: string, source: string | Uint8Array): string {
  const snapshot = requireNextDevSnapshot(preparation);
  assert.equal(resourcePath, snapshot.cssEntry, "Next development stylesheet loader received an unregistered resource");
  assert.equal(typeof source === "string" ? source : Buffer.from(source).toString("utf8"), STYLEX_NEXT_DEV_CSS_ENTRY, "Next development stylesheet marker changed during compilation");
  return snapshot.css;
}

export async function auditNextDevCss(preparation: NextDevPreparation, resourcePath: string, source: string | Uint8Array): Promise<string> {
  const snapshot = requireNextDevSnapshot(preparation);
  const logical = nextDevLogicalPath(snapshot.rootDirectory, resourcePath);
  await ordinary(snapshot.rootDirectory, logical);
  if (resourcePath === snapshot.cssEntry) return renderNextDevCss(preparation, resourcePath, source);
  const css = typeof source === "string" ? source : Buffer.from(source).toString("utf8");
  if (logical.startsWith("node_modules/")) {
    const declared = snapshot.packageInputs.find((input) => input.role === "stylesheet" && input.logicalPath === logical);
    assert.ok(declared !== undefined, `Next development package stylesheet is not declared: ${logical}`);
    assert.equal(sha256(source), declared.sha256, `Next development package stylesheet changed: ${logical}`);
  }
  auditCssWithoutStandaloneRecipes(css, snapshot.manifests, `Next development stylesheet ${logical}`);
  return css;
}

export async function loadNextDevModule(preparation: NextDevPreparation, resourcePath: string, source: string | Uint8Array, inputSourceMap?: unknown): Promise<Readonly<{ code: string; map: unknown }>> {
  const snapshot = requireNextDevSnapshot(preparation);
  const logical = nextDevLogicalPath(snapshot.rootDirectory, resourcePath);
  if (!logical.startsWith("node_modules/")) return transformNextDevSource(preparation, resourcePath, source, inputSourceMap);
  await ordinary(snapshot.rootDirectory, logical);
  const declared = snapshot.packageInputs.find((input) => input.role === "runtime" && input.logicalPath === logical);
  assert.ok(declared !== undefined, `Next development package module is outside its declared runtime: ${logical}`);
  assert.equal(sha256(source), declared.sha256, `Next development package runtime changed: ${logical}`);
  return { code: typeof source === "string" ? source : Buffer.from(source).toString("utf8"), map: inputSourceMap ?? null };
}
