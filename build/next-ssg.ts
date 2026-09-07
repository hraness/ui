import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { StylexArtifactV1 } from "./contracts.js";
import { normalizeLogicalPath, sha256 } from "./compiler.js";
import {
  STYLEX_NEXT_REQUIRED_VERSION,
  STYLEX_NEXT_SSG_INITIAL_SOURCE,
  STYLEX_NEXT_SSG_INPUTS,
  serializeStylexNextSsgRoutes,
  type StylexNextFrameworkAssetV1,
  type StylexNextSsgPostprocessingV1,
} from "./next-contracts.js";

export { serializeStylexNextSsgRoutes } from "./next-contracts.js";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROUTES = 100_000;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${description} must be an object`);
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], description: string): void {
  const allowed = new Set([...required, ...optional]);
  assert.ok(Object.keys(value).every((key) => allowed.has(key)), `${description} has an unknown field`);
  assert.ok(required.every((key) => Object.hasOwn(value, key)), `${description} is missing a required field`);
}

function route(value: unknown): string {
  assert.ok(typeof value === "string" && value.startsWith("/") && value.length <= 4096 && !/[\u0000-\u001f\u007f]/u.test(value), "Next SSG route must be a bounded absolute URL pathname");
  return value;
}

function routeEntries(value: unknown): readonly [string, Record<string, unknown>][] {
  const entries = Object.entries(object(value, "Next SSG route table"));
  assert.ok(entries.length <= MAX_ROUTES, "Next SSG route table exceeds its bound");
  return entries.map(([key, value]) => [route(key), object(value, "Next SSG route metadata")]);
}

/** Only the fields consumed by the pinned native writer become receipt data. */
export function deriveStylexNextSsgRoutes(prerenderValue: unknown, routesValue: unknown): Readonly<{
  locales: readonly string[] | null;
  routes: readonly string[];
}> {
  const prerender = object(prerenderValue, "Next prerender manifest");
  knownKeys(prerender, ["version", "routes", "dynamicRoutes", "notFoundRoutes", "preview"], [], "Next prerender manifest");
  assert.equal(prerender.version, 4, "Next prerender manifest version changed");
  assert.ok(Array.isArray(prerender.notFoundRoutes) && prerender.notFoundRoutes.length <= MAX_ROUTES, "Next not-found route inventory is invalid");
  for (const value of prerender.notFoundRoutes) route(value);
  // Preview material is never returned, logged, or copied into the receipt.
  object(prerender.preview, "Next prerender preview metadata");
  const manifest = object(routesValue, "Next routes manifest");
  knownKeys(manifest, ["version", "appType", "staticRoutes", "dynamicRoutes"], [
    "pages404", "caseSensitive", "basePath", "redirects", "headers", "onMatchHeaders", "rewrites", "dataRoutes", "i18n", "rsc", "rewriteHeaders", "skipProxyUrlNormalize", "deploymentId", "ppr",
  ], "Next routes manifest");
  assert.equal(manifest.version, 3, "Next routes manifest version changed");
  // The reviewed production boundary is an App Router build. Unlike appDir,
  // a pages-only build's decision to call this writer is not recoverable from
  // its final prerender manifest (all SSG pages may have returned notFound).
  assert.ok(manifest.appType === "app" || manifest.appType === "hybrid", "Next SSG postprocessing requires the reviewed App Router writer branch");
  for (const name of ["staticRoutes", "dynamicRoutes"]) {
    const entries = manifest[name];
    assert.ok(Array.isArray(entries) && entries.length <= MAX_ROUTES, "Next routes manifest inventory is invalid");
    const pages = entries.map((entry: unknown) => route(object(entry, "Next routes manifest entry").page));
    assert.equal(new Set(pages).size, pages.length, "Next routes manifest contains duplicate page entries");
  }
  let locales: readonly string[] | null = null;
  if (manifest.i18n !== undefined) {
    const i18n = object(manifest.i18n, "Next routes i18n");
    knownKeys(i18n, ["locales", "defaultLocale"], ["domains", "localeDetection"], "Next routes i18n");
    assert.ok(Array.isArray(i18n.locales) && i18n.locales.length > 0 && i18n.locales.length <= 100, "Next locale inventory is invalid");
    locales = i18n.locales.map((locale: unknown) => {
      assert.ok(typeof locale === "string" && /^[A-Za-z0-9-]+$/u.test(locale) && locale.length <= 100, "Next locale is invalid");
      return locale;
    });
    assert.equal(new Set(locales.map((locale) => locale.toLowerCase())).size, locales.length, "Next locales contain a case-insensitive collision");
    assert.ok(typeof i18n.defaultLocale === "string" && locales.includes(i18n.defaultLocale), "Next default locale is absent from its locale inventory");
  }
  const statics = routeEntries(prerender.routes);
  const dynamics = routeEntries(prerender.dynamicRoutes);
  assert.ok(statics.length + dynamics.length <= MAX_ROUTES, "Next combined SSG route inventory exceeds its bound");
  const selected: string[] = [];
  for (const [path, metadata] of statics) {
    knownKeys(metadata, [], ["dataRoute", "experimentalBypassFor", "initialHeaders", "initialStatus", "initialRevalidateSeconds", "initialExpireSeconds", "prefetchDataRoute", "srcRoute", "experimentalPPR", "renderingMode", "allowHeader"], "Next static prerender metadata");
    if (metadata.srcRoute !== undefined && metadata.srcRoute !== null) { route(metadata.srcRoute); continue; }
    const segment = path.split("/", 2)[1];
    const locale = locales?.find((locale) => locale.toLowerCase() === segment?.toLowerCase());
    selected.push(locale === undefined ? path : path.slice(locale.length + 1) || "/");
  }
  for (const [path, metadata] of dynamics) {
    knownKeys(metadata, [], ["dataRoute", "dataRouteRegex", "experimentalBypassFor", "fallback", "remainingPrerenderableParams", "fallbackRevalidate", "fallbackExpire", "fallbackHeaders", "fallbackStatus", "fallbackRootParams", "fallbackRouteParams", "fallbackSourceRoute", "prefetchDataRoute", "prefetchDataRouteRegex", "routeRegex", "experimentalPPR", "renderingMode", "allowHeader"], "Next dynamic prerender metadata");
    // Next does not normalize the dynamic keys. Deduplication occurs only after
    // sorting the combined list, including legitimate localized collisions.
    selected.push(path);
  }
  return { locales, routes: [...new Set(selected.sort())] };
}

async function readBounded(root: string, logical: string): Promise<Readonly<{ artifact: StylexArtifactV1; source: string }>> {
  const path = normalizeLogicalPath(logical);
  const absolute = resolve(root, ...path.split("/"));
  assert.equal(await realpath(absolute), absolute, `Next SSG input traverses a symlink: ${path}`);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(before.isFile() && before.nlink === 1 && before.size <= MAX_BYTES, `Next SSG input must be a bounded ordinary single-link file: ${path}`);
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const identity = (stat: typeof before) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
    assert.equal(length, before.size, `Next SSG input changed while reading: ${path}`);
    assert.deepEqual(identity(await handle.stat()), identity(before), `Next SSG input changed while reading: ${path}`);
    assert.deepEqual(identity(await lstat(absolute)), identity(before), `Next SSG input was replaced while reading: ${path}`);
    assert.equal(await realpath(absolute), absolute, `Next SSG input path changed while reading: ${path}`);
    const bytes = buffer.subarray(0, length);
    const source = bytes.toString("utf8");
    assert.ok(Buffer.from(source).equals(bytes), `Next SSG input has invalid UTF-8: ${path}`);
    return { artifact: { bytes: length, path, sha256: sha256(bytes) }, source };
  } finally { await handle.close(); }
}

function parseNativeManifest(source: string): unknown {
  const value: unknown = JSON.parse(source);
  // The pinned formatter emits precisely this shape. This also rejects duplicate
  // JSON keys and alternate numeric/escape spellings rather than ignoring them.
  assert.ok(source === JSON.stringify(value, null, 2), "Next native manifest does not match its pinned formatter");
  return value;
}

export async function proveStylexNextSsgPostprocessing(
  root: string,
  outputRoot: string,
  initial: StylexNextFrameworkAssetV1,
): Promise<StylexNextSsgPostprocessingV1> {
  assert.equal(initial.role, "ssg-manifest", "Next postprocessing only owns the SSG role");
  const nextPackage = await readBounded(root, "node_modules/next/package.json");
  const packageMetadata = object(JSON.parse(nextPackage.source) as unknown, "Next package metadata");
  assert.equal(packageMetadata.name, "next");
  assert.equal(packageMetadata.version, STYLEX_NEXT_REQUIRED_VERSION, "Next SSG package version changed");
  const creators: StylexArtifactV1[] = [];
  for (const [path, expected] of STYLEX_NEXT_SSG_INPUTS) {
    const input = await readBounded(root, `node_modules/next/${path}`);
    assert.equal(input.artifact.sha256, expected, `Next SSG creator differs from pinned original bytes: ${path}`);
    creators.push(input.artifact);
  }
  assert.deepEqual(initial.input, creators.find(({ path }) => path === initial.input.path), "Next SSG original creator changed");
  const buildId = await readBounded(outputRoot, "BUILD_ID");
  assert.ok(buildId.source.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(buildId.source), "Next SSG BUILD_ID must be one safe segment");
  const path = `static/${buildId.source}/_ssgManifest.js`;
  assert.deepEqual(initial.output, { bytes: Buffer.byteLength(STYLEX_NEXT_SSG_INITIAL_SOURCE), path, sha256: sha256(STYLEX_NEXT_SSG_INITIAL_SOURCE) }, "Next SSG compiled asset differs from its original pinned source or BUILD_ID");
  const prerender = await readBounded(outputRoot, "prerender-manifest.json");
  const routes = await readBounded(outputRoot, "routes-manifest.json");
  const derived = deriveStylexNextSsgRoutes(parseNativeManifest(prerender.source), parseNativeManifest(routes.source));
  const output = await readBounded(outputRoot, path);
  assert.equal(output.source, serializeStylexNextSsgRoutes(derived.routes), "Next SSG postprocessed bytes differ from the exact pinned native derivation");
  return {
    buildId: buildId.source,
    creators,
    initial,
    inputs: [buildId.artifact, prerender.artifact, routes.artifact],
    locales: derived.locales,
    output: output.artifact,
    package: nextPackage.artifact,
    routes: derived.routes,
  };
}
