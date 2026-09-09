import assert from "node:assert/strict";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { canonicalJson, normalizeLogicalPath, sha256 } from "./compiler.js";

type InputIdentity = Readonly<{ bytes: number; sha256: string }>;

function relativePath(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && value.length > 0 && value.trim() === value
    && !isAbsolute(value) && !/[\\:%?#\u0000-\u001f\u007f]/u.test(value),
  `${description} must be an ordinary relative path`);
  return value;
}

function below(root: string, absolute: string, description: string): string {
  return normalizeLogicalPath(relative(root, absolute).split(sep).join("/"), description);
}

/** Native bundler paths are relative to staging. Rebase only their location,
 * before hashing, to the final generation layout; never rewrite mapping indexes
 * or invent source content. Publication copies these exact bytes unchanged. */
export function createViteSourceMapPaths(options: Readonly<{
  rootDirectory: string;
  stagingDirectory: string;
  publishedDirectory: string;
  inputIdentity(path: string): InputIdentity | undefined;
}>) {
  below(options.rootDirectory, options.publishedDirectory, "Vite source-map publication directory");
  const witnessed = new Map<string, Set<string>>();
  const transform = (sourcePath: string, mapPath: string): string => {
    const outputPath = below(options.stagingDirectory, resolve(mapPath), "Vite source-map staging path");
    assert.ok(/\.[cm]?js\.map$/u.test(outputPath), "Vite source maps require JavaScript chunk companions");
    const absolute = resolve(dirname(mapPath), relativePath(sourcePath, "Vite native map source"));
    const logical = below(options.rootDirectory, absolute, "Vite source-map input");
    assert.ok(options.inputIdentity(logical) !== undefined, `Vite source-map input lacks a loaded-file witness: ${logical}`);
    const sources = witnessed.get(outputPath) ?? new Set<string>();
    sources.add(logical);
    witnessed.set(outputPath, sources);
    return relative(dirname(resolve(options.publishedDirectory, outputPath)), absolute).split(sep).join("/");
  };
  const source = (mapPath: string, value: unknown, preliminaryMapPath = mapPath): Readonly<{ logical: string; identity: InputIdentity }> => {
    normalizeLogicalPath(mapPath, "Vite map output");
    const absolute = resolve(dirname(resolve(options.publishedDirectory, mapPath)), relativePath(value, "Vite published map source"));
    const logical = below(options.rootDirectory, absolute, "Vite published source-map input");
    assert.equal(witnessed.get(preliminaryMapPath)?.has(logical), true, `Vite source-map source bypassed native chunk path projection: ${logical}`);
    const identity = options.inputIdentity(logical);
    assert.ok(identity !== undefined, `Vite source-map input witness disappeared: ${logical}`);
    assert.equal(value, relative(dirname(resolve(options.publishedDirectory, mapPath)), absolute).split(sep).join("/"),
      "Vite published map source is not the canonical relative path");
    return { logical, identity };
  };
  const assertComplete = (preliminaryMapPath: string, logicalSources: readonly string[]): void => {
    assert.equal(new Set(logicalSources).size, logicalSources.length, "Vite source map contains duplicate source identities");
    assert.deepEqual([...logicalSources].sort(), [...(witnessed.get(preliminaryMapPath) ?? [])].sort(),
      "Vite source map omitted or introduced native chunk sources");
  };
  return { assertComplete, source, transform };
}

type MapPaths = ReturnType<typeof createViteSourceMapPaths>;

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode without changing the native mapping string. Validate all deltas and
 * source/name indexes, including original/generated UTF-16 column bounds. */
function validateMappings(mappings: string, names: readonly string[], sources: readonly string[], code: string): void {
  const linesOf = (source: string): string[] => source.split(/\r\n|[\n\r\u2028\u2029]/u);
  const generatedLines = linesOf(code);
  const sourceLines = sources.map(linesOf);
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  const mappedSources = new Set<number>();
  const lines = mappings.split(";");
  assert.ok(lines.length <= generatedLines.length, "Vite source map exceeds generated lines");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let generatedColumn = 0;
    if (lines[lineIndex] === "") continue;
    for (const segment of lines[lineIndex]!.split(",")) {
      assert.ok(segment.length > 0, "Vite source map contains an empty segment");
      const values: number[] = [];
      let value = 0;
      let scale = 1;
      for (const character of segment) {
        const digit = base64.indexOf(character);
        assert.ok(digit >= 0, "Vite source map contains invalid base64 VLQ");
        value += (digit & 31) * scale;
        assert.ok(Number.isSafeInteger(value), "Vite source-map VLQ overflow");
        if ((digit & 32) !== 0) { scale *= 32; assert.ok(Number.isSafeInteger(scale)); continue; }
        values.push((value & 1) === 1 ? -Math.floor(value / 2) : value / 2);
        value = 0;
        scale = 1;
      }
      assert.equal(scale, 1, "Vite source map contains unterminated VLQ");
      assert.ok([1, 4, 5].includes(values.length), "Vite source map contains an invalid segment arity");
      assert.ok(values[0]! >= 0, "Vite source-map generated columns must be ordered");
      generatedColumn += values[0]!;
      assert.ok(generatedColumn <= generatedLines[lineIndex]!.length, "Vite source map exceeds generated columns");
      if (values.length === 1) continue;
      sourceIndex += values[1]!;
      originalLine += values[2]!;
      originalColumn += values[3]!;
      assert.ok(sourceIndex >= 0 && sourceIndex < sourceLines.length, "Vite source map references an absent source");
      mappedSources.add(sourceIndex);
      const source = sourceLines[sourceIndex]!;
      assert.ok(originalLine >= 0 && originalLine < source.length, "Vite source map references an absent original line");
      assert.ok(originalColumn >= 0 && originalColumn <= source[originalLine]!.length,
        "Vite source map exceeds original columns");
      if (values.length === 5) {
        nameIndex += values[4]!;
        assert.ok(nameIndex >= 0 && nameIndex < names.length, "Vite source map references an absent name");
      }
    }
  }
  assert.equal(mappedSources.size, sources.length, "Vite source map omits mappings for native sources");
}

export function validateViteSourceMap(value: unknown, options: Readonly<{
  chunkPath: string;
  preliminaryChunkPath?: string;
  requiredSources?: readonly string[];
  code: string;
  paths: MapPaths;
}>): string {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Vite source map must be an object");
  const required = ["version", "file", "sources", "sourcesContent", "names", "mappings"];
  const optional = ["sourceRoot", "ignoreList", "x_google_ignoreList"];
  const record: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    assert.ok(typeof key === "string" && (required.includes(key) || optional.includes(key) || key === "toUrl"),
      "Vite source map has unknown fields");
    const field: PropertyDescriptor = Object.getOwnPropertyDescriptor(value, key)!;
    assert.ok(field.enumerable && Object.hasOwn(field, "value"), "Vite source-map fields must be enumerable data properties");
    // Vite 7's lazy-import rewrite adds an own toUrl function to its native
    // composed map. Its SourceMap also owns undefined optional fields. Native
    // JSON.stringify omits both; do the same without invoking native methods or
    // dropping any unknown or defined map data from the validated identity.
    if (key === "toUrl") {
      assert.equal(typeof field.value, "function", "Vite native source-map toUrl must be a function");
    } else if (field.value !== undefined || required.includes(key)) {
      record[key] = field.value;
    }
  }
  assert.ok(required.every((key) => Object.hasOwn(record, key)), "Vite source map is incomplete");
  assert.equal(record.version, 3, "Vite source-map version must be 3");
  assert.equal(record.file, basename(options.chunkPath), "Vite source map belongs to another chunk");
  assert.ok(record.sourceRoot === undefined || record.sourceRoot === "", "Vite source-map sourceRoot must be empty");
  assert.ok(Array.isArray(record.sources) && Array.isArray(record.sourcesContent), "Vite source-map source arrays are unavailable");
  assert.equal(record.sources.length, record.sourcesContent.length, "Vite source-map source contents are incomplete");
  const contents = record.sourcesContent;
  const logicalSources: string[] = [];
  const preliminaryMapPath = `${options.preliminaryChunkPath ?? options.chunkPath}.map`;
  const sources = record.sources.map((path: unknown, index: number) => {
    const source = options.paths.source(`${options.chunkPath}.map`, path, preliminaryMapPath);
    logicalSources.push(source.logical);
    const content: unknown = contents[index];
    assert.equal(typeof content, "string", `Vite source-map embedded source is unavailable: ${source.logical}`);
    assert.deepEqual({ bytes: Buffer.byteLength(content as string), sha256: sha256(content as string) }, source.identity,
      `Vite source-map embedded source differs from its loaded file: ${source.logical}`);
    return content as string;
  });
  options.paths.assertComplete(preliminaryMapPath, logicalSources);
  for (const required of options.requiredSources ?? []) {
    assert.ok(logicalSources.includes(required), `Vite source map omits rendered file input: ${required}`);
  }
  assert.ok(Array.isArray(record.names) && record.names.every((name: unknown) => typeof name === "string"), "Vite source-map names must be strings");
  assert.equal(typeof record.mappings, "string", "Vite source-map mappings must be a string");
  for (const key of ["ignoreList", "x_google_ignoreList"] as const) {
    const indexes = record[key];
    if (indexes === undefined) continue;
    assert.ok(Array.isArray(indexes) && indexes.every((index: unknown) => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < sources.length)
      && new Set(indexes).size === indexes.length, "Vite source-map ignore list is invalid");
  }
  validateMappings(record.mappings as string, record.names as string[], sources, options.code);
  return canonicalJson(record);
}
