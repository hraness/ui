/** Private, manifest-bound browser inputs for the opt-in development adapter. */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, readStylexPackageManifest, sha256 } from "./compiler.js";
import type { StylexArtifactV1 } from "./contracts.js";

export const NEXT_DEV_PRIVATE_CLIENT = "dist/build/next-dev-client.js";
export const NEXT_DEV_PRIVATE_BOOTSTRAP = "dist/build/next-dev-bootstrap.cjs";
const ADAPTER = "dist/build/next-dev.js";
const MAX_BYTES = 1024 * 1024;
export type NextDevPrivateArtifacts = Readonly<{
  clientPath: string;
  factoryExpression: string;
  identity: string;
  manifestSha256: string;
  packageRoot: string;
}>;

export function nextDevPrivateArtifactPaths(moduleUrl: string) {
  const adapterPath = fileURLToPath(moduleUrl);
  const packageRoot = resolve(dirname(adapterPath), "../..");
  return Object.freeze({ adapterPath, packageRoot, clientPath: resolve(dirname(adapterPath), "next-dev-client.js") });
}

async function readBound(root: string, artifact: StylexArtifactV1): Promise<string> {
  let path = root;
  const parts = artifact.path.split("/");
  for (const [index, part] of parts.entries()) {
    path = resolve(path, part);
    const state = await lstat(path);
    assert.ok(!state.isSymbolicLink() && (index === parts.length - 1 ? state.isFile() : state.isDirectory()),
      "Next development private artifact must be an ordinary physical input");
  }
  assert.equal(await realpath(path), path, "Next development private artifact traverses a symlink");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    assert.ok(before.size > 0n && before.size <= BigInt(MAX_BYTES), "Next development private artifact exceeds its byte bound");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    for (const state of [after, current]) {
      assert.ok(state.isFile() && !state.isSymbolicLink() && state.dev === before.dev && state.ino === before.ino
        && state.size === before.size && state.mtimeNs === before.mtimeNs && state.ctimeNs === before.ctimeNs,
      "Next development private artifact changed while reading");
    }
    assert.equal(bytes.length, artifact.bytes, "Next development private artifact byte count drift");
    assert.equal(sha256(bytes), artifact.sha256, "Next development private artifact hash drift");
    const source = bytes.toString("utf8");
    assert.ok(Buffer.from(source).equals(bytes), "Next development private artifact must be UTF-8");
    return source;
  } finally { await handle.close(); }
}

/** No source fallback, public entry, dynamic compiler, or second browser owner. */
export async function readNextDevPrivateArtifacts(moduleUrl: string): Promise<NextDevPrivateArtifacts> {
  const { adapterPath, clientPath, packageRoot } = nextDevPrivateArtifactPaths(moduleUrl);
  assert.equal(adapterPath, resolve(packageRoot, ...ADAPTER.split("/")), "Next development requires its built private adapter boundary");
  assert.equal(clientPath, resolve(packageRoot, ...NEXT_DEV_PRIVATE_CLIENT.split("/")));
  const manifestPath = resolve(packageRoot, "dist/stylex-manifest.json");
  const manifest = await readStylexPackageManifest(manifestPath, packageRoot);
  assert.equal(manifest.package.name, "@hraness/ui", "Next development browser inputs must belong to the UI adapter package");
  const sources = new Map<string, string>();
  for (const path of [ADAPTER, NEXT_DEV_PRIVATE_CLIENT, NEXT_DEV_PRIVATE_BOOTSTRAP]) {
    const artifact = manifest.buildTools.find((entry) => entry.path === path);
    assert.ok(artifact !== undefined && !manifest.runtime.some((entry) => entry.path === path),
      "Next development private browser artifact is absent from its exact build-tool inventory");
    sources.set(path, await readBound(packageRoot, artifact));
  }
  assert.ok(sources.get(NEXT_DEV_PRIVATE_CLIENT)!.startsWith('"use client";\n'), "Next development private React entry lost its client boundary");
  const body = sources.get(NEXT_DEV_PRIVATE_BOOTSTRAP)!;
  assert.ok(!body.startsWith('"use client";') && !/\b(?:require|import)\s*\(/u.test(body),
    "Next development bootstrap must be self-contained and independent of React startup");
  // The public BASIC hook accepts a single catalogue argument. The packaged
  // factory runs only there, against that exact document, before client entry.
  const factoryExpression = `function(catalogue){const module={exports:{}};const exports=module.exports;\n${body}\nreturn module.exports.installNextDevBridgeOwner(document,catalogue);}`;
  assert.ok(Buffer.byteLength(factoryExpression) <= MAX_BYTES);
  assert.deepEqual(await readStylexPackageManifest(manifestPath, packageRoot), manifest,
    "Next development private package changed during its captured read");
  const manifestSha256 = sha256(canonicalJson(manifest));
  return Object.freeze({ clientPath, factoryExpression, identity: sha256(canonicalJson({ manifestSha256,
    files: [...sources].map(([path, source]) => ({ path, sha256: sha256(source) })) })), manifestSha256, packageRoot });
}
