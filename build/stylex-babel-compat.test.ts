import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { createStylexTransformCollector } from "./compiler.js";
import {
  STYLEX_BABEL_COMPAT_PATCHED_SOURCE_SHA256,
  STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
  patchStylexBabelSourceForCompatibility,
  stylexBabelPluginModule,
  type StylexBabelSourceHashes,
} from "./stylex-babel-compat.js";

const repository = process.cwd();
const require = createRequire(import.meta.url);
const upstreamFilename = require.resolve("@stylexjs/babel-plugin");
const upstreamSource = readFileSync(upstreamFilename, "utf8");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesFor(source: string, patchedSourceSha256 = sha256(source)): StylexBabelSourceHashes {
  return { patchedSourceSha256, sourceSha256: sha256(source) };
}

function sourceWithMediaQuery(query: string): string {
  return [
    'import * as stylex from "@stylexjs/stylex";',
    "export const styles = stylex.create({",
    `  root: { color: { default: "black", ${JSON.stringify(query)}: "red" } },`,
    "});",
  ].join("\n");
}

function repeatedMediaSource(count: number): string {
  const entries = Array.from({ length: count }, (_, index) => [
    `  item${String(index)}: {`,
    '    animationName: { default: "none", [reducedMotion]: "none" },',
    '    color: { default: "black", [forcedColors]: "CanvasText" },',
    "  },",
  ].join("\n"));
  return [
    'import * as stylex from "@stylexjs/stylex";',
    'const forcedColors = "@media (forced-colors: active)";',
    'const reducedMotion = "@media (prefers-reduced-motion: reduce)";',
    "export const styles = stylex.create({",
    ...entries,
    "});",
  ].join("\n");
}

describe("pinned StyleX Babel compatibility", () => {
  test("loads a callable plugin with the required StyleX transform surface", () => {
    expect(typeof stylexBabelPluginModule).toBe("function");
    const candidate = stylexBabelPluginModule as {
      processStylexRules?: unknown;
      withOptions?: unknown;
    };
    expect(typeof candidate.processStylexRules).toBe("function");
    expect(typeof candidate.withOptions).toBe("function");
  });

  test("patches the exact upstream source without mutating it", () => {
    expect(sha256(upstreamSource)).toBe(STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256);
    const patched = patchStylexBabelSourceForCompatibility(upstreamSource);
    expect(sha256(patched)).toBe(STYLEX_BABEL_COMPAT_PATCHED_SOURCE_SHA256);
    expect(sha256(readFileSync(upstreamFilename, "utf8"))).toBe(
      STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
    );
  });

  test("rejects changed source before applying the compatibility patch", () => {
    expect(() => patchStylexBabelSourceForCompatibility(`${upstreamSource}\n`)).toThrow(
      /source SHA-256 changed/u,
    );
  });

  test("rejects missing and repeated patch sites", () => {
    const patchSite =
      "\t    if (tokens.peek() != null) {\n\t      const token = tokens.peek();\n\t      if (token == null) {\n\t        return output;\n\t      }\n\t      const consumedTokens = tokens.slice(initialIndex);\n";
    const missing = "module.exports = function fixture() {};\n";
    const repeated = `${patchSite}\n${patchSite}\n`;
    for (const source of [missing, repeated]) {
      expect(() => patchStylexBabelSourceForCompatibility(source, hashesFor(source))).toThrow(
        /exactly one EOF compatibility patch site/u,
      );
    }
  });

  test("rejects an unexpected patched-source digest", () => {
    const expected = {
      patchedSourceSha256: "0".repeat(64),
      sourceSha256: STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
    };
    expect(() => patchStylexBabelSourceForCompatibility(upstreamSource, expected)).toThrow(
      /Patched StyleX Babel source SHA-256 changed/u,
    );
  });

  test("accepts forward and reverse collector transforms beyond the Bun parser-state threshold", async () => {
    const stressSource = repeatedMediaSource(128);
    const terminalSource = sourceWithMediaQuery("@media (forced-colors: active)");
    const stressId = resolve(repository, "build", "compat-repeated.stylex.ts");
    const terminalId = resolve(repository, "build", "compat-after-repeated.stylex.ts");

    const forward = createStylexTransformCollector(repository);
    const forwardStress = await forward.transform(stressSource, stressId);
    const forwardTerminal = await forward.transform(terminalSource, terminalId);
    const forwardRules = forward.seal();

    const reverse = createStylexTransformCollector(repository);
    const reverseTerminal = await reverse.transform(terminalSource, terminalId);
    const reverseStress = await reverse.transform(stressSource, stressId);
    const reverseRules = reverse.seal();

    expect(forwardStress).toEqual(reverseStress);
    expect(forwardTerminal).toEqual(reverseTerminal);
    expect(forwardRules).toEqual(reverseRules);
    expect(forwardStress.rules.length).toBeGreaterThan(0);
    expect(forwardTerminal.rules.length).toBeGreaterThan(0);
  });

  test("preserves exact last-media-query-wins normalization for overlapping ranges", async () => {
    const source = [
      'import * as stylex from "@stylexjs/stylex";',
      "export const styles = stylex.create({",
      "  root: {",
      "    color: {",
      '      default: "black",',
      '      "@media (min-width: 1px)": "red",',
      '      "@media (min-width: 2px)": "blue",',
      "    },",
      "  },",
      "});",
    ].join("\n");
    const collector = createStylexTransformCollector(repository);
    const { rules } = await collector.transform(
      source,
      resolve(repository, "build", "compat-order.stylex.ts"),
    );
    const normalized = rules.map(([key, value, priority]) => ({
      ltr: value.ltr.replaceAll(key, "fixture"),
      priority,
      rtl: value.rtl,
    }));
    expect(normalized).toEqual([
      { ltr: ".fixture{color:black}", priority: 3000, rtl: null },
      {
        ltr: "@media (min-width: 1px) and (max-width: 1.99px){.fixture.fixture{color:red}}",
        priority: 3200,
        rtl: null,
      },
      {
        ltr: "@media (min-width: 2px){.fixture.fixture{color:blue}}",
        priority: 3200,
        rtl: null,
      },
    ]);
  });

  test("continues to reject trailing non-EOF tokens and unbalanced queries", async () => {
    for (const query of [
      "@media (forced-colors: active) trailing",
      "@media (forced-colors: active",
    ]) {
      const collector = createStylexTransformCollector(repository);
      await expect(collector.transform(
        sourceWithMediaQuery(query),
        resolve(repository, "build", "compat-invalid.stylex.ts"),
      )).rejects.toThrow(
        /Invalid media query syntax/u,
      );
    }
  });
});
