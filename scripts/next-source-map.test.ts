import { describe, expect, test } from "bun:test";

import {
  assertNextAuthoredSourceEmbedding,
  assertNextSourceMapOutputLink,
  nextSourceMapEntries,
} from "./next-source-map.ts";

const authored = [
  "app/client.tsx",
  "app/edge/page.tsx",
  "app/global-error-proof/page.tsx",
  "app/global-error.tsx",
  "app/index/[manifestProof]/page.tsx",
  "app/layout.tsx",
  "app/lazy.tsx",
  "app/page.tsx",
] as const;
const read = (value: unknown, expectedOutputPath?: string) =>
  nextSourceMapEntries(value, "fixture map", authored, expectedOutputPath);
const flat = (
  sources: readonly unknown[] = ["webpack/runtime"],
  sourcesContent?: readonly unknown[],
  mappings = "AAAA",
) => ({
  version: 3,
  sources,
  mappings,
  ...(sourcesContent === undefined ? {} : { sourcesContent }),
});
const section = (map: unknown, line = 0, column = 0) => ({ offset: { line, column }, map });
const mappingsForEverySource = (count: number) =>
  count === 0 ? "" : ["AAAA", ...Array.from({ length: count - 1 }, () => "CCAA")].join(",");

describe("Next smoke source-map proof", () => {
  test("decodes native client, Node, and Edge omitted startup tails without padding input arrays", () => {
    for (const sourceCount of [18, 13, 12]) {
      const available = sourceCount - 3;
      const sources = Object.freeze([
        ...Array.from({ length: available }, (_, index) => `webpack://_N_E/webpack/runtime/${String(index)}`),
        ...["before-startup", "startup", "after-startup"].map((name) => `webpack://_N_E/webpack/${name}`),
      ]);
      const sourcesContent = Object.freeze(Array.from({ length: available }, (_, index) => `runtime ${String(index)}`));
      const input = Object.freeze(flat(sources, sourcesContent));
      const before = JSON.stringify(input);
      const result = read(input);
      expect(result).toHaveLength(sourceCount);
      expect(result.slice(0, available).map(({ content }) => content)).toEqual(sourcesContent);
      expect(result.slice(available)).toEqual(sources.slice(available).map((source) => ({
        source,
        content: null,
        mapped: false,
      })));
      expect(result[0]?.mapped).toBe(true);
      expect(result.slice(1).every(({ mapped }) => !mapped)).toBe(true);
      expect(sourcesContent).toHaveLength(available);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  test("preserves source indices, content holes, and exact mapping references", () => {
    const sources = ["first", "second", "third"];
    for (const sourcesContent of [undefined, [], [null], ["", null], ["first", null, "third"]]) {
      expect(read(flat(sources, sourcesContent, "AAAA,CCAA"))).toEqual(sources.map((source, index) => ({
        source,
        content: sourcesContent?.[index] ?? null,
        mapped: index < 2,
      })));
    }
    expect(read(flat(sources, ["first", "second", "third"], "ACAA"))).toEqual([
      { source: "first", content: "first", mapped: false },
      { source: "second", content: "second", mapped: true },
      { source: "third", content: "third", mapped: false },
    ]);
  });

  test("rejects malformed maps, sparse arrays, unknown keys, and invalid optional metadata", () => {
    const valid = flat();
    for (const value of [
      null, [], 1, {}, { ...valid, version: 2 }, { ...valid, unknown: true },
      { ...valid, sources: "source" }, { ...valid, sources: [null] },
      { ...valid, sources: [1] }, { ...valid, sources: new Array(1) },
      { ...valid, mappings: null }, { ...valid, mappings: 1 },
      { ...valid, sourcesContent: null }, { ...valid, sourcesContent: "content" },
      { ...valid, sourcesContent: [1] }, { ...valid, sourcesContent: [false] },
      { ...valid, sourcesContent: [{}] }, { ...valid, sourcesContent: [undefined] },
      { ...valid, sourcesContent: new Array(1) },
      { ...valid, names: "name" }, { ...valid, names: [null] }, { ...valid, names: new Array(1) },
      { ...valid, sourceRoot: null }, { ...valid, file: "" }, { ...valid, file: "/private/out.js" },
      { ...valid, ignoreList: [1] }, { ...valid, ignoreList: [0, 0] },
      { ...valid, ignoreList: new Array(1) },
    ]) expect(() => read(value)).toThrow();
    expect(() => read(flat(["only-source"], ["first", null]))).toThrow(/exceeds sources/u);
    expect(read({ ...valid, ignoreList: [0], names: ["name"], sourceRoot: "" })).toHaveLength(1);
    expect(read({ ...flat(["one", "two"], undefined, "AAAA,CCAA"), ignoreList: [1, 0] })).toHaveLength(2);
  });

  test("decodes bounded Base64 VLQ segments and rejects malformed mapping structure", () => {
    expect(read(flat(["source"], ["original"], ""))).toEqual([
      { source: "source", content: "original", mapped: false },
    ]);
    expect(read(flat(["source"], ["original"], ";A;AAAA"))).toEqual([
      { source: "source", content: "original", mapped: true },
    ]);
    expect(read({ ...flat(["source"], ["original"], "AAAAA"), names: ["symbol"] })[0]?.mapped).toBe(true);
    for (const mappings of [
      ",", "AAAA,", ",AAAA", "AA", "AAA", "AAAAAA", "!", "g", "B", "DAAA", "EAAA,DAAA", "ADAA", "AADA", "AAAD",
    ]) expect(() => read(flat(["source"], ["original"], mappings))).toThrow();
    expect(() => read(flat(["source"], ["original"], "ACAA"))).toThrow(/source index/u);
    expect(() => read({ ...flat(["source"], ["original"], "AAAAC"), names: [] })).toThrow(/name index/u);
  });

  test("accepts only canonical authored identities and exact resolved webpack source roots", () => {
    const source = "app/page.tsx";
    const original = "export default function Page() { return null; }\n";
    for (const name of [
      source,
      `./${source}`,
      `webpack://_N_E/${source}`,
      `webpack://_N_E/./${source}`,
      `webpack://hraness-packed-next-adopter-smoke/${source}`,
    ]) {
      expect(() => assertNextAuthoredSourceEmbedding(read(flat([name], [original])), source, original)).not.toThrow();
    }
    expect(() => assertNextAuthoredSourceEmbedding(read({
      ...flat([source], [original]),
      sourceRoot: "webpack://_N_E/",
    }), source, original)).not.toThrow();
    for (const name of [
      `/Users/example/consumer/${source}`,
      `file:///Users/example/consumer/${source}`,
      `webpack://_N_E//Users/example/consumer/${source}`,
      `webpack://_N_E/node_modules/private/${source}`,
      `https://example.test/${source}`,
    ]) expect(() => read(flat([name], [original]))).toThrow(/noncanonical authored-source identity/u);
    expect(() => assertNextAuthoredSourceEmbedding(read(flat([`other-${source}`], [original])), source, original))
      .toThrow(/omitted authored source/u);
  });

  test("requires exact original content on an actually referenced authored source index", () => {
    const originals = authored.map((source) => `export const original = ${JSON.stringify(source)};\n`);
    const mapped = read(flat(
      authored.map((source) => `webpack://_N_E/${source}`),
      originals,
      mappingsForEverySource(authored.length),
    ));
    for (const [index, source] of authored.entries()) {
      expect(() => assertNextAuthoredSourceEmbedding(mapped, source, originals[index]!)).not.toThrow();
      expect(() => assertNextAuthoredSourceEmbedding(mapped.filter((entry) => entry.source !== `webpack://_N_E/${source}`), source, originals[index]!))
        .toThrow(/omitted authored source/u);
      expect(() => assertNextAuthoredSourceEmbedding(read(flat([source], [originals[index]!], "A")), source, originals[index]!))
        .toThrow(/never reference/u);
      for (const contents of [undefined, [], [null]]) {
        expect(() => assertNextAuthoredSourceEmbedding(read(flat([source], contents)), source, originals[index]!))
          .toThrow(/omitted mapped embedded/u);
      }
      expect(() => assertNextAuthoredSourceEmbedding(read(flat([source], ["changed"])), source, originals[index]!))
        .toThrow(/changed mapped embedded/u);
    }
  });

  test("does not borrow an unmapped exact original from a mapped native wrapper alias", () => {
    const source = "app/edge/page.tsx";
    const original = "export default function Edge() { return null; }\n";
    const wrapped = "/* Next loader wrapper */ export { default } from 'next-entry';\n";
    const sources = [`webpack://_N_E/./${source}`, `webpack://_N_E/${source}`];
    expect(() => assertNextAuthoredSourceEmbedding(
      read(flat(sources, [wrapped, original], "AAAA,CCAA")), source, original,
    )).not.toThrow();
    expect(() => assertNextAuthoredSourceEmbedding(
      read(flat(sources, [wrapped, original], "AAAA")), source, original,
    )).toThrow(/changed mapped embedded/u);
    expect(() => assertNextAuthoredSourceEmbedding(
      read(flat(sources, [wrapped, original], "ACAA")), source, original,
    )).not.toThrow();
  });

  test("validates ordered nonoverlapping indexed maps without cross-section content borrowing", () => {
    const source = "app/page.tsx";
    const input = { version: 3, file: "../app/out.js", sections: [
      section(flat(["runtime", "webpack/startup"], ["runtime"], "AAAA")),
      section({ version: 3, sections: [section(flat([source], ["original"]))] }, 1),
    ] };
    const before = JSON.stringify(input);
    const result = read(input, "server/app/out.js");
    expect(result).toEqual([
      { source: "runtime", content: "runtime", mapped: true },
      { source: "webpack/startup", content: null, mapped: false },
      { source, content: "original", mapped: true },
    ]);
    expect(() => assertNextAuthoredSourceEmbedding(result, source, "original")).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
    input.sections[1]!.map = { version: 3, sections: [section(flat([source], ["original"], "A"))] };
    expect(() => assertNextAuthoredSourceEmbedding(read(input, "server/app/out.js"), source, "original"))
      .toThrow(/never reference/u);
  });

  test("rejects malformed, unordered, overlapping, or excessively nested indexed maps", () => {
    for (const sections of [
      null, [], {}, [null], new Array(1),
      [{}], [{ map: flat() }], [{ offset: null, map: flat() }],
      [section(flat(), -1)], [section(flat(), 0, -1)], [section(flat(), 0.5)],
      [section(flat(), 0, Number.NaN)], [{ offset: { line: 0, column: 0 }, url: "external.map" }],
      [{ ...section(flat()), extra: true }], [section(flat(["runtime"], [false]))],
      [section(flat(), 1), section(flat(), 0)],
      [section(flat(), 0, 1), section(flat(), 0, 1)],
      [section(flat(["runtime"], ["runtime"], "EAAA")), section(flat(), 0, 1)],
      [section(flat(["runtime"], ["runtime"], "E")), section(flat(), 0, 1)],
    ]) expect(() => read({ version: 3, sections })).toThrow();
    expect(() => read({ version: 3, sections: [section(flat())], mappings: "AAAA" })).toThrow(/unknown keys/u);
    let nested: unknown = flat();
    for (let index = 0; index < 66; index += 1) nested = { version: 3, sections: [section(nested)] };
    expect(() => read(nested)).toThrow(/index-map nesting bound/u);
  });

  test("binds map metadata and trailing external links to the exact adjacent output", () => {
    expect(() => read({ ...flat(), file: "static/chunks/app/page.js" }, "static/chunks/app/page.js")).not.toThrow();
    expect(() => read({ ...flat(), file: "../app/page.js" }, "server/app/page.js")).not.toThrow();
    expect(() => read({ ...flat(), file: "app/edge/page.js" }, "server/app/edge/page.js")).not.toThrow();
    expect(() => read({ ...flat(), file: "232.js" }, "server/chunks/232.js")).not.toThrow();
    expect(() => read({ ...flat(), file: "../webpack-runtime.js" }, "server/webpack-runtime.js")).not.toThrow();
    expect(() => read({ ...flat(), file: "other.js" }, "server/app/page.js")).toThrow(/file differs/u);
    expect(() => read(
      { ...flat(), file: "../app/global-error-proof/page.js" },
      "server/app/index/[manifestProof]/page.js",
    )).toThrow(/file differs/u);
    expect(() => assertNextSourceMapOutputLink(
      "console.log('ok');\n//# sourceMappingURL=page.js.map\n",
      "server/app/page.js",
      "server/app/page.js.map",
    )).not.toThrow();
    expect(() => assertNextSourceMapOutputLink(
      ".fixture{}\n/*# sourceMappingURL=site.css.map */\n",
      "static/css/site.css",
      "static/css/site.css.map",
    )).not.toThrow();
    for (const [outputSource, outputPath, mapPath] of [
      ["console.log('ok')", "server/app/page.js", "server/app/page.js.map"],
      ["//# sourceMappingURL=other.js.map", "server/app/page.js", "server/app/page.js.map"],
      ["//# sourceMappingURL=data:application/json,e30=", "server/app/page.js", "server/app/page.js.map"],
      ["//# sourceMappingURL=page.js.map", "server/app/page.js", "server/other/page.js.map"],
      ["//# sourceMappingURL=page.js.map", "/private/page.js", "/private/page.js.map"],
    ] as const) expect(() => assertNextSourceMapOutputLink(outputSource, outputPath, mapPath)).toThrow();
  });
});
