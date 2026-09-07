import assert from "node:assert/strict";
import { posix } from "node:path";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MAX_COLLECTION_LENGTH = 100_000;
const MAX_INDEXED_MAPS = 100_000;
const MAX_MAPPING_BYTES = 64 * 1024 * 1024;
const MAX_MAPPING_SEGMENTS = 2_000_000;
const MAX_SOURCE_ENTRIES = 500_000;
const MAX_SOURCE_NAME_BYTES = 16 * 1024;

export type NextSourceMapEntry = Readonly<{
  content: null | string;
  mapped: boolean;
  source: string;
}>;

type GeneratedPosition = Readonly<{ column: number; line: number }>;
type ParseBudget = { maps: number; segments: number; sources: number };
type ParsedNextSourceMap = Readonly<{
  entries: readonly NextSourceMapEntry[];
  file: null | string;
  maximumPosition: GeneratedPosition | undefined;
}>;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  description: string,
): void {
  const allowed = new Set([...required, ...optional]);
  assert.deepEqual(
    Object.keys(record).filter((key) => !allowed.has(key)).sort(),
    [],
    `${description} contains unknown keys`,
  );
  for (const key of required) assert.ok(Object.hasOwn(record, key), `${description} is missing ${key}`);
}

function denseArray(value: unknown, description: string): unknown[] {
  assert.ok(Array.isArray(value) && value.length <= MAX_COLLECTION_LENGTH, `${description} must be a bounded array`);
  for (let index = 0; index < value.length; index += 1) {
    assert.ok(Object.hasOwn(value, index), `${description} must not be sparse`);
  }
  return value;
}

function boundedString(value: unknown, description: string, allowEmpty = true): string {
  assert.ok(typeof value === "string", `${description} must be a string`);
  assert.ok(allowEmpty || value.length > 0, `${description} must be nonempty`);
  assert.ok(Buffer.byteLength(value, "utf8") <= MAX_SOURCE_NAME_BYTES, `${description} exceeds its byte bound`);
  return value;
}

function authoredSource(value: string, description: string): string {
  boundedString(value, description, false);
  assert.ok(
    !value.startsWith("/")
      && !value.startsWith("./")
      && !value.startsWith("../")
      && !value.includes("\\")
      && !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
      && !/[\u0000-\u001f\u007f]/u.test(value),
    `${description} must be a normalized relative path`,
  );
  return value;
}

function resolveSource(sourceRoot: string, source: string): string {
  if (sourceRoot.length === 0 || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(source) || source.startsWith("/")) return source;
  return `${sourceRoot}${sourceRoot.endsWith("/") ? "" : "/"}${source}`;
}

/** Only exact relative identities and the two forms observed from pinned
 * webpack are accepted as authored evidence. Arbitrary path suffixes, file
 * URLs, and private absolute paths cannot satisfy this predicate. */
function matchesAuthoredSource(value: string, source: string): boolean {
  if (value === source || value === `./${source}`) return true;
  if (!value.startsWith("webpack://")) return false;
  const remainder = value.slice("webpack://".length);
  const slash = remainder.indexOf("/");
  if (slash <= 0) return false;
  const namespace = remainder.slice(0, slash);
  const logical = remainder.slice(slash + 1);
  return /^[A-Za-z0-9@._-]+$/u.test(namespace)
    && (logical === source || logical === `./${source}`);
}

function comparePosition(left: GeneratedPosition, right: GeneratedPosition): number {
  return left.line - right.line || left.column - right.column;
}

function translatedPosition(position: GeneratedPosition, offset: GeneratedPosition): GeneratedPosition {
  return {
    column: position.line === 0 ? offset.column + position.column : position.column,
    line: offset.line + position.line,
  };
}

function decodeVlq(segment: string, cursor: { value: number }, description: string): number {
  let encoded = 0;
  let shift = 0;
  let continued = true;
  while (continued) {
    assert.ok(cursor.value < segment.length, `${description} contains a truncated Base64 VLQ value`);
    const digit = BASE64.indexOf(segment[cursor.value]!);
    assert.ok(digit >= 0, `${description} contains a non-Base64 VLQ character`);
    cursor.value += 1;
    continued = (digit & 32) !== 0;
    const payload = digit & 31;
    const addition = payload * (2 ** shift);
    assert.ok(Number.isSafeInteger(encoded + addition), `${description} exceeds the Base64 VLQ integer bound`);
    encoded += addition;
    shift += 5;
    assert.ok(shift <= 55, `${description} exceeds the Base64 VLQ width bound`);
  }
  const negative = encoded % 2 === 1;
  const magnitude = Math.floor(encoded / 2);
  assert.ok(!(negative && magnitude === 0), `${description} contains a noncanonical negative zero`);
  return negative ? -magnitude : magnitude;
}

function decodeMappings(
  mappings: string,
  sourceCount: number,
  nameCount: number,
  description: string,
  budget: ParseBudget,
): Readonly<{ mappedSources: ReadonlySet<number>; maximumPosition: GeneratedPosition | undefined }> {
  assert.ok(Buffer.byteLength(mappings, "utf8") <= MAX_MAPPING_BYTES, `${description} exceeds its byte bound`);
  const mappedSources = new Set<number>();
  let maximumPosition: GeneratedPosition | undefined;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  const lines = mappings.split(";");
  assert.ok(lines.length <= MAX_COLLECTION_LENGTH, `${description} exceeds its generated-line bound`);
  for (const [line, encodedLine] of lines.entries()) {
    if (encodedLine.length === 0) continue;
    const segments = encodedLine.split(",");
    assert.ok(segments.length <= MAX_COLLECTION_LENGTH, `${description} line ${String(line)} exceeds its segment bound`);
    budget.segments += segments.length;
    assert.ok(budget.segments <= MAX_MAPPING_SEGMENTS, `${description} exceeds the total source-map segment bound`);
    let generatedColumn = 0;
    for (const [segmentIndex, segment] of segments.entries()) {
      const segmentDescription = `${description} line ${String(line)} segment ${String(segmentIndex)}`;
      assert.ok(segment.length > 0, `${segmentDescription} must be nonempty`);
      const cursor = { value: 0 };
      const values: number[] = [];
      while (cursor.value < segment.length) {
        values.push(decodeVlq(segment, cursor, segmentDescription));
        assert.ok(values.length <= 5, `${segmentDescription} has too many fields`);
      }
      assert.ok(values.length === 1 || values.length === 4 || values.length === 5, `${segmentDescription} has an invalid field count`);
      assert.ok(values[0]! >= 0, `${segmentDescription} has a negative generated-column delta`);
      generatedColumn += values[0]!;
      assert.ok(Number.isSafeInteger(generatedColumn) && generatedColumn >= 0, `${segmentDescription} has an invalid generated column`);
      maximumPosition = { column: generatedColumn, line };
      if (values.length === 1) continue;
      sourceIndex += values[1]!;
      originalLine += values[2]!;
      originalColumn += values[3]!;
      assert.ok(Number.isSafeInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < sourceCount, `${segmentDescription} has an invalid source index`);
      assert.ok(Number.isSafeInteger(originalLine) && originalLine >= 0, `${segmentDescription} has an invalid original line`);
      assert.ok(Number.isSafeInteger(originalColumn) && originalColumn >= 0, `${segmentDescription} has an invalid original column`);
      if (values.length === 5) {
        nameIndex += values[4]!;
        assert.ok(Number.isSafeInteger(nameIndex) && nameIndex >= 0 && nameIndex < nameCount, `${segmentDescription} has an invalid name index`);
      }
      mappedSources.add(sourceIndex);
    }
  }
  return { mappedSources, maximumPosition };
}

function mapFile(record: Record<string, unknown>, description: string): null | string {
  if (record.file === undefined) return null;
  const file = boundedString(record.file, `${description}.file`, false);
  assert.ok(
    !file.startsWith("/")
      && !file.includes("\\")
      && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(file)
      && !/[\u0000-\u001f\u007f]/u.test(file),
    `${description}.file must not disclose an absolute or URL path`,
  );
  return file;
}

function matchesPinnedNextMapFile(file: string, output: string): boolean {
  if (output.startsWith("static/")) return file === output;
  if (output.startsWith("server/app/")) {
    const routeOutput = output.slice("server/".length);
    return file === routeOutput || file === `../${routeOutput}`;
  }
  if (/^server\/chunks\/[^/]+$/u.test(output)) return file === posix.basename(output);
  if (/^server\/[^/]+$/u.test(output)) {
    const name = posix.basename(output);
    return file === name || file === `../${name}`;
  }
  return false;
}

function entries(
  value: unknown,
  description: string,
  authoredSources: readonly string[],
  depth: number,
  budget: ParseBudget,
): ParsedNextSourceMap {
  assert.ok(depth <= 64, `${description} exceeds the index-map nesting bound`);
  budget.maps += 1;
  assert.ok(budget.maps <= MAX_INDEXED_MAPS, `${description} exceeds the total source-map count bound`);
  const record = object(value, description);
  assert.equal(record.version, 3, `${description}.version must be 3`);
  if (record.sections !== undefined) {
    exactKeys(record, ["sections", "version"], ["file"], description);
    const sections = denseArray(record.sections, `${description}.sections`);
    assert.ok(sections.length > 0, `${description}.sections must be nonempty`);
    const outputEntries: NextSourceMapEntry[] = [];
    let previousOffset: GeneratedPosition | undefined;
    let previousMaximum: GeneratedPosition | undefined;
    for (const [index, section] of sections.entries()) {
      const sectionDescription = `${description}.sections[${String(index)}]`;
      const sectionRecord = object(section, sectionDescription);
      exactKeys(sectionRecord, ["map", "offset"], [], sectionDescription);
      const offsetRecord = object(sectionRecord.offset, `${sectionDescription}.offset`);
      exactKeys(offsetRecord, ["column", "line"], [], `${sectionDescription}.offset`);
      assert.ok(Number.isSafeInteger(offsetRecord.line) && (offsetRecord.line as number) >= 0, `${sectionDescription}.offset.line is invalid`);
      assert.ok(Number.isSafeInteger(offsetRecord.column) && (offsetRecord.column as number) >= 0, `${sectionDescription}.offset.column is invalid`);
      const offset = { column: offsetRecord.column as number, line: offsetRecord.line as number };
      if (previousOffset !== undefined) assert.ok(comparePosition(previousOffset, offset) < 0, `${description}.sections offsets must be strictly increasing`);
      if (previousMaximum !== undefined) assert.ok(comparePosition(previousMaximum, offset) < 0, `${description}.sections contain overlapping mapped ranges`);
      const child = entries(sectionRecord.map, `${sectionDescription}.map`, authoredSources, depth + 1, budget);
      outputEntries.push(...child.entries);
      previousOffset = offset;
      if (child.maximumPosition !== undefined) previousMaximum = translatedPosition(child.maximumPosition, offset);
    }
    return { entries: outputEntries, file: mapFile(record, description), maximumPosition: previousMaximum };
  }

  exactKeys(record, ["mappings", "sources", "version"], ["file", "ignoreList", "names", "sourceRoot", "sourcesContent"], description);
  const rawSources = denseArray(record.sources, `${description}.sources`);
  budget.sources += rawSources.length;
  assert.ok(budget.sources <= MAX_SOURCE_ENTRIES, `${description}.sources exceeds the total source-entry bound`);
  const sourceRoot = record.sourceRoot === undefined ? "" : boundedString(record.sourceRoot, `${description}.sourceRoot`);
  const sources = rawSources.map((source, index) => {
    const resolved = resolveSource(sourceRoot, boundedString(source, `${description}.sources[${String(index)}]`));
    assert.ok(Buffer.byteLength(resolved, "utf8") <= MAX_SOURCE_NAME_BYTES, `${description}.sources[${String(index)}] exceeds its resolved byte bound`);
    return resolved;
  });
  const names = record.names === undefined
    ? []
    : denseArray(record.names, `${description}.names`).map((name, index) => boundedString(name, `${description}.names[${String(index)}]`));
  assert.ok(typeof record.mappings === "string", `${description}.mappings must be a string`);
  const mappings = record.mappings;
  const decoded = decodeMappings(mappings, sources.length, names.length, `${description}.mappings`, budget);
  let sourcesContent: readonly (null | string)[] | undefined;
  if (record.sourcesContent !== undefined) {
    const content = denseArray(record.sourcesContent, `${description}.sourcesContent`);
    assert.ok(content.length <= sources.length, `${description}.sourcesContent exceeds sources`);
    assert.ok(content.every((item) => item === null || typeof item === "string"), `${description}.sourcesContent entries are invalid`);
    sourcesContent = content as readonly (null | string)[];
  }
  if (record.ignoreList !== undefined) {
    const ignoreList = denseArray(record.ignoreList, `${description}.ignoreList`);
    assert.ok(
      ignoreList.every((index) => Number.isSafeInteger(index) && (index as number) >= 0 && (index as number) < sources.length),
      `${description}.ignoreList contains an invalid source index`,
    );
    assert.equal(new Set(ignoreList as number[]).size, ignoreList.length, `${description}.ignoreList must contain unique source indices`);
  }
  for (const [index, source] of sources.entries()) {
    for (const authored of authoredSources) {
      if (source === authored || source.endsWith(`/${authored}`)) {
        assert.ok(matchesAuthoredSource(source, authored), `${description}.sources[${String(index)}] uses a noncanonical authored-source identity`);
      }
    }
  }
  return {
    entries: sources.map((source, index) => ({
      content: sourcesContent?.[index] ?? null,
      mapped: decoded.mappedSources.has(index),
      source,
    })),
    file: mapFile(record, description),
    maximumPosition: decoded.maximumPosition,
  };
}

/** Decode and structurally validate basic or indexed source-map metadata
 * without modifying native map bytes. Every entry records whether at least one
 * valid mapping segment actually references its exact source index. */
export function nextSourceMapEntries(
  value: unknown,
  description: string,
  authoredSources: readonly string[],
  expectedOutputPath?: string,
): readonly NextSourceMapEntry[] {
  const normalizedAuthored = authoredSources.map((source, index) => authoredSource(source, `${description} authoredSources[${String(index)}]`));
  assert.equal(new Set(normalizedAuthored).size, normalizedAuthored.length, `${description} authoredSources must be unique`);
  const parsed = entries(value, description, normalizedAuthored, 0, { maps: 0, segments: 0, sources: 0 });
  if (expectedOutputPath !== undefined) {
    const output = authoredSource(expectedOutputPath, `${description} expected output`);
    if (parsed.file !== null) {
      // These are the complete file conventions observed from pinned Next
      // 16.2.12. Preserve the App Router route suffix instead of accepting a
      // same-basename map from another page.
      assert.ok(matchesPinnedNextMapFile(parsed.file, output), `${description}.file differs from its emitted output`);
    }
  }
  return parsed.entries;
}

export function assertNextSourceMapOutputLink(
  outputSource: string,
  outputPath: string,
  mapPath: string,
): void {
  const output = authoredSource(outputPath, "Next mapped output path");
  const map = authoredSource(mapPath, "Next source-map path");
  assert.equal(map, `${output}.map`, "Next source-map path must be adjacent to its exact mapped output");
  const match = /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*\s]+)\s*\*\/)\s*$/u.exec(outputSource);
  assert.ok(match !== null, `Next mapped output ${output} omits its trailing external sourceMappingURL`);
  const reference = match[1] ?? match[2];
  assert.equal(reference, posix.basename(map), `Next mapped output ${output} links a different source map`);
}

export function assertNextAuthoredSourceEmbedding(
  mappedSources: readonly NextSourceMapEntry[],
  source: string,
  original: string,
): void {
  const normalized = authoredSource(source, "Next authored source");
  const identities = mappedSources.filter((candidate) => matchesAuthoredSource(candidate.source, normalized));
  assert.ok(identities.length > 0, `Next emitted source-map chain omitted authored source ${normalized}`);
  const referenced = identities.filter(({ mapped }) => mapped);
  assert.ok(referenced.length > 0, `Next emitted mappings never reference authored source ${normalized}`);
  const embedded = referenced.flatMap(({ content }) => typeof content === "string" ? [content] : []);
  assert.ok(embedded.length > 0, `Next emitted source-map chain omitted mapped embedded authored source ${normalized}`);
  // Next can retain a transformed wrapper alias beside the original input.
  // The exact original still has to occupy an actually referenced source slot.
  assert.ok(embedded.includes(original), `Next emitted source-map chain changed mapped embedded authored source ${normalized}`);
}
