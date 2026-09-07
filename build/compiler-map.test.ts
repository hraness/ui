import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, test } from "bun:test";

import {
  canonicalJson,
  createStylexTransformCollector,
  parseStylexSourceMap,
  sha256,
} from "./compiler.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(): Promise<Readonly<{ path: string; root: string; source: string }>> {
  const root = await mkdtemp(join(tmpdir(), "ui-stylex-maps-"));
  roots.push(root);
  await mkdir(join(root, "src"));
  const path = join(root, "src", "fixture.tsx");
  const source = [
    'import * as stylex from "@stylexjs/stylex";',
    'const styles = stylex.create({ root: { color: "rebeccapurple" } });',
    'export const className = stylex.props(styles.root).className;',
    "",
  ].join("\n");
  await writeFile(path, source);
  return { path, root, source };
}

describe("StyleX mapped transform", () => {
  const privatePaths = [
    "/Users/example/private/page.tsx",
    "C:/private/page.tsx",
    "C:\\private\\page.tsx",
    "C:private/page.tsx",
    "\\\\server\\share\\page.tsx",
    "//server/share/page.tsx",
    "file:///private/page.tsx",
    "https://example.invalid/private/page.tsx",
    "http://example.invalid/private/page.tsx",
    "data:text/plain,private",
    "../private/page.tsx",
    "src/../private/page.tsx",
    "./src/page.tsx",
    "src//page.tsx",
    "src/%2e%2e/private/page.tsx",
    "%2Fprivate/page.tsx",
    "src/page.tsx?private",
    "src/page.tsx#private",
    "src/pa\nge.tsx",
    " src/page.tsx",
  ];
  for (const field of ["sources", "sourceRoot", "file"] as const) {
    for (const path of privatePaths) {
      test(`rejects private or ambiguous ${field}: ${JSON.stringify(path)}`, () => {
        assert.throws(() => parseStylexSourceMap({
          mappings: "AAAA", names: [], sources: ["src/page.tsx"], version: 3,
          [field]: field === "sources" ? [path] : path,
        }));
      });
    }
  }

  test("preserves exact relative map data and source indexes without normalization", () => {
    const map = {
      file: "generated/nested/input.js",
      ignoreList: [2, 0],
      mappings: "AAAAA;ACCAC;ACDAC",
      names: ["omega", "alpha"],
      sourceRoot: "authored/nested/",
      sources: ["z.tsx", "nested/a.tsx", "z.tsx"],
      sourcesContent: ["first", null, "third"],
      version: 3,
      x_google_ignoreList: [1],
    };
    assert.deepEqual(parseStylexSourceMap(map), map);
    assert.equal(canonicalJson(parseStylexSourceMap(map)), canonicalJson(map));
    for (const sourceRoot of ["", "authored/nested"]) {
      assert.deepEqual(parseStylexSourceMap({ ...map, sourceRoot }), { ...map, sourceRoot });
    }
  });

  test("keeps the legacy transform surface and adds maps only by explicit opt-in", async () => {
    const context = await fixture();
    const legacy = createStylexTransformCollector(context.root);
    const legacyResult = await legacy.transform(context.source, context.path);
    legacy.seal();
    assert.deepEqual(Object.keys(legacyResult).sort(), ["code", "rules"]);

    const mapped = createStylexTransformCollector(context.root);
    const mappedResult = await mapped.transformWithMap(context.source, context.path, {
      logicalSourceFileName: "src/fixture.tsx",
    });
    mapped.seal();
    assert.equal(mappedResult.code, legacyResult.code);
    assert.equal(mappedResult.inputMapSha256, null);
    assert.equal(mappedResult.logicalSourceFileName, "src/fixture.tsx");
    assert.equal(mappedResult.map.version, 3);
    assert.ok(mappedResult.map.sources.includes("src/fixture.tsx"));
    assert.equal(mappedResult.mapSha256, sha256(canonicalJson(mappedResult.map)));
  });

  test("chains a caller map and binds both map identities", async () => {
    const context = await fixture();
    const inputSourceMap = {
      mappings: "AAAA",
      names: [],
      sources: ["authored/fixture.tsx"],
      sourcesContent: [context.source],
      version: 3 as const,
    };
    const collector = createStylexTransformCollector(context.root);
    const result = await collector.transformWithMap(context.source, context.path, {
      inputSourceMap,
      logicalSourceFileName: "src/fixture.tsx",
    });
    collector.seal();
    assert.equal(result.inputMapSha256, sha256(canonicalJson(inputSourceMap)));
    assert.ok(result.map.sources.some((source) => source.endsWith("authored/fixture.tsx")));
    assert.deepEqual(result.map.sourcesContent, [context.source]);
  });

  test("chains a nested relative root while retaining the exact accepted input-map hash", async () => {
    const context = await fixture();
    const inputSourceMap = {
      file: "generated/nested/input.js",
      mappings: "AAAA",
      names: [],
      sourceRoot: "authored/",
      sources: ["nested/fixture.tsx"],
      sourcesContent: [context.source],
      version: 3 as const,
    };
    const before = canonicalJson(inputSourceMap);
    const collector = createStylexTransformCollector(context.root);
    const result = await collector.transformWithMap(context.source, context.path, {
      inputSourceMap,
      logicalSourceFileName: "src/fixture.tsx",
    });
    collector.seal();
    assert.equal(canonicalJson(inputSourceMap), before);
    assert.equal(result.inputMapSha256, sha256(before));
    assert.deepEqual(result.map.sources, ["authored/nested/fixture.tsx"]);
    assert.deepEqual(result.map.sourcesContent, [context.source]);
    assert.equal(result.mapSha256, sha256(canonicalJson(result.map)));
  });

  test("rejects private maps before collecting rules or returning transformed output", async () => {
    const context = await fixture();
    const validMap = { mappings: "AAAA", names: [], sources: ["authored/fixture.tsx"], version: 3 };
    for (const options of [
      { inputSourceMap: { ...validMap, sources: [context.path] }, logicalSourceFileName: "src/fixture.tsx" },
      { inputSourceMap: { ...validMap, sourceRoot: "file:///private/" }, logicalSourceFileName: "src/fixture.tsx" },
      { inputSourceMap: { ...validMap, file: "C:/private/input.js" }, logicalSourceFileName: "src/fixture.tsx" },
      { inputSourceMap: validMap, logicalSourceFileName: "file:private/fixture.tsx" },
    ]) {
      const collector = createStylexTransformCollector(context.root);
      await assert.rejects(collector.transformWithMap(context.source, context.path, options));
      assert.deepEqual(collector.seal(), []);
    }
  });

  test("rejects malformed or lossy source-map shapes", () => {
    assert.throws(
      () => parseStylexSourceMap({ mappings: "", names: [], sources: ["src/a.ts"], version: 3, vendor: true }),
      /unknown keys/u,
    );
    assert.throws(
      () => parseStylexSourceMap({ mappings: "", names: [], sources: ["src/a.ts"], sourcesContent: [], version: 3 }),
      /length must match/u,
    );
    assert.throws(
      () => parseStylexSourceMap({ mappings: "", names: [], sources: [], version: 3 }),
      /nonempty array/u,
    );
  });
});
