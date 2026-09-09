import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { parseSync } from "@babel/core";
import { transform as inspectCss } from "lightningcss";
import type { Plugin, ResolvedConfig } from "vite";

import {
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
  type StylexArtifactV1,
  type StylexGenerationHandleV1,
  type StylexGraphEdgeV1,
  type StylexPackageManifestV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  canonicalJson,
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
import { createViteSourceMapPaths, validateViteSourceMapPair, viteSourceMapProjectionChunkPath } from "./vite-source-maps.js";

export type StylexViteOptions = Readonly<{
  generation: StylexGenerationHandleV1;
  graphId: string;
  rootDirectory: string;
  sourceMaps?: "external";
}>;

type CssDependency = Readonly<{ kind: "css-import" | "css-url"; url: string }>;
type InputSnapshot = Readonly<{ bytes: number; sha256: string }>;

const javascriptFilter = /\.[cm]?[jt]sx?$/u;
const emittedJavaScriptFilter = /\.[cm]?[jt]sx?$/iu;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanModuleId(id: string): string {
  const query = id.indexOf("?");
  const fragment = id.indexOf("#");
  const boundary = query === -1
    ? fragment
    : fragment === -1
      ? query
      : Math.min(query, fragment);
  return boundary === -1 ? id : id.slice(0, boundary);
}

function hasUnsupportedAssetQuery(id: string): boolean {
  const query = id.split("?", 2)[1]?.split("#", 1)[0];
  return query !== undefined
    && query.split("&").some((part) => ["inline", "raw"].some((name) => part === name || part.startsWith(`${name}=`)));
}

function rootInputPath(id: string, rootDirectory: string): string | undefined {
  const clean = cleanModuleId(id);
  if (!isAbsolute(clean)) return undefined;
  const logical = relative(rootDirectory, clean).split(sep).join("/");
  assert.ok(
    logical.length > 0 && logical !== ".." && !logical.startsWith("../"),
    "Vite graph module escaped the declared root",
  );
  return normalizeLogicalPath(logical, "Vite graph input");
}

function packageBelowNodeModules(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const first = parts[index + 1]!;
  if (first.startsWith("@") && index + 2 < parts.length) return `${first}/${parts[index + 2]!}`;
  return first;
}

function packageRelativePath(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const packageSegments = parts[index + 1]!.startsWith("@") ? 2 : 1;
  const start = index + 1 + packageSegments;
  return start < parts.length ? parts.slice(start).join("/") : undefined;
}

function localTransformPath(id: string, rootDirectory: string): string | undefined {
  const logical = rootInputPath(id, rootDirectory);
  return logical === undefined || packageBelowNodeModules(logical) !== undefined ? undefined : logical;
}

function graphName(id: string, rootDirectory: string): string {
  const clean = cleanModuleId(id);
  const logical = rootInputPath(clean, rootDirectory);
  if (logical !== undefined) return `input:${logical}`;
  if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/iu.test(clean)) {
    return `external:${clean}`;
  }
  const stable = clean.replaceAll(rootDirectory, "<graph-root>");
  return `virtual:${sha256(stable)}`;
}

function externalGraphName(id: string): string {
  const clean = cleanModuleId(id);
  assert.ok(
    clean.length > 0
      && !clean.includes("\\")
      && !/[\u0000-\u001f\u007f]/u.test(clean),
    `Vite external import contains forbidden characters: ${id}`,
  );
  assert.ok(
    !isAbsolute(clean)
      && !/^[A-Za-z]:\//u.test(clean)
      && !clean.startsWith("./")
      && !clean.startsWith("../")
      && !clean.toLowerCase().startsWith("file:"),
    `Vite may not externalize a relative or absolute file from a complete graph: ${id}`,
  );
  assert.ok(
    id === clean && (isBuiltin(clean) || (
      /^(?:@[a-z0-9_-][a-z0-9._-]*\/)?[a-z0-9_-][a-z0-9._-]*(?:\/[a-z0-9._~-]+)*$/iu.test(clean)
      && clean.split("/").every((part) => part !== "." && part !== "..")
    )),
    `Vite external import must be a bare package or Node builtin, not a queried, private, or virtual module: ${id}`,
  );
  return `external:${clean}`;
}

type ParsedModule = Readonly<{
  codeSha256: string;
  importedIds: readonly string[];
  dynamicallyImportedIds: readonly string[];
}>;
type ModuleSnapshot = Readonly<{
  id: string;
  external: boolean;
  isEntry: boolean;
  codeSha256: string | null;
  importedIds: readonly string[];
  dynamicallyImportedIds: readonly string[];
}>;
type ModuleContext = Readonly<{
  meta: unknown;
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): unknown;
}>;

function moduleRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Vite module metadata is unavailable");
  return value as Record<string, unknown>;
}

function moduleEdges(value: unknown): readonly string[] {
  assert.ok(Array.isArray(value) && value.every((id: unknown) => typeof id === "string" && id.length > 0),
    "Vite module dependencies must contain exact module IDs");
  return [...value] as string[];
}

function parsedModule(value: unknown): ParsedModule {
  const info = moduleRecord(value);
  assert.equal(typeof info.code, "string", "Vite parsed internal module must have available code");
  return {
    codeSha256: sha256(info.code as string),
    importedIds: moduleEdges(info.importedIds),
    dynamicallyImportedIds: moduleEdges(info.dynamicallyImportedIds),
  };
}

function snapshotModules(context: ModuleContext, parsed: ReadonlyMap<string, ParsedModule>): readonly ModuleSnapshot[] {
  const meta = moduleRecord(context.meta);
  assert.ok(typeof meta.rollupVersion === "string" && meta.rollupVersion.length > 0, "Vite bundler identity is unavailable");
  // Rolldown documents rollupVersion as a dummy compatibility value. Its own
  // public version field selects the ModuleInfo contract, never a missing flag.
  const rolldown = "rolldownVersion" in meta;
  if (rolldown) assert.ok(typeof meta.rolldownVersion === "string" && meta.rolldownVersion.length > 0);
  const ids = [...context.getModuleIds()];
  assert.ok(ids.length > 0 && ids.length <= 100_000 && ids.every((id) => typeof id === "string" && id.length > 0));
  const membership = new Set(ids);
  assert.equal(membership.size, ids.length, "Vite module census contains duplicate IDs");
  for (const id of parsed.keys()) assert.ok(membership.has(id), `Vite parsed module disappeared from the terminal census: ${id}`);
  return ids.sort(compareStrings).map((id) => {
    const info = moduleRecord(context.getModuleInfo(id));
    assert.equal(info.id, id, "Vite module metadata ID differs from its census entry");
    assert.equal(typeof info.isEntry, "boolean", "Vite module entry status is unavailable");
    const importedIds = moduleEdges(info.importedIds);
    const dynamicallyImportedIds = moduleEdges(info.dynamicallyImportedIds);
    const attestation = parsed.get(id);
    let external: boolean;
    if (rolldown) {
      assert.equal("isExternal" in info, false, "Rolldown external classification must use its parsed-module census");
      external = attestation === undefined;
    } else {
      assert.equal(typeof info.isExternal, "boolean", "Rollup must explicitly classify external modules");
      external = info.isExternal as boolean;
    }
    if (external) {
      assert.equal(attestation, undefined, `Vite parsed internal module was classified external: ${id}`);
      assert.equal(info.code, null, `Vite unparsed external module has code: ${id}`);
      assert.equal(info.isEntry, false, `Vite external module may not be an entry: ${id}`);
      assert.deepEqual(importedIds, [], `Vite external module has internal dependencies: ${id}`);
      assert.deepEqual(dynamicallyImportedIds, [], `Vite external module has dynamic dependencies: ${id}`);
      externalGraphName(id);
    } else {
      assert.ok(attestation !== undefined, `Vite internal module lacks a moduleParsed attestation: ${id}`);
      assert.deepEqual(parsedModule(info), attestation, `Vite module changed after parsing: ${id}`);
    }
    for (const dependency of [...importedIds, ...dynamicallyImportedIds]) {
      assert.ok(membership.has(dependency), `Vite dependency is absent from the terminal module census: ${dependency}`);
    }
    return { id, external, isEntry: info.isEntry as boolean, codeSha256: external ? null : attestation!.codeSha256, importedIds, dynamicallyImportedIds };
  });
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

function targetsStylexRuntime(id: string, rootDirectory: string): boolean {
  const clean = cleanModuleId(id);
  if (clean === "@stylexjs/stylex" || clean.startsWith("@stylexjs/stylex/")) return true;
  const logical = rootInputPath(clean, rootDirectory);
  return logical !== undefined && packageBelowNodeModules(logical) === "@stylexjs/stylex";
}

function verifyStylexDependencyEdges(
  importerId: string,
  importedIds: readonly string[],
  rootDirectory: string,
  manifests: readonly StylexPackageManifestV1[],
): void {
  const importer = rootInputPath(importerId, rootDirectory);
  if (importer === undefined) return;
  const dependencyPackage = packageBelowNodeModules(importer);
  if (dependencyPackage === undefined || dependencyPackage === "@stylexjs/stylex") return;
  if (!importedIds.some((id) => targetsStylexRuntime(id, rootDirectory))) return;
  assert.ok(
    manifests.some((manifest) => manifest.package.name === dependencyPackage),
    `StyleX dependency ${dependencyPackage} has no verified package manifest`,
  );
}

function inspectStylexViteCss(
  source: string,
  filename: string,
  manifests: readonly StylexPackageManifestV1[],
): readonly CssDependency[] {
  auditCssWithoutStandaloneRecipes(source, manifests, `Vite CSS input ${filename}`);
  const dependencies: CssDependency[] = [];
  const result = inspectCss({
    code: Buffer.from(source),
    filename,
    minify: false,
    visitor: {
      Rule: {
        import(rule) {
          dependencies.push({ kind: "css-import", url: rule.value.url });
        },
      },
      Url(url) {
        dependencies.push({ kind: "css-url", url: url.url });
      },
    },
  });
  assert.equal(result.warnings.length, 0, `Vite CSS inspection emitted warnings for ${filename}`);
  return dependencies.sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));
}

function externalCssUrl(url: string): boolean {
  return /^(?:data:|https?:|blob:|#|\/\/)/iu.test(url);
}

function rejectOutputOverrides(config: Record<string, unknown>): void {
  assert.equal(config.root, undefined, "The StyleX Vite adapter owns Vite root");
  assert.equal(config.publicDir, undefined, "The StyleX Vite adapter disables Vite public-directory copying");
  const build = config.build;
  if (build === undefined) return;
  assert.ok(typeof build === "object" && build !== null && !Array.isArray(build), "Vite build config must be an object");
  const record = build as Record<string, unknown>;
  assert.ok(
    record.sourcemap === undefined || record.sourcemap === false,
    "The StyleX Vite adapter accepts only build.sourcemap false or undefined",
  );
  for (const key of ["assetsInlineLimit", "outDir", "assetsDir", "copyPublicDir", "cssCodeSplit", "emptyOutDir", "lib", "write"] as const) {
    assert.equal(record[key], undefined, `The StyleX Vite adapter owns build.${key}`);
  }
  for (const [alias, bundler] of bundlerOptionRecords(record)) {
    assert.equal(bundler.external, undefined, `The StyleX Vite adapter owns ${alias} externalization`);
    assert.equal(bundler.input, undefined, `The StyleX Vite adapter owns ${alias} input`);
    assert.equal(bundler.output, undefined, `The StyleX Vite adapter owns ${alias} output paths`);
  }
}

function bundlerOptionRecords(build: object): readonly (readonly [string, Record<string, unknown>])[] {
  const record = build as Record<string, unknown>;
  return ["rollupOptions", "rolldownOptions"].flatMap((alias) => {
    const value = record[alias];
    if (value === undefined) return [];
    assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `Vite ${alias} must be an object`);
    return [[alias, value as Record<string, unknown>] as const];
  });
}

type EmittedAsset = Readonly<{
  fileName: string;
  originalFileName?: string | null;
  originalFileNames?: readonly string[];
  source: string | Uint8Array;
  type: "asset";
}>;

type EmittedChunk = Readonly<{
  code: string;
  dynamicImports: readonly string[];
  facadeModuleId: string | null;
  fileName: string;
  imports: readonly string[];
  isEntry: boolean;
  preliminaryFileName?: string;
  map: unknown;
  modules: Readonly<Record<string, unknown>>;
  type: "chunk";
}>;

type BundleSnapshot = Readonly<{
  artifact: StylexArtifactV1;
  linkage: string;
}>;

function rejectJavaScriptSourceMapComments(source: string, path: string, companion?: string): void {
  const plugins: ("jsx" | "typescript")[] = [];
  if (/\.[cm]?tsx?$/iu.test(path)) plugins.push("typescript");
  if (/\.[cm]?[jt]sx$/iu.test(path)) plugins.push("jsx");
  const parsed = parseSync(source, {
    babelrc: false, configFile: false, filename: path, sourceType: "unambiguous",
    parserOpts: { plugins, allowReturnOutsideFunction: true },
  });
  assert.ok(parsed !== null, `Vite output JavaScript could not be inspected: ${path}`);
  const annotations = (parsed.comments ?? []).filter((comment) => /^\s*[@#]\s*sourceMappingURL\s*=/u.test(comment.value));
  if (companion === undefined) {
    assert.equal(annotations.length, 0, `StyleX Vite does not support source-map references: ${path}`);
  } else {
    assert.equal(annotations.length, 1, `Vite chunk requires exactly one source-map reference: ${path}`);
    const annotation = annotations[0]!;
    assert.equal(annotation.type, "CommentLine", "Vite source-map reference must be the native terminal line comment");
    assert.equal(annotation.value.trim(), `# sourceMappingURL=${companion}`, `Vite source-map reference differs from its companion: ${path}`);
    assert.ok(typeof annotation.end === "number" && source.slice(annotation.end).trim() === "", "Vite source-map reference must be terminal");
  }
}

function rejectCssSourceMapComments(source: string, path: string): void {
  // The CSS has already passed Lightning CSS's parser. Recognize comments
  // outside string and URL tokens without mistaking their literal contents for
  // annotations. CSS escapes apply to URL function names as well as values.
  const whitespace = (character: string | undefined): boolean => character !== undefined && /[\t\n\f\r ]/u.test(character);
  const nameCharacter = (character: string | undefined): boolean => character !== undefined && /[-_a-z0-9\u0080-\uffff]/iu.test(character);
  const escape = (offset: number): readonly [number, string] => {
    let end = offset + 1;
    const start = end;
    while (end < source.length && end - start < 6 && /[a-f0-9]/iu.test(source[end]!)) end += 1;
    if (end > start) {
      const value = Number.parseInt(source.slice(start, end), 16);
      if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
      else if (whitespace(source[end])) end += 1;
      return [end, value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff) ? "\ufffd" : String.fromCodePoint(value)];
    }
    if (source[end] === "\r" && source[end + 1] === "\n") return [end + 2, ""];
    return [Math.min(end + 1, source.length), source[end] ?? ""];
  };
  let offset = 0;
  while (offset < source.length) {
    const character = source[offset]!;
    if (character === '"' || character === "'") {
      const quote = character;
      offset += 1;
      while (offset < source.length && source[offset] !== quote) {
        offset = source[offset] === "\\" ? escape(offset)[0] : offset + 1;
      }
      offset += 1;
    } else if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      assert.doesNotMatch(source.slice(offset + 2, end === -1 ? source.length : end), /^\s*[@#]\s*sourceMappingURL\s*=/u,
        `StyleX Vite does not support source-map references: ${path}`);
      offset = end === -1 ? source.length : end + 2;
    } else if (nameCharacter(character) || character === "\\") {
      let name = "";
      while (nameCharacter(source[offset]) || source[offset] === "\\") {
        if (source[offset] === "\\") {
          const [next, value] = escape(offset);
          name += value;
          offset = next;
        } else { name += source[offset]!; offset += 1; }
      }
      if (name.toLowerCase() !== "url" || source[offset] !== "(") continue;
      offset += 1;
      while (whitespace(source[offset])) offset += 1;
      if (source[offset] === '"' || source[offset] === "'") continue;
      while (offset < source.length && source[offset] !== ")") {
        offset = source[offset] === "\\" ? escape(offset)[0] : offset + 1;
      }
      offset += 1;
    } else offset += 1;
  }
}

function snapshotBundle(
  bundle: Readonly<Record<string, EmittedAsset | EmittedChunk>>,
  rootDirectory: string,
  bundlerMeta: unknown,
  mapPaths?: ReturnType<typeof createViteSourceMapPaths>,
): readonly BundleSnapshot[] {
  const mapIdentities = new Map<string, string>();
  if (mapPaths !== undefined) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      const mapPath = `${chunk.fileName}.map`;
      const asset = bundle[mapPath];
      assert.ok(asset?.type === "asset" && asset.fileName === mapPath, `Vite chunk lacks its exact source-map companion: ${chunk.fileName}`);
      assert.deepEqual(emittedAssetProvenance(asset, rootDirectory), [], "Vite source-map companions may not be copied source assets");
      const projectionChunkPath = viteSourceMapProjectionChunkPath(bundlerMeta, chunk.fileName, chunk.preliminaryFileName);
      const requiredSources = Object.entries(chunk.modules).flatMap(([id, metadata]) => {
        const logical = rootInputPath(id, rootDirectory);
        const module = moduleRecord(metadata);
        assert.ok(typeof module.renderedLength === "number" && Number.isSafeInteger(module.renderedLength) && module.renderedLength >= 0,
          "Vite mapped chunk must expose native rendered module lengths");
        return logical !== undefined && module.renderedLength > 0 ? [logical] : [];
      });
      const options: Parameters<typeof validateViteSourceMapPair>[2] = { chunkPath: chunk.fileName,
        projectionChunkPath, requiredSources, code: chunk.code, paths: mapPaths, bundlerMeta };
      const raw = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
      const parsed: unknown = JSON.parse(raw);
      assert.equal(raw, JSON.stringify(parsed), "Vite source-map companion must use the exact native JSON serialization without duplicate keys");
      const identity = validateViteSourceMapPair(chunk.map, parsed, options);
      mapIdentities.set(mapPath, identity);
    }
  }
  // Rolldown does not preserve bundle object identity between hooks. Snapshot
  // bytes and public linkage values, never an output object or backing buffer.
  return Object.values(bundle).map((output) => {
    const path = normalizeLogicalPath(output.fileName, "Vite output path");
    const map = mapIdentities.get(path);
    assert.ok(!/\.map$/iu.test(path) || map !== undefined, `StyleX Vite does not support unpaired source-map output: ${path}`);
    const bytes = output.type === "chunk"
      ? Buffer.from(output.code)
      : typeof output.source === "string" ? Buffer.from(output.source) : Buffer.from(output.source);
    if (output.type === "chunk" || emittedJavaScriptFilter.test(path)) {
      assert.ok(mapPaths === undefined || output.type === "chunk", "External Vite maps do not support copied JavaScript assets");
      rejectJavaScriptSourceMapComments(bytes.toString("utf8"), path, mapPaths === undefined ? undefined : `${basename(path)}.map`);
    } else if (/\.css$/iu.test(path)) {
      rejectCssSourceMapComments(bytes.toString("utf8"), path);
    }
    let linkage: string;
    if (output.type === "chunk") {
      assert.ok(mapPaths !== undefined || output.map === null || output.map === undefined, `StyleX Vite does not support chunk source maps: ${path}`);
      linkage = canonicalJson({
        dynamicImports: [...output.dynamicImports],
        facade: output.facadeModuleId === null ? null : graphName(output.facadeModuleId, rootDirectory),
        imports: [...output.imports],
        isEntry: output.isEntry,
        modules: Object.keys(output.modules).map((id) => graphName(id, rootDirectory)).sort(compareStrings),
        ...(mapPaths === undefined ? {} : { sourceMap: mapIdentities.get(`${path}.map`) }),
        type: output.type,
      });
    } else {
      linkage = canonicalJson({
        provenance: /\.css$/iu.test(path) || map !== undefined ? [] : emittedAssetProvenance(output, rootDirectory),
        type: output.type,
      });
    }
    return { artifact: { bytes: bytes.byteLength, path, sha256: sha256(bytes) }, linkage };
  }).sort((left, right) => compareStrings(left.artifact.path, right.artifact.path));
}

function emittedAssetProvenance(output: EmittedAsset, rootDirectory: string): readonly string[] {
  const names = [...(output.originalFileNames ?? [])];
  if (output.originalFileName !== null && output.originalFileName !== undefined) {
    assert.ok(
      names.length === 0 || names.includes(output.originalFileName),
      `Vite asset provenance fields disagree for ${output.fileName}`,
    );
    names.push(output.originalFileName);
  }
  return [...new Set(names)].map((name) => {
    assert.ok(
      name.length > 0 && !name.includes("?") && !name.includes("#"),
      `Vite asset provenance is not an ordinary source path for ${output.fileName}`,
    );
    const absolute = isAbsolute(name) ? name : resolve(rootDirectory, name);
    const logical = rootInputPath(absolute, rootDirectory);
    assert.ok(logical !== undefined, `Vite asset provenance is not root-contained for ${output.fileName}`);
    return logical;
  }).sort(compareStrings);
}

function assertOwnedOutputDirectory(
  outputOptions: Readonly<{
    dir?: string | undefined;
    file?: string | undefined;
    sourcemap?: boolean | "hidden" | "inline" | undefined;
    sourcemapPathTransform?: ((sourcePath: string, mapPath: string) => string) | undefined;
    // Rollup and Rolldown expose different option unions. This is a foreign
    // value until the exact adapter-owned callback identity is checked below.
    sourcemapIgnoreList?: unknown;
  }>,
  outputDirectory: string,
  mapPaths?: ReturnType<typeof createViteSourceMapPaths>,
): void {
  assert.equal(outputOptions.file, undefined, "StyleX Vite does not support a single-file output override");
  assert.ok(typeof outputOptions.dir === "string", "StyleX Vite requires an owned Rollup output directory");
  assert.equal(resolve(outputOptions.dir), outputDirectory, "Rollup output escaped the owned graph staging root");
  assert.ok(
    mapPaths === undefined
      ? outputOptions.sourcemap === undefined || outputOptions.sourcemap === false
      : outputOptions.sourcemap === true,
    mapPaths === undefined
      ? "StyleX Vite requires Rollup sourcemap output to remain disabled"
      : "StyleX Vite requires Rollup sourcemap output to match its owned profile",
  );
  if (mapPaths !== undefined) {
    assert.equal(outputOptions.sourcemapPathTransform, mapPaths.transform, "Vite source-map path projection was replaced");
    assert.equal(outputOptions.sourcemapIgnoreList, mapPaths.ignore, "Vite source-map ignore callback was replaced");
  }
}

export function stylexVite(options: StylexViteOptions): Plugin {
  assert.ok(options.sourceMaps === undefined || options.sourceMaps === "external", "StyleX Vite sourceMaps must be external or omitted");
  const rootDirectory = resolve(options.rootDirectory);
  const collector = createStylexTransformCollector(rootDirectory);
  const transformed = new Set<string>();
  const auditedCss = new Set<string>();
  const cssInputs = new Set<string>();
  const nativeInputs = new Set<string>();
  const emittedAssetInputs = new Set<string>();
  const cssEdges: StylexGraphEdgeV1[] = [];
  const inputSnapshots = new Map<string, InputSnapshot>();
  const parsedModules = new Map<string, ParsedModule>();
  let terminalModules: readonly ModuleSnapshot[] | undefined;
  let moduleCollectionEnded = false;
  let configured = false;
  let resolved = false;
  let complete = false;
  let sealedRules: ReturnType<typeof collector.seal> | undefined;
  let prepared: Awaited<ReturnType<typeof prepareStylexGraph>> | undefined;
  let plannedOutput: Readonly<{ outputDirectory: string; outputRoot: string }> | undefined;
  let loaded: Awaited<ReturnType<typeof loadStylexGeneration>> | undefined;
  let resolvedConfig: ResolvedConfig | undefined;
  let generatedBundle: readonly BundleSnapshot[] | undefined;
  let mapPaths: ReturnType<typeof createViteSourceMapPaths> | undefined;

  const snapshotInput = (logical: string, bytes: string | Uint8Array): void => {
    const snapshot = {
      bytes: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength,
      sha256: sha256(bytes),
    };
    const previous = inputSnapshots.get(logical);
    if (previous === undefined) inputSnapshots.set(logical, snapshot);
    else assert.deepEqual(snapshot, previous, `Vite input changed between loads: ${logical}`);
  };

  const readAndSnapshotInput = async (logical: string): Promise<Buffer> => {
    const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
    const bytes = await readFile(ordinary);
    snapshotInput(logical, bytes);
    return bytes;
  };

  const validateResolvedConfig = (config: ResolvedConfig): void => {
    assert.equal(configured, true, "StyleX Vite config was not prepared");
    assert.equal(config.command, "build", "StyleX Vite supports build mode only");
    assert.ok(config.build.watch === null || config.build.watch === undefined, "StyleX Vite does not support watch mode");
    assert.ok(plannedOutput !== undefined && loaded !== undefined);
    assert.equal(resolve(config.root), rootDirectory, "Resolved Vite root differs from the owned graph root");
    const publicDirectory: unknown = config.publicDir;
    assert.ok(
      publicDirectory === false || publicDirectory === "",
      "StyleX Vite must disable public-directory copying",
    );
    assert.equal(config.build.copyPublicDir, false, "StyleX Vite must own all graph output files");
    assert.equal(config.build.assetsInlineLimit, 0, "StyleX Vite must disable implicit asset inlining");
    assert.equal(config.build.cssCodeSplit, false, "StyleX Vite must emit one complete graph stylesheet");
    assert.equal(resolve(config.build.outDir), plannedOutput.outputDirectory, "Resolved Vite outDir differs from the graph staging root");
    assert.equal(config.build.sourcemap, options.sourceMaps === "external", options.sourceMaps === "external"
      ? "StyleX Vite sourcemap output differs from its owned profile"
      : "StyleX Vite must disable sourcemap output");
    assert.equal(config.build.write, true, "StyleX Vite requires filesystem output for receipt sealing");
    const graph = loaded.expectedGraph(options.graphId);
    const bundlers = bundlerOptionRecords(config.build);
    assert.ok(bundlers.length > 0, "StyleX Vite requires resolved bundler input");
    for (const [alias, bundler] of bundlers) {
      assert.equal(bundler.output, undefined, `The StyleX Vite adapter owns resolved Rollup output options (${alias})`);
      assert.equal(bundler.external, undefined, `The StyleX Vite adapter owns resolved ${alias} externalization`);
      assert.deepEqual(bundler.input, graph.entrypoints.map((entrypoint) => resolve(rootDirectory, entrypoint)),
        `Resolved ${alias} input differs from the declared graph`);
    }
    const target = config.build.ssr === false || config.build.ssr === undefined ? "client" : "ssr";
    assert.equal(target, graph.kind, `Vite target differs from graph ${graph.id}`);
  };

  return {
    name: "@hraness/ui-stylex-vite",
    enforce: "pre",
    async config(config, environment) {
      assert.equal(environment.command, "build", "StyleX Vite supports one-shot builds only; serve and HMR are unsupported");
      assert.equal(configured, false, "StyleX Vite may be configured only once");
      rejectOutputOverrides(config as Record<string, unknown>);
      assert.ok(config.build?.watch === null || config.build?.watch === undefined, "StyleX Vite does not support watch mode");
      loaded = await loadStylexGeneration(options.generation);
      const graph = loaded.expectedGraph(options.graphId);
      assert.equal(graph.adapter, "vite", `Graph ${graph.id} is not a Vite graph`);
      const outputRoot = `.stylex-generation/graphs/${graph.id}/output`;
      plannedOutput = {
        outputDirectory: join(options.generation.directory, ...outputRoot.split("/")),
        outputRoot,
      };
      if (options.sourceMaps === "external") {
        mapPaths = createViteSourceMapPaths({
          rootDirectory,
          stagingDirectory: plannedOutput.outputDirectory,
          publishedDirectory: join(dirname(options.generation.directory), loaded.plan.generationId, "graphs", graph.id),
          inputIdentity: (path) => inputSnapshots.get(path),
        });
      }
      configured = true;
      return {
        publicDir: false,
        root: rootDirectory,
        build: {
          assetsInlineLimit: 0,
          copyPublicDir: false,
          cssCodeSplit: false,
          emptyOutDir: false,
          outDir: plannedOutput.outputDirectory,
          rollupOptions: { input: graph.entrypoints.map((entrypoint) => resolve(rootDirectory, entrypoint)) },
          sourcemap: options.sourceMaps === "external",
          write: true,
        },
      };
    },
    async configResolved(config) {
      validateResolvedConfig(config);
      resolvedConfig = config;
      resolved = true;
    },
    outputOptions(output) {
      if (mapPaths === undefined) return null;
      assert.equal(output.sourcemapPathTransform, undefined, "StyleX Vite owns source-map path projection");
      assert.equal(output.sourcemap, true, "StyleX Vite external source maps must remain enabled");
      assert.ok(output.sourcemapExcludeSources === undefined || output.sourcemapExcludeSources === false,
        "StyleX Vite source maps require exact embedded input contents");
      assert.equal(output.sourcemapBaseUrl, undefined, "StyleX Vite source maps must be local companions");
      return { ...output, sourcemapPathTransform: mapPaths.transform, sourcemapIgnoreList: mapPaths.ignore };
    },
    moduleParsed(info) {
      assert.equal(moduleCollectionEnded, false, "Vite parsed a module after terminal collection");
      assert.ok(typeof info.id === "string" && info.id.length > 0);
      assert.equal(parsedModules.has(info.id), false, `Vite parsed a module more than once: ${info.id}`);
      parsedModules.set(info.id, parsedModule(info));
    },
    buildEnd: {
      order: "post",
      handler(error) {
        assert.equal(moduleCollectionEnded, false, "Vite module collection may finish only once");
        moduleCollectionEnded = true;
        if (error !== undefined) return;
        terminalModules = snapshotModules(this, parsedModules);
      },
    },
    renderStart() {
      assert.ok(terminalModules !== undefined, "Vite modules were not sealed by a successful buildEnd");
      assert.deepEqual(snapshotModules(this, parsedModules), terminalModules,
        "Vite module census changed after terminal collection");
    },
    load: {
      order: "pre",
      async handler(id) {
        assert.equal(hasUnsupportedAssetQuery(id), false, `Vite content-inlining asset queries are unsupported: ${id}`);
        const logical = rootInputPath(id, rootDirectory);
        if (logical !== undefined) await readAndSnapshotInput(logical);
        return null;
      },
    },
    async transform(code, id) {
      assert.equal(resolved, true, "StyleX Vite received a module before config resolution");
      const loadedGeneration = loaded;
      assert.ok(loadedGeneration !== undefined);
      const clean = cleanModuleId(id);
      const input = rootInputPath(clean, rootDirectory);
      if (input !== undefined) {
        if (javascriptFilter.test(clean) || /\.css$/iu.test(clean)) snapshotInput(input, code);
        else await readAndSnapshotInput(input);
      }
      if (/\.css$/iu.test(clean)) {
        const auditCss = async (source: string, sourceId: string): Promise<void> => {
          const sourceClean = cleanModuleId(sourceId);
          const logical = rootInputPath(sourceClean, rootDirectory);
          if (logical !== undefined) {
            cssInputs.add(logical);
            snapshotInput(logical, source);
          }
          if (auditedCss.has(sourceClean)) return;
          auditedCss.add(sourceClean);
          const dependencies = inspectStylexViteCss(
            source,
            sourceClean,
            loadedGeneration.packageManifests,
          );
          for (const dependency of dependencies) {
            const from = graphName(sourceClean, rootDirectory);
            if (externalCssUrl(dependency.url)) {
              cssEdges.push({ external: true, from, kind: dependency.kind, to: `resource:${sha256(dependency.url)}` });
              continue;
            }
            const resolution = await this.resolve(dependency.url, sourceClean, { skipSelf: true });
            assert.ok(resolution !== null && resolution !== undefined, `Unresolved owned CSS import ${dependency.url} from ${from}`);
            assert.ok(
              resolution.external === undefined || resolution.external === false,
              `Owned CSS import may not be external: ${dependency.url}`,
            );
            const target = cleanModuleId(resolution.id);
            assert.ok(isAbsolute(target), `Owned CSS dependency is not an auditable file: ${dependency.url}`);
            cssEdges.push({ external: false, from, kind: dependency.kind, to: graphName(target, rootDirectory) });
            const targetLogical = rootInputPath(target, rootDirectory);
            assert.ok(targetLogical !== undefined);
            const targetBytes = await readAndSnapshotInput(targetLogical);
            if (dependency.kind === "css-url") {
              nativeInputs.add(targetLogical);
              continue;
            }
            assert.ok(/\.css$/iu.test(target), `Owned CSS import is not a CSS file: ${dependency.url}`);
            await auditCss(targetBytes.toString("utf8"), target);
          }
        };
        await auditCss(code, clean);
        return null;
      }
      if (input === undefined || !javascriptFilter.test(clean)) return null;
      if (packageBelowNodeModules(input) !== undefined) return null;
      const logical = localTransformPath(clean, rootDirectory);
      assert.ok(logical !== undefined);
      assert.equal(transformed.has(logical), false, `Vite transformed ${logical} more than once`);
      transformed.add(logical);
      if (mapPaths !== undefined) {
        // The bundler resolves each transform map relative to this module's
        // directory. A basename avoids duplicating its repository subdirectory.
        const result = await collector.transformWithMap(code, clean, { logicalSourceFileName: basename(clean) });
        return { code: result.code, map: canonicalJson(result.map) };
      }
      const result = await collector.transform(code, clean);
      return { code: result.code, map: null };
    },
    generateBundle: {
      order: "post",
      async handler(outputOptions, bundle) {
        assert.equal(resolved, true, "StyleX Vite bundle was generated before config resolution");
        const loadedGeneration = loaded;
        const finalConfig = resolvedConfig;
        const outputPlan = plannedOutput;
        assert.ok(loadedGeneration !== undefined && finalConfig !== undefined && outputPlan !== undefined);
        validateResolvedConfig(finalConfig);
        assertOwnedOutputDirectory(outputOptions, outputPlan.outputDirectory, mapPaths);
        assert.equal(prepared, undefined, "StyleX Vite graph staging may be prepared only once");
        const preparedGraph = await prepareStylexGraph(options.generation, options.graphId);
        assert.deepEqual(preparedGraph, outputPlan, "Prepared Vite graph location differs from its configured output location");
        prepared = preparedGraph;
        assert.equal(sealedRules, undefined, "StyleX Vite may generate one bundle only");
        sealedRules = collector.seal();
        const bundleSnapshot = snapshotBundle(bundle, rootDirectory, this.meta, mapPaths);
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset") continue;
          const asset = output as EmittedAsset;
          if (mapPaths !== undefined && /\.map$/u.test(asset.fileName)) continue;
          const generatedCss = /\.css$/iu.test(asset.fileName);
          // With cssCodeSplit disabled, Vite reports the synthetic bundle label
          // `style.css` as an original file name. The actual CSS sources are
          // already snapshotted by the transform-time CSS graph audit; treating
          // this output label as an input path would invent a root file that
          // does not exist. Non-CSS assets must still carry exact source
          // provenance so their emitted bytes can be verified below.
          const provenance = generatedCss ? [] : emittedAssetProvenance(asset, rootDirectory);
          assert.ok(
            generatedCss || provenance.length > 0,
            `Vite emitted non-CSS asset without source provenance: ${asset.fileName}`,
          );
          if (generatedCss) {
            const css = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
            auditCssWithoutStandaloneRecipes(css, loadedGeneration.packageManifests, "Vite graph output");
            auditCssWithoutStylexRules(css, sealedRules, "Vite graph output");
          }
          const emittedBytes = typeof asset.source === "string" ? Buffer.from(asset.source) : Buffer.from(asset.source);
          for (const logical of provenance) {
            const sourceBytes = await readAndSnapshotInput(logical);
            emittedAssetInputs.add(logical);
            if (!generatedCss) {
              assert.deepEqual(
                { bytes: emittedBytes.byteLength, sha256: sha256(emittedBytes) },
                { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
                `Vite emitted asset differs from its source provenance: ${asset.fileName} <- ${logical}`,
              );
            }
          }
        }
        generatedBundle = bundleSnapshot;
      },
    },
    configureServer() {
      throw new Error("StyleX Vite does not support serve or HMR mode");
    },
    handleHotUpdate() {
      throw new Error("StyleX Vite does not support HMR");
    },
    writeBundle: {
      order: "post",
      async handler(outputOptions, bundle) {
        assert.equal(complete, false, "StyleX Vite may write one graph receipt only");
        const loadedGeneration = loaded;
        const preparedGraph = prepared;
        assert.ok(preparedGraph !== undefined && loadedGeneration !== undefined);
        assertOwnedOutputDirectory(outputOptions, preparedGraph.outputDirectory, mapPaths);
        const graph = loadedGeneration.expectedGraph(options.graphId);
        const rules = sealedRules;
        assert.ok(rules !== undefined, "Vite bundle rules were not sealed before receipt publication");
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset") continue;
          const asset = output as EmittedAsset;
          if (mapPaths !== undefined && /\.map$/u.test(asset.fileName)) continue;
          const path = normalizeLogicalPath(asset.fileName, "Vite output path");
          const generatedCss = /\.css$/iu.test(path);
          const provenance = generatedCss ? [] : emittedAssetProvenance(asset, rootDirectory);
          assert.ok(
            generatedCss || provenance.length > 0,
            `Vite emitted non-CSS asset without source provenance: ${path}`,
          );
          const settledBytes: Buffer = await readFile(
            join(preparedGraph.outputDirectory, ...path.split("/")),
          );
          for (const logical of provenance) {
            const sourceBytes = await readAndSnapshotInput(logical);
            emittedAssetInputs.add(logical);
            if (!generatedCss) {
              assert.deepEqual(
                { bytes: settledBytes.byteLength, sha256: sha256(settledBytes) },
                { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
                `Vite settled asset differs from its source provenance: ${path} <- ${logical}`,
              );
            }
          }
        }
        assert.ok(terminalModules !== undefined, "Vite modules were not sealed by a successful buildEnd");
        assert.deepEqual(snapshotModules(this, parsedModules), terminalModules,
          "Vite module census changed after terminal collection");
        const modules = new Map(terminalModules.map((info) => [info.id, info]));
        const moduleIds = terminalModules.filter(({ external }) => !external).map(({ id }) => id);
        const entrypoints = terminalModules
          .filter((info) => info.isEntry)
          .map((info) => rootInputPath(info.id, rootDirectory))
          .filter((id): id is string => id !== undefined)
          .sort();
        assert.deepEqual(entrypoints, [...graph.entrypoints].sort(), "Vite entry modules differ from the declared graph");
        const edges: StylexGraphEdgeV1[] = [...cssEdges];
        const dependency = (id: string): Readonly<{ external: boolean; to: string }> => {
          const info = modules.get(id);
          assert.ok(info !== undefined, `Vite dependency is absent from the terminal module census: ${id}`);
          const { external } = info;
          return {
            external,
            to: external ? externalGraphName(id) : graphName(id, rootDirectory),
          };
        };
        for (const info of terminalModules) {
          if (info.external) continue;
          const { id } = info;
          const from = graphName(id, rootDirectory);
          const importedIds = [...info.importedIds, ...info.dynamicallyImportedIds];
          verifyStylexDependencyEdges(
            id,
            importedIds,
            rootDirectory,
            loadedGeneration.packageManifests,
          );
          if (info.isEntry) edges.push({ external: false, from: "$entry", kind: "entry", to: from });
          for (const imported of info.importedIds) {
            const target = dependency(imported);
            edges.push({
              external: target.external,
              from,
              kind: "static-import",
              to: target.to,
            });
          }
          for (const imported of info.dynamicallyImportedIds) {
            const target = dependency(imported);
            edges.push({
              external: target.external,
              from,
              kind: "dynamic-import",
              to: target.to,
            });
          }
        }
        const canonicalEdges = [...new Map(edges.map((edge) => [canonicalJson(edge), edge])).values()]
          .sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));
        const expectedInputPaths = [...new Set([
          ...moduleIds.map((id) => rootInputPath(id, rootDirectory)).filter((id): id is string => id !== undefined),
          ...cssInputs,
          ...nativeInputs,
          ...emittedAssetInputs,
        ])].sort();
        assert.deepEqual(
          [...inputSnapshots.keys()].sort(),
          expectedInputPaths,
          "Vite input settlement differs from its module, CSS, and native-asset inventory",
        );
        const inputPaths = [...inputSnapshots.keys()].sort();
        for (const path of inputPaths.filter((path) => /\.css$/iu.test(path))) {
          assert.ok(cssInputs.has(path), `Vite CSS input bypassed the StyleX audit: ${path}`);
        }
        const inputs = await Promise.all(inputPaths.map(async (path) => {
          const artifact = await artifactForFile(rootDirectory, path);
          const snapshot = inputSnapshots.get(path);
          assert.ok(snapshot !== undefined);
          assert.deepEqual(
            { bytes: artifact.bytes, sha256: artifact.sha256 },
            snapshot,
            `Vite input changed during compilation: ${path}`,
          );
          verifyRegisteredPackageInput(path, artifact, loadedGeneration.packageManifests);
          return artifact;
        }));
        const outputPaths = Object.values(bundle).map((output) => normalizeLogicalPath(output.fileName, "Vite output path")).sort();
        assert.equal(new Set(outputPaths).size, outputPaths.length, "Vite output paths must be unique");
        const stylesheetOutputPaths = outputPaths.filter((path) => /\.css$/iu.test(path));
        assert.ok(
          stylesheetOutputPaths.length <= 1,
          `Vite graph ${graph.id} emitted split CSS despite the owned single-stylesheet contract`,
        );
        const hasStyledTemplate = loadedGeneration.plan.templates.some(
          (template) => template.stylesheetGraphId === graph.id,
        );
        if (graph.kind === "client" && hasStyledTemplate) {
          assert.equal(
            stylesheetOutputPaths.length,
            1,
            `Vite client graph ${graph.id} with a produced template must emit exactly one complete compiler-foundation stylesheet`,
          );
        }
        for (const path of stylesheetOutputPaths) {
          const css = await readFile(
            join(preparedGraph.outputDirectory, ...path.split("/")),
            "utf8",
          );
          auditCssWithoutStandaloneRecipes(css, loadedGeneration.packageManifests, "Vite settled graph output");
          auditCssWithoutStylexRules(css, rules, "Vite settled graph output");
        }
        const outputs = await Promise.all(outputPaths.map((path) => artifactForFile(preparedGraph.outputDirectory, path)));
        assert.ok(generatedBundle !== undefined, "StyleX Vite bundle snapshot was not sealed");
        assert.deepEqual(snapshotBundle(bundle, rootDirectory, this.meta, mapPaths), generatedBundle,
          "Vite bundle bytes or linkage changed after the generated snapshot");
        assert.deepEqual(outputs, generatedBundle.map(({ artifact }) => artifact),
          "Vite settled output differs from its generated byte snapshot");
        assert.deepEqual(snapshotModules(this, parsedModules), terminalModules,
          "Vite module census changed before receipt publication");
        await writeStylexGraphReceipt({
          generation: options.generation,
          rootDirectory,
          receipt: {
            adapter: "vite",
            compilerSha256,
            edges: canonicalEdges,
            entrypoints: graph.entrypoints,
            generationId: loadedGeneration.plan.generationId,
            graphId: graph.id,
            inputs,
            kind: "hraness-stylex-graph-receipt",
            outputRoot: preparedGraph.outputRoot,
            outputs,
            packages: loadedGeneration.plan.packages,
            planSha256: options.generation.planSha256,
            rules,
            rulesSha256: stylexRulesSha256(rules),
            schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
            state: "complete",
            target: graph.kind,
          },
        });
        complete = true;
      },
    },
  };
}
