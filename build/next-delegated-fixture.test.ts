import assert from "node:assert/strict";
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
    ["HistoryCategoryIcon", "./category-icon"],
    ["HistoryMeasureRail", "./history-measure-rail"],
    ["HistoryStickyOffsetSync", "./history-sticky-offset-sync"],
  ] as const) {
    assert.equal(imports.get(name), path, `Missing direct server import: ${name}`);
    assert.ok(rendered.has(name), `Missing direct server render: ${name}`);
  }
  assert.ok(iconInHeading, "The server-authored measure heading must render its client icon");
}

test("representative server composition directly renders all three original client boundaries", async () => {
  const source = await readFile(fixturePath, "utf8");
  assertServerComposition(source);
  assert.throws(() => assertServerComposition(source.replace(/import \{ HistoryCategoryIcon \} from "\.\/category-icon";\n/u, "")), /direct server import/u);
  assert.throws(() => assertServerComposition(source.replace(/<HistoryCategoryIcon filterId=\{id\} \/>/u, "")), /direct server render/u);
  assert.throws(() => assertServerComposition(`"use client";\n${source}`), /server composition/u);
});

const observerUrl = pathToFileURL(`${import.meta.dir}/../fixtures/next-adopter/delegated-entry-proof.mjs`).href;
const { assertFixtureClientBoundaryImports } = await import(observerUrl) as {
  assertFixtureClientBoundaryImports(entry: unknown, root: string): string[];
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
