import { describe, expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";

import { canonicalJson, sha256 } from "./compiler.js";
import { createViteSourceMapPaths, validateViteSourceMap } from "./vite-source-maps.js";

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

  test("accepts validated native map instances but rejects omitted sources, mappings and chunk witnesses", () => {
    const item = fixture();
    class NativeMap {
      toString() { return JSON.stringify(this); }
    }
    const native = Object.assign(new NativeMap(), item.map);
    expect(validateViteSourceMap(native, { ...item, code: content })).toBe(canonicalJson(item.map));
    expect(() => validateViteSourceMap({ ...item.map, sources: [], sourcesContent: [], mappings: "" }, { ...item, code: content })).toThrow(/omitted/u);
    expect(() => validateViteSourceMap({ ...item.map, mappings: "" }, { ...item, code: content })).toThrow(/omits mappings/u);
    expect(() => validateViteSourceMap(item.map, { ...item, code: content, preliminaryChunkPath: "assets/other.js" })).toThrow(/bypassed native chunk/u);
    expect(() => validateViteSourceMap(item.map, { ...item, code: content, requiredSources: ["src/absent.ts"] })).toThrow(/omits rendered/u);
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
