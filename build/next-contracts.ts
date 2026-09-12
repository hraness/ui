import assert from "node:assert/strict";
import { isAbsolute, posix, resolve } from "node:path";
import { parseSync } from "@babel/core";

import type {
  StylexArtifactV1,
  StylexPackageIdentityV1,
  StylexRuleV1,
} from "./contracts.js";
import {
  canonicalJson,
  canonicalizeStylexRules,
  compilerSha256,
  normalizeLogicalPath,
  parseStylexRules,
  sha256,
  stylexRulesSha256,
  stylexUnionPolicySha256,
  validateStylexSourceMapPath,
} from "./compiler.js";

import { STYLEX_NEXT_BUILTIN_GLOBAL_ERROR_ENTRY, STYLEX_NEXT_REQUIRED_VERSION, STYLEX_NEXT_FRAMEWORK_INPUTS, stylexNextProfile, stylexNextVersion, type StylexNextVersion } from "./next-profile.js";
import { validateStylexNextDelegatedEntryBootstrap, type StylexNextDelegatedEntryBootstrapV1 } from "./next-delegated.js";
export { STYLEX_NEXT_REQUIRED_VERSION, STYLEX_NEXT_FRAMEWORK_INPUTS, STYLEX_NEXT_AUXILIARY_TRACE_CREATOR, STYLEX_NEXT_PROXY_RENAME_CREATOR, STYLEX_NEXT_EMPTY_ENTRY_INPUTS, STYLEX_NEXT_SSG_INPUTS } from "./next-profile.js";

export const STYLEX_NEXT_ADAPTER_VERSION = "hraness-stylex-next-v3" as const;
export const STYLEX_NEXT_MODULE_SCHEMA_VERSION = 1 as const;
export const STYLEX_NEXT_GRAPH_SCHEMA_VERSION = 1 as const;
export const STYLEX_NEXT_BUILD_SCHEMA_VERSION = 2 as const;
export const STYLEX_NEXT_TARGETS = ["client", "edge-rsc", "node-rsc"] as const;

/** Match Array<string>.sort() in canonical receipts, without locale collation. */
export function compareStylexNextStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type StylexNextMode = "delivery" | "development" | "discovery";
export type StylexNextProductionMode = Exclude<StylexNextMode, "development">;
export type StylexNextTarget = (typeof STYLEX_NEXT_TARGETS)[number];

const STYLEX_NEXT_UNDERSCORE_PAGE_ENTRIES = new Set([
  "app/_global-error/page",
  "app/_not-found/page",
]);

function appEntryDirectory(name: string, convention: string): string {
  return name.slice(0, -(convention.length + 1));
}

function isDirectoryAncestor(ancestor: string, descendant: string): boolean {
  return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

/**
 * Derive the physical App Router modules that may own the generated stylesheet.
 * Next 16.2.12 exposes these entries only after its server compiler has injected
 * the client graph, so this intentionally operates on the resolved entry names.
 */
export function stylexNextDeliveryCssOwnerNames(value: readonly string[]): readonly string[] {
  assert.ok(Array.isArray(value) && value.length > 0 && value.length <= 4096, "Next client entry names must be a nonempty bounded array");
  const names = value.map((name, index) => normalizeLogicalPath(name, `Next client entry names[${String(index)}]`));
  assert.equal(new Set(names).size, names.length, "Next client entry names must be unique");
  assert.ok(!names.some((name) => name === "pages" || name.startsWith("pages/")), "StyleX Next delivery does not support Pages Router client entries");
  assert.ok(
    !names.some((name) => name.split("/").includes("global-not-found")),
    "StyleX Next delivery does not yet support the global-not-found convention",
  );
  const globalErrors = names.filter((name) => name.split("/").includes("global-error"));
  assert.ok(
    globalErrors.every((name) => name === "app/global-error" || name === STYLEX_NEXT_BUILTIN_GLOBAL_ERROR_ENTRY),
    "StyleX Next delivery supports only the physical root app/global-error convention",
  );
  // The exact framework fallback is not a physical application CSS owner.
  // Graph publication and settlement verify its selected-profile creator bytes.
  const layouts = names.filter((name) => name === "app/layout" || (name.startsWith("app/") && name.endsWith("/layout")));
  assert.ok(layouts.length > 0, "StyleX Next delivery requires at least one physical App Router root layout entry");
  const roots = layouts.filter((layout) => {
    const directory = appEntryDirectory(layout, "layout");
    return !layouts.some((candidate) => {
      if (candidate === layout) return false;
      return isDirectoryAncestor(appEntryDirectory(candidate, "layout"), directory);
    });
  });
  for (const layout of roots) {
    const segments = appEntryDirectory(layout, "layout").split("/").slice(1);
    assert.ok(
      !segments.some((segment) => segment.startsWith("@") || /^\(\.{1,3}\)/u.test(segment)),
      `StyleX Next delivery cannot infer a root layout through a parallel or intercepting route: ${layout}`,
    );
  }
  const rootDirectories = roots.map((name) => appEntryDirectory(name, "layout"));
  for (const page of names.filter((name) => (name === "app/page" || (name.startsWith("app/") && name.endsWith("/page"))) && !STYLEX_NEXT_UNDERSCORE_PAGE_ENTRIES.has(name))) {
    const directory = appEntryDirectory(page, "page");
    assert.ok(
      rootDirectories.some((root) => isDirectoryAncestor(root, directory)),
      `Next App Router page has no unambiguous physical root layout owner: ${page}`,
    );
  }
  return [...roots, ...(names.includes("app/global-error") ? ["app/global-error"] : [])]
    .sort(compareStylexNextStrings);
}

function stylexNextEntryImports(value: unknown, description: string): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    assert.ok(value.every((entry) => typeof entry === "string"), `${description} array must contain only strings`);
    return value;
  }
  const record = object(value, description);
  assert.ok(Object.hasOwn(record, "import"), `${description} object must expose an import field`);
  return stylexNextEntryImports(record.import, `${description}.import`);
}

function appendStylexNextEntryImport(value: unknown, generatedEntry: string, description: string): unknown {
  if (typeof value === "string") return [value, generatedEntry];
  if (Array.isArray(value)) return [...value, generatedEntry];
  const record = object(value, description);
  return { ...record, import: appendStylexNextEntryImport(record.import, generatedEntry, `${description}.import`) };
}

/** Apply the settled owner plan to a resolved webpack entry map without
 * exposing an additional public export from the packaged Next adapter. */
export function stylexNextDeliveryEntries(value: unknown, generatedEntry: string): Readonly<Record<string, unknown>> {
  assert.ok(isAbsolute(generatedEntry) && resolve(generatedEntry) === generatedEntry, "Next generated StyleX delivery entry must be an exact absolute path");
  const record = object(value, "Next webpack entry map");
  const owners = new Set(stylexNextDeliveryCssOwnerNames(Object.keys(record)));
  const output: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(record)) {
    const description = `Next webpack entry ${name}`;
    assert.ok(!stylexNextEntryImports(entry, description).includes(generatedEntry), `${description} already references the generated StyleX delivery entry`);
    output[name] = owners.has(name) ? appendStylexNextEntryImport(entry, generatedEntry, description) : entry;
  }
  assert.ok(Object.keys(output).length > 0, "Next webpack entry map must be nonempty");
  return output;
}

export type StylexNextGraphMapV1 = Readonly<{
  client: string;
  edgeRsc: string;
  nodeRsc: string;
}>;

export const defaultStylexNextGraphMap: StylexNextGraphMapV1 = {
  client: "client",
  edgeRsc: "edge-rsc",
  nodeRsc: "node-rsc",
};

export type StylexNextWebpackContext = Readonly<{
  dev: boolean;
  isServer: boolean;
  nextRuntime?: "edge" | "nodejs";
}>;

export type StylexNextBytesV1 = Readonly<{
  bytes: number;
  sha256: string;
}>;

export type StylexNextMapReceiptV1 = Readonly<{
  inputSha256: null | string;
  logicalSourceFileName: string;
  output: StylexNextBytesV1;
  sources: readonly string[];
}>;

export type StylexNextModuleReceiptV1 = Readonly<{
  adapterVersion: typeof STYLEX_NEXT_ADAPTER_VERSION;
  attemptId: string;
  compilerSha256: string;
  graphId: string;
  input: StylexArtifactV1;
  kind: "hraness-stylex-next-module";
  mode: StylexNextMode;
  output: StylexNextBytesV1;
  rules: readonly StylexRuleV1[];
  rulesSha256: string;
  schemaVersion: typeof STYLEX_NEXT_MODULE_SCHEMA_VERSION;
  sourceMap: StylexNextMapReceiptV1;
  target: StylexNextTarget;
}>;

export type StylexNextModuleIdentityV1 = Readonly<{
  path: string;
  receiptSha256: string;
}>;

export type StylexNextEntrypointV1 = Readonly<{
  css: readonly string[];
  files: readonly string[];
  javascript: readonly string[];
  name: string;
  stylexCss: readonly string[];
}>;

// These are the audited Next 16.2.12 emitters, not filename-only exemptions.
// Their payloads must also satisfy validateStylexNextFrameworkPayload, and an
// emitted webpack chunk can never use this exception.

export type StylexNextFrameworkRole = keyof typeof STYLEX_NEXT_FRAMEWORK_INPUTS;
export type StylexNextFrameworkAssetV1 = Readonly<{
  input: StylexArtifactV1;
  output: StylexArtifactV1;
  role: StylexNextFrameworkRole;
}>;


// The pinned post-build writer renames only the Node proxy JS and NFT files.

export type StylexNextProxyRenameV1 = Readonly<{
  absent: readonly ["server/proxy.js", "server/proxy.js.nft.json"];
  creator: StylexArtifactV1;
  initial: StylexArtifactV1;
  output: StylexArtifactV1;
  sourceMap: StylexArtifactV1;
}>;

/** Framework dependency metadata, never a dependency-selection authorization. */
export type StylexNextAuxiliaryTraceAssetV1 = Readonly<{
  creator: StylexArtifactV1;
  entrypoint: string;
  initial: StylexArtifactV1;
  kind: "next-node-dependency-trace";
}>;

/** Observed bytes only: no closure, dependency safety, copying or deployment proof. */
export type StylexNextAuxiliaryTraceSnapshotV1 = Readonly<{
  asset: StylexNextAuxiliaryTraceAssetV1;
  output: StylexArtifactV1;
  proxyRename?: StylexNextProxyRenameV1;
  semantics: "observation-only";
}>;

// An empty client-entry loader has no original characters to map. Pin every
// creator in its webpack/minifier chain; this is separate from manifest assets.
export const STYLEX_NEXT_EMPTY_ENTRY_LOADER = "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js" as const;
export type StylexNextEmptyEntryGraphV1 = Readonly<{
  chunkIds: readonly number[];
  dependencies: readonly Readonly<{ cssFiles: readonly string[]; files: readonly string[]; id: number }>[];
  entryModuleId: number;
  entrypoints: readonly string[];
  loader: typeof STYLEX_NEXT_EMPTY_ENTRY_LOADER;
  loaderOptions: "server=false";
  originalSource: StylexNextBytesV1;
}>;
export type StylexNextEmptyEntryBootstrapV1 = Readonly<{
  graph: StylexNextEmptyEntryGraphV1;
  inputs: readonly StylexArtifactV1[];
  output: StylexArtifactV1;
}>;

function webpackId(value: unknown): number {
  assert.ok(Number.isSafeInteger(value) && (value as number) >= 0, "Next empty entry requires numeric webpack IDs");
  return value as number;
}

export function validateStylexNextEmptyEntryGraph(value: unknown): StylexNextEmptyEntryGraphV1 {
  const record = object(value, "Next empty entry graph");
  keys(record, ["chunkIds", "dependencies", "entryModuleId", "entrypoints", "loader", "loaderOptions", "originalSource"], "Next empty entry graph");
  assert.ok(
    Array.isArray(record.chunkIds) && record.chunkIds.length > 0 && record.chunkIds.length <= 4096,
    "Next empty entry chunk IDs must be a non-empty array bounded to 4096 chunks",
  );
  const chunkIds = record.chunkIds.map(webpackId);
  assert.deepEqual(chunkIds, [...new Set(chunkIds)].sort((a, b) => a - b), "Next empty entry chunk IDs must be unique and sorted");
  assert.ok(
    Array.isArray(record.dependencies) && record.dependencies.length <= 4096,
    "Next empty entry dependencies must be an array bounded to 4096 startup chunks",
  );
  const dependencies = record.dependencies.map((value) => {
    const dependency = object(value, "Next empty entry dependency");
    keys(dependency, ["cssFiles", "files", "id"], "Next empty entry dependency");
    const id = webpackId(dependency.id);
    assert.ok(!chunkIds.includes(id), "Next empty entry cannot depend on itself");
    const files = strings(dependency.files, "Next empty entry dependency files").map((path) => normalizeLogicalPath(path, "Next empty entry dependency file"));
    const cssFiles = strings(dependency.cssFiles, "Next empty entry dependency CSS files").map((path) => normalizeLogicalPath(path, "Next empty entry dependency CSS file"));
    assert.ok(files.every((path) => /\.(?:c|m)?js$/u.test(path)), "Next empty entry JavaScript dependencies must name JavaScript files");
    assert.ok(cssFiles.every((path) => path.endsWith(".css")), "Next empty entry CSS dependencies must name CSS files");
    assert.ok(files.length + cssFiles.length > 0 && files.length + cssFiles.length <= 4096, "Next empty entry dependency must have a bounded nonempty output inventory");
    return { cssFiles, files, id };
  });
  assert.equal(new Set(dependencies.map(({ id }) => id)).size, dependencies.length, "Next empty entry dependencies must be unique");
  const entrypoints = strings(record.entrypoints, "Next empty entry entrypoints");
  assert.ok(entrypoints.length > 0, "Next empty entry must belong to a real entrypoint");
  assert.equal(record.loader, STYLEX_NEXT_EMPTY_ENTRY_LOADER, "Next empty entry loader is not the pinned creator");
  assert.equal(record.loaderOptions, "server=false", "Next empty entry loader options must contain no imports");
  const originalSource = bytes(record.originalSource, "Next empty entry original source");
  assert.deepEqual(originalSource, { bytes: 0, sha256: sha256("") }, "Next empty entry original source must be exactly empty");
  return { chunkIds, dependencies, entryModuleId: webpackId(record.entryModuleId), entrypoints, loader: STYLEX_NEXT_EMPTY_ENTRY_LOADER, loaderOptions: "server=false", originalSource };
}

export function validateStylexNextEmptyEntryBootstrap(value: unknown, nextVersion: StylexNextVersion = STYLEX_NEXT_REQUIRED_VERSION): StylexNextEmptyEntryBootstrapV1 {
  const record = object(value, "Next empty entry bootstrap");
  keys(record, ["graph", "inputs", "output"], "Next empty entry bootstrap");
  const inputs = artifacts(record.inputs, "Next empty entry inputs");
  assert.deepEqual(inputs.map(({ path, sha256 }) => [path, sha256]), stylexNextProfile(nextVersion).emptyEntryInputs.map(([path, hash]) => [`node_modules/next/${path}`, hash]), "Next empty entry creator inputs differ from pinned Next bytes");
  return { graph: validateStylexNextEmptyEntryGraph(record.graph), inputs, output: artifact(record.output, "Next empty entry output") };
}

/** Compare AST structure with one bounded grammar, never evaluate chunk code.
 * Only the minifier's local runtime parameter name may vary. */
export function validateStylexNextEmptyEntryPayload(graphValue: unknown, source: string): void {
  const graph = validateStylexNextEmptyEntryGraph(graphValue);
  assert.ok(Buffer.byteLength(source) <= 256 * 1024, "Next empty entry payload exceeds its byte bound");
  const parse = (text: string) => {
    const parsed = parseSync(text, { babelrc: false, configFile: false, sourceType: "script" });
    assert.ok(parsed !== null);
    assert.ok(!(parsed.comments ?? []).some((comment) => /sourceMappingURL\s*=/u.test(comment.value)), "Next empty entry cannot claim an invented map");
    return dataNode(parsed.program);
  };
  const actual = parse(source);
  assert.ok(Array.isArray(actual.body) && actual.body.length === 1);
  const call = dataNode(dataNode(actual.body[0]).expression);
  assert.ok(call.type === "CallExpression" && Array.isArray(call.arguments) && call.arguments.length === 1);
  const payload = dataNode(call.arguments[0]);
  assert.ok(payload.type === "ArrayExpression" && Array.isArray(payload.elements) && payload.elements.length === 3);
  const runtime = dataNode(payload.elements[2]);
  assert.ok(runtime.type === "ArrowFunctionExpression" && Array.isArray(runtime.params) && runtime.params.length === 1);
  const parameter = dataNode(runtime.params[0]);
  assert.ok(parameter.type === "Identifier" && typeof parameter.name === "string" && /^[A-Za-z_$][\w$]*$/u.test(parameter.name) && !["self", "_N_E"].includes(parameter.name), "Next empty entry runtime parameter is invalid");
  const name = parameter.name;
  const expected = parse(`(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([${JSON.stringify(graph.chunkIds)},{${String(graph.entryModuleId)}:()=>{}},${name}=>{${name}.O(0,${JSON.stringify(graph.dependencies.map(({ id }) => id))},()=>${name}(${name}.s=${String(graph.entryModuleId)})),_N_E=${name}.O()}]);`);
  let nodes = 0;
  const syntax = (value: unknown, depth = 0): unknown => {
    assert.ok(++nodes < 100_000 && depth < 128, "Next empty entry syntax exceeds its bound");
    if (Array.isArray(value)) return value.map((item) => syntax(item, depth + 1));
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["start", "end", "loc", "extra", "leadingComments", "innerComments", "trailingComments"].includes(key)).map(([key, item]) => [key, syntax(item, depth + 1)]));
  };
  assert.deepEqual(syntax(actual), syntax(expected), "Next empty entry payload is not the exact proven empty bootstrap");
}

/** Next 16.2.12 normalizePagePath and strict isDynamicRoute semantics, including
 * interception normalization. Keep parity tests against the pinned package. */
export function normalizeStylexNextManifestPagePath(page: string): string {
  assert.ok(page.startsWith("/") && !page.includes("\\") && !page.includes("\0"), "Next manifest page path is invalid");
  let dynamicPath = page;
  const markers = ["(..)(..)", "(.)", "(..)", "(...)"] as const;
  const marked = page.split("/").find((segment) => markers.some((marker) => segment.startsWith(marker)));
  if (/^\/index(\/|$)/u.test(page) && marked !== undefined) {
    const marker = markers.find((marker) => marked.startsWith(marker))!;
    const [rawParent, tail] = page.split(marker, 2);
    assert.ok(rawParent && tail, "Next manifest interception route is invalid");
    const parts = rawParent.split("/");
    const parent = parts.filter((part, index) => part && !(part.startsWith("(") && part.endsWith(")")) && !part.startsWith("@") && !(["page", "route"].includes(part) && index === parts.length - 1)).join("/");
    const normalizedParent = `/${parent}`;
    if (marker === "(.)") dynamicPath = normalizedParent === "/" ? `/${tail}` : `${normalizedParent}/${tail}`;
    else if (marker === "(...)") dynamicPath = `/${tail}`;
    else {
      const remove = marker === "(..)" ? 1 : 2;
      assert.ok(normalizedParent !== "/" && normalizedParent.split("/").length > remove, "Next manifest interception route climbs above root");
      dynamicPath = normalizedParent.split("/").slice(0, -remove).concat(tail).join("/");
    }
  }
  const dynamic = /\/\[[^/]+\](?=\/|$)/u.test(dynamicPath);
  const normalized = /^\/index(\/|$)/u.test(page) && !dynamic ? `/index${page}` : page === "/" ? "/index" : page;
  assert.equal(posix.normalize(normalized), normalized, "Next manifest page path is not normalized");
  return normalized;
}

export function stylexNextFrameworkRole(path: string, target: StylexNextTarget): StylexNextFrameworkRole | undefined {
  normalizeLogicalPath(path, "Next framework output");
  if (target === "client") {
    if (/^static\/[^/]+\/_buildManifest\.js$/u.test(path)) return "build-manifest";
    if (/^static\/[^/]+\/_ssgManifest\.js$/u.test(path)) return "ssg-manifest";
    if (/^static\/chunks\/polyfills-[a-f0-9]+\.js$/u.test(path)) return "polyfill-nomodule";
    if (/^server\/app\/.+_client-reference-manifest\.js$/u.test(path)) return "client-reference-manifest";
    if (path === "server/middleware-build-manifest.js") return "middleware-build-manifest";
    if (path === "server/middleware-react-loadable-manifest.js") return "react-loadable-manifest";
    if (path === "server/dynamic-css-manifest.js") return "dynamic-css-manifest";
    if (path === "server/next-font-manifest.js") return "next-font-manifest";
  } else {
    if (path === "server/server-reference-manifest.js") return "server-reference-manifest";
    if (target === "edge-rsc" && path === "server/interception-route-rewrite-manifest.js") return "interception-rewrite-manifest";
  }
  return undefined;
}

type DataNode = Record<string, unknown>;
function dataNode(value: unknown): DataNode {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Next framework syntax must be an AST node");
  return value as DataNode;
}
function identifier(value: unknown, name: string): boolean {
  const node = dataNode(value);
  return node.type === "Identifier" && node.name === name;
}
function member(value: unknown, base: string, name: string): boolean {
  const node = dataNode(value);
  return node.type === "MemberExpression" && node.computed === false && identifier(node.object, base) && identifier(node.property, name);
}
function safeKey(value: unknown): string {
  const node = dataNode(value);
  const key = node.type === "Identifier" ? node.name : node.type === "StringLiteral" || node.type === "NumericLiteral" ? String(node.value) : undefined;
  assert.ok(typeof key === "string" && !["__proto__", "prototype", "constructor"].includes(key), "Next framework data contains an unsafe property");
  return key;
}

/** Interpret only JSON-like data and devalue's local parameter initialization.
 * This never evaluates JavaScript, performs global reads, or calls payload code. */
function manifestData(root: unknown, allowPinnedBuildManifestNaN = false): unknown {
  let nodes = 0;
  let allocated = 0;
  const allocate = (count: number): void => {
    allocated += count;
    assert.ok(allocated <= 200_000, "Next framework data exceeds its allocation bound");
  };
  const read = (value: unknown, bindings: Map<string, unknown>, depth = 0): unknown => {
    assert.ok(++nodes <= 200_000 && depth <= 128, "Next framework data exceeds its syntax bound");
    const node = dataNode(value);
    if (node.type === "StringLiteral" || node.type === "BooleanLiteral") return node.value;
    if (node.type === "NumericLiteral") { assert.ok(typeof node.value === "number" && Number.isFinite(node.value)); return node.value; }
    if (node.type === "NullLiteral") return null;
    if (node.type === "Identifier") {
      assert.ok(typeof node.name === "string");
      if (bindings.has(node.name)) return bindings.get(node.name);
      // Next 16.2.12's empty BloomFilter computes numHashes as NaN, and its
      // pinned devalue emitter writes that primitive as the identifier `NaN`.
      // Interpret the token locally only for the build manifest; the validated
      // result below further confines it to an exact empty router-filter shape.
      assert.ok(allowPinnedBuildManifestNaN && node.name === "NaN", "Next framework data reads an external identifier");
      return Number.NaN;
    }
    if (node.type === "UnaryExpression") {
      const argument = read(node.argument, bindings, depth + 1);
      if (node.operator === "void") { assert.equal(argument, 0); return undefined; }
      if (node.operator === "!") { assert.ok(argument === 0 || argument === 1); return !argument; }
      assert.ok(node.operator === "-" && typeof argument === "number", "Next framework data contains an unsupported unary operator");
      return -argument;
    }
    if (node.type === "ArrayExpression") {
      assert.ok(Array.isArray(node.elements));
      allocate(node.elements.length);
      return node.elements.map((item) => item === null ? undefined : read(item, bindings, depth + 1));
    }
    if (node.type === "ObjectExpression") {
      assert.ok(Array.isArray(node.properties));
      allocate(node.properties.length);
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const value of node.properties) {
        const property = dataNode(value);
        assert.ok(property.type === "ObjectProperty" && property.computed === false && property.method !== true, "Next framework data requires ordinary properties");
        const key = safeKey(property.key);
        assert.ok(!Object.hasOwn(output, key), "Next framework data duplicates a property");
        output[key] = read(property.value, bindings, depth + 1);
      }
      return output;
    }
    if (node.type === "SequenceExpression") {
      assert.ok(Array.isArray(node.expressions) && node.expressions.length > 0);
      let result: unknown;
      for (const entry of node.expressions) result = read(entry, bindings, depth + 1);
      return result;
    }
    if (node.type === "AssignmentExpression") {
      assert.equal(node.operator, "=");
      const left = dataNode(node.left);
      assert.equal(left.type, "MemberExpression");
      const owner = dataNode(left.object);
      assert.ok(owner.type === "Identifier" && typeof owner.name === "string" && bindings.has(owner.name), "Next framework data assignment leaves its local parameters");
      const container = bindings.get(owner.name);
      assert.ok(typeof container === "object" && container !== null, "Next framework data writes a non-container");
      assert.ok(left.computed === false || ["StringLiteral", "NumericLiteral"].includes(String(dataNode(left.property).type)), "Next framework data has a dynamic property");
      const key = safeKey(left.property);
      if (Array.isArray(container)) assert.ok(/^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) < container.length, "Next framework data writes outside an array");
      const result = read(node.right, bindings, depth + 1);
      (container as Record<string, unknown>)[key] = result;
      return result;
    }
    if (node.type === "CallExpression") {
      assert.ok(Array.isArray(node.arguments));
      if (identifier(node.callee, "Array")) {
        assert.equal(node.arguments.length, 1);
        const length = read(node.arguments[0], bindings, depth + 1);
        assert.ok(Number.isSafeInteger(length) && (length as number) >= 0 && (length as number) <= 200_000, "Next framework data array exceeds its bound");
        allocate(length as number);
        return Array.from({ length: length as number }, () => undefined);
      }
      const callee = dataNode(node.callee);
      assert.ok((callee.type === "FunctionExpression" || callee.type === "ArrowFunctionExpression") && callee.async === false && callee.generator !== true && (callee.id === null || callee.id === undefined), "Next framework data cannot call external code");
      assert.ok(Array.isArray(callee.params) && callee.params.length === node.arguments.length);
      const local = new Map<string, unknown>();
      for (const [index, raw] of callee.params.entries()) {
        const parameter = dataNode(raw);
        assert.ok(parameter.type === "Identifier" && typeof parameter.name === "string" && !local.has(parameter.name) && !["Array", "Set", "self", "globalThis"].includes(parameter.name), "Next framework data has invalid local parameters");
        local.set(parameter.name, read(node.arguments[index], bindings, depth + 1));
      }
      const body = dataNode(callee.body);
      if (body.type !== "BlockStatement") return read(body, local, depth + 1);
      assert.ok(Array.isArray(body.body) && body.body.length > 0 && Array.isArray(body.directives) && body.directives.length === 0);
      for (const [index, raw] of body.body.entries()) {
        const statement = dataNode(raw);
        if (index === body.body.length - 1) { assert.equal(statement.type, "ReturnStatement"); return read(statement.argument, local, depth + 1); }
        assert.equal(statement.type, "ExpressionStatement");
        read(statement.expression, local, depth + 1);
      }
    }
    assert.fail(`Next framework data contains executable or unsupported syntax: ${String(node.type)}`);
  };
  const result = read(root, new Map());
  const seen = new Set<object>();
  const check = (value: unknown, depth = 0): void => {
    assert.ok(++nodes <= 400_000 && depth <= 128, "Next framework data exceeds its value bound");
    if (typeof value !== "object" || value === null) return;
    assert.ok(!seen.has(value), "Next framework data contains a cycle");
    seen.add(value);
    for (const item of Object.values(value)) check(item, depth + 1);
    seen.delete(value);
  };
  check(result);
  return result;
}

function validateBuildManifestNonFiniteData(value: unknown): void {
  const manifest = object(value, "Next build manifest data");
  const nonFinitePaths: string[][] = [];
  const visit = (current: unknown, path: readonly string[]): void => {
    if (typeof current === "number" && !Number.isFinite(current)) {
      nonFinitePaths.push([...path]);
      return;
    }
    if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) visit(item, [...path, String(index)]);
      return;
    }
    if (typeof current === "object" && current !== null) {
      for (const [key, item] of Object.entries(current)) visit(item, [...path, key]);
    }
  };
  visit(manifest, []);
  for (const path of nonFinitePaths) {
    assert.ok(
      path.length === 2
        && ["__routerFilterStatic", "__routerFilterDynamic"].includes(path[0] ?? "")
        && path[1] === "numHashes",
      "Next build manifest contains a non-finite value outside an empty router filter",
    );
    const filter = object(manifest[path[0]!], "Next build manifest router filter");
    keys(filter, ["bitArray", "errorRate", "numBits", "numHashes", "numItems"], "Next build manifest router filter");
    assert.ok(typeof filter.errorRate === "number" && Number.isFinite(filter.errorRate)
      && filter.errorRate > 0 && filter.errorRate < 1, "Next empty router filter error rate is invalid");
    assert.equal(filter.numItems, 0, "Next empty router filter item count changed");
    assert.equal(filter.numBits, 0, "Next empty router filter bit count changed");
    assert.ok(Number.isNaN(filter.numHashes), "Next empty router filter hash count is not NaN");
    assert.deepEqual(filter.bitArray, [], "Next empty router filter bit array is not empty");
  }
}

export function validateStylexNextFrameworkPayload(role: StylexNextFrameworkRole, path: string, source: string): void {
  assert.ok(Buffer.byteLength(source) <= 8 * 1024 * 1024, "Next framework payload exceeds its byte bound");
  if (role === "polyfill-nomodule") { assert.equal(sha256(source), STYLEX_NEXT_FRAMEWORK_INPUTS[role][1], "Next framework polyfill differs from pinned original bytes"); return; }
  const parsed = parseSync(source, { babelrc: false, configFile: false, sourceType: "script" });
  assert.ok(parsed !== null);
  assert.ok(!(parsed.comments ?? []).some((comment) => /sourceMappingURL\s*=/u.test(comment.value)), "An unmapped Next framework payload cannot claim a source map");
  const program = dataNode(parsed.program);
  assert.ok(Array.isArray(program.body) && Array.isArray(program.directives) && program.directives.length === 0);
  const expressions: DataNode[] = [];
  const flatten = (value: unknown): void => {
    const node = dataNode(value);
    if (node.type === "SequenceExpression") { assert.ok(Array.isArray(node.expressions)); for (const item of node.expressions) flatten(item); }
    else expressions.push(node);
  };
  for (const raw of program.body) { const statement = dataNode(raw); assert.equal(statement.type, "ExpressionStatement", "Next framework payload must only initialize its manifest"); flatten(statement.expression); }
  const assign = (node: DataNode | undefined, base: string, name: string): unknown => {
    assert.ok(node !== undefined && node.type === "AssignmentExpression" && node.operator === "=" && member(node.left, base, name), "Next framework payload writes an unexpected global");
    return node.right;
  };
  const callback = (node: DataNode | undefined, name: string): void => {
    assert.ok(node !== undefined && node.type === "LogicalExpression" && node.operator === "&&" && member(node.left, "self", name), "Next framework callback is invalid");
    const call = dataNode(node.right);
    assert.ok(call.type === "CallExpression" && member(call.callee, "self", name) && Array.isArray(call.arguments) && call.arguments.length === 0, "Next framework callback is invalid");
  };
  if (role === "ssg-manifest") {
    assert.equal(expressions.length, 2);
    const init = dataNode(assign(expressions[0], "self", "__SSG_MANIFEST"));
    assert.ok(init.type === "NewExpression" && identifier(init.callee, "Set") && Array.isArray(init.arguments) && init.arguments.length === 0, "Next SSG manifest must initialize an empty Set");
    callback(expressions[1], "__SSG_MANIFEST_CB");
    return;
  }
  if (role === "client-reference-manifest") {
    assert.equal(expressions.length, 2);
    const init = dataNode(assign(expressions[0], "globalThis", "__RSC_MANIFEST"));
    assert.ok(init.type === "LogicalExpression" && init.operator === "||" && member(init.left, "globalThis", "__RSC_MANIFEST"));
    assert.deepEqual(Object.keys(object(manifestData(init.right), "Next RSC manifest initial value")), []);
    const assignment = expressions[1]!;
    const left = dataNode(assignment.left);
    assert.ok(assignment.type === "AssignmentExpression" && assignment.operator === "=" && left.type === "MemberExpression" && left.computed === true && member(left.object, "globalThis", "__RSC_MANIFEST"));
    const route = dataNode(left.property);
    assert.ok(route.type === "StringLiteral" && typeof route.value === "string" && route.value.startsWith("/"), "Next RSC manifest route is invalid");
    const normalizedRoute = normalizeStylexNextManifestPagePath(route.value);
    assert.equal(
      normalizedRoute,
      route.value,
      "Pinned Next 16.2.12 has an unsupported static leading /index route because its client-reference manifest writer and reader disagree",
    );
    assert.equal(path, `server/app${normalizedRoute}_client-reference-manifest.js`, "Next RSC manifest route differs from output path");
    object(manifestData(assignment.right), "Next RSC manifest data");
    return;
  }
  const globals = {
    "build-manifest": "__BUILD_MANIFEST", "dynamic-css-manifest": "__DYNAMIC_CSS_MANIFEST",
    "interception-rewrite-manifest": "__INTERCEPTION_ROUTE_REWRITE_MANIFEST", "middleware-build-manifest": "__BUILD_MANIFEST",
    "next-font-manifest": "__NEXT_FONT_MANIFEST", "react-loadable-manifest": "__REACT_LOADABLE_MANIFEST", "server-reference-manifest": "__RSC_SERVER_MANIFEST",
  } as const;
  assert.equal(expressions.length, role === "build-manifest" ? 2 : 1);
  const data = manifestData(
    assign(expressions[0], role === "middleware-build-manifest" ? "globalThis" : "self", globals[role]),
    role === "build-manifest",
  );
  if (role === "build-manifest") validateBuildManifestNonFiniteData(data);
  else if (role === "middleware-build-manifest") object(data, "Next build manifest data");
  else {
    assert.equal(typeof data, "string", "Next framework manifest must contain JSON text");
    const decoded: unknown = JSON.parse(data as string);
    if (role === "dynamic-css-manifest" || role === "interception-rewrite-manifest") assert.ok(Array.isArray(decoded), "Next framework manifest JSON must be an array");
    else object(decoded, "Next framework manifest JSON");
  }
  if (role === "build-manifest") callback(expressions[1], "__BUILD_MANIFEST_CB");
}

export type StylexNextGraphReceiptV1 = Readonly<{
  adapterVersion: typeof STYLEX_NEXT_ADAPTER_VERSION;
  attemptId: string;
  auxiliaryTraceAssets: readonly StylexNextAuxiliaryTraceAssetV1[];
  compilerSha256: string;
  cssInputs: readonly StylexArtifactV1[];
  delegatedEntryBootstraps: readonly StylexNextDelegatedEntryBootstrapV1[];
  entrypoints: readonly StylexNextEntrypointV1[];
  emptyEntryBootstraps: readonly StylexNextEmptyEntryBootstrapV1[];
  frameworkAssets: readonly StylexNextFrameworkAssetV1[];
  graphId: string;
  kind: "hraness-stylex-next-graph";
  javascriptChunks: readonly string[];
  mode: StylexNextProductionMode;
  modules: readonly StylexNextModuleIdentityV1[];
  nextVersion: StylexNextVersion;
  outputDirectory: string;
  outputs: readonly StylexArtifactV1[];
  packages: readonly StylexPackageIdentityV1[];
  rules: readonly StylexRuleV1[];
  rulesSha256: string;
  schemaVersion: typeof STYLEX_NEXT_GRAPH_SCHEMA_VERSION;
  sourceMaps: readonly StylexArtifactV1[];
  sourcesSha256: string;
  target: StylexNextTarget;
  webpackVersion: string;
}>;

export type StylexNextGraphIdentityV1 = Readonly<{
  graphId: string;
  receiptSha256: string;
  target: StylexNextTarget;
}>;

// Native Next writes this one asset again after webpack has finished. These
// inputs bind both creators and the exact route-to-Set serialization algorithm.
// The pinned production minifier combines the raw creator's two statements.
export const STYLEX_NEXT_SSG_INITIAL_SOURCE = "self.__SSG_MANIFEST=new Set,self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB();" as const;

/** Exact devalue 2.x Set<string> subset: a unique Set needs no reference IIFE. */
function devalueSsgString(value: string): string {
  const escapes: Readonly<Record<string, string>> = { "<": "\\u003C", ">": "\\u003E", "/": "\\u002F", "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\0": "\\0", "\u2028": "\\u2028", "\u2029": "\\u2029", '"': '\\"' };
  let output = '"';
  for (let index = 0; index < value.length; index++) {
    const character = value.charAt(index);
    const code = value.charCodeAt(index);
    if (Object.hasOwn(escapes, character)) output += escapes[character];
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = value.charCodeAt(index + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) output += character + value.charAt(++index);
      else output += `\\u${code.toString(16).toUpperCase()}`;
    } else output += character;
  }
  return `${output}"`;
}

// Keep this pure derivation in the contract layer so validation and filesystem
// settlement share the same bytes without a contracts-to-settlement cycle.
export function serializeStylexNextSsgRoutes(routes: readonly string[]): string {
  assert.ok(routes.length <= 100_000, "Next SSG route inventory exceeds its bound");
  for (const route of routes) {
    assert.ok(typeof route === "string" && route.startsWith("/") && route.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(route), "Next SSG route must be a bounded absolute URL pathname");
  }
  assert.deepEqual(routes, [...new Set(routes)].sort(), "Next SSG serialization requires sorted unique routes");
  return `self.__SSG_MANIFEST=new Set([${routes.map(devalueSsgString).join(",")}]);self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()`;
}

export type StylexNextSsgPostprocessingV1 = Readonly<{
  buildId: string;
  creators: readonly StylexArtifactV1[];
  initial: StylexNextFrameworkAssetV1;
  inputs: readonly StylexArtifactV1[];
  locales: readonly string[] | null;
  output: StylexArtifactV1;
  package: StylexArtifactV1;
  routes: readonly string[];
}>;

export type StylexNextPostprocessingReceiptV1 = Readonly<{
  adapterVersion: typeof STYLEX_NEXT_ADAPTER_VERSION;
  attemptId: string;
  auxiliaryTraceSnapshots: readonly StylexNextAuxiliaryTraceSnapshotV1[];
  compilerSha256: string;
  graphs: readonly StylexNextGraphIdentityV1[];
  kind: "hraness-stylex-next-postprocessing";
  mode: StylexNextProductionMode;
  nextVersion: StylexNextVersion;
  outputDirectory: string;
  planSha256: string;
  schemaVersion: 1;
  ssg: readonly StylexNextSsgPostprocessingV1[];
}>;

export type StylexNextBuildRecordV1 = Readonly<{
  adapterVersion: typeof STYLEX_NEXT_ADAPTER_VERSION;
  attemptId: string;
  compilerSha256: string;
  delivery: readonly StylexNextGraphIdentityV1[];
  discovery: readonly StylexNextGraphIdentityV1[];
  finalCss: StylexArtifactV1;
  kind: "hraness-stylex-next-build";
  nextVersion: StylexNextVersion;
  outputDirectory: string;
  packages: readonly StylexPackageIdentityV1[];
  postprocessing: Readonly<{ delivery: StylexArtifactV1; discovery: StylexArtifactV1 }>;
  rulesSha256: string;
  schemaVersion: 1;
  state: "complete";
}>;

export type StylexNextBuildRecordV2 = Readonly<Omit<StylexNextBuildRecordV1, "schemaVersion"> & {
  schemaVersion: typeof STYLEX_NEXT_BUILD_SCHEMA_VERSION;
  unionPolicySha256: string;
}>;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function keys(
  record: Record<string, unknown>,
  required: readonly string[],
  description: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  assert.deepEqual(
    Object.keys(record).filter((key) => !allowed.has(key)).sort(),
    [],
    `${description} contains unknown keys`,
  );
  for (const key of required) assert.ok(Object.hasOwn(record, key), `${description} is missing ${key}`);
}

function string(value: unknown, description: string): string {
  assert.ok(
    typeof value === "string"
      && value.length > 0
      && value.trim() === value
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `${description} must be a nonempty printable string`,
  );
  return value;
}

function segment(value: unknown, description: string): string {
  const result = string(value, description);
  assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result), `${description} must be a normalized segment`);
  return result;
}

function digest(value: unknown, description: string): string {
  const result = string(value, description);
  assert.ok(/^[a-f0-9]{64}$/u.test(result), `${description} must be a lowercase SHA-256`);
  return result;
}

function bytes(value: unknown, description: string): StylexNextBytesV1 {
  const record = object(value, description);
  keys(record, ["bytes", "sha256"], description);
  assert.ok(Number.isSafeInteger(record.bytes) && (record.bytes as number) >= 0, `${description}.bytes must be a nonnegative safe integer`);
  return { bytes: record.bytes as number, sha256: digest(record.sha256, `${description}.sha256`) };
}

function strings(value: unknown, description: string): readonly string[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((item, index) => string(item, `${description}[${String(index)}]`));
  assert.deepEqual(output, [...output].sort(), `${description} must be sorted`);
  assert.equal(new Set(output).size, output.length, `${description} must be unique`);
  return output;
}

function orderedStrings(value: unknown, description: string): readonly string[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  return value.map((item, index) => string(item, `${description}[${String(index)}]`));
}

function artifact(value: unknown, description: string): StylexArtifactV1 {
  const record = object(value, description);
  keys(record, ["bytes", "path", "sha256"], description);
  const measured = bytes({ bytes: record.bytes, sha256: record.sha256 }, description);
  return { ...measured, path: normalizeLogicalPath(record.path, `${description}.path`) };
}

function artifacts(value: unknown, description: string): readonly StylexArtifactV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((item, index) => artifact(item, `${description}[${String(index)}]`));
  assert.deepEqual(output.map(({ path }) => path), [...output].map(({ path }) => path).sort(), `${description} must be path sorted`);
  assert.equal(new Set(output.map(({ path }) => path)).size, output.length, `${description} paths must be unique`);
  return output;
}

function identities(value: unknown, description: string): readonly StylexPackageIdentityV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((item, index) => {
    const record = object(item, `${description}[${String(index)}]`);
    keys(record, ["manifestSha256", "name", "version"], `${description}[${String(index)}]`);
    return {
      manifestSha256: digest(record.manifestSha256, `${description}[${String(index)}].manifestSha256`),
      name: string(record.name, `${description}[${String(index)}].name`),
      version: string(record.version, `${description}[${String(index)}].version`),
    };
  });
  assert.deepEqual(output.map(({ name }) => name), [...output].map(({ name }) => name).sort(), `${description} must be package-name sorted`);
  assert.equal(new Set(output.map(({ name }) => name)).size, output.length, `${description} package names must be unique`);
  return output;
}

export function parseStylexNextTarget(value: unknown, description = "Next target"): StylexNextTarget {
  assert.ok(STYLEX_NEXT_TARGETS.some((target) => target === value), `${description} is invalid`);
  return value as StylexNextTarget;
}

function mode(value: unknown, description: string): StylexNextMode {
  assert.ok(value === "delivery" || value === "development" || value === "discovery", `${description} is invalid`);
  return value;
}

export function defineStylexNextGraphMap(value: unknown): StylexNextGraphMapV1 {
  const record = object(value, "Next graph map");
  keys(record, ["client", "edgeRsc", "nodeRsc"], "Next graph map");
  const output = {
    client: segment(record.client, "Next graph map.client"),
    edgeRsc: segment(record.edgeRsc, "Next graph map.edgeRsc"),
    nodeRsc: segment(record.nodeRsc, "Next graph map.nodeRsc"),
  };
  assert.equal(new Set(Object.values(output)).size, 3, "Next graph IDs must be unique");
  return output;
}

export function resolveStylexNextTarget(value: unknown): StylexNextTarget {
  const record = object(value, "Next webpack context");
  keys(record, ["dev", "isServer"], "Next webpack context", ["nextRuntime"]);
  assert.ok(typeof record.dev === "boolean", "Next webpack context.dev must be boolean");
  assert.ok(typeof record.isServer === "boolean", "Next webpack context.isServer must be boolean");
  assert.equal(record.dev, false, "Production StyleX Next graphs reject dev/HMR compilations");
  if (record.isServer === false) {
    assert.equal(record.nextRuntime, undefined, "Client StyleX Next graph must not declare a server runtime");
    return "client";
  }
  if (record.nextRuntime === "edge") return "edge-rsc";
  assert.ok(
    record.nextRuntime === undefined || record.nextRuntime === "nodejs",
    "Server StyleX Next graph has an unsupported runtime",
  );
  return "node-rsc";
}

export function graphIdForStylexNextTarget(
  target: StylexNextTarget,
  graphMap: StylexNextGraphMapV1 = defaultStylexNextGraphMap,
): string {
  const parsed = defineStylexNextGraphMap(graphMap);
  if (target === "client") return parsed.client;
  if (target === "edge-rsc") return parsed.edgeRsc;
  return parsed.nodeRsc;
}

export function validateStylexNextModuleReceipt(value: unknown): StylexNextModuleReceiptV1 {
  const record = object(value, "Next module receipt");
  keys(record, [
    "adapterVersion", "attemptId", "compilerSha256", "graphId", "input", "kind", "mode",
    "output", "rules", "rulesSha256", "schemaVersion", "sourceMap", "target",
  ], "Next module receipt");
  assert.equal(record.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
  assert.equal(record.compilerSha256, compilerSha256, "Next module compiler hash is stale");
  assert.equal(record.kind, "hraness-stylex-next-module");
  assert.equal(record.schemaVersion, STYLEX_NEXT_MODULE_SCHEMA_VERSION);
  const target = parseStylexNextTarget(record.target, "Next module target");
  const parsedMode = mode(record.mode, "Next module mode");
  const input = artifact(record.input, "Next module input");
  const output = bytes(record.output, "Next module output");
  const rules = canonicalizeStylexRules(parseStylexRules(record.rules, "Next module rules"));
  assert.equal(canonicalJson(rules), canonicalJson(record.rules), "Next module rules must be canonical");
  assert.equal(record.rulesSha256, stylexRulesSha256(rules), "Next module rules hash is stale");
  const map = object(record.sourceMap, "Next module sourceMap");
  keys(map, ["inputSha256", "logicalSourceFileName", "output", "sources"], "Next module sourceMap");
  assert.ok(map.inputSha256 === null || typeof map.inputSha256 === "string", "Next module sourceMap.inputSha256 is invalid");
  const inputSha256 = map.inputSha256 === null ? null : digest(map.inputSha256, "Next module sourceMap.inputSha256");
  const sourceMap: StylexNextMapReceiptV1 = {
    inputSha256,
    logicalSourceFileName: validateStylexSourceMapPath(map.logicalSourceFileName, "Next module sourceMap.logicalSourceFileName"),
    output: bytes(map.output, "Next module sourceMap.output"),
    sources: orderedStrings(map.sources, "Next module sourceMap.sources")
      .map((source, index) => validateStylexSourceMapPath(source, `Next module sourceMap.sources[${String(index)}]`)),
  };
  assert.ok(sourceMap.sources.length > 0, "Next module sourceMap.sources must be nonempty");
  assert.equal(sourceMap.logicalSourceFileName, input.path, "Next module logical source filename must equal its input path");
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: segment(record.attemptId, "Next module attemptId"),
    compilerSha256,
    graphId: segment(record.graphId, "Next module graphId"),
    input,
    kind: "hraness-stylex-next-module",
    mode: parsedMode,
    output,
    rules,
    rulesSha256: stylexRulesSha256(rules),
    schemaVersion: STYLEX_NEXT_MODULE_SCHEMA_VERSION,
    sourceMap,
    target,
  };
}

function moduleIdentities(value: unknown): readonly StylexNextModuleIdentityV1[] {
  assert.ok(Array.isArray(value), "Next graph modules must be an array");
  const output = value.map((item, index) => {
    const record = object(item, `Next graph modules[${String(index)}]`);
    keys(record, ["path", "receiptSha256"], `Next graph modules[${String(index)}]`);
    return {
      path: normalizeLogicalPath(record.path, `Next graph modules[${String(index)}].path`),
      receiptSha256: digest(record.receiptSha256, `Next graph modules[${String(index)}].receiptSha256`),
    };
  });
  assert.deepEqual(output.map(({ path }) => path), [...output].map(({ path }) => path).sort(), "Next graph modules must be path sorted");
  assert.equal(new Set(output.map(({ path }) => path)).size, output.length, "Next graph module paths must be unique");
  return output;
}

function entrypoints(value: unknown): readonly StylexNextEntrypointV1[] {
  assert.ok(Array.isArray(value), "Next graph entrypoints must be an array");
  const output = value.map((item, index) => {
    const record = object(item, `Next graph entrypoints[${String(index)}]`);
    keys(record, ["css", "files", "javascript", "name", "stylexCss"], `Next graph entrypoints[${String(index)}]`);
    const files = strings(record.files, `Next graph entrypoints[${String(index)}].files`);
    const css = strings(record.css, `Next graph entrypoints[${String(index)}].css`);
    const javascript = strings(record.javascript, `Next graph entrypoints[${String(index)}].javascript`);
    const stylexCss = strings(record.stylexCss, `Next graph entrypoints[${String(index)}].stylexCss`);
    assert.ok(css.every((path) => files.includes(path) && path.endsWith(".css")), "Next entrypoint CSS must be included in files");
    assert.ok(javascript.every((path) => files.includes(path) && /\.(?:c|m)?js$/u.test(path)), "Next entrypoint JavaScript must be included in files");
    assert.ok(stylexCss.every((path) => css.includes(path)), "Next entrypoint StyleX CSS must be linked CSS");
    return { css, files, javascript, name: string(record.name, `Next graph entrypoints[${String(index)}].name`), stylexCss };
  });
  assert.deepEqual(output.map(({ name }) => name), [...output].map(({ name }) => name).sort(), "Next graph entrypoints must be name sorted");
  assert.equal(new Set(output.map(({ name }) => name)).size, output.length, "Next graph entrypoint names must be unique");
  return output;
}

export function validateStylexNextGraphReceipt(value: unknown): StylexNextGraphReceiptV1 {
  const record = object(value, "Next graph receipt");
  keys(record, [
    "adapterVersion", "attemptId", "auxiliaryTraceAssets", "compilerSha256", "cssInputs", "delegatedEntryBootstraps", "entrypoints", "emptyEntryBootstraps", "frameworkAssets", "graphId", "javascriptChunks", "kind",
    "mode", "modules", "nextVersion", "outputDirectory", "outputs", "packages", "rules", "rulesSha256",
    "schemaVersion", "sourceMaps", "sourcesSha256", "target", "webpackVersion",
  ], "Next graph receipt");
  assert.equal(record.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
  assert.equal(record.compilerSha256, compilerSha256, "Next graph compiler hash is stale");
  assert.equal(record.kind, "hraness-stylex-next-graph");
  assert.ok(record.mode === "delivery" || record.mode === "discovery", "Next graph receipt mode must be production");
  const nextVersion = stylexNextVersion(record.nextVersion);
  assert.equal(record.schemaVersion, STYLEX_NEXT_GRAPH_SCHEMA_VERSION);
  const target = parseStylexNextTarget(record.target, "Next graph target");
  const modules = moduleIdentities(record.modules);
  const rules = canonicalizeStylexRules(parseStylexRules(record.rules, "Next graph rules"));
  assert.equal(canonicalJson(rules), canonicalJson(record.rules), "Next graph rules must be canonical");
  if (modules.length === 0) assert.equal(rules.length, 0, "An empty Next source graph cannot contain StyleX rules");
  assert.equal(record.rulesSha256, stylexRulesSha256(rules), "Next graph rules hash is stale");
  const expectedSourcesSha256 = sha256(canonicalJson(modules));
  assert.equal(record.sourcesSha256, expectedSourcesSha256, "Next graph source inventory hash is stale");
  const graphId = segment(record.graphId, "Next graph graphId");
  const parsedEntrypoints = entrypoints(record.entrypoints);
  if (modules.length > 0) assert.ok(parsedEntrypoints.length > 0, "A populated Next source graph must contain entrypoints");
  if (record.mode === "delivery" && target === "client") {
    const owners = new Set(stylexNextDeliveryCssOwnerNames(parsedEntrypoints.map(({ name }) => name)));
    assert.ok(
      parsedEntrypoints.every(({ name, stylexCss }) => (stylexCss.length > 0) === owners.has(name)),
      "Next delivery client entrypoints must bind generated StyleX CSS on every and only planned physical owner",
    );
  } else {
    assert.ok(parsedEntrypoints.every(({ stylexCss }) => stylexCss.length === 0), "Only the Next delivery client graph may bind generated StyleX CSS");
  }
  const outputs = artifacts(record.outputs, "Next graph outputs");
  assert.ok(
    parsedEntrypoints.every(({ files }) => files.every((path) => outputs.some((output) => output.path === path))),
    "Every Next entrypoint file must be present in graph outputs",
  );
  const sourceMaps = artifacts(record.sourceMaps, "Next graph sourceMaps");
  const javascriptChunks = strings(record.javascriptChunks, "Next graph javascriptChunks").map((path) => normalizeLogicalPath(path, "Next JavaScript chunk"));
  assert.ok(javascriptChunks.every((path) => /\.(?:c|m)?js$/u.test(path) && outputs.some((output) => output.path === path)), "Next JavaScript chunks must be emitted JavaScript assets");
  assert.ok(parsedEntrypoints.every((entry) => entry.javascript.every((path) => javascriptChunks.includes(path))), "Every Next entrypoint JavaScript output must belong to a chunk");
  assert.ok(Array.isArray(record.auxiliaryTraceAssets) && record.auxiliaryTraceAssets.length <= 100_000, "Next auxiliaryTraceAssets must be a bounded array");
  const auxiliaryTraceAssets = record.auxiliaryTraceAssets.map((value) => validateStylexNextAuxiliaryTraceAsset(value, nextVersion));
  const auxiliaryPaths = auxiliaryTraceAssets.map(({ initial }) => initial.path);
  assert.deepEqual(auxiliaryPaths, [...new Set(auxiliaryPaths)].sort(), "Next auxiliary trace assets must be unique and path sorted");
  assert.deepEqual(auxiliaryPaths, outputs.filter(({ path }) => path.endsWith(".nft.json")).map(({ path }) => path), "Every Next NFT output must have the exact auxiliary trace classification");
  for (const asset of auxiliaryTraceAssets) {
    assert.equal(target, "node-rsc", "Only the Next Node RSC graph owns dependency trace metadata");
    const entry = parsedEntrypoints.find(({ name }) => name === asset.entrypoint);
    const javascript = `server/${asset.entrypoint}.js`;
    assert.ok(entry !== undefined && entry.files.includes(javascript) && entry.javascript.includes(javascript) && javascriptChunks.includes(javascript), "Next auxiliary trace must bind an actual registered server entrypoint chunk");
    assert.deepEqual(outputs.find(({ path }) => path === asset.initial.path), asset.initial, "Next auxiliary trace initial bytes differ from graph output");
    assert.ok(!parsedEntrypoints.some(({ files }) => files.includes(asset.initial.path)), "Next auxiliary metadata cannot be a linked entrypoint asset");
    assert.ok(!sourceMaps.some(({ path }) => path === asset.initial.path || path === `${asset.initial.path}.map`), "Next auxiliary metadata cannot waive a source map");
  }
  assert.ok(Array.isArray(record.emptyEntryBootstraps), "Next emptyEntryBootstraps must be an array");
  const emptyEntryBootstraps = record.emptyEntryBootstraps.map((value) => validateStylexNextEmptyEntryBootstrap(value, nextVersion));
  assert.deepEqual(emptyEntryBootstraps.map(({ output }) => output.path), [...new Set(emptyEntryBootstraps.map(({ output }) => output.path))].sort(), "Next empty entry outputs must be unique and path sorted");
  for (const bootstrap of emptyEntryBootstraps) {
    assert.equal(target, "client", "Only Next client graphs may prove empty entry bootstraps");
    assert.ok(javascriptChunks.includes(bootstrap.output.path), "Next empty entry must remain in the complete chunk inventory");
    assert.deepEqual(outputs.find(({ path }) => path === bootstrap.output.path), bootstrap.output, "Next empty entry output bytes differ from graph output");
    assert.ok(!sourceMaps.some(({ path }) => path === `${bootstrap.output.path}.map`), "A mapped chunk cannot use the empty entry category");
    assert.deepEqual(bootstrap.graph.entrypoints, parsedEntrypoints.filter(({ javascript }) => javascript.includes(bootstrap.output.path)).map(({ name }) => name), "Next empty entry entrypoint linkage differs from graph");
    for (const dependency of bootstrap.graph.dependencies) {
      for (const path of dependency.files) {
        assert.ok(javascriptChunks.includes(path) && sourceMaps.some((map) => map.path === `${path}.map`), "Next empty entry startup dependency must retain a real mapped chunk");
        assert.ok(bootstrap.graph.entrypoints.every((name) => parsedEntrypoints.find((entry) => entry.name === name)?.javascript.includes(path)), "Next empty entry startup dependency is absent from its entrypoint");
      }
      for (const path of dependency.cssFiles) {
        assert.ok(outputs.some((output) => output.path === path) && !javascriptChunks.includes(path), "Next empty entry CSS dependency must retain its emitted stylesheet");
        assert.ok(bootstrap.graph.entrypoints.every((name) => {
          const entry = parsedEntrypoints.find((entry) => entry.name === name);
          return entry?.css.includes(path) && entry.files.includes(path);
        }), "Next empty entry CSS dependency is absent from its entrypoint");
      }
    }
  }
  assert.ok(Array.isArray(record.delegatedEntryBootstraps) && record.delegatedEntryBootstraps.length <= 4096, "Next delegatedEntryBootstraps must be a bounded array");
  const delegatedEntryBootstraps = record.delegatedEntryBootstraps.map((value) => validateStylexNextDelegatedEntryBootstrap(value, nextVersion));
  const delegatedPaths = delegatedEntryBootstraps.map(({ output }) => output.path);
  assert.deepEqual(delegatedPaths, [...new Set(delegatedPaths)].sort(), "Next delegated outputs must be unique and path sorted");
  for (const bootstrap of delegatedEntryBootstraps) {
    assert.equal(target, "client", "Only Next client graphs may prove delegated entries");
    assert.ok(javascriptChunks.includes(bootstrap.output.path), "Next delegated entry must remain in the chunk inventory");
    assert.deepEqual(outputs.find(({ path }) => path === bootstrap.output.path), bootstrap.output, "Next delegated output bytes differ from graph output");
    assert.ok(!sourceMaps.some(({ path }) => path === `${bootstrap.output.path}.map`), "A mapped chunk cannot use the delegated entry category");
    assert.ok(!emptyEntryBootstraps.some(({ output }) => output.path === bootstrap.output.path), "Next delegated entry cannot also be an empty entry");
    assert.deepEqual(bootstrap.graph.entrypoints, parsedEntrypoints.filter(({ javascript }) => javascript.includes(bootstrap.output.path)).map(({ name }) => name), "Next delegated entrypoint linkage differs from graph");
    // Each entry owner is an exact dependency (validated above), so every owner
    // JS and adjacent map also joins these complete hashed graph inventories.
    for (const dependency of bootstrap.graph.dependencies) {
      for (const path of dependency.files) {
        assert.ok(javascriptChunks.includes(path) && sourceMaps.some((map) => map.path === `${path}.map`), "Next delegated startup dependency must retain a real mapped chunk");
        assert.ok(bootstrap.graph.entrypoints.every((name) => parsedEntrypoints.find((entry) => entry.name === name)?.javascript.includes(path)), "Next delegated startup dependency is absent from its entrypoint");
      }
      for (const path of dependency.cssFiles) {
        assert.ok(outputs.some((output) => output.path === path) && !javascriptChunks.includes(path), "Next delegated CSS dependency must retain its emitted stylesheet");
        assert.ok(bootstrap.graph.entrypoints.every((name) => {
          const entry = parsedEntrypoints.find((entry) => entry.name === name);
          return entry?.css.includes(path) && entry.files.includes(path);
        }), "Next delegated CSS dependency is absent from its entrypoint");
      }
    }
  }
  assert.ok(Array.isArray(record.frameworkAssets), "Next frameworkAssets must be an array");
  const frameworkAssets: StylexNextFrameworkAssetV1[] = record.frameworkAssets.map((value) => {
    const entry = object(value, "Next framework asset");
    keys(entry, ["input", "output", "role"], "Next framework asset");
    assert.ok(typeof entry.role === "string" && Object.hasOwn(STYLEX_NEXT_FRAMEWORK_INPUTS, entry.role), "Next framework role is unsupported");
    const role = entry.role as StylexNextFrameworkRole;
    const input = artifact(entry.input, "Next framework input");
    const output = artifact(entry.output, "Next framework output");
    const [path, hash] = stylexNextProfile(nextVersion).frameworkInputs[role];
    assert.equal(input.path, `node_modules/next/${path}`, "Next framework input path differs from its pinned role");
    assert.equal(input.sha256, hash, "Next framework input hash differs from its selected Next profile");
    assert.equal(stylexNextFrameworkRole(output.path, target), role, "Next framework output path or target differs from its role");
    assert.deepEqual(outputs.find(({ path }) => path === output.path), output, "Next framework output bytes must match its graph output");
    assert.ok(!javascriptChunks.includes(output.path), "A Next JavaScript chunk cannot use a framework map exception");
    assert.ok(!sourceMaps.some(({ path }) => path === `${output.path}.map`), "A mapped Next asset cannot use a framework map exception");
    if (role === "polyfill-nomodule") assert.deepEqual({ bytes: output.bytes, sha256: output.sha256 }, { bytes: input.bytes, sha256: input.sha256 }, "Next polyfill output must match its original bytes");
    return { input, output, role };
  });
  assert.deepEqual(frameworkAssets.map(({ output }) => output.path), [...new Set(frameworkAssets.map(({ output }) => output.path))].sort(), "Next framework assets must be unique and path sorted");
  const javascriptOutputs = outputs.filter(({ path }) => /\.(?:c|m)?js$/u.test(path));
  if (parsedEntrypoints.length > 0) assert.ok(javascriptOutputs.length > 0, "Next graph entrypoints must emit JavaScript");
  if (javascriptChunks.length > 0) assert.ok(sourceMaps.length > 0, "Next graph must retain emitted source maps");
  assert.ok(sourceMaps.every(({ path }) => path.endsWith(".map")), "Next graph sourceMaps must contain only .map outputs");
  assert.ok(sourceMaps.every(({ path }) => outputs.some((output) => output.path === path)), "Next graph sourceMaps must be present in outputs");
  assert.deepEqual(sourceMaps, outputs.filter(({ path }) => path.endsWith(".map")), "Next graph must bind the complete exact source-map inventory");
  assert.ok(
    sourceMaps.every(({ path }) => outputs.some((output) => output.path === path.slice(0, -4))),
    "Every Next source map must retain its mapped output",
  );
  assert.ok(
    javascriptChunks.every((path) => sourceMaps.some((map) => map.path === `${path}.map`) || emptyEntryBootstraps.some(({ output }) => output.path === path) || delegatedPaths.includes(path)),
    "Every Next JavaScript chunk must retain its external source map",
  );
  assert.ok(
    javascriptOutputs.every(({ path }) => sourceMaps.some((map) => map.path === `${path}.map`) || frameworkAssets.some(({ output }) => output.path === path) || emptyEntryBootstraps.some(({ output }) => output.path === path) || delegatedPaths.includes(path)),
    "Every unmapped Next JavaScript output must have proven framework provenance",
  );
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: segment(record.attemptId, "Next graph attemptId"),
    auxiliaryTraceAssets,
    compilerSha256,
    cssInputs: artifacts(record.cssInputs, "Next graph cssInputs"),
    delegatedEntryBootstraps,
    entrypoints: parsedEntrypoints,
    emptyEntryBootstraps,
    frameworkAssets,
    graphId,
    kind: "hraness-stylex-next-graph",
    javascriptChunks,
    mode: record.mode,
    modules,
    nextVersion,
    outputDirectory: normalizeLogicalPath(record.outputDirectory, "Next graph outputDirectory"),
    outputs,
    packages: identities(record.packages, "Next graph packages"),
    rules,
    rulesSha256: stylexRulesSha256(rules),
    schemaVersion: STYLEX_NEXT_GRAPH_SCHEMA_VERSION,
    sourceMaps,
    sourcesSha256: expectedSourcesSha256,
    target,
    webpackVersion: string(record.webpackVersion, "Next graph webpackVersion"),
  };
}

function graphIdentities(value: unknown, description: string): readonly StylexNextGraphIdentityV1[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((item, index) => {
    const record = object(item, `${description}[${String(index)}]`);
    keys(record, ["graphId", "receiptSha256", "target"], `${description}[${String(index)}]`);
    return {
      graphId: segment(record.graphId, `${description}[${String(index)}].graphId`),
      receiptSha256: digest(record.receiptSha256, `${description}[${String(index)}].receiptSha256`),
      target: parseStylexNextTarget(record.target, `${description}[${String(index)}].target`),
    };
  });
  assert.deepEqual(output.map(({ target }) => target), [...STYLEX_NEXT_TARGETS], `${description} must contain the exact target set`);
  assert.equal(new Set(output.map(({ graphId }) => graphId)).size, output.length, `${description} graph IDs must be unique`);
  return output;
}

export function validateStylexNextBuildRecord(value: unknown): StylexNextBuildRecordV2 {
  const record = object(value, "Next build record");
  keys(record, [
    "adapterVersion", "attemptId", "compilerSha256", "delivery", "discovery", "finalCss", "kind",
    "nextVersion", "outputDirectory", "packages", "postprocessing", "rulesSha256", "schemaVersion", "state", "unionPolicySha256",
  ], "Next build record");
  assert.equal(record.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
  assert.equal(record.compilerSha256, compilerSha256, "Next build compiler hash is stale");
  assert.equal(record.unionPolicySha256, stylexUnionPolicySha256, "Next build union policy is stale");
  assert.equal(record.kind, "hraness-stylex-next-build");
  const nextVersion = stylexNextVersion(record.nextVersion);
  assert.equal(record.schemaVersion, STYLEX_NEXT_BUILD_SCHEMA_VERSION);
  assert.equal(record.state, "complete");
  const discovery = graphIdentities(record.discovery, "Next build discovery");
  const delivery = graphIdentities(record.delivery, "Next build delivery");
  const postprocessing = object(record.postprocessing, "Next build postprocessing");
  keys(postprocessing, ["delivery", "discovery"], "Next build postprocessing");
  const postprocessingArtifacts = {
    delivery: artifact(postprocessing.delivery, "Next delivery postprocessing"),
    discovery: artifact(postprocessing.discovery, "Next discovery postprocessing"),
  };
  for (const mode of ["discovery", "delivery"] as const) {
    assert.ok(postprocessingArtifacts[mode].path.endsWith(`/${mode}/postprocessing.json`), "Next postprocessing receipt path differs from its mode");
  }
  assert.equal(postprocessingArtifacts.delivery.path.slice(0, -"delivery/postprocessing.json".length), postprocessingArtifacts.discovery.path.slice(0, -"discovery/postprocessing.json".length), "Next postprocessing receipts belong to different attempts");
  assert.deepEqual(
    delivery.map(({ graphId, target }) => ({ graphId, target })),
    discovery.map(({ graphId, target }) => ({ graphId, target })),
    "Next discovery and delivery graph identities differ",
  );
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: segment(record.attemptId, "Next build attemptId"),
    compilerSha256,
    delivery,
    discovery,
    finalCss: artifact(record.finalCss, "Next build finalCss"),
    kind: "hraness-stylex-next-build",
    nextVersion,
    outputDirectory: normalizeLogicalPath(record.outputDirectory, "Next build outputDirectory"),
    packages: identities(record.packages, "Next build packages"),
    postprocessing: postprocessingArtifacts,
    rulesSha256: digest(record.rulesSha256, "Next build rulesSha256"),
    schemaVersion: STYLEX_NEXT_BUILD_SCHEMA_VERSION,
    unionPolicySha256: stylexUnionPolicySha256,
    state: "complete",
  };
}

export function validateStylexNextAuxiliaryTraceAsset(value: unknown, nextVersion: StylexNextVersion = STYLEX_NEXT_REQUIRED_VERSION): StylexNextAuxiliaryTraceAssetV1 {
  const record = object(value, "Next auxiliary trace asset");
  keys(record, ["creator", "entrypoint", "initial", "kind"], "Next auxiliary trace asset");
  assert.equal(record.kind, "next-node-dependency-trace", "Next auxiliary trace kind is unsupported");
  const entrypoint = normalizeLogicalPath(record.entrypoint, "Next auxiliary trace entrypoint");
  // Next 16.2.12 registers a root or src/proxy.ts as the literal Node entry
  // "proxy". Graph validation still requires its exact registered JS chunk.
  assert.ok(entrypoint === "proxy" || /^(?:app|pages)\/.+/u.test(entrypoint), "Next auxiliary trace must name an app, pages, or exact proxy server entrypoint");
  const creator = artifact(record.creator, "Next auxiliary trace creator");
  assert.equal(creator.path, `node_modules/next/${stylexNextProfile(nextVersion).auxiliaryTraceCreator[0]}`, "Next auxiliary trace creator path differs from its pinned owner");
  assert.equal(creator.sha256, stylexNextProfile(nextVersion).auxiliaryTraceCreator[1], "Next auxiliary trace creator differs from its selected Next profile");
  const initial = artifact(record.initial, "Next auxiliary trace initial artifact");
  assert.equal(initial.path, `server/${entrypoint}.js.nft.json`, "Next auxiliary trace path differs from its server entrypoint");
  assert.ok(initial.path.length <= 4096, "Next auxiliary trace artifact path exceeds its bound");
  assert.ok(initial.bytes <= 16 * 1024 * 1024, "Next auxiliary trace initial artifact exceeds its byte bound");
  return { creator, entrypoint, initial, kind: "next-node-dependency-trace" };
}

export function validateStylexNextAuxiliaryTraceSnapshot(value: unknown, nextVersion: StylexNextVersion = STYLEX_NEXT_REQUIRED_VERSION): StylexNextAuxiliaryTraceSnapshotV1 {
  const record = object(value, "Next auxiliary trace snapshot");
  assert.equal(record.semantics, "observation-only", "Next auxiliary trace snapshot cannot claim dependency or deployment proof");
  const asset = validateStylexNextAuxiliaryTraceAsset(record.asset, nextVersion);
  const proxy = asset.entrypoint === "proxy";
  keys(record, proxy ? ["asset", "output", "proxyRename", "semantics"] : ["asset", "output", "semantics"], "Next auxiliary trace snapshot");
  const output = artifact(record.output, "Next auxiliary trace final artifact");
  assert.equal(output.path, proxy ? "server/middleware.js.nft.json" : asset.initial.path, "Next auxiliary trace final path changed");
  assert.ok(output.bytes <= 16 * 1024 * 1024, "Next auxiliary trace final artifact exceeds its byte bound");
  if (proxy) {
    const rename = object(record.proxyRename, "Next proxy rename");
    keys(rename, ["absent", "creator", "initial", "output", "sourceMap"], "Next proxy rename");
    const creator = artifact(rename.creator, "Next proxy rename creator");
    assert.equal(creator.path, `node_modules/next/${stylexNextProfile(nextVersion).proxyRenameCreator[0]}`, "Next proxy rename creator path changed");
    assert.equal(creator.sha256, stylexNextProfile(nextVersion).proxyRenameCreator[1], "Next proxy rename creator differs from its selected Next profile");
    const initial = artifact(rename.initial, "Next proxy initial JavaScript");
    assert.equal(initial.path, "server/proxy.js", "Next proxy initial JavaScript path changed");
    const final = artifact(rename.output, "Next proxy final JavaScript");
    assert.deepEqual(final, { ...initial, path: "server/middleware.js" }, "Next proxy rename must preserve exact JavaScript bytes");
    const sourceMap = artifact(rename.sourceMap, "Next proxy source map");
    assert.equal(sourceMap.path, "server/proxy.js.map", "Next proxy rename must preserve its original source-map path");
    const absent = ["server/proxy.js", "server/proxy.js.nft.json"] as const;
    assert.deepEqual(rename.absent, absent, "Next proxy rename must prove both original paths absent");
    return { asset, output, proxyRename: { absent, creator, initial, output: final, sourceMap }, semantics: "observation-only" };
  }
  return { asset, output, semantics: "observation-only" };
}

export function validateStylexNextPostprocessingReceipt(value: unknown): StylexNextPostprocessingReceiptV1 {
  const record = object(value, "Next postprocessing receipt");
  keys(record, ["adapterVersion", "attemptId", "auxiliaryTraceSnapshots", "compilerSha256", "graphs", "kind", "mode", "nextVersion", "outputDirectory", "planSha256", "schemaVersion", "ssg"], "Next postprocessing receipt");
  assert.equal(record.adapterVersion, STYLEX_NEXT_ADAPTER_VERSION);
  assert.equal(record.compilerSha256, compilerSha256);
  assert.equal(record.kind, "hraness-stylex-next-postprocessing");
  const nextVersion = stylexNextVersion(record.nextVersion);
  assert.equal(record.schemaVersion, 1);
  assert.ok(record.mode === "discovery" || record.mode === "delivery", "Next postprocessing requires a production mode");
  assert.ok(Array.isArray(record.auxiliaryTraceSnapshots) && record.auxiliaryTraceSnapshots.length <= 100_000, "Next auxiliaryTraceSnapshots must be a bounded array");
  const auxiliaryTraceSnapshots = record.auxiliaryTraceSnapshots.map((value) => validateStylexNextAuxiliaryTraceSnapshot(value, nextVersion));
  const auxiliaryPaths = auxiliaryTraceSnapshots.map(({ output }) => output.path);
  assert.deepEqual(auxiliaryPaths, [...new Set(auxiliaryPaths)].sort(), "Next auxiliary snapshots must be unique and path sorted");
  assert.ok(Array.isArray(record.ssg) && record.ssg.length <= 1, "Next postprocessing permits at most one client SSG asset");
  const ssg = record.ssg.map((value: unknown): StylexNextSsgPostprocessingV1 => {
    const item = object(value, "Next SSG postprocessing");
    keys(item, ["buildId", "creators", "initial", "inputs", "locales", "output", "package", "routes"], "Next SSG postprocessing");
    const buildId = string(item.buildId, "Next SSG build ID");
    assert.ok(buildId.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(buildId), "Next SSG build ID must be one safe segment");
    const initial = object(item.initial, "Next SSG initial asset");
    keys(initial, ["input", "output", "role"], "Next SSG initial asset");
    assert.equal(initial.role, "ssg-manifest");
    const initialOutput = artifact(initial.output, "Next SSG initial output");
    assert.deepEqual(initialOutput, { bytes: Buffer.byteLength(STYLEX_NEXT_SSG_INITIAL_SOURCE), path: `static/${buildId}/_ssgManifest.js`, sha256: sha256(STYLEX_NEXT_SSG_INITIAL_SOURCE) }, "Next SSG initial asset differs from the pinned creator");
    const creators = artifacts(item.creators, "Next SSG creators");
    assert.deepEqual(creators.map(({ path, sha256 }) => [path, sha256]), stylexNextProfile(nextVersion).ssgInputs.map(([path, hash]) => [`node_modules/next/${path}`, hash]), "Next SSG creators differ from the pinned inputs");
    const initialInput = artifact(initial.input, "Next SSG initial input");
    assert.deepEqual(initialInput, creators.find(({ path }) => path === `node_modules/next/${STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"][0]}`), "Next SSG initial creator is not bound");
    const inputs = artifacts(item.inputs, "Next SSG inputs");
    assert.deepEqual(inputs.map(({ path }) => path), ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json"], "Next SSG requires its exact native input inventory");
    assert.deepEqual(inputs[0], { bytes: Buffer.byteLength(buildId, "utf8"), path: "BUILD_ID", sha256: sha256(buildId) }, "Next SSG BUILD_ID artifact differs from its declared UTF-8 build ID");
    const output = artifact(item.output, "Next SSG final output");
    assert.equal(output.path, initialOutput.path, "Next SSG final path changed");
    const packageArtifact = artifact(item.package, "Next SSG package");
    assert.equal(packageArtifact.path, "node_modules/next/package.json");
    assert.ok(item.locales === null || Array.isArray(item.locales), "Next SSG locales must be null or an array");
    const locales = item.locales === null ? null : orderedStrings(item.locales, "Next SSG locales");
    if (locales !== null) {
      assert.ok(locales.length > 0 && locales.length <= 100, "Next SSG locale inventory is out of bounds");
      assert.ok(locales.every((locale) => /^[A-Za-z0-9-]+$/u.test(locale) && locale.length <= 100), "Next SSG locale is invalid");
      assert.equal(new Set(locales.map((locale) => locale.toLowerCase())).size, locales.length, "Next SSG locales contain a case-insensitive collision");
    }
    const routes = strings(item.routes, "Next SSG routes");
    const source = serializeStylexNextSsgRoutes(routes);
    assert.deepEqual(output, { bytes: Buffer.byteLength(source, "utf8"), path: initialOutput.path, sha256: sha256(source) }, "Next SSG final output differs from its exact declared route serialization");
    return { buildId, creators, initial: { input: initialInput, output: initialOutput, role: "ssg-manifest" }, inputs, locales, output, package: packageArtifact, routes };
  });
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: segment(record.attemptId, "Next postprocessing attempt ID"),
    auxiliaryTraceSnapshots,
    compilerSha256,
    graphs: graphIdentities(record.graphs, "Next postprocessing graphs"),
    kind: "hraness-stylex-next-postprocessing",
    mode: record.mode,
    nextVersion,
    outputDirectory: normalizeLogicalPath(record.outputDirectory, "Next postprocessing output directory"),
    planSha256: digest(record.planSha256, "Next postprocessing plan hash"),
    schemaVersion: 1,
    ssg,
  };
}

export function stylexNextReceiptSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}
