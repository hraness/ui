import assert from "node:assert/strict";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { parseSync } from "@babel/core";

export const STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION = 1 as const;
export const STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE = "isolated-regular-file-deliverable-stage" as const;
export const STYLEX_NEXT_OUTPUT_MAX_DIRECTORIES = 32_768;
export const STYLEX_NEXT_OUTPUT_MAX_FILES = 32_768;
export const STYLEX_NEXT_OUTPUT_MAX_PRIVATE_MAPS = 4_096;
export const STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES = 64 * 1024 * 1024;
export const STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;

export type StylexNextOutputArtifactV1 = Readonly<{
  bytes: number;
  mode: number;
  path: string;
  sha256: string;
}>;

export type StylexNextOutputDirectoryV1 = Readonly<{
  mode: number;
  path: string;
}>;

/**
 * A private map and the output whose bytes it describes before settlement.
 * Both artifacts are historical after a successful settlement.
 */
export type StylexNextPrivateSourceMapV1 = Readonly<{
  map: StylexNextOutputArtifactV1;
  mappedOutput: StylexNextOutputArtifactV1;
}>;

export type StylexNextOutputPostprocessFileV1 = Readonly<{
  absolutePath: string;
  artifact: StylexNextOutputArtifactV1;
}>;

export type StylexNextOutputPostprocessPairV1 = Readonly<{
  map: StylexNextOutputPostprocessFileV1;
  mappedOutput: StylexNextOutputPostprocessFileV1;
}>;

/**
 * The callback is intentionally provider-neutral. It may process only the
 * listed map/output pairs. The settlement core rejects every new regular-file
 * path, directory-topology change, unrelated mutation, or unpaired deletion.
 */
export type StylexNextOutputPostprocessor = (
  request: Readonly<{
    outputDirectory: string;
    sourceMaps: readonly StylexNextOutputPostprocessPairV1[];
  }>,
) => Promise<void>;

export type SettleStylexNextPrivateOutputOptions = Readonly<{
  /**
   * This literal is an explicit caller contract: outputDirectory is a private,
   * isolated staging root containing only the exact deliverable regular files,
   * and the caller holds its output lease for the entire operation.
   */
  scope: typeof STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE;
  outputDirectory: string;
  outputs: readonly StylexNextOutputArtifactV1[];
  privateSourceMaps: readonly StylexNextPrivateSourceMapV1[];
  revalidateBeforeReturn?: () => Promise<void>;
  upload?: StylexNextOutputPostprocessor;
}>;

export type StylexNextOutputSettlementV1 = Readonly<{
  kind: "hraness-stylex-next-output-settlement";
  privateSourceMaps: readonly StylexNextPrivateSourceMapV1[];
  privateSourceMapsSha256: string;
  publicDirectories: readonly StylexNextOutputDirectoryV1[];
  publicDirectoriesSha256: string;
  publicOutputs: readonly StylexNextOutputArtifactV1[];
  publicOutputsSha256: string;
  publicRootMode: number;
  schemaVersion: typeof STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION;
  scope: typeof STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE;
  state: "settled";
  upload: "failed" | "not-configured" | "succeeded";
}>;

type CapturedFile = Readonly<{
  artifact: StylexNextOutputArtifactV1;
}>;

type CapturedTree = Readonly<{
  directories: readonly StylexNextOutputDirectoryV1[];
  files: readonly CapturedFile[];
  rootMode: number;
}>;

type ParsedSettlementOptions = Readonly<{
  scope: typeof STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE;
  outputDirectory: string;
  outputs: readonly StylexNextOutputArtifactV1[];
  privateSourceMaps: readonly StylexNextPrivateSourceMapV1[];
  revalidateBeforeReturn?: () => Promise<void>;
  upload?: StylexNextOutputPostprocessor;
}>;

type RecoveryCopy = Readonly<{
  artifact: StylexNextOutputArtifactV1;
  dev: number;
  ino: number;
  path: string;
}>;

type RecoveryDirectory = Readonly<{
  dev: number;
  ino: number;
  path: string;
}>;

type CommentSpan = Readonly<{
  end: number;
  kind: "block" | "line";
  start: number;
  value: string;
}>;

const OUTPUT_EXTENSIONS = new Set([".cjs", ".css", ".js", ".mjs"]);
const READ_BUFFER_BYTES = 64 * 1024;
const MAX_LOGICAL_PATH_BYTES = 4_096;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  description: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  assert.deepEqual(
    Object.keys(record).filter((key) => !allowed.has(key)),
    [],
    `${description} contains unknown keys`,
  );
  for (const key of required) assert.ok(Object.hasOwn(record, key), `${description}.${key} is required`);
}

function logicalPath(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && value.length > 0, `${description} must be a nonempty string`);
  assert.ok(Buffer.byteLength(value, "utf8") <= MAX_LOGICAL_PATH_BYTES, `${description} exceeds its byte bound`);
  assert.ok(!value.includes("\\") && !value.includes("\0"), `${description} must use a safe POSIX path`);
  assert.ok(!value.startsWith("/") && !/^[A-Za-z]:/u.test(value), `${description} must be relative`);
  assert.equal(posix.normalize(value), value, `${description} must be normalized`);
  assert.ok(
    value !== "." && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
    `${description} must remain below the output directory`,
  );
  return value;
}

function digest(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${description} must be a SHA-256 digest`);
  return value;
}

function mode(value: unknown, description: string): number {
  assert.ok(Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0o777, `${description} must be ordinary permission bits`);
  return Number(value);
}

function artifact(value: unknown, description: string): StylexNextOutputArtifactV1 {
  const record = object(value, description);
  exactKeys(record, ["bytes", "mode", "path", "sha256"], description);
  assert.ok(Number.isSafeInteger(record.bytes) && Number(record.bytes) >= 0, `${description}.bytes is invalid`);
  return Object.freeze({
    bytes: Number(record.bytes),
    mode: mode(record.mode, `${description}.mode`),
    path: logicalPath(record.path, `${description}.path`),
    sha256: digest(record.sha256, `${description}.sha256`),
  });
}

function directory(value: unknown, description: string): StylexNextOutputDirectoryV1 {
  const record = object(value, description);
  exactKeys(record, ["mode", "path"], description);
  return Object.freeze({
    mode: mode(record.mode, `${description}.mode`),
    path: logicalPath(record.path, `${description}.path`),
  });
}

function comparePath(left: Readonly<{ path: string }>, right: Readonly<{ path: string }>): number {
  return left.path.localeCompare(right.path, "en");
}

function outputExtension(path: string): string {
  return posix.extname(path).toLowerCase();
}

function isPrivateMapPath(path: string): boolean {
  return outputExtension(path) === ".map";
}

function isTextualOutputPath(path: string): boolean {
  return OUTPUT_EXTENSIONS.has(outputExtension(path));
}

function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function assertNoPortablePathCollisions(paths: readonly string[], description: string): void {
  const spellingByKey = new Map<string, string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const spelling = parts.slice(0, index).join("/");
      const key = portablePathKey(spelling);
      const previous = spellingByKey.get(key);
      assert.ok(previous === undefined || previous === spelling, `${description} must not contain case or Unicode-normalization collisions`);
      spellingByKey.set(key, spelling);
    }
  }
}

function artifacts(value: unknown, description: string): readonly StylexNextOutputArtifactV1[] {
  assert.ok(Array.isArray(value) && value.length > 0, `${description} must be a nonempty array`);
  assert.ok(value.length <= STYLEX_NEXT_OUTPUT_MAX_FILES, `${description} exceeds its file bound`);
  const parsed = value.map((item, index) => artifact(item, `${description}[${String(index)}]`));
  assert.deepEqual(parsed, [...parsed].sort(comparePath), `${description} must be path sorted`);
  assert.equal(new Set(parsed.map(({ path }) => path)).size, parsed.length, `${description} paths must be unique`);
  assertNoPortablePathCollisions(parsed.map(({ path }) => path), `${description} paths`);
  const total = parsed.reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(Number.isSafeInteger(total) && total <= STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES, `${description} exceeds its total-byte bound`);
  return Object.freeze(parsed);
}

function directories(value: unknown, description: string): readonly StylexNextOutputDirectoryV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  assert.ok(value.length <= STYLEX_NEXT_OUTPUT_MAX_DIRECTORIES, `${description} exceeds its directory bound`);
  const parsed = value.map((item, index) => directory(item, `${description}[${String(index)}]`));
  assert.deepEqual(parsed, [...parsed].sort(comparePath), `${description} must be path sorted`);
  assert.equal(new Set(parsed.map(({ path }) => path)).size, parsed.length, `${description} paths must be unique`);
  assertNoPortablePathCollisions(parsed.map(({ path }) => path), `${description} paths`);
  return Object.freeze(parsed);
}

function sourceMapPair(value: unknown, description: string): StylexNextPrivateSourceMapV1 {
  const record = object(value, description);
  exactKeys(record, ["map", "mappedOutput"], description);
  const map = artifact(record.map, `${description}.map`);
  const mappedOutput = artifact(record.mappedOutput, `${description}.mappedOutput`);
  assert.ok(isPrivateMapPath(map.path), `${description}.map must end in .map case-insensitively`);
  assert.equal(map.path.slice(0, -4), mappedOutput.path, `${description}.map must be the exact mapped-output sidecar`);
  assert.ok(isTextualOutputPath(mappedOutput.path), `${description}.mappedOutput has an unsupported extension`);
  assert.ok(mappedOutput.bytes <= STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES, `${description}.mappedOutput exceeds its bounded settlement size`);
  return Object.freeze({ map, mappedOutput });
}

function sourceMapPairs(value: unknown, description: string): readonly StylexNextPrivateSourceMapV1[] {
  assert.ok(Array.isArray(value) && value.length > 0, `${description} must be a nonempty array`);
  assert.ok(value.length <= STYLEX_NEXT_OUTPUT_MAX_PRIVATE_MAPS, `${description} exceeds its private-map bound`);
  const parsed = value.map((item, index) => sourceMapPair(item, `${description}[${String(index)}]`));
  assert.deepEqual(
    parsed.map(({ map }) => map.path),
    [...parsed].map(({ map }) => map.path).sort((left, right) => left.localeCompare(right, "en")),
    `${description} must be map-path sorted`,
  );
  assert.equal(new Set(parsed.map(({ map }) => map.path)).size, parsed.length, `${description} map paths must be unique`);
  assert.equal(new Set(parsed.map(({ mappedOutput }) => mappedOutput.path)).size, parsed.length, `${description} mapped-output paths must be unique`);
  assertNoPortablePathCollisions(parsed.map(({ map }) => map.path), `${description} map paths`);
  assertNoPortablePathCollisions(parsed.map(({ mappedOutput }) => mappedOutput.path), `${description} mapped-output paths`);
  return Object.freeze(parsed);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalArtifact(value: StylexNextOutputArtifactV1): StylexNextOutputArtifactV1 {
  return Object.freeze({ bytes: value.bytes, mode: value.mode, path: value.path, sha256: value.sha256 });
}

function canonicalDirectory(value: StylexNextOutputDirectoryV1): StylexNextOutputDirectoryV1 {
  return Object.freeze({ mode: value.mode, path: value.path });
}

function canonicalPairs(value: readonly StylexNextPrivateSourceMapV1[]): readonly StylexNextPrivateSourceMapV1[] {
  return Object.freeze(value.map(({ map, mappedOutput }) => Object.freeze({
    map: canonicalArtifact(map),
    mappedOutput: canonicalArtifact(mappedOutput),
  })));
}

function inventorySha256(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function permissionMode(value: number, description: string): number {
  const permissions = value & 0o7777;
  assert.equal(permissions & 0o7000, 0, `${description} must not use special permission bits`);
  return permissions;
}

async function ordinaryOutputRoot(value: string): Promise<Readonly<{ mode: number; path: string }>> {
  assert.ok(isAbsolute(value) && resolve(value) === value, "StyleX Next outputDirectory must be an absolute normalized path");
  const information = await lstat(value);
  assert.ok(information.isDirectory() && !information.isSymbolicLink(), "StyleX Next outputDirectory must be an ordinary nonsymlink directory");
  assert.equal(await realpath(value), value, "StyleX Next outputDirectory must not traverse a symlink");
  return Object.freeze({ mode: permissionMode(information.mode, "StyleX Next outputDirectory"), path: value });
}

function absoluteBelow(root: string, logical: string, description: string): string {
  const absolute = resolve(root, ...logical.split("/"));
  const below = relative(root, absolute);
  assert.ok(below.length > 0 && below !== ".." && !below.startsWith(`..${sep}`) && !isAbsolute(below), `${description} escapes the output directory`);
  return absolute;
}

function sameFileIdentity(
  left: Readonly<{ ctimeMs: number; dev: number; ino: number; mode: number; mtimeMs: number; nlink: number; size: number }>,
  right: Readonly<{ ctimeMs: number; dev: number; ino: number; mode: number; mtimeMs: number; nlink: number; size: number }>,
): boolean {
  return left.ctimeMs === right.ctimeMs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.mtimeMs === right.mtimeMs
    && left.nlink === right.nlink
    && left.size === right.size;
}

async function captureFile(root: string, path: string): Promise<CapturedFile> {
  const logical = logicalPath(path, "StyleX Next output path");
  const absolute = absoluteBelow(root, logical, `StyleX Next output ${logical}`);
  const pathInformation = await lstat(absolute);
  assert.ok(pathInformation.isFile() && !pathInformation.isSymbolicLink(), `StyleX Next output must be an ordinary nonsymlink file: ${logical}`);
  assert.equal(pathInformation.nlink, 1, `StyleX Next output must have exactly one hard link: ${logical}`);
  assert.equal(await realpath(absolute), absolute, `StyleX Next output must not traverse a symlink: ${logical}`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile(), `StyleX Next output must remain an ordinary file: ${logical}`);
    assert.equal(before.nlink, 1, `StyleX Next output must remain single-link: ${logical}`);
    assert.ok(before.size <= STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES, `StyleX Next output exceeds its per-file byte bound: ${logical}`);
    const hash = createHash("sha256");
    const block = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(block, 0, block.byteLength, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      hash.update(block.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    assert.ok(sameFileIdentity(before, after) && bytes === after.size, `StyleX Next output changed while it was read: ${logical}`);
    const settledPath = await lstat(absolute);
    assert.ok(settledPath.isFile() && !settledPath.isSymbolicLink() && settledPath.nlink === 1 && settledPath.dev === after.dev && settledPath.ino === after.ino, `StyleX Next output path changed or gained a hard link while it was read: ${logical}`);
    return Object.freeze({
      artifact: Object.freeze({
        bytes,
        mode: permissionMode(after.mode, `StyleX Next output ${logical}`),
        path: logical,
        sha256: hash.digest("hex"),
      }),
    });
  } finally {
    await handle.close();
  }
}

async function captureFileIfPresent(root: string, path: string): Promise<CapturedFile | undefined> {
  try {
    return await captureFile(root, path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function readCapturedBytes(
  root: string,
  expected: StylexNextOutputArtifactV1,
  description: string,
): Promise<Buffer> {
  assert.ok(expected.bytes <= STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES, `${description} exceeds its bounded in-memory size`);
  const absolute = absoluteBelow(root, expected.path, description);
  const pathBefore = await lstat(absolute);
  assert.ok(pathBefore.isFile() && !pathBefore.isSymbolicLink(), `${description} must be an ordinary nonsymlink file`);
  assert.equal(pathBefore.nlink, 1, `${description} must have exactly one hard link`);
  assert.equal(await realpath(absolute), absolute, `${description} must not traverse a symlink`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile(), `${description} must be an ordinary file`);
    assert.equal(before.nlink, 1, `${description} must remain single-link`);
    assert.equal(permissionMode(before.mode, description), expected.mode, `${description} mode changed`);
    assert.equal(before.size, expected.bytes, `${description} byte count changed`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assert.ok(sameFileIdentity(before, after), `${description} changed while it was read`);
    assert.equal(hashBytes(bytes), expected.sha256, `${description} hash changed`);
    const pathInformation = await lstat(absolute);
    assert.ok(pathInformation.isFile() && !pathInformation.isSymbolicLink() && pathInformation.nlink === 1 && pathInformation.dev === after.dev && pathInformation.ino === after.ino, `${description} path changed or gained a hard link while it was read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function captureTree(root: string): Promise<CapturedTree> {
  const rootIdentity = await ordinaryOutputRoot(root);
  const files: CapturedFile[] = [];
  const directoriesFound: StylexNextOutputDirectoryV1[] = [];
  let totalBytes = 0;
  const walk = async (logicalDirectory: string): Promise<void> => {
    const absolute = logicalDirectory === "" ? root : absoluteBelow(root, logicalDirectory, "StyleX Next output directory");
    const information = await lstat(absolute);
    assert.ok(information.isDirectory() && !information.isSymbolicLink(), "StyleX Next output tree contains a nonordinary directory");
    assert.equal(await realpath(absolute), absolute, "StyleX Next output tree traverses a symlink");
    if (logicalDirectory !== "") {
      directoriesFound.push(Object.freeze({ mode: permissionMode(information.mode, `StyleX Next output directory ${logicalDirectory}`), path: logicalDirectory }));
      assert.ok(directoriesFound.length <= STYLEX_NEXT_OUTPUT_MAX_DIRECTORIES, "StyleX Next output tree exceeds its directory bound");
    }
    const entries = (await readdir(absolute, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"));
    const entryIdentity = entries.map((entry) => [entry.name, entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "special"]);
    for (const entry of entries) {
      const logical = logicalDirectory === "" ? entry.name : `${logicalDirectory}/${entry.name}`;
      logicalPath(logical, "StyleX Next output entry");
      if (entry.isDirectory()) await walk(logical);
      else if (entry.isFile()) {
        const captured = await captureFile(root, logical);
        files.push(captured);
        totalBytes += captured.artifact.bytes;
        assert.ok(files.length <= STYLEX_NEXT_OUTPUT_MAX_FILES, "StyleX Next output tree exceeds its file bound");
        assert.ok(Number.isSafeInteger(totalBytes) && totalBytes <= STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES, "StyleX Next output tree exceeds its total-byte bound");
      } else throw new Error(`StyleX Next output tree contains a symlink or special entry: ${logical}`);
    }
    const after = await lstat(absolute);
    assert.ok(after.isDirectory() && !after.isSymbolicLink() && sameFileIdentity(information, after), `StyleX Next output directory changed while inventoried: ${logicalDirectory || "."}`);
    const settledEntries = (await readdir(absolute, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map((entry) => [entry.name, entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "special"]);
    assert.deepEqual(settledEntries, entryIdentity, `StyleX Next output directory entries changed while inventoried: ${logicalDirectory || "."}`);
  };
  await walk("");
  const filePaths = files.map(({ artifact: item }) => item.path);
  const directoryPaths = directoriesFound.map(({ path }) => path);
  assertNoPortablePathCollisions([...filePaths, ...directoryPaths], "StyleX Next output tree paths");
  return Object.freeze({
    directories: Object.freeze(directoriesFound.sort(comparePath)),
    files: Object.freeze(files.sort((left, right) => comparePath(left.artifact, right.artifact))),
    rootMode: rootIdentity.mode,
  });
}

function assertArtifactEquals(actual: StylexNextOutputArtifactV1, expected: StylexNextOutputArtifactV1, description: string): void {
  assert.deepEqual(actual, expected, description);
}

function parseOptions(value: SettleStylexNextPrivateOutputOptions): ParsedSettlementOptions {
  const record = object(value, "StyleX Next output settlement options");
  exactKeys(record, ["scope", "outputDirectory", "outputs", "privateSourceMaps"], "StyleX Next output settlement options", ["revalidateBeforeReturn", "upload"]);
  assert.equal(record.scope, STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE, "StyleX Next output settlement requires an isolated regular-file deliverable stage");
  assert.ok(typeof record.outputDirectory === "string", "StyleX Next outputDirectory must be a string");
  assert.ok(record.revalidateBeforeReturn === undefined || typeof record.revalidateBeforeReturn === "function", "StyleX Next revalidateBeforeReturn must be a function");
  assert.ok(record.upload === undefined || typeof record.upload === "function", "StyleX Next upload must be a function");
  const outputs = artifacts(record.outputs, "StyleX Next verified outputs");
  for (const output of outputs) {
    if (isTextualOutputPath(output.path)) {
      assert.ok(output.bytes <= STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES, `StyleX Next textual output exceeds its bounded settlement size: ${output.path}`);
    }
  }
  const privateSourceMaps = sourceMapPairs(record.privateSourceMaps, "StyleX Next private source maps");
  const byPath = new Map(outputs.map((item) => [item.path, item]));
  const listedMaps = new Set(privateSourceMaps.map(({ map }) => map.path));
  assert.deepEqual(outputs.filter(({ path }) => isPrivateMapPath(path)).map(({ path }) => path), [...listedMaps].sort((left, right) => left.localeCompare(right, "en")), "Every verified .map output must be declared private exactly once");
  for (const pair of privateSourceMaps) {
    const verifiedMap = byPath.get(pair.map.path);
    const verifiedOutput = byPath.get(pair.mappedOutput.path);
    assert.ok(verifiedMap !== undefined, `Private source map is absent from verified outputs: ${pair.map.path}`);
    assert.ok(verifiedOutput !== undefined, `Mapped output is absent from verified outputs: ${pair.mappedOutput.path}`);
    assertArtifactEquals(pair.map, verifiedMap, `Private source map differs from verified output: ${pair.map.path}`);
    assertArtifactEquals(pair.mappedOutput, verifiedOutput, `Mapped output differs from verified output: ${pair.mappedOutput.path}`);
  }
  return {
    scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
    outputDirectory: record.outputDirectory,
    outputs,
    privateSourceMaps,
    ...(record.revalidateBeforeReturn === undefined ? {} : { revalidateBeforeReturn: record.revalidateBeforeReturn as () => Promise<void> }),
    ...(record.upload === undefined ? {} : { upload: record.upload as StylexNextOutputPostprocessor }),
  };
}

function javascriptComments(source: string, path: string): readonly CommentSpan[] {
  const parsed = parseSync(source, {
    babelrc: false,
    configFile: false,
    filename: path,
    parserOpts: { allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true },
    sourceType: "unambiguous",
  });
  assert.ok(parsed !== null, `Mapped JavaScript could not be parsed: ${path}`);
  return Object.freeze((parsed.comments ?? []).map((comment) => {
    assert.ok(Number.isSafeInteger(comment.start) && Number.isSafeInteger(comment.end), `Mapped JavaScript comment has no stable span: ${path}`);
    return Object.freeze({
      end: Number(comment.end),
      kind: comment.type === "CommentLine" ? "line" as const : "block" as const,
      start: Number(comment.start),
      value: comment.value,
    });
  }));
}

function cssEscape(source: string, start: number, path: string): Readonly<{ end: number; value: string }> {
  assert.equal(source[start], "\\");
  let index = start + 1;
  assert.ok(index < source.length && source[index] !== "\n" && source[index] !== "\r", `Mapped CSS contains an invalid escape: ${path}`);
  if (/^[a-fA-F0-9]$/u.test(source[index]!)) {
    let digits = "";
    while (digits.length < 6 && index < source.length && /^[a-fA-F0-9]$/u.test(source[index]!)) {
      digits += source[index];
      index += 1;
    }
    if (source.slice(index, index + 2) === "\r\n") index += 2;
    else if (source[index] === " " || source[index] === "\t" || source[index] === "\n" || source[index] === "\r" || source[index] === "\f") index += 1;
    const codePoint = Number.parseInt(digits, 16);
    const valid = codePoint !== 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
    return Object.freeze({ end: index, value: String.fromCodePoint(valid ? codePoint : 0xfffd) });
  }
  const value = source[index]!;
  return Object.freeze({ end: index + 1, value });
}

function cssIdentifier(source: string, start: number, path: string): Readonly<{ end: number; value: string }> | undefined {
  let index = start;
  let value = "";
  while (index < source.length) {
    const character = source[index]!;
    if (/^[a-zA-Z0-9_-]$/u.test(character) || character.codePointAt(0)! >= 0x80) {
      value += character;
      index += character.length;
    } else if (character === "\\") {
      const escaped = cssEscape(source, index, path);
      value += escaped.value;
      index = escaped.end;
    } else break;
  }
  return index === start ? undefined : Object.freeze({ end: index, value });
}

function cssUrlTokenEnd(source: string, open: number, path: string): number {
  assert.equal(source[open], "(");
  let index = open + 1;
  let quote: "\"" | "'" | undefined;
  while (index < source.length) {
    const character = source[index]!;
    if (quote !== undefined) {
      if (character === "\\") {
        if (source.slice(index + 1, index + 3) === "\r\n") index += 3;
        else if (source[index + 1] === "\n" || source[index + 1] === "\r" || source[index + 1] === "\f") index += 2;
        else index = cssEscape(source, index, path).end;
        continue;
      }
      assert.ok(character !== "\n" && character !== "\r", `Mapped CSS contains an unterminated url string: ${path}`);
      if (character === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (character === "\\") {
      index = cssEscape(source, index, path).end;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === ")") return index + 1;
    index += character.length;
  }
  throw new Error(`Mapped CSS contains an unterminated url token: ${path}`);
}

function cssComments(source: string, path: string): readonly CommentSpan[] {
  const comments: CommentSpan[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character !== undefined && (/^[a-zA-Z0-9_-]$/u.test(character) || character === "\\" || character.codePointAt(0)! >= 0x80)) {
      const identifier = cssIdentifier(source, index, path);
      assert.ok(identifier !== undefined);
      if (identifier.value.toLowerCase() === "url" && source[identifier.end] === "(") {
        index = cssUrlTokenEnd(source, identifier.end, path);
      } else index = identifier.end;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      let closed = false;
      while (index < source.length) {
        const nested = source[index];
        if (nested === "\\") { index += 2; continue; }
        assert.ok(nested !== "\n" && nested !== "\r", `Mapped CSS contains an unterminated string: ${path}`);
        index += 1;
        if (nested === quote) { closed = true; break; }
      }
      assert.ok(closed, `Mapped CSS contains an unterminated string: ${path}`);
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const start = index;
      const endMarker = source.indexOf("*/", index + 2);
      assert.ok(endMarker >= 0, `Mapped CSS contains an unterminated comment: ${path}`);
      const end = endMarker + 2;
      comments.push(Object.freeze({ end, kind: "block", start, value: source.slice(start + 2, endMarker) }));
      index = end;
      continue;
    }
    index += 1;
  }
  return Object.freeze(comments);
}

function sourceMapDirectives(source: string, extension: string, path: string): readonly Readonly<CommentSpan & { reference: string }>[] {
  const comments = extension === ".css" ? cssComments(source, path) : javascriptComments(source, path);
  const directives: Readonly<CommentSpan & { reference: string }>[] = [];
  for (const comment of comments) {
    const body = comment.value.trim();
    if (!/^[#@][ \t]*sourceMappingURL[ \t]*=/u.test(body)) continue;
    const match = /^[#@][ \t]*sourceMappingURL[ \t]*=([^\r\n]*)$/u.exec(body);
    assert.ok(match !== null && match[1]!.trim().length > 0, `Mapped output contains a malformed sourceMappingURL directive: ${path}`);
    directives.push(Object.freeze({ ...comment, reference: match[1]!.trim() }));
  }
  return Object.freeze(directives);
}

function expectedMapReferences(pair: StylexNextPrivateSourceMapV1): ReadonlySet<string> {
  const reference = posix.relative(posix.dirname(pair.mappedOutput.path), pair.map.path);
  return new Set([reference, `./${reference}`]);
}

function stripExactSourceMapReference(bytes: Buffer, pair: StylexNextPrivateSourceMapV1): Buffer {
  const source = bytes.toString("utf8");
  assert.ok(Buffer.from(source, "utf8").equals(bytes), `Mapped output is not valid UTF-8: ${pair.mappedOutput.path}`);
  const extension = outputExtension(pair.mappedOutput.path);
  const directives = sourceMapDirectives(source, extension, pair.mappedOutput.path);
  if (directives.length === 0) return bytes;
  assert.equal(directives.length, 1, `Mapped output contains multiple sourceMappingURL directives: ${pair.mappedOutput.path}`);
  const directive = directives[0]!;
  assert.ok(/^\s*$/u.test(source.slice(directive.end)), `Mapped output contains a nonterminal sourceMappingURL directive: ${pair.mappedOutput.path}`);
  assert.ok(expectedMapReferences(pair).has(directive.reference), `Mapped output references a different source map: ${pair.mappedOutput.path}`);
  const lineStart = source.lastIndexOf("\n", Math.max(0, directive.start - 1)) + 1;
  const ownLine = /^[ \t]*$/u.test(source.slice(lineStart, directive.start));
  let removalEnd = directive.end;
  if (ownLine) {
    while (source[removalEnd] === " " || source[removalEnd] === "\t") removalEnd += 1;
    if (source.slice(removalEnd, removalEnd + 2) === "\r\n") removalEnd += 2;
    else if (source[removalEnd] === "\n" || source[removalEnd] === "\r") removalEnd += 1;
  }
  const stripped = `${source.slice(0, ownLine ? lineStart : directive.start)}${source.slice(removalEnd)}`;
  assert.equal(sourceMapDirectives(stripped, extension, pair.mappedOutput.path).length, 0, `Mapped output retains a sourceMappingURL directive: ${pair.mappedOutput.path}`);
  return Buffer.from(stripped, "utf8");
}

async function replaceCapturedFile(
  root: string,
  current: CapturedFile,
  nextBytes: Buffer,
  targetMode = current.artifact.mode,
): Promise<CapturedFile> {
  const nextArtifact = Object.freeze({ bytes: nextBytes.byteLength, mode: targetMode, path: current.artifact.path, sha256: hashBytes(nextBytes) });
  if (current.artifact.bytes === nextArtifact.bytes && current.artifact.sha256 === nextArtifact.sha256 && current.artifact.mode === targetMode) return current;
  const absolute = absoluteBelow(root, current.artifact.path, "StyleX Next mapped output");
  const parent = dirname(absolute);
  const parentInformation = await lstat(parent);
  assert.ok(parentInformation.isDirectory() && !parentInformation.isSymbolicLink(), `Mapped output parent is not an ordinary nonsymlink directory: ${current.artifact.path}`);
  assert.equal(await realpath(parent), parent, `Mapped output parent traverses a symlink: ${current.artifact.path}`);
  const temporary = resolve(dirname(absolute), `.${basename(absolute)}.${randomUUID()}.stylex-map-settlement`);
  let created = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, targetMode);
    created = true;
    try {
      await handle.writeFile(nextBytes);
      await handle.chmod(targetMode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const immediatelyBefore = await captureFile(root, current.artifact.path);
    assertArtifactEquals(immediatelyBefore.artifact, current.artifact, `Mapped output changed immediately before source-map reference stripping: ${current.artifact.path}`);
    await rename(temporary, absolute);
    created = false;
    const replaced = await captureFile(root, current.artifact.path);
    assertArtifactEquals(replaced.artifact, nextArtifact, `Mapped output replacement differs from its exact settled bytes: ${current.artifact.path}`);
    return replaced;
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

async function restoreMissingCapturedFile(root: string, expected: StylexNextOutputArtifactV1, nextBytes: Buffer): Promise<CapturedFile> {
  const absolute = absoluteBelow(root, expected.path, "StyleX Next missing mapped output");
  const parent = dirname(absolute);
  const parentInformation = await lstat(parent);
  assert.ok(parentInformation.isDirectory() && !parentInformation.isSymbolicLink(), `Mapped output parent is not an ordinary nonsymlink directory: ${expected.path}`);
  assert.equal(await realpath(parent), parent, `Mapped output parent traverses a symlink: ${expected.path}`);
  const temporary = resolve(parent, `.${basename(absolute)}.${randomUUID()}.stylex-map-restoration`);
  let created = false;
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, expected.mode);
    created = true;
    try {
      await handle.writeFile(nextBytes);
      await handle.chmod(expected.mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    assert.equal(await captureFileIfPresent(root, expected.path), undefined, `Mapped output reappeared immediately before restoration: ${expected.path}`);
    await rename(temporary, absolute);
    created = false;
    return await captureFile(root, expected.path);
  } finally {
    if (created) await rm(temporary, { force: true });
  }
}

async function removePrivateMap(root: string, logical: string): Promise<void> {
  const absolute = absoluteBelow(root, logical, "StyleX Next private source map");
  let information;
  try { information = await lstat(absolute); }
  catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
  assert.ok(information.isFile() && !information.isSymbolicLink(), `Private source map is not an ordinary nonsymlink file: ${logical}`);
  assert.equal(information.nlink, 1, `Private source map must have exactly one hard link: ${logical}`);
  assert.equal(await realpath(absolute), absolute, `Private source map traverses a symlink: ${logical}`);
  const immediatelyBefore = await lstat(absolute);
  assert.ok(
    immediatelyBefore.isFile()
      && !immediatelyBefore.isSymbolicLink()
      && immediatelyBefore.nlink === 1
      && immediatelyBefore.dev === information.dev
      && immediatelyBefore.ino === information.ino,
    `Private source map changed identity or gained a hard link before removal: ${logical}`,
  );
  await unlink(absolute);
}

function requestFor(root: string, pairs: readonly StylexNextPrivateSourceMapV1[]): Parameters<StylexNextOutputPostprocessor>[0] {
  const sourceMaps = pairs.map(({ map, mappedOutput }) => Object.freeze({
    map: Object.freeze({ absolutePath: absoluteBelow(root, map.path, "StyleX Next private source map"), artifact: canonicalArtifact(map) }),
    mappedOutput: Object.freeze({ absolutePath: absoluteBelow(root, mappedOutput.path, "StyleX Next mapped output"), artifact: canonicalArtifact(mappedOutput) }),
  }));
  return Object.freeze({ outputDirectory: root, sourceMaps: Object.freeze(sourceMaps) });
}

function capturesByPath(value: readonly CapturedFile[]): ReadonlyMap<string, CapturedFile> {
  return new Map(value.map((item) => [item.artifact.path, item]));
}

function validatePostprocessScope(before: CapturedTree, after: CapturedTree, pairs: readonly StylexNextPrivateSourceMapV1[]): void {
  assert.equal(after.rootMode, before.rootMode, "Private-map postprocessor changed the output-root mode");
  assert.deepEqual(after.directories, before.directories, "Private-map postprocessor changed output directory topology or modes");
  const beforeByPath = capturesByPath(before.files);
  const afterByPath = capturesByPath(after.files);
  const mutable = new Set(pairs.flatMap(({ map, mappedOutput }) => [map.path, mappedOutput.path]));
  for (const path of afterByPath.keys()) assert.ok(beforeByPath.has(path), `Private-map postprocessor created an unexpected output: ${path}`);
  for (const [path, prior] of beforeByPath) {
    const current = afterByPath.get(path);
    if (isPrivateMapPath(path)) {
      assert.ok(mutable.has(path), `Private-map postprocessor reached an undeclared map: ${path}`);
      if (current !== undefined) assert.equal(current.artifact.mode, prior.artifact.mode, `Private-map postprocessor changed private-map mode: ${path}`);
      continue;
    }
    assert.ok(current !== undefined, `Private-map postprocessor removed a public output: ${path}`);
    if (mutable.has(path)) assert.equal(current.artifact.mode, prior.artifact.mode, `Private-map postprocessor changed mapped-output mode: ${path}`);
    else assertArtifactEquals(current.artifact, prior.artifact, `Private-map postprocessor changed an unrelated output: ${path}`);
  }
}

async function writeRecoveryCopy(path: string, bytes: Buffer): Promise<Readonly<{ dev: number; ino: number }>> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const information = await lstat(path);
  assert.ok(information.isFile() && !information.isSymbolicLink(), "StyleX Next mapped-output recovery copy must be ordinary");
  assert.equal(information.nlink, 1, "StyleX Next mapped-output recovery copy must have exactly one hard link");
  assert.equal(await realpath(path), path, "StyleX Next mapped-output recovery copy changed identity");
  assert.equal(permissionMode(information.mode, "StyleX Next mapped-output recovery copy"), 0o600, "StyleX Next mapped-output recovery copy mode changed");
  return Object.freeze({ dev: information.dev, ino: information.ino });
}

async function createRecoveryCopies(
  root: string,
  pairs: readonly StylexNextPrivateSourceMapV1[],
  beforeByPath: ReadonlyMap<string, CapturedFile>,
): Promise<Readonly<{ copies: ReadonlyMap<string, RecoveryCopy>; directory: RecoveryDirectory; paths: readonly string[] }>> {
  const parent = dirname(root);
  assert.equal(await realpath(parent), parent, "StyleX Next recovery parent must not traverse a symlink");
  const directoryPath = await mkdtemp(resolve(parent, `.${basename(root)}.stylex-private-recovery-`));
  const copies = new Map<string, RecoveryCopy>();
  const paths: string[] = [];
  let total = 0;
  try {
    await chmod(directoryPath, 0o700);
    const directoryInformation = await lstat(directoryPath);
    assert.ok(directoryInformation.isDirectory() && !directoryInformation.isSymbolicLink(), "StyleX Next recovery directory must be ordinary");
    assert.equal(await realpath(directoryPath), directoryPath, "StyleX Next recovery directory changed identity");
    assert.equal(permissionMode(directoryInformation.mode, "StyleX Next recovery directory"), 0o700, "StyleX Next recovery directory mode changed");
    for (const [index, pair] of pairs.entries()) {
      const prior = beforeByPath.get(pair.mappedOutput.path);
      assert.ok(prior !== undefined, `Mapped output is missing from recovery baseline: ${pair.mappedOutput.path}`);
      const bytes = await readCapturedBytes(root, prior.artifact, `Mapped output recovery input ${pair.mappedOutput.path}`);
      total += bytes.byteLength;
      assert.ok(total <= STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES, "StyleX Next mapped-output recovery exceeds its total-byte bound");
      const recoveryPath = resolve(directoryPath, `${String(index).padStart(6, "0")}.mapped-output`);
      paths.push(recoveryPath);
      const identity = await writeRecoveryCopy(recoveryPath, bytes);
      copies.set(pair.mappedOutput.path, Object.freeze({ artifact: prior.artifact, ...identity, path: recoveryPath }));
    }
    return Object.freeze({
      copies,
      directory: Object.freeze({ dev: directoryInformation.dev, ino: directoryInformation.ino, path: directoryPath }),
      paths: Object.freeze(paths),
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const path of [...paths].reverse()) {
      try { await unlink(path); }
      catch (cleanupError) { if (errorCode(cleanupError) !== "ENOENT") cleanupErrors.push(cleanupError); }
    }
    try { await rmdir(directoryPath); }
    catch (cleanupError) { if (errorCode(cleanupError) !== "ENOENT") cleanupErrors.push(cleanupError); }
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "StyleX Next recovery-copy creation failed and its exact cleanup was incomplete");
    throw error;
  }
}

async function readRecoveryCopy(copy: RecoveryCopy): Promise<Buffer> {
  const information = await lstat(copy.path);
  assert.ok(information.isFile() && !information.isSymbolicLink(), "StyleX Next mapped-output recovery copy must be ordinary");
  assert.equal(information.nlink, 1, "StyleX Next mapped-output recovery copy must remain single-link");
  assert.equal(await realpath(copy.path), copy.path, "StyleX Next mapped-output recovery copy changed identity");
  assert.ok(information.dev === copy.dev && information.ino === copy.ino, "StyleX Next mapped-output recovery copy path changed identity");
  assert.equal(permissionMode(information.mode, "StyleX Next mapped-output recovery copy"), 0o600, "StyleX Next mapped-output recovery copy mode changed");
  assert.ok(copy.artifact.bytes <= STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES, "StyleX Next mapped-output recovery copy exceeds its byte bound");
  const handle = await open(copy.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assert.ok(sameFileIdentity(before, after), "StyleX Next mapped-output recovery copy changed while read");
    assert.equal(bytes.byteLength, copy.artifact.bytes, "StyleX Next mapped-output recovery copy byte count changed");
    assert.equal(hashBytes(bytes), copy.artifact.sha256, "StyleX Next mapped-output recovery copy hash changed");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function validatePrivateMapInputs(
  pairs: readonly StylexNextPrivateSourceMapV1[],
  recoveryByPath: ReadonlyMap<string, RecoveryCopy>,
): Promise<void> {
  for (const pair of pairs) {
    const recovery = recoveryByPath.get(pair.mappedOutput.path);
    assert.ok(recovery !== undefined, `Mapped output has no recovery copy: ${pair.mappedOutput.path}`);
    stripExactSourceMapReference(await readRecoveryCopy(recovery), pair);
  }
}

async function cleanupRecoveryCopies(recovery: Readonly<{ copies: ReadonlyMap<string, RecoveryCopy>; directory: RecoveryDirectory; paths: readonly string[] }>): Promise<void> {
  const errors: unknown[] = [];
  let directoryIsExact = false;
  try {
    const information = await lstat(recovery.directory.path);
    assert.ok(information.isDirectory() && !information.isSymbolicLink(), "StyleX Next recovery directory must remain ordinary during cleanup");
    assert.ok(information.dev === recovery.directory.dev && information.ino === recovery.directory.ino, "StyleX Next recovery directory changed identity before cleanup");
    assert.equal(await realpath(recovery.directory.path), recovery.directory.path, "StyleX Next recovery directory traverses a symlink during cleanup");
    directoryIsExact = true;
    const expectedNames = recovery.paths.map((path) => basename(path)).sort((left, right) => left.localeCompare(right, "en"));
    const actualNames = (await readdir(recovery.directory.path)).sort((left, right) => left.localeCompare(right, "en"));
    assert.deepEqual(actualNames, expectedNames, "StyleX Next recovery directory contents changed before cleanup");
  } catch (error) {
    errors.push(error);
  }
  const copyByPath = new Map([...recovery.copies.values()].map((copy) => [copy.path, copy]));
  if (directoryIsExact) for (const path of [...recovery.paths].reverse()) {
    try {
      const copy = copyByPath.get(path);
      assert.ok(copy !== undefined, "StyleX Next recovery cleanup path has no exact identity");
      const information = await lstat(path);
      assert.ok(information.isFile() && !information.isSymbolicLink(), "StyleX Next recovery cleanup target must remain an ordinary file");
      assert.equal(information.nlink, 1, "StyleX Next recovery cleanup target must remain single-link");
      assert.ok(information.dev === copy.dev && information.ino === copy.ino, "StyleX Next recovery cleanup target changed identity");
      assert.equal(await realpath(path), path, "StyleX Next recovery cleanup target traverses a symlink");
      await unlink(path);
    } catch (error) { errors.push(error); }
  }
  if (directoryIsExact) {
    try { await rmdir(recovery.directory.path); }
    catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "StyleX Next recovery copies could not be removed exactly");
}

async function cleanupPair(
  root: string,
  pair: StylexNextPrivateSourceMapV1,
  before: CapturedFile,
  after: CapturedFile | undefined,
  recovery: RecoveryCopy,
  restoreMappedOutput: boolean,
): Promise<CapturedFile> {
  let baseBytes: Buffer;
  if (restoreMappedOutput) baseBytes = await readRecoveryCopy(recovery);
  else {
    assert.ok(after !== undefined, `Mapped output disappeared before privacy settlement: ${pair.mappedOutput.path}`);
    baseBytes = await readCapturedBytes(root, after.artifact, `Mapped output settlement input ${pair.mappedOutput.path}`);
  }
  const stripped = stripExactSourceMapReference(baseBytes, pair);
  if (after === undefined) return restoreMissingCapturedFile(root, before.artifact, stripped);
  return replaceCapturedFile(root, after, stripped, restoreMappedOutput ? before.artifact.mode : after.artifact.mode);
}

async function cleanupPrivateMaps(
  root: string,
  pairs: readonly StylexNextPrivateSourceMapV1[],
  beforeByPath: ReadonlyMap<string, CapturedFile>,
  afterByPath: ReadonlyMap<string, CapturedFile>,
  recoveryByPath: ReadonlyMap<string, RecoveryCopy>,
  restoreMappedOutputs: boolean,
): Promise<ReadonlyMap<string, StylexNextOutputArtifactV1>> {
  const errors: unknown[] = [];
  for (const { map } of pairs) {
    try { await removePrivateMap(root, map.path); }
    catch (error) { errors.push(error); }
  }
  const expectedFinal = new Map<string, StylexNextOutputArtifactV1>();
  for (const [path, captured] of beforeByPath) if (!isPrivateMapPath(path)) expectedFinal.set(path, captured.artifact);
  for (const pair of pairs) {
    const before = beforeByPath.get(pair.mappedOutput.path);
    const recovery = recoveryByPath.get(pair.mappedOutput.path);
    if (before === undefined || recovery === undefined) {
      errors.push(new Error(`Verified mapped output disappeared from the settlement baseline: ${pair.mappedOutput.path}`));
      continue;
    }
    try {
      const after = afterByPath.get(pair.mappedOutput.path) ?? await captureFileIfPresent(root, pair.mappedOutput.path);
      const replaced = await cleanupPair(root, pair, before, after, recovery, restoreMappedOutputs);
      assert.equal(replaced.artifact.mode, before.artifact.mode, `Mapped output mode changed during settlement: ${pair.mappedOutput.path}`);
      expectedFinal.set(pair.mappedOutput.path, replaced.artifact);
    } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, "StyleX Next private-map cleanup did not reach a privacy-safe state");
  return expectedFinal;
}

async function assertNoMapReference(root: string, captured: CapturedFile): Promise<void> {
  const extension = outputExtension(captured.artifact.path);
  if (!isTextualOutputPath(captured.artifact.path)) return;
  const bytes = await readCapturedBytes(root, captured.artifact, `Public output ${captured.artifact.path}`);
  const source = bytes.toString("utf8");
  assert.ok(Buffer.from(source, "utf8").equals(bytes), `Public output is not valid UTF-8: ${captured.artifact.path}`);
  assert.equal(sourceMapDirectives(source, extension, captured.artifact.path).length, 0, `Public output retains a sourceMappingURL directive: ${captured.artifact.path}`);
}

function assertTopology(actual: CapturedTree, rootMode: number, expected: readonly StylexNextOutputDirectoryV1[], description: string): void {
  assert.equal(actual.rootMode, rootMode, `${description} root mode changed`);
  assert.deepEqual(actual.directories, expected, `${description} directory topology or modes changed`);
}

async function settledPublicOutputs(
  root: string,
  expectedFinal: ReadonlyMap<string, StylexNextOutputArtifactV1>,
  rootMode: number,
  expectedDirectories: readonly StylexNextOutputDirectoryV1[],
): Promise<readonly StylexNextOutputArtifactV1[]> {
  const captured = await captureTree(root);
  assertTopology(captured, rootMode, expectedDirectories, "StyleX Next public output");
  assert.deepEqual(captured.files.map(({ artifact: item }) => item.path), [...expectedFinal.keys()].sort((left, right) => left.localeCompare(right, "en")), "StyleX Next public output paths changed during private-map settlement");
  for (const item of captured.files) {
    const expected = expectedFinal.get(item.artifact.path);
    assert.ok(expected !== undefined, `StyleX Next public output is unexpected: ${item.artifact.path}`);
    assertArtifactEquals(item.artifact, expected, `StyleX Next public output changed during private-map settlement: ${item.artifact.path}`);
    await assertNoMapReference(root, item);
  }
  assert.ok(captured.files.every(({ artifact: item }) => !isPrivateMapPath(item.path)), "StyleX Next public output retains a source map");
  return Object.freeze(captured.files.map(({ artifact: item }) => item));
}

function settlementRecord(
  privateSourceMaps: readonly StylexNextPrivateSourceMapV1[],
  publicOutputs: readonly StylexNextOutputArtifactV1[],
  publicDirectories: readonly StylexNextOutputDirectoryV1[],
  publicRootMode: number,
  upload: StylexNextOutputSettlementV1["upload"],
): StylexNextOutputSettlementV1 {
  const canonicalPrivate = canonicalPairs(privateSourceMaps);
  const canonicalPublic = Object.freeze(publicOutputs.map(canonicalArtifact));
  const canonicalDirectories = Object.freeze(publicDirectories.map(canonicalDirectory));
  return Object.freeze({
    kind: "hraness-stylex-next-output-settlement",
    privateSourceMaps: canonicalPrivate,
    privateSourceMapsSha256: inventorySha256(canonicalPrivate),
    publicDirectories: canonicalDirectories,
    publicDirectoriesSha256: inventorySha256(canonicalDirectories),
    publicOutputs: canonicalPublic,
    publicOutputsSha256: inventorySha256(canonicalPublic),
    publicRootMode,
    schemaVersion: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION,
    scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
    state: "settled",
    upload,
  });
}

function parseSettlement(value: unknown): StylexNextOutputSettlementV1 {
  const record = object(value, "StyleX Next output settlement");
  exactKeys(record, ["kind", "privateSourceMaps", "privateSourceMapsSha256", "publicDirectories", "publicDirectoriesSha256", "publicOutputs", "publicOutputsSha256", "publicRootMode", "schemaVersion", "scope", "state", "upload"], "StyleX Next output settlement");
  assert.equal(record.kind, "hraness-stylex-next-output-settlement");
  assert.equal(record.schemaVersion, STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION);
  assert.equal(record.scope, STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE);
  assert.equal(record.state, "settled");
  assert.ok(record.upload === "failed" || record.upload === "not-configured" || record.upload === "succeeded", "StyleX Next output settlement upload state is invalid");
  const privateSourceMaps = sourceMapPairs(record.privateSourceMaps, "StyleX Next settlement private source maps");
  const publicDirectories = directories(record.publicDirectories, "StyleX Next settlement public directories");
  const publicOutputs = artifacts(record.publicOutputs, "StyleX Next settlement public outputs");
  const publicRootMode = mode(record.publicRootMode, "StyleX Next settlement public root mode");
  assert.ok(publicOutputs.every(({ path }) => !isPrivateMapPath(path)), "StyleX Next settlement public outputs must exclude maps");
  const publicByPath = new Map(publicOutputs.map((item) => [item.path, item]));
  for (const pair of privateSourceMaps) assert.ok(publicByPath.has(pair.mappedOutput.path), `StyleX Next settlement omitted mapped public output: ${pair.mappedOutput.path}`);
  const canonicalPrivate = canonicalPairs(privateSourceMaps);
  const canonicalPublic = Object.freeze(publicOutputs.map(canonicalArtifact));
  const canonicalDirectories = Object.freeze(publicDirectories.map(canonicalDirectory));
  assert.equal(record.privateSourceMapsSha256, inventorySha256(canonicalPrivate), "StyleX Next private source-map inventory hash is stale");
  assert.equal(record.publicDirectoriesSha256, inventorySha256(canonicalDirectories), "StyleX Next public-directory inventory hash is stale");
  assert.equal(record.publicOutputsSha256, inventorySha256(canonicalPublic), "StyleX Next public-output inventory hash is stale");
  return Object.freeze({
    kind: "hraness-stylex-next-output-settlement",
    privateSourceMaps: canonicalPrivate,
    privateSourceMapsSha256: record.privateSourceMapsSha256,
    publicDirectories: canonicalDirectories,
    publicDirectoriesSha256: record.publicDirectoriesSha256,
    publicOutputs: canonicalPublic,
    publicOutputsSha256: record.publicOutputsSha256,
    publicRootMode,
    schemaVersion: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION,
    scope: STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE,
    state: "settled",
    upload: record.upload,
  });
}

/**
 * Re-read a settled isolated regular-file output stage. Call this immediately
 * before atomically committing a higher-level completion record; neither this
 * function nor the settlement return value is itself a publication barrier.
 */
export async function revalidateStylexNextOutputSettlement(outputDirectory: string, settlement: StylexNextOutputSettlementV1): Promise<StylexNextOutputSettlementV1> {
  const root = await ordinaryOutputRoot(outputDirectory);
  const parsed = parseSettlement(settlement);
  assert.equal(root.mode, parsed.publicRootMode, "StyleX Next settled public output root mode changed");
  const captured = await captureTree(root.path);
  assertTopology(captured, parsed.publicRootMode, parsed.publicDirectories, "StyleX Next settled public output");
  assert.deepEqual(captured.files.map(({ artifact: item }) => item), parsed.publicOutputs, "StyleX Next settled public outputs changed");
  for (const item of captured.files) await assertNoMapReference(root.path, item);
  return parsed;
}

/**
 * Settle an isolated, exact regular-file delivery stage while its caller still
 * holds the output lease. The function records directory topology but treats
 * no state outside outputDirectory as a deliverable. Provider failure is
 * nonfatal only when exact restoration, map removal, and integrity succeed.
 */
export async function settleStylexNextPrivateOutput(options: SettleStylexNextPrivateOutputOptions): Promise<StylexNextOutputSettlementV1> {
  const parsed = parseOptions(options);
  const root = await ordinaryOutputRoot(parsed.outputDirectory);
  const before = await captureTree(root.path);
  assert.equal(before.rootMode, root.mode, "StyleX Next output root changed during baseline capture");
  assert.deepEqual(before.files.map(({ artifact: item }) => item), parsed.outputs, "StyleX Next output tree differs from the verified delivery inventory");
  const beforeByPath = capturesByPath(before.files);
  const recovery = await createRecoveryCopies(root.path, parsed.privateSourceMaps, beforeByPath);
  let failure: unknown;
  let result: StylexNextOutputSettlementV1 | undefined;
  try {
    let upload: StylexNextOutputSettlementV1["upload"] = "not-configured";
    let uploaderFailed = false;
    let inputError: unknown;
    try { await validatePrivateMapInputs(parsed.privateSourceMaps, recovery.copies); }
    catch (error) { inputError = error; }
    if (parsed.upload !== undefined && inputError === undefined) {
      try { await parsed.upload(requestFor(root.path, parsed.privateSourceMaps)); upload = "succeeded"; }
      catch { uploaderFailed = true; upload = "failed"; }
    }

    let after: CapturedTree = Object.freeze({ directories: Object.freeze([]), files: Object.freeze([]), rootMode: root.mode });
    let scopeError: unknown;
    try {
      after = await captureTree(root.path);
      validatePostprocessScope(before, after, parsed.privateSourceMaps);
    } catch {
      scopeError = new Error("StyleX Next private-map postprocessor changed output outside its exact map/mapped-output scope");
    }
    const afterByPath = capturesByPath(after.files);
    let expectedFinal: ReadonlyMap<string, StylexNextOutputArtifactV1>;
    try {
      expectedFinal = await cleanupPrivateMaps(root.path, parsed.privateSourceMaps, beforeByPath, afterByPath, recovery.copies, uploaderFailed || scopeError !== undefined || inputError !== undefined);
    } catch (cleanupError) {
      const causes = [inputError, scopeError, cleanupError].filter((cause) => cause !== undefined);
      throw causes.length === 1
        ? cleanupError
        : new AggregateError(causes, "StyleX Next input or postprocessing failed and privacy cleanup did not reach a privacy-safe state");
    }
    if (inputError !== undefined) throw inputError;
    if (scopeError !== undefined) throw scopeError;

    const publicOutputs = await settledPublicOutputs(root.path, expectedFinal, before.rootMode, before.directories);
    const settlement = settlementRecord(parsed.privateSourceMaps, publicOutputs, before.directories, before.rootMode, upload);
    await parsed.revalidateBeforeReturn?.();
    await revalidateStylexNextOutputSettlement(root.path, settlement);
    result = settlement;
  } catch (error) {
    failure = error;
  }
  try {
    await cleanupRecoveryCopies(recovery);
  } catch (cleanupError) {
    failure = failure === undefined
      ? cleanupError
      : new AggregateError([failure, cleanupError], "StyleX Next settlement failed and its recovery copies could not be removed exactly");
  }
  if (failure !== undefined) throw failure;
  assert.ok(result !== undefined, "StyleX Next output settlement completed without a result");
  return result;
}
