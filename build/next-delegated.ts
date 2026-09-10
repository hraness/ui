import assert from "node:assert/strict";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseSync } from "@babel/core";

import type { StylexArtifactV1 } from "./contracts.js";
import { normalizeLogicalPath } from "./compiler.js";
import { STYLEX_NEXT_REQUIRED_VERSION, stylexNextProfile, type StylexNextVersion } from "./next-profile.js";

const LOADER = "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js" as const;
const MAX_ITEMS = 4096;
const MAX_SOURCE_BYTES = 256 * 1024;
// Unicode-mode matching sees a valid surrogate pair as one non-surrogate code
// point. This rejects only lone surrogates and preserves the ES2023 type target.
const wellFormed = (value: string): boolean => !/[\ud800-\udfff]/u.test(value);
type Import = Readonly<{ request: string; ids: readonly string[] }>;
type Dependency = Readonly<{ id: number; files: readonly string[]; cssFiles: readonly string[] }>;
export type StylexNextDelegatedEntryGraphV1 = Readonly<{
  chunkIds: readonly number[];
  dependencies: readonly Dependency[];
  entryModuleId: number;
  entryOwners: readonly Readonly<{ id: number; files: readonly string[] }>[];
  entrypoints: readonly string[];
  imports: readonly Import[];
  loader: typeof LOADER;
  originalSource: Readonly<{ bytes: number; sha256: string }>;
}>;
export type StylexNextDelegatedEntryBootstrapV1 = Readonly<{
  graph: StylexNextDelegatedEntryGraphV1;
  inputs: readonly StylexArtifactV1[];
  output: StylexArtifactV1;
}>;

function object(value: unknown, names: readonly string[], description: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${description} must be an object`);
  assert.ok([null, Object.prototype].includes(Object.getPrototypeOf(value)), `${description} must be plain data`);
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), `${description} has unexpected keys`);
  return value as Record<string, unknown>;
}
function array(value: unknown, description: string): unknown[] {
  assert.ok(Array.isArray(value) && value.length <= MAX_ITEMS, `${description} must be bounded`);
  for (let index = 0; index < value.length; index += 1) assert.ok(Object.hasOwn(value, index), `${description} must not be sparse`);
  return value;
}
function id(value: unknown): number {
  assert.ok(Number.isSafeInteger(value) && (value as number) >= 0, "Delegated entry requires a numeric webpack ID");
  return value as number;
}
function logical(value: unknown): string {
  assert.ok(typeof value === "string" && wellFormed(value) && value.length > 0 && value.length <= 4096 && !/[?!#\u0000-\u001f\u007f]/u.test(value), "Delegated entry path is invalid");
  return normalizeLogicalPath(value, "Delegated entry logical path");
}
function paths(value: unknown): readonly string[] {
  const result = array(value, "Delegated entry paths").map(logical);
  assert.deepEqual(result, [...new Set(result)].sort(), "Delegated entry paths must be unique and sorted");
  return result;
}
function digest(value: unknown): string {
  assert.ok(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "Delegated entry digest is invalid");
  return value;
}
function sourceBytes(value: unknown): Readonly<{ bytes: number; sha256: string }> {
  const record = object(value, ["bytes", "sha256"], "Delegated entry source bytes");
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) > 0 && (record.bytes as number) <= MAX_SOURCE_BYTES, "Delegated entry source must be nonempty and bounded");
  return { bytes: record.bytes as number, sha256: digest(record.sha256) };
}
function artifact(value: unknown): StylexArtifactV1 {
  const record = object(value, ["bytes", "path", "sha256"], "Delegated entry artifact");
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0);
  return { bytes: record.bytes as number, path: logical(record.path), sha256: digest(record.sha256) };
}
function imports(value: unknown): readonly Import[] {
  let exportCount = 0;
  const result = array(value, "Delegated entry imports").map((value) => {
    const record = object(value, ["ids", "request"], "Delegated entry import");
    const rawIds = array(record.ids, "Delegated entry exports");
    exportCount += rawIds.length;
    assert.ok(exportCount <= 16_384, "Delegated entry total exports exceed their bound");
    const ids = rawIds.map((value) => {
      assert.ok(typeof value === "string" && wellFormed(value) && value.length <= 256 && (value === "*" || /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(value)), "Delegated entry export name is invalid");
      return value;
    });
    assert.equal(new Set(ids).size, ids.length, "Delegated entry exports repeat");
    return { ids, request: logical(record.request) };
  });
  assert.ok(result.length > 0, "Delegated entry imports must be nonempty");
  assert.equal(new Set(result.map(({ request }) => request)).size, result.length, "Delegated entry imports repeat");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_SOURCE_BYTES, "Delegated entry import inventory exceeds its bound");
  return result;
}

/** Recompute source identity again when a persisted proof is settled. Captured
 * original-source hashes cannot independently authorize arbitrary loader code. */
export function stylexNextDelegatedEntrySource(root: string, value: unknown): string {
  assert.ok(isAbsolute(root) && resolve(root) === root, "Delegated entry source root must be canonical");
  const source = imports(value).map(({ ids, request }) => {
    const importPath = JSON.stringify(resolve(root, request));
    return ids.length === 0 || ids.includes("*")
      ? `import(/* webpackMode: "eager" */ ${importPath});\n`
      : `import(/* webpackMode: "eager", webpackExports: ${JSON.stringify(ids)} */ ${importPath});\n`;
  }).join(";\n");
  assert.ok(Buffer.byteLength(source) <= MAX_SOURCE_BYTES);
  return source;
}

/** A delegated owner is ordinary mapped JavaScript, never another mapless
 * exception. Preserve the native map bytes and bind its embedded loader source
 * to the same finite producer grammar used at capture and final settlement. */
export function validateStylexNextDelegatedEntryOwnerMap(
  root: string,
  graphValue: StylexNextDelegatedEntryGraphV1,
  ownerPath: string,
  bytes: Uint8Array,
): void {
  const graph = validateStylexNextDelegatedEntryGraph(graphValue);
  assert.ok(graph.entryOwners.some(({ files }) => files.includes(ownerPath)), "Delegated map must belong to its registered entry owner");
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 64 * 1024 * 1024, "Delegated owner map exceeds its byte bound");
  const text = Buffer.from(bytes).toString("utf8");
  assert.ok(Buffer.from(text).equals(Buffer.from(bytes)), "Delegated owner map must retain exact UTF-8 bytes");
  const value: unknown = JSON.parse(text);
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Delegated owner map must be an object");
  const map = value as Record<string, unknown>;
  assert.equal(map.version, 3, "Delegated owner map must be native source-map version 3");
  assert.equal(map.file, ownerPath, "Delegated owner map names another JavaScript output");
  assert.ok(typeof map.mappings === "string" && map.mappings.length > 0 && /^[A-Za-z0-9+/;,]+$/u.test(map.mappings), "Delegated owner map must contain mapping data");
  assert.ok(Array.isArray(map.sources) && map.sources.length > 0 && map.sources.length <= 100_000 && map.sources.every((source) => typeof source === "string" && wellFormed(source)), "Delegated owner map must retain its native source inventory");
  assert.ok(Array.isArray(map.names) && map.names.length <= 1_000_000 && map.names.every((name) => typeof name === "string" && wellFormed(name)), "Delegated owner map names are invalid");
  assert.ok(Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length && map.sourcesContent.every((source) => source === null || (typeof source === "string" && wellFormed(source))), "Delegated owner map must retain its embedded sources");
  assert.ok(map.sourcesContent.includes(stylexNextDelegatedEntrySource(root, graph.imports)), "Delegated owner map lost the exact eager entry source");
}

/** Decode only the pinned loader's direct module list. Compare its generated
 * source separately, so options cannot hide another loader or execution path. */
export function parseStylexNextDelegatedEntryLoader(value: unknown, root: string): Readonly<{ imports: readonly Import[]; source: string }> {
  assert.ok(typeof value === "string" && wellFormed(value) && Buffer.byteLength(value) <= MAX_SOURCE_BYTES, "Delegated entry loader options must be well-formed and bounded");
  const fields = value.split("&");
  assert.ok(fields.length > 1 && fields.length <= MAX_ITEMS + 1, "Delegated entry loader fields exceed their bound");
  assert.ok(fields.every((field) => /^(?:modules|server)=/u.test(field) && !/%(?![a-f0-9]{2})/iu.test(field)), "Delegated entry loader options are malformed");
  // URLSearchParams substitutes malformed UTF-8; reject it before that parser.
  for (const field of fields) decodeURIComponent(field.replaceAll("+", " "));
  const options = new URLSearchParams(value);
  assert.deepEqual(options.getAll("server"), ["false"], "Delegated entry loader must name server=false exactly once");
  assert.ok([...options.keys()].every((key) => key === "modules" || key === "server"), "Delegated entry loader contains unknown options");
  const absolute = options.getAll("modules").map((encoded) => {
    assert.ok(Buffer.byteLength(encoded) <= 16 * 1024, "Delegated entry import exceeds its byte bound");
    const record = object(JSON.parse(encoded) as unknown, ["ids", "request"], "Delegated entry loader import");
    assert.equal(encoded, JSON.stringify({ request: record.request, ids: record.ids }), "Delegated entry import differs from the pinned creator's canonical JSON");
    assert.ok(typeof record.request === "string" && isAbsolute(record.request), "Delegated entry loader request must be absolute");
    const request = logical(relative(root, record.request).split(sep).join("/"));
    assert.equal(resolve(root, request), record.request, "Delegated entry loader request is not canonical");
    return { ids: record.ids, request };
  });
  const parsed = imports(absolute);
  return { imports: parsed, source: stylexNextDelegatedEntrySource(root, parsed) };
}

export function validateStylexNextDelegatedEntryGraph(value: unknown): StylexNextDelegatedEntryGraphV1 {
  const record = object(value, ["chunkIds", "dependencies", "entryModuleId", "entryOwners", "entrypoints", "imports", "loader", "originalSource"], "Delegated entry graph");
  const chunkIds = array(record.chunkIds, "Delegated entry chunk IDs").map(id);
  assert.ok(chunkIds.length > 0);
  assert.deepEqual(chunkIds, [...new Set(chunkIds)].sort((a, b) => a - b));
  const dependencies = array(record.dependencies, "Delegated entry dependencies").map((value) => {
    const dependency = object(value, ["cssFiles", "files", "id"], "Delegated entry dependency");
    const files = paths(dependency.files);
    const cssFiles = paths(dependency.cssFiles);
    assert.ok(files.every((path) => /\.(?:c|m)?js$/u.test(path)) && cssFiles.every((path) => path.endsWith(".css")));
    assert.ok(files.length + cssFiles.length > 0 && files.length + cssFiles.length <= MAX_ITEMS);
    const dependencyId = id(dependency.id);
    assert.ok(!chunkIds.includes(dependencyId), "Delegated entry cannot depend on itself");
    return { cssFiles, files, id: dependencyId };
  });
  assert.equal(new Set(dependencies.map(({ id }) => id)).size, dependencies.length);
  const entryOwners = array(record.entryOwners, "Delegated entry owners").map((value) => {
    const owner = object(value, ["files", "id"], "Delegated entry owner");
    const ownerId = id(owner.id);
    const files = paths(owner.files);
    const dependency = dependencies.find(({ id }) => id === ownerId);
    assert.ok(dependency !== undefined && files.length > 0, "Delegated entry owner must be a JavaScript startup dependency");
    assert.deepEqual(files, dependency.files, "Delegated entry owner files differ from startup dependency");
    return { files, id: ownerId };
  });
  assert.ok(entryOwners.length > 0);
  assert.deepEqual(entryOwners.map(({ id }) => id), [...new Set(entryOwners.map(({ id }) => id))].sort((a, b) => a - b));
  const entrypoints = paths(record.entrypoints);
  assert.ok(entrypoints.length > 0);
  assert.equal(record.loader, LOADER);
  return { chunkIds, dependencies, entryModuleId: id(record.entryModuleId), entryOwners, entrypoints, imports: imports(record.imports), loader: LOADER, originalSource: sourceBytes(record.originalSource) };
}

export function validateStylexNextDelegatedEntryBootstrap(value: unknown, nextVersion: StylexNextVersion = STYLEX_NEXT_REQUIRED_VERSION): StylexNextDelegatedEntryBootstrapV1 {
  const record = object(value, ["graph", "inputs", "output"], "Delegated entry bootstrap");
  const inputs = array(record.inputs, "Delegated entry creators").map(artifact);
  assert.deepEqual(inputs.map(({ path, sha256 }) => [path, sha256]), stylexNextProfile(nextVersion).emptyEntryInputs.map(([path, hash]) => [`node_modules/next/${path}`, hash]), "Delegated entry creators differ from pinned Next bytes");
  const output = artifact(record.output);
  assert.ok(output.bytes > 0 && output.bytes <= MAX_SOURCE_BYTES && /\.(?:c|m)?js$/u.test(output.path));
  return { graph: validateStylexNextDelegatedEntryGraph(record.graph), inputs, output };
}

/** Match only webpack's module-free startup grammar; never execute its source. */
export function validateStylexNextDelegatedEntryPayload(graphValue: unknown, source: string): void {
  const graph = validateStylexNextDelegatedEntryGraph(graphValue);
  assert.ok(Buffer.byteLength(source) <= MAX_SOURCE_BYTES, "Delegated entry payload exceeds its bound");
  const parse = (text: string) => {
    const parsed = parseSync(text, { babelrc: false, configFile: false, sourceType: "script" });
    assert.ok(parsed !== null);
    assert.ok(!(parsed.comments ?? []).some((comment) => /sourceMappingURL\s*=/u.test(comment.value)), "Delegated entry cannot invent a source map");
    return parsed.program;
  };
  const actual = parse(source);
  const expression = actual.body[0];
  assert.ok(actual.body.length === 1 && expression?.type === "ExpressionStatement" && expression.expression.type === "CallExpression");
  const payload = expression.expression.arguments[0];
  assert.ok(payload?.type === "ArrayExpression" && payload.elements.length === 3);
  const runtime = payload.elements[2];
  assert.ok(runtime?.type === "ArrowFunctionExpression" && runtime.params.length === 1);
  const parameter = runtime.params[0];
  assert.ok(parameter?.type === "Identifier" && /^[A-Za-z_$][\w$]*$/u.test(parameter.name) && !["self", "_N_E"].includes(parameter.name));
  const name = parameter.name;
  const expected = parse(`(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([${JSON.stringify(graph.chunkIds)},{},${name}=>{${name}.O(0,${JSON.stringify(graph.dependencies.map(({ id }) => id))},()=>${name}(${name}.s=${String(graph.entryModuleId)})),_N_E=${name}.O()}]);`);
  let nodes = 0;
  const syntax = (value: unknown, depth = 0): unknown => {
    assert.ok(++nodes < 100_000 && depth < 128, "Delegated entry syntax exceeds its bound");
    if (Array.isArray(value)) return value.map((item) => syntax(item, depth + 1));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["start", "end", "loc", "extra", "leadingComments", "innerComments", "trailingComments"].includes(key)).map(([key, item]) => [key, syntax(item, depth + 1)]));
  };
  assert.deepEqual(syntax(actual), syntax(expected), "Delegated entry payload differs from the exact startup grammar");
}
