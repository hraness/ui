import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { test } from "bun:test";
import ts from "typescript";

const fixturePath = `${import.meta.dir}/../fixtures/next-adopter/app/shared-history/shared-history.tsx`;

function assertServerComposition(source: string): void {
  const file = ts.createSourceFile(fixturePath, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TSX);
  const imports = new Map<string, string>();
  const rendered = new Set<string>();
  let iconInHeading = false;
  for (const statement of file.statements) {
    assert.ok(!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)
      || statement.expression.text !== "use client", "Shared history must remain server composition");
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) imports.set(binding.name.text, statement.moduleSpecifier.text);
    }
  }
  const visit = (node: ts.Node, inHeading = false): void => {
    const heading = inHeading || (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "h2");
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(file);
      rendered.add(name);
      if (name === "HistoryCategoryIcon" && heading) iconInHeading = true;
    }
    ts.forEachChild(node, (child) => visit(child, heading));
  };
  visit(file);
  for (const [name, path] of [
    ["HistoryMeasureKey", "./history-measure-key"],
    ["HistoryCategoryIcon", "./category-icon"],
    ["HistoryMeasureRail", "./history-measure-rail"],
    ["HistoryStickyOffsetSync", "./history-sticky-offset-sync"],
  ] as const) {
    assert.equal(imports.get(name), path, `Missing direct server import: ${name}`);
    assert.ok(rendered.has(name), `Missing direct server render: ${name}`);
  }
  assert.ok(iconInHeading, "The server-authored measure heading must render its client icon");
  assert.ok(source.indexOf('from "./history-measure-key"') < source.indexOf('from "./category-icon"'), "Visit the nested server composition before the direct icon boundary");
}

test("representative server composition directly renders all three original client boundaries", async () => {
  const source = await readFile(fixturePath, "utf8");
  assertServerComposition(source);
  assert.throws(() => assertServerComposition(source.replace(/import \{ HistoryCategoryIcon \} from "\.\/category-icon";\n/u, "")), /direct server import/u);
  assert.throws(() => assertServerComposition(source.replace(/<HistoryCategoryIcon filterId=\{id\} \/>/u, "")), /direct server render/u);
  assert.throws(() => assertServerComposition(`"use client";\n${source}`), /server composition/u);
});

function assertDefinitionKey(source: string): void {
  const file = ts.createSourceFile("history-measure-key.tsx", source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TSX);
  assert.ok(!file.statements.some((statement) => ts.isExpressionStatement(statement)
    && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client"), "Definition key must remain server composition");
  const iconImport = file.statements.find((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "./category-icon");
  assert.ok(iconImport && ts.isImportDeclaration(iconImport));
  const bindings = iconImport.importClause?.namedBindings;
  assert.ok(bindings && ts.isNamedImports(bindings)
    && bindings.elements.some((binding) => binding.name.text === "HistoryCategoryIcon"), "Definition key needs the named client icon import");
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(file);
  for (const name of ["dl", "dt", "dd"]) assert.ok(nodes.some((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(file) === name));
  const term = nodes.find((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "dt");
  assert.ok(term?.getText(file).includes("<HistoryCategoryIcon filterId={id} />"), "Definition term must render its icon");
  const definition = nodes.find((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "dd");
  assert.equal(definition?.getText(file), "<dd>{description}</dd>", "Existing description belongs in the semantic definition");
}

test("measure definitions have a meaningful second server importer without repeated descriptions", async () => {
  const composition = await readFile(fixturePath, "utf8");
  const key = await readFile(`${import.meta.dir}/../fixtures/next-adopter/app/shared-history/history-measure-key.tsx`, "utf8");
  assertServerComposition(composition);
  assertDefinitionKey(key);
  assert.equal(composition.includes("{description}"), false);
  assert.equal((key.match(/\{description\}/gu) ?? []).length, 1);
  assert.throws(() => assertServerComposition(composition.replace(/<HistoryMeasureKey measures=\{measures\} \/>/u, "")), /direct server render/u);
  assert.throws(() => assertDefinitionKey(`"use client";\n${key}`), /server composition/u);
  assert.throws(() => assertDefinitionKey(key.replace(/<HistoryCategoryIcon filterId=\{id\} \/>/u, "")), /render its icon/u);
  assert.throws(() => assertDefinitionKey(key.replace("<dd>{description}</dd>", "<dd>Definition omitted</dd>")), /Existing description/u);
});

const observerUrl = pathToFileURL(`${import.meta.dir}/../fixtures/next-adopter/delegated-entry-proof.mjs`).href;
const { assertFixtureClientBoundaryImports, captureFixtureTopology } = await import(observerUrl) as {
  assertFixtureClientBoundaryImports(entry: unknown, root: string): string[];
  captureFixtureTopology(compilation: unknown, names: readonly string[], shortener: unknown): unknown;
};
const boundaries = [
  { request: "/fixture/app/shared-history/category-icon.tsx", ids: ["HistoryCategoryIcon"] },
  { request: "/fixture/app/shared-history/history-measure-rail.tsx", ids: ["HistoryMeasureRail"] },
  { request: "/fixture/app/shared-history/history-sticky-offset-sync.tsx", ids: ["HistoryStickyOffsetSync"] },
];
function nativeEntry(imports: readonly Readonly<{ request: string; ids: readonly string[] }>[]) {
  return { loaders: [{
    loader: "/fixture/node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js",
    options: new URLSearchParams([...imports.map((item) => ["modules", JSON.stringify(item)]), ["server", "false"]]).toString(),
  }] };
}

test("independent native census requires all three direct client imports and named exports", () => {
  const entry = nativeEntry([...boundaries, { request: "/fixture/node_modules/@hraness/ui/dist/index.js", ids: ["ThemedSurface"] }]);
  assert.deepEqual(assertFixtureClientBoundaryImports(entry, "/fixture"), boundaries.map(({ request }) => request.slice("/fixture/".length)));
  for (let index = 0; index < boundaries.length; index += 1) {
    assert.throws(() => assertFixtureClientBoundaryImports(nativeEntry(boundaries.filter((_, position) => position !== index)), "/fixture"), /direct server-visible client boundary/u);
  }
  assert.throws(() => assertFixtureClientBoundaryImports(nativeEntry([...boundaries, boundaries[0]!]), "/fixture"), /direct server-visible client boundary/u);
  assert.throws(() => assertFixtureClientBoundaryImports(nativeEntry(boundaries.map((value, index) => index === 0 ? { ...value, ids: [] } : value)), "/fixture"), /named client export/u);
  assert.throws(() => assertFixtureClientBoundaryImports(nativeEntry([...boundaries, { request: "/fixture/app/shared-history/other.tsx", ids: ["Other"] }]), "/fixture"), /direct server-visible client boundary/u);
});

test("native census rejects another loader and malformed or ambiguous options", () => {
  for (const options of ["server=false", "modules=not-json&server=false", `${nativeEntry(boundaries).loaders[0]!.options}&server=false`, "x".repeat(262145)]) {
    const entry = nativeEntry(boundaries);
    entry.loaders[0]!.options = options;
    assert.throws(() => assertFixtureClientBoundaryImports(entry, "/fixture"));
  }
  const entry = nativeEntry(boundaries);
  entry.loaders[0]!.loader = "/fixture/another-loader.js";
  assert.throws(() => assertFixtureClientBoundaryImports(entry, "/fixture"));
});

function diagnosticFixture() {
  const bytes = "actual native source, not a retained body";
  const chunk = { id: 17 };
  const source = { size: () => Buffer.byteLength(bytes), source: () => bytes };
  const iconData = { id: 3, identifier: () => "icon-data", size: () => 30, type: "javascript/esm", resource: "/fixture/icon.js", originalSource: () => source };
  const icon = { ...iconData, id: 2, identifier: () => "category-icon", modules: [iconData] };
  const entry = { ...iconData, ...nativeEntry(boundaries), id: 1, identifier: () => "entry" };
  const group = { chunks: [chunk] };
  const bailouts: Array<string | ((shortener: { shorten(value: string): string }) => string)> = [
    (shortener) => `Cannot concatenate ${shortener.shorten("/fixture/icon.js")}: different chunks`,
  ];
  const compilation = {
    chunks: [chunk], entrypoints: new Map([["app/delegated-one/page", group]]),
    chunkGraph: {
      getModuleId: (module: { id: number }) => module.id,
      getModuleChunksIterable: () => [chunk],
      getChunkEntryModulesWithChunkGroupIterable: () => [[entry, group]],
      getChunkModulesIterable: () => [entry, icon],
      getChunkRuntimeModulesIterable: () => [],
    },
    moduleGraph: {
      getOptimizationBailout: () => bailouts,
      getOutgoingConnections: (module: unknown) => module === icon ? [{ resolvedModule: iconData, dependency: { type: "harmony import specifier" } }] : [],
    },
  };
  const shortener = { shorten: (value: string) => value.replace("/fixture/", "./") };
  return { bytes, source, bailouts, compilation, shortener };
}

test("pre-assertion diagnostics retain actual module relationships and hashes, not source bodies", () => {
  const fixture = diagnosticFixture();
  const result = captureFixtureTopology(fixture.compilation, ["app/delegated-one/page"], fixture.shortener) as Array<{
    chunks: Array<{ modules: Array<{ originalSource: { bytes: number; sha256: string }; bailouts: string[]; nestedModules: Array<{ id: number }>; dependencies: Array<{ module: { id: number } }> }>; entries: Array<{ loaders: Array<{ options: string }> }> }>;
  }>;
  const chunk = result[0]!.chunks[0]!;
  assert.equal(chunk.modules.length, 2, "Observing a retained module must not turn it into an admitted empty chunk");
  assert.deepEqual(chunk.modules[1]!.nestedModules.map(({ id }) => id), [3]);
  assert.deepEqual(chunk.modules[1]!.dependencies.map(({ module }) => module.id), [3]);
  assert.deepEqual(chunk.modules[1]!.bailouts, ["Cannot concatenate ./icon.js: different chunks"]);
  assert.deepEqual(chunk.modules[1]!.originalSource, { bytes: Buffer.byteLength(fixture.bytes), sha256: createHash("sha256").update(fixture.bytes).digest("hex") });
  assert.equal(chunk.entries[0]!.loaders[0]!.options, nativeEntry(boundaries).loaders[0]!.options);
  assert.equal(JSON.stringify(result).includes(fixture.bytes), false);
  assert.equal(fixture.compilation.chunkGraph.getChunkModulesIterable().length, 2);
});

test("diagnostic text, collections and source reads are bounded before retention", () => {
  const fixture = diagnosticFixture();
  fixture.bailouts.splice(0, 1, "x".repeat(16385));
  assert.throws(() => captureFixtureTopology(fixture.compilation, ["app/delegated-one/page"], fixture.shortener), /bounded exact text/u);
  fixture.bailouts.splice(0, 1, "\ud800");
  assert.throws(() => captureFixtureTopology(fixture.compilation, ["app/delegated-one/page"], fixture.shortener), /bounded exact text/u);
  fixture.bailouts.splice(0);
  assert.throws(() => captureFixtureTopology(fixture.compilation, Array.from({ length: 65 }, () => "route"), fixture.shortener), /route names exceeds its bound/u);
  fixture.source.size = () => 4 * 1024 * 1024 + 1;
  fixture.source.source = () => { throw new Error("oversized source was read"); };
  assert.throws(() => captureFixtureTopology(fixture.compilation, ["app/delegated-one/page"], fixture.shortener), (error) => error instanceof assert.AssertionError);
});
