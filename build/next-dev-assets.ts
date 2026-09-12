import assert from "node:assert/strict";
import { posix } from "node:path";
import { bundleAsync, transform } from "lightningcss";
import { auditCssWithoutStandaloneRecipes, canonicalJson, normalizeLogicalPath, sha256 } from "./compiler.js";
import type { StylexPackageManifestV1 } from "./contracts.js";

export type NextDevCapturedCssInput = Readonly<{ path: string; sha256: string; source: string }>;
const MAX_CSS_INPUTS = 128;
const MAX_CSS_BYTES = 8 * 1024 * 1024;

/**
 * Materialize the native asset entirely from captured producer bytes. A digest
 * over CSS containing relative imports would neither locate nor bind its full
 * presentation at the new immutable URL. No resolver fallback reads the disk.
 * This dev-only profile supports inline data images, not external CSS assets.
 */
export async function materializeNextDevNativeCss(options: Readonly<{
  entryPath: string;
  manifests: readonly StylexPackageManifestV1[];
  source: string;
  stylesheets: readonly NextDevCapturedCssInput[];
}>): Promise<Readonly<{ css: string; inputs: readonly Readonly<{ path: string; sha256: string }>[]; path: string; sha256: string }>> {
  // The pinned native asynchronous resolver requires the same genuine Node
  // runtime as Next. Reject Bun before entering that native callback boundary.
  assert.ok(process.versions.bun === undefined && !("Bun" in globalThis) && /^24\./u.test(process.versions.node),
    "Next development native CSS materialization requires genuine Node 24");
  const entry = normalizeLogicalPath(options.entryPath, "Next development native CSS entry");
  assert.ok(entry.endsWith(".css") && !entry.startsWith("node_modules/"), "Next development native CSS entry must be first-party CSS");
  assert.ok(typeof options.source === "string", "Next development native CSS source must be captured text");
  assert.ok(Array.isArray(options.stylesheets) && options.stylesheets.length > 0 && options.stylesheets.length <= MAX_CSS_INPUTS,
    "Next development native CSS inputs exceed their finite bound");
  const sources = new Map<string, Readonly<{ sha256: string; source: string }>>();
  sources.set(entry, Object.freeze({ source: options.source, sha256: sha256(options.source) }));
  let bytes = Buffer.byteLength(options.source);
  for (const input of options.stylesheets) {
    const path = normalizeLogicalPath(input.path, "Next development captured CSS path");
    assert.match(path, /^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.css$/u,
      "Next development native foundations must be registered installed CSS");
    assert.ok(!sources.has(path), "Next development native CSS inputs must be unique");
    assert.ok(typeof input.source === "string" && /^[a-f0-9]{64}$/u.test(input.sha256)
      && sha256(input.source) === input.sha256, "Next development captured CSS hash differs from its bytes");
    sources.set(path, Object.freeze({ sha256: input.sha256, source: input.source }));
    bytes += Buffer.byteLength(input.source);
    assert.ok(bytes <= MAX_CSS_BYTES, "Next development native CSS bytes exceed their finite bound");
  }
  const resolve = (specifier: string, from: string): string => {
    assert.ok(sources.has(from), "Next development CSS importer is outside captured authority");
    assert.ok(/^(?:\.\/|\.\.\/)/u.test(specifier) && !/[\\?#\0]/u.test(specifier),
      "Next development native CSS imports must be ordinary relative captured paths");
    const path = normalizeLogicalPath(posix.normalize(posix.join(posix.dirname(from), specifier)), "Next development resolved CSS import");
    assert.ok(path !== entry && sources.has(path), "Next development native CSS import is undeclared or returns to the entry");
    return path;
  };
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (path: string): void => {
    assert.ok(!visiting.has(path), "Next development native CSS imports contain a cycle");
    if (visited.has(path)) return;
    visiting.add(path);
    const captured = sources.get(path)!;
    if (path !== entry) auditCssWithoutStandaloneRecipes(captured.source, options.manifests, "Next development native foundation");
    const imports: string[] = [];
    const result = transform({ code: Buffer.from(captured.source), filename: path, errorRecovery: false, minify: false, sourceMap: false,
      visitor: {
        Rule(rule) { if (rule.type === "import") imports.push(resolve(rule.value.url, path)); },
        Url(url) {
          assert.match(url.url, /^data:image\/(?:png|gif|jpeg|webp|svg\+xml)(?:;|,)/iu,
            "Next development immutable CSS supports only inline data image URLs");
        },
      },
    });
    assert.equal(result.warnings.length, 0, "Next development native CSS audit emitted warnings");
    for (const imported of imports) walk(imported);
    visiting.delete(path);
    visited.add(path);
  };
  walk(entry);
  const result = await bundleAsync({ filename: entry, errorRecovery: false, minify: false, sourceMap: false,
    resolver: {
      read(path) {
        assert.ok(visited.has(path), "Next development native CSS attempted an uncaptured read");
        return sources.get(path)!.source;
      },
      resolve,
    },
    visitor: {
      Rule(rule) { assert.notEqual(rule.type, "import", "Next development immutable CSS retained an import"); },
      Url(url) {
        assert.match(url.url, /^data:image\/(?:png|gif|jpeg|webp|svg\+xml)(?:;|,)/iu,
          "Next development immutable CSS retained an external asset");
      },
    },
  });
  assert.equal(result.warnings.length, 0, "Next development native CSS bundling emitted warnings");
  assert.ok(result.code.byteLength > 0 && result.code.byteLength <= MAX_CSS_BYTES, "Next development native CSS output exceeds its finite bound");
  const inputs = [...visited].sort().map((path) => Object.freeze({ path, sha256: sources.get(path)!.sha256 }));
  // Parsing may discard ordinary comments, including the captured source
  // revision marker. Bind every input digest explicitly so same-rule source
  // revisions cannot acquire one CSS hash with conflicting coverage authority.
  const css = `${Buffer.from(result.code).toString("utf8")}/* hraness-stylex-native-inputs ${sha256(canonicalJson(inputs))} */\n`;
  const digest = sha256(css);
  return Object.freeze({ css, inputs: Object.freeze(inputs), path: `static/css/hraness-stylex/${digest}.css`, sha256: digest });
}
