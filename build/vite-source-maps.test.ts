import { describe, expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";

import { canonicalJson, sha256 } from "./compiler.js";
import { createViteSourceMapPaths, validateViteSourceMap, validateViteSourceMapPair, viteSourceMapProjectionChunkPath } from "./vite-source-maps.js";

const content = "export const answer = 42;\n";
const sourceIdentity = { bytes: Buffer.byteLength(content), sha256: sha256(content) };

function fixture(root = "/fixture/project", suffix = "attempt-one") {
  const stagingDirectory = `${root}/generations/.hraness-stylex-production-${suffix}/.stylex-generation/graphs/client/output`;
  const publishedDirectory = `${root}/generations/production/graphs/client`;
  const paths = createViteSourceMapPaths({ rootDirectory: root, stagingDirectory, publishedDirectory,
    inputIdentity: (path) => path === "src/entry.ts" ? sourceIdentity : undefined });
  const chunkPath = "assets/entry.js";
  const source = paths.transform("../../../../../../../src/entry.ts", `${stagingDirectory}/${chunkPath}.map`);
  const map = { version: 3, file: basename(chunkPath), sources: [source], sourcesContent: [content], names: ["answer"], mappings: "AAAAA" };
  return { paths, chunkPath, map, source, stagingDirectory, publishedDirectory };
}

describe("Vite external source-map contract", () => {
  test("projects staging paths to final physical sources without temporary or absolute provenance", () => {
    const a = fixture();
    const b = fixture("/another/root", "different-attempt");
    expect(a.map).toEqual(b.map);
    expect(resolve(dirname(`${a.publishedDirectory}/${a.chunkPath}.map`), a.source)).toBe("/fixture/project/src/entry.ts");
    expect(a.source).not.toContain("attempt");
    expect(a.source).not.toContain("fixture");
    expect(validateViteSourceMap(a.map, { ...a, code: content })).toBe(canonicalJson(a.map));
  });

  test("rejects publication outside the source root", () => {
    expect(() => createViteSourceMapPaths({ rootDirectory: "/root/app", stagingDirectory: "/root/staging", publishedDirectory: "/elsewhere/output", inputIdentity: () => sourceIdentity })).toThrow();
  });

  function ignoreFixture(witness = "complete") {
    const paths = createViteSourceMapPaths({ rootDirectory: "/project", stagingDirectory: "/project/staging",
      publishedDirectory: "/project/published/graphs/client", inputIdentity: (path) =>
        ["src/entry.ts", "node_modules/vendor/index.js"].includes(path) ? sourceIdentity : undefined });
    const rawSources = ["../src/entry.ts", "../node_modules/vendor/index.js"];
    const sources = rawSources.map((source, index) => {
      if (witness === "complete" || (witness === "partial" && index === 1)) paths.ignore(source, "/project/staging/entry.js.map");
      return paths.transform(source, "/project/staging/entry.js.map");
    });
    const map = { version: 3, file: "entry.js", sources, sourcesContent: [content, content], names: [], mappings: "AAAA,ACAA" };
    const options = { paths, chunkPath: "entry.js", code: content,
      bundlerMeta: { rollupVersion: "4.23.0", rolldownVersion: "1.2.7", viteVersion: "8.2.1" } };
    return { map, options };
  }

  test("joins only Rolldown's witnessed lazy-map ignore loss while preserving the complete emitted map", () => {
    const { map, options } = ignoreFixture();
    const companion = { ...map, ignoreList: [1] };
    const bytes = JSON.stringify(companion);
    expect(validateViteSourceMapPair(map, companion, options)).toBe(canonicalJson(companion));
    expect(validateViteSourceMapPair(map, companion, { ...options,
      bundlerMeta: { ...options.bundlerMeta, rolldownVersion: "1.2.8" } })).toBe(canonicalJson(companion));
    expect(JSON.stringify(companion)).toBe(bytes);
    expect(Object.hasOwn(map, "ignoreList")).toBe(false);
    for (const ignores of [{ ignoreList: [1] }, { x_google_ignoreList: [1] }, { ignoreList: [1], x_google_ignoreList: [1] }]) {
      const native = { ...map, ...ignores };
      expect(validateViteSourceMapPair(native, native, options)).toBe(canonicalJson(native));
    }
    const google = { ...map, x_google_ignoreList: [1] };
    expect(validateViteSourceMapPair(google, google, { ...options, bundlerMeta: { rollupVersion: "4.63.1", viteVersion: "7.3.6" } }))
      .toBe(canonicalJson(google));
    const reordered = { ...map, sources: [...map.sources].reverse() };
    expect(validateViteSourceMapPair(reordered, { ...reordered, ignoreList: [0] }, options))
      .toBe(canonicalJson({ ...reordered, ignoreList: [0] }));
  });

  test("ignore-list normalization cannot hide callback omissions, first-party hiding, aliases or unrelated map drift", () => {
    const { map, options } = ignoreFixture();
    const companion = { ...map, ignoreList: [1] };
    for (const witness of ["missing", "partial"]) {
      const fixture = ignoreFixture(witness);
      expect(() => validateViteSourceMapPair(fixture.map, { ...fixture.map, ignoreList: [1] }, fixture.options)).toThrow(/callback/u);
    }
    expect(() => validateViteSourceMapPair(map, map, options)).toThrow(/omitted native ignore/u);
    for (const indexes of [[], [0], [0, 1], [1, 1], [2], [-1]]) {
      expect(() => validateViteSourceMapPair(map, { ...map, ignoreList: indexes }, options)).toThrow();
      expect(() => validateViteSourceMapPair({ ...map, x_google_ignoreList: indexes }, companion, options)).toThrow();
    }
    expect(() => validateViteSourceMapPair(map, { ...companion, x_google_ignoreList: [0] }, options)).toThrow();
    for (const mutation of [{ names: ["extra"] }, { mappings: "AAAA,CCAA" }, { sourceRoot: "" }, { file: "foreign.js" }, { extra: "unknown" }]) {
      expect(() => validateViteSourceMapPair(map, { ...companion, ...mutation }, options)).toThrow();
    }
    expect(() => validateViteSourceMapPair({ ...map, ignoreList: [0] }, companion, options)).toThrow();
    for (const bundlerMeta of [null, {}, { rollupVersion: "4.63.1", viteVersion: "7.3.6" },
      { rolldownVersion: "1.2.9", viteVersion: "8.2.1" }, { rolldownVersion: "1.2.7", viteVersion: "8.2.2" }]) {
      expect(() => validateViteSourceMapPair(map, companion, { ...options, bundlerMeta })).toThrow(/companion differs/u);
    }
    expect(() => validateViteSourceMapPair(map, { ...map, x_google_ignoreList: [1] }, options)).toThrow(/companion differs/u);
  });

  test("all-false native ignore decisions still require exact source and chunk coverage", () => {
    const item = fixture();
    const mapPath = `${item.stagingDirectory}/${item.chunkPath}.map`;
    expect(item.paths.ignore("../../../../../../../src/entry.ts", mapPath)).toBe(false);
    const options = { ...item, code: content, bundlerMeta: { rolldownVersion: "1.2.7", viteVersion: "8.2.1" } };
    expect(validateViteSourceMapPair(item.map, item.map, options)).toBe(canonicalJson(item.map));
    expect(validateViteSourceMapPair(item.map, { ...item.map, ignoreList: [] }, options)).toBe(canonicalJson({ ...item.map, ignoreList: [] }));
    expect(() => item.paths.ignoredIndexes("assets/foreign.js.map", ["src/entry.ts"])).toThrow(/not observed/u);
    expect(() => item.paths.ignoredIndexes(`${item.chunkPath}.map`, [])).toThrow(/census/u);
  });

  test("authentic empty chunks need no callbacks but erased or unobserved rendered sources still fail", () => {
    const paths = createViteSourceMapPaths({ rootDirectory: "/project", stagingDirectory: "/project/staging",
      publishedDirectory: "/project/published", inputIdentity: () => sourceIdentity });
    const map = { version: 3, file: "empty.js", sources: [], sourcesContent: [], names: [], mappings: "" };
    const options = { chunkPath: "empty.js", code: "", paths, bundlerMeta: { rolldownVersion: "1.2.7", viteVersion: "8.2.1" } };
    expect(validateViteSourceMapPair(map, map, options)).toBe(canonicalJson(map));
    expect(() => validateViteSourceMapPair(map, map, { ...options, requiredSources: ["src/entry.ts"] })).toThrow(/rendered/u);
    paths.transform("../src/entry.ts", "/project/staging/empty.js.map");
    expect(() => validateViteSourceMapPair(map, map, options)).toThrow(/omitted/u);
    expect(() => paths.ignoredIndexes("empty.js.map", [])).toThrow(/not observed/u);
    paths.ignore("../src/entry.ts", "/project/staging/empty.js.map");
    expect(() => paths.ignoredIndexes("empty.js.map", [])).toThrow(/census/u);
  });

  test("rejects outside, unobserved, encoded and URL sources and foreign map output", () => {
    const item = fixture();
    for (const source of ["/secrets.ts", "file:///secrets.ts", "https://host/source.ts", "../src%2fentry.ts", "../src/entry.ts?raw", "../src/entry.ts#part", "../src\\entry.ts", "\u0000virtual", "../../../../../../../../secret.ts", "../../../../../../../src/absent.ts"]) {
      expect(() => item.paths.transform(source, `${item.stagingDirectory}/${item.chunkPath}.map`)).toThrow();
    }
    expect(() => item.paths.transform("entry.ts", "/outside/chunk.js.map")).toThrow();
    expect(() => item.paths.transform("entry.ts", `${item.stagingDirectory}/style.css.map`)).toThrow();
    expect(() => item.paths.source(`${item.chunkPath}.map`, `${item.source}/../entry.ts`)).toThrow();
  });

  test("requires native path projection even for otherwise valid file content", () => {
    const item = fixture();
    const paths = createViteSourceMapPaths({ rootDirectory: "/fixture/project", stagingDirectory: item.stagingDirectory, publishedDirectory: item.publishedDirectory, inputIdentity: () => sourceIdentity });
    expect(() => validateViteSourceMap(item.map, { ...item, paths, code: content })).toThrow(/bypassed native/u);
  });

  test("joins each engine's exact native callback coordinate without accepting the other chunk identity", () => {
    const chunkPath = "assets/entry-BkSbaUkx.js";
    const preliminaryChunkPath = "assets/entry-!~{000}~.js";
    for (const engine of ["rollup", "rolldown"] as const) {
      const meta = { rollupVersion: engine === "rollup" ? "4.63.1" : "4.23.0",
        ...(engine === "rolldown" ? { rolldownVersion: "1.2.7" } : {}) };
      const expected = engine === "rollup" ? preliminaryChunkPath : chunkPath;
      const other = engine === "rollup" ? chunkPath : preliminaryChunkPath;
      const projectionChunkPath = viteSourceMapProjectionChunkPath(meta, chunkPath, preliminaryChunkPath);
      expect(projectionChunkPath).toBe(expected);
      const paths = createViteSourceMapPaths({ rootDirectory: "/fixture/project", stagingDirectory: "/fixture/project/staging",
        publishedDirectory: "/fixture/project/published/graphs/client", inputIdentity: (path) => path === "src/entry.ts" ? sourceIdentity : undefined });
      const source = paths.transform("../../src/entry.ts", `/fixture/project/staging/${expected}.map`);
      const map = { version: 3, file: basename(chunkPath), sources: [source], sourcesContent: [content], names: [], mappings: "AAAA" };
      const options = { chunkPath, projectionChunkPath, code: content, paths };
      expect(validateViteSourceMap(map, options)).toBe(canonicalJson(map));
      expect(() => validateViteSourceMap(map, { ...options, projectionChunkPath: other })).toThrow(/bypassed native chunk/u);
      expect(() => validateViteSourceMap(map, { ...options, projectionChunkPath: "assets/foreign.js" })).toThrow(/bypassed native chunk/u);
      expect(() => validateViteSourceMap({ ...map, sources: [], sourcesContent: [], mappings: "" }, options)).toThrow(/omitted/u);
    }
  });

  test("requires native engine and both normalized chunk identities even when only one selects the witness", () => {
    for (const meta of [null, [], {}, { rollupVersion: "" }, { rollupVersion: 4 },
      { rollupVersion: "4.23.0", rolldownVersion: undefined }, { rollupVersion: "4.23.0", rolldownVersion: "" },
      { rollupVersion: "4.23.0", rolldownVersion: 1 }]) {
      expect(() => viteSourceMapProjectionChunkPath(meta, "assets/entry.js", "assets/preliminary.js")).toThrow(/identity/u);
    }
    for (const meta of [{ rollupVersion: "4.63.1" }, { rollupVersion: "4.23.0", rolldownVersion: "1.2.7" }]) {
      for (const path of ["", "/outside.js", "../outside.js", "assets/../outside.js", "assets\\entry.js"]) {
        expect(() => viteSourceMapProjectionChunkPath(meta, path, "assets/preliminary.js")).toThrow();
        expect(() => viteSourceMapProjectionChunkPath(meta, "assets/entry.js", path)).toThrow();
      }
      expect(() => viteSourceMapProjectionChunkPath(meta, "assets/entry.js", undefined)).toThrow();
    }
  });

  test("accepts validated native map instances but rejects omitted sources, mappings and chunk witnesses", () => {
    const item = fixture();
    class NativeMap {
      toString() { return JSON.stringify(this); }
    }
    const native = Object.assign(new NativeMap(), item.map);
    expect(validateViteSourceMap(native, { ...item, code: content })).toBe(canonicalJson(item.map));
    expect(() => validateViteSourceMap({ ...item.map, sources: [], sourcesContent: [], mappings: "" }, { ...item, code: content })).toThrow(/omitted/u);
    expect(() => validateViteSourceMap({ ...item.map, mappings: "" }, { ...item, code: content })).toThrow(/omits mappings/u);
    expect(() => validateViteSourceMap(item.map, { ...item, code: content, projectionChunkPath: "assets/other.js" })).toThrow(/bypassed native chunk/u);
    expect(() => validateViteSourceMap(item.map, { ...item, code: content, requiredSources: ["src/absent.ts"] })).toThrow(/omits rendered/u);
  });

  test("normalizes only Vite's native lazy-map method and absent optional JSON fields", () => {
    const item = fixture();
    class NativeComposedMap {
      sourceRoot = undefined;
      toString() { return JSON.stringify(this); }
    }
    let calls = 0;
    const native = Object.assign(new NativeComposedMap(), item.map, {
      ignoreList: [0],
      toUrl: () => { calls += 1; throw new Error("native method must not be invoked"); },
    });
    const serialized: unknown = JSON.parse(JSON.stringify(native));
    expect(validateViteSourceMap(native, { ...item, code: content })).toBe(canonicalJson(serialized));
    expect(validateViteSourceMap(serialized, { ...item, code: content })).toBe(canonicalJson(serialized));
    expect(calls).toBe(0);
    expect(Object.hasOwn(native, "toUrl")).toBe(true);
    expect(Object.hasOwn(native, "sourceRoot")).toBe(true);
    expect(native.sourcesContent).toEqual([content]);
    expect(native.mappings).toBe(item.map.mappings);
    for (const key of ["sourceRoot", "ignoreList", "x_google_ignoreList"]) {
      expect(validateViteSourceMap({ ...item.map, [key]: undefined }, { ...item, code: content }))
        .toBe(canonicalJson(item.map));
    }
  });

  test("does not normalize unknown keys, malformed native methods or executable map data", () => {
    const item = fixture();
    for (const mutation of [
      { toUrl: "private payload" }, { toUrl: undefined }, { toUrl: null }, { toUrl: {} },
      { toString: "private payload" }, { toString: undefined }, { toString: null }, { toString: {} },
      { extra: undefined }, { extra: () => "private payload" }, { toJSON: () => item.map },
      { debugId: "unsupported" }, { [Symbol("unsupported")]: undefined },
    ]) expect(() => validateViteSourceMap({ ...item.map, ...mutation }, { ...item, code: content })).toThrow();
    let getterCalls = 0;
    for (const key of ["sources", "sourceRoot", "toUrl", "toString"]) {
      const map = { ...item.map };
      Object.defineProperty(map, key, { enumerable: true, get: () => { getterCalls += 1; return undefined; } });
      expect(() => validateViteSourceMap(map, { ...item, code: content })).toThrow(/data properties/u);
    }
    expect(getterCalls).toBe(0);
    const hidden = { ...item.map };
    Object.defineProperty(hidden, "sources", { enumerable: false, value: item.map.sources });
    expect(() => validateViteSourceMap(hidden, { ...item, code: content })).toThrow(/data properties/u);
  });

  test("normalizes Rolldown's own map helpers without executing them or changing JSON map data", () => {
    const item = fixture();
    let calls = 0;
    const native = { ...item.map,
      toString() { calls += 1; throw new Error("native method must not be invoked"); },
      toUrl() { calls += 1; throw new Error("native method must not be invoked"); },
    };
    expect(Object.keys(native)).toEqual([...Object.keys(item.map), "toString", "toUrl"]);
    expect(JSON.parse(JSON.stringify(native))).toEqual(item.map);
    expect(validateViteSourceMap(native, { ...item, code: content })).toBe(canonicalJson(item.map));
    expect(calls).toBe(0);
    for (const key of ["toString", "toUrl"]) {
      const hidden = { ...item.map };
      Object.defineProperty(hidden, key, { enumerable: false, value: () => { calls += 1; } });
      expect(() => validateViteSourceMap(hidden, { ...item, code: content })).toThrow(/data properties/u);
    }
    expect(calls).toBe(0);
  });

  test("rejects incomplete, foreign, malformed and content-drift maps", () => {
    const item = fixture();
    for (const mutation of [
      { version: 2 }, { file: "other.js" }, { sourcesContent: [] }, { sourcesContent: [null] },
      { sourcesContent: ["forged"] }, { sources: ["../../../../../../outside.ts"] },
      { sourceRoot: "../elsewhere" }, { extra: "unsupported" }, { names: [1] },
      { ignoreList: [1] }, { ignoreList: [0, 0] }, { x_google_ignoreList: [-1] },
      { mappings: undefined },
    ]) expect(() => validateViteSourceMap({ ...item.map, ...mutation }, { ...item, code: content })).toThrow();
    expect(() => validateViteSourceMap(null, { ...item, code: content })).toThrow();
    expect(() => validateViteSourceMap([], { ...item, code: content })).toThrow();
    const { sourcesContent: _omitted, ...incomplete } = item.map;
    expect(() => validateViteSourceMap(incomplete, { ...item, code: content })).toThrow();
  });

  test("validates VLQ indexes, order, arity, overflow and original/generated coordinates", () => {
    const item = fixture();
    for (const mappings of ["!", "g", "gggggggggggA", "AA", "AAAAAA", "ACAA", "ADAA", "AAEA", "AADA", "AAA0B", "AAAAC", "C,DAAA", ",AAAA", "AAAA,", "0BAAA", ";;;AAAA"]) {
      expect(() => validateViteSourceMap({ ...item.map, mappings }, { ...item, code: "x" })).toThrow();
    }
    // A one-field generated segment and a named source segment are both native forms.
    const valid = { ...item.map, mappings: "A,AAAAA", ignoreList: [0], sourceRoot: "" };
    expect(validateViteSourceMap(valid, { ...item, code: content })).toBe(canonicalJson(valid));
  });

  test("counts ECMAScript line terminators without altering original bytes", () => {
    for (const separator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
      const source = `a${separator}b`;
      const paths = createViteSourceMapPaths({ rootDirectory: "/root/app", stagingDirectory: "/root/app/staging",
        publishedDirectory: "/root/app/final", inputIdentity: () => ({ bytes: Buffer.byteLength(source), sha256: sha256(source) }) });
      const projected = paths.transform("../entry.js", "/root/app/staging/output.js.map");
      const map = { version: 3, file: "output.js", sources: [projected], sourcesContent: [source], names: [], mappings: "AAAA;AACA" };
      const options = { chunkPath: "output.js", code: source, paths };
      expect(validateViteSourceMap(map, options)).toBe(canonicalJson(map));
      expect(() => validateViteSourceMap({ ...map, mappings: "AAAE" }, options)).toThrow(/original columns/u);
    }
  });
});
