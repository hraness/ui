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
