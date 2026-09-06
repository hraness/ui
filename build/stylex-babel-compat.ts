import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { compileFunction } from "node:vm";

export const STYLEX_BABEL_COMPAT_PACKAGE_NAME = "@stylexjs/babel-plugin" as const;
export const STYLEX_BABEL_COMPAT_UPSTREAM_VERSION = "0.19.0" as const;
export const STYLEX_BABEL_COMPAT_ENTRY = "lib/index.js" as const;
export const STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_BYTES = 418_079 as const;
export const STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256 =
  "f880cd6733b91557647f1f894dbcbef7102199a112d1e8a6689fcf7b94f736c3" as const;
export const STYLEX_BABEL_COMPAT_PATCH_ID =
  "stylex-0.19.0-token-parser-explicit-eof-v1" as const;
export const STYLEX_BABEL_COMPAT_PATCH_SHA256 =
  "4d17ac835421e037788f800035cfe91ee4fdce384ce97529d572015ea4318295" as const;
export const STYLEX_BABEL_COMPAT_PATCHED_SOURCE_BYTES = 418_119 as const;
export const STYLEX_BABEL_COMPAT_PATCHED_SOURCE_SHA256 =
  "32dfd685bf0ccc18c922ac6906cb911b05b081cc00c0fa6e100818d211abd1ba" as const;

// @stylexjs/babel-plugin 0.19.0 can expose the tokenizer's explicit EOF token
// after a valid media query under Bun 1.3.14. The upstream parser ordinarily
// observes null at this boundary. This exact patch accepts only that terminal
// token; every other trailing token still follows the upstream rejection path,
// and last-media-query-wins ordering remains enabled.
const patchTarget =
  "\t    if (tokens.peek() != null) {\n\t      const token = tokens.peek();\n\t      if (token == null) {\n\t        return output;\n\t      }\n\t      const consumedTokens = tokens.slice(initialIndex);\n";
const patchReplacement =
  "\t    if (tokens.peek() != null) {\n\t      const token = tokens.peek();\n\t      if (token == null || (0, _cssTokenizer.isTokenEOF)(token)) {\n\t        return output;\n\t      }\n\t      const consumedTokens = tokens.slice(initialIndex);\n";

export type StylexBabelSourceHashes = Readonly<{
  patchedSourceSha256: string;
  sourceSha256: string;
}>;

const pinnedSourceHashes: StylexBabelSourceHashes = {
  patchedSourceSha256: STYLEX_BABEL_COMPAT_PATCHED_SOURCE_SHA256,
  sourceSha256: STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function occurrenceCount(source: string, target: string): number {
  let count = 0;
  let offset = 0;
  for (;;) {
    const index = source.indexOf(target, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + target.length;
  }
}

const patchDescriptor = JSON.stringify({
  id: STYLEX_BABEL_COMPAT_PATCH_ID,
  replacement: patchReplacement,
  sourceSha256: STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
  target: patchTarget,
});
assert.equal(
  sha256(patchDescriptor),
  STYLEX_BABEL_COMPAT_PATCH_SHA256,
  "StyleX Babel compatibility patch identity changed",
);

export function patchStylexBabelSourceForCompatibility(
  source: string,
  expected: StylexBabelSourceHashes = pinnedSourceHashes,
): string {
  assert.match(expected.sourceSha256, /^[a-f0-9]{64}$/u, "Expected StyleX source SHA-256 is invalid");
  assert.match(expected.patchedSourceSha256, /^[a-f0-9]{64}$/u, "Expected patched StyleX source SHA-256 is invalid");
  assert.equal(
    sha256(source),
    expected.sourceSha256,
    "Pinned StyleX Babel source SHA-256 changed",
  );
  assert.equal(
    occurrenceCount(source, patchTarget),
    1,
    "Pinned StyleX Babel source must contain exactly one EOF compatibility patch site",
  );

  const index = source.indexOf(patchTarget);
  const patched = `${source.slice(0, index)}${patchReplacement}${source.slice(index + patchTarget.length)}`;
  assert.equal(
    sha256(patched),
    expected.patchedSourceSha256,
    "Patched StyleX Babel source SHA-256 changed",
  );
  return patched;
}

type CommonJsModuleRecord = { exports: unknown };
type CommonJsWrapper = (
  exports: unknown,
  require: ReturnType<typeof createRequire>,
  module: CommonJsModuleRecord,
  filename: string,
  directory: string,
) => void;

export function loadStylexBabelPlugin(): unknown {
  const requireFromCompatibilityModule = createRequire(import.meta.url);
  const resolvedEntry = requireFromCompatibilityModule.resolve(STYLEX_BABEL_COMPAT_PACKAGE_NAME);
  const filename = realpathSync(resolvedEntry);
  const packageRoot = realpathSync(resolve(dirname(filename), ".."));
  assert.equal(
    filename,
    resolve(packageRoot, ...STYLEX_BABEL_COMPAT_ENTRY.split("/")),
    `Pinned ${STYLEX_BABEL_COMPAT_PACKAGE_NAME} entry changed`,
  );

  const entryStat = lstatSync(filename);
  assert.ok(entryStat.isFile() && !entryStat.isSymbolicLink(), "Pinned StyleX Babel entry must be an ordinary file");
  assert.equal(entryStat.size, STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_BYTES, "Pinned StyleX Babel entry byte size changed");

  const unresolvedManifest = resolve(packageRoot, "package.json");
  const manifestFilename = realpathSync(unresolvedManifest);
  assert.equal(manifestFilename, unresolvedManifest, "Pinned StyleX Babel package manifest must be a physical package-root file");
  const manifestStat = lstatSync(manifestFilename);
  assert.ok(
    manifestStat.isFile() && !manifestStat.isSymbolicLink(),
    "Pinned StyleX Babel package manifest must be an ordinary file",
  );
  const manifestValue: unknown = JSON.parse(readFileSync(manifestFilename, "utf8"));
  assert.ok(typeof manifestValue === "object" && manifestValue !== null && !Array.isArray(manifestValue));
  const manifest = manifestValue as { name?: unknown; version?: unknown };
  assert.equal(manifest.name, STYLEX_BABEL_COMPAT_PACKAGE_NAME, "Pinned StyleX Babel package name changed");
  assert.equal(manifest.version, STYLEX_BABEL_COMPAT_UPSTREAM_VERSION, "Pinned StyleX Babel package version changed");

  const sourceBytes = readFileSync(filename);
  assert.equal(sourceBytes.byteLength, STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_BYTES, "Pinned StyleX Babel source byte size changed");
  assert.equal(
    sha256(sourceBytes),
    STYLEX_BABEL_COMPAT_UPSTREAM_SOURCE_SHA256,
    "Pinned StyleX Babel source SHA-256 changed",
  );
  const source = sourceBytes.toString("utf8");
  const patched = patchStylexBabelSourceForCompatibility(source);
  assert.equal(Buffer.byteLength(patched), STYLEX_BABEL_COMPAT_PATCHED_SOURCE_BYTES, "Patched StyleX Babel source byte size changed");
  const moduleRecord: CommonJsModuleRecord = { exports: {} };

  // compileFunction is a supported node:vm API and avoids Module._compile's
  // private loader surface. Supplying a require rooted at the verified entry
  // point preserves the CommonJS dependency-resolution contract in memory.
  const wrapper = compileFunction(
    patched,
    ["exports", "require", "module", "__filename", "__dirname"],
    { filename },
  ) as CommonJsWrapper;
  Reflect.apply(wrapper, moduleRecord.exports, [
    moduleRecord.exports,
    createRequire(filename),
    moduleRecord,
    filename,
    dirname(filename),
  ]);
  return moduleRecord.exports;
}

export const stylexBabelPluginModule: unknown = loadStylexBabelPlugin();
