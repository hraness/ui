/** Exact private browser artifacts; these paths are not package exports. */
import assert from "node:assert/strict";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

export const NEXT_DEV_PRIVATE_OUTPUTS = ["build/next-dev-bootstrap.cjs", "build/next-dev-client.js"] as const;
const CLIENT_EXPORTS = ["StylexNextDevConsumer", "StylexNextDevDocument", "stylexNextDevRevision"];
const BOOTSTRAP_EXPORTS = ["createNextDevBridgeOwner", "installNextDevBridgeOwner"];
const CLIENT_IMPORTS = new Set(["react", "react/jsx-runtime", "next/navigation"]);
const MAX_BYTES = 1024 * 1024;

/** Browser-specific checks, not permission for arbitrary client build tools. */
export function validateNextDevPrivateBrowserSource(path: string, source: string): void {
  assert.ok(NEXT_DEV_PRIVATE_OUTPUTS.some((entry) => entry === path), "Unknown private browser artifact");
  assert.ok(Buffer.byteLength(source) > 0 && Buffer.byteLength(source) <= MAX_BYTES, "Private browser artifact exceeds its bound");
  const scanned = new Bun.Transpiler({ loader: "js" }).scan(source);
  if (path === "build/next-dev-client.js") {
    assert.ok(source.startsWith('"use client";\n'), "Private React bridge lost its client directive");
    assert.deepEqual([...scanned.exports].sort(), CLIENT_EXPORTS, "Private React bridge exports changed");
    assert.ok(scanned.imports.some(({ path }) => path === "react") && scanned.imports.some(({ path }) => path === "next/navigation"),
      "Private React bridge lost its public React/router boundary");
    for (const dependency of scanned.imports) {
      assert.ok(dependency.kind === "import-statement" && CLIENT_IMPORTS.has(dependency.path), `Private React bridge has an unowned browser dependency: ${JSON.stringify(dependency)}`);
    }
  } else {
    assert.ok(!source.startsWith('"use client";'), "Private bootstrap cannot depend on React startup");
    assert.deepEqual(scanned.imports, [], "Private bootstrap must bundle all of its browser closure");
    assert.doesNotMatch(source, /\b(?:require|import)\s*\(/u, "Private bootstrap has a runtime dependency");
    const module = { exports: {} };
    // Execute the actual minified CommonJS bytes without Node/React/compiler
    // globals. This proves artifact initialization and export closure only;
    // the package hook probe and native fixture own subsequent behavior.
    runInNewContext(source, { module, exports: module.exports }, { timeout: 1000 });
    assert.deepEqual(Object.keys(module.exports).sort(), BOOTSTRAP_EXPORTS, "Private bootstrap exports changed");
    for (const name of BOOTSTRAP_EXPORTS) assert.equal(typeof (module.exports as Record<string, unknown>)[name], "function");
  }
}

export async function buildNextDevPrivateBrowserArtifacts(repository: string, stage: string): Promise<readonly string[]> {
  assert.equal(Bun.version, "1.3.14");
  const outdir = resolve(stage, "build");
  const directory = await lstat(outdir);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  assert.equal(await realpath(outdir), outdir);
  for (const path of NEXT_DEV_PRIVATE_OUTPUTS) {
    const client = path.endsWith("client.js");
    const entrypoint = resolve(repository, "build", client ? "next-dev-client.tsx" : "next-dev-bootstrap.ts");
    if (client) assert.ok((await readFile(entrypoint, "utf8")).startsWith('"use client";'), "Private React source lost its client boundary");
    const result = await Bun.build({ entrypoints: [entrypoint], env: "disable", format: client ? "esm" : "cjs",
      // This is a precompiled artifact, not the application's Fast Refresh
      // transform. Do not let ambient NODE_ENV select JSX debug paths/bytes.
      jsx: { runtime: "automatic", importSource: "react", development: false },
      minify: true, packages: "external", splitting: false, sourcemap: "none", target: "browser", throw: false });
    assert.equal(result.success, true, result.logs.map(String).join("\n"));
    assert.equal(result.logs.length, 0, "Private browser artifact emitted a build warning");
    assert.equal(result.outputs.length, 1, "Private browser entry emitted an unexpected split asset");
    const emitted = await result.outputs[0]!.text();
    const source = client && !emitted.startsWith('"use client";\n') ? '"use client";\n' + emitted : emitted;
    assert.ok(!source.includes(resolve(repository)), "Private browser artifact retained its absolute source root");
    validateNextDevPrivateBrowserSource(path, source);
    await writeFile(resolve(stage, path), source, { flag: "wx", mode: 0o644 });
  }
  return NEXT_DEV_PRIVATE_OUTPUTS;
}
