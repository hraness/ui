import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, expect, test } from "bun:test";
import { artifactForFile, canonicalJson, compilerContract, compilerSha256, serializeStylexPackageRules, sha256 } from "./compiler.js";
import { NEXT_DEV_PRIVATE_BOOTSTRAP, NEXT_DEV_PRIVATE_CLIENT, readNextDevPrivateArtifacts } from "./next-dev-artifacts.js";
import type { StylexPackageManifestV1 } from "./contracts.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-private-artifacts-")); roots.push(root);
  const write = async (path: string, source: string) => { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, source); };
  await write("package.json", '{"name":"@hraness/ui","version":"0.5.14","type":"module"}\n');
  await write("dist/build/next-dev.js", "export const adapter = true;\n");
  await write(NEXT_DEV_PRIVATE_CLIENT, '"use client";\nexport const client = true;\n');
  await write(NEXT_DEV_PRIVATE_BOOTSTRAP, "module.exports.installNextDevBridgeOwner=(document,value)=>({document,value});\n");
  await write("dist/index.js", '"use client";\nexport const ordinary = true;\n');
  await write("src/foundation.css", "@layer base{body{margin:0}}\n");
  const standaloneSerializer = { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" };
  await write("dist/stylex.css", serializeStylexPackageRules([], standaloneSerializer));
  const manifest: StylexPackageManifestV1 = { buildTools: await Promise.all([NEXT_DEV_PRIVATE_BOOTSTRAP, NEXT_DEV_PRIVATE_CLIENT, "dist/build/next-dev.js"].sort().map(path => artifactForFile(root, path))),
    compiler: compilerContract, compilerFoundation: "src/foundation.css", compilerSha256,
    kind: "hraness-stylex-package-manifest", package: { name: "@hraness/ui", version: "0.5.14" }, rules: [], rulesSha256: sha256("[]"),
    runtime: [await artifactForFile(root, "dist/index.js")], schemaVersion: 1, standaloneCss: await artifactForFile(root, "dist/stylex.css"), standaloneSerializer,
    stylesheets: [await artifactForFile(root, "src/foundation.css")] };
  const seal = async (next = manifest) => write("dist/stylex-manifest.json", canonicalJson(next) + "\n");
  await seal();
  return { root, write, manifest, seal, url: pathToFileURL(join(root, "dist/build/next-dev.js")).href };
}

test("private bootstrap and client require exact package, path, bytes and manifest identity", async () => {
  const input = await fixture(); const output = await readNextDevPrivateArtifacts(input.url);
  expect(output.clientPath).toBe(join(input.root, NEXT_DEV_PRIVATE_CLIENT));
  expect(output.packageRoot).toBe(input.root);
  expect(output.manifestSha256).toBe(sha256(canonicalJson(input.manifest)));
  expect(output.identity).toMatch(/^[a-f0-9]{64}$/u);
  const document = { owned: true }; const value = { captured: true };
  // The deliberately tiny fixture factory proves invocation shape only. The
  // canonical package gate separately executes the real minified artifact.
  const result = runInNewContext(`(${output.factoryExpression})(value)`, { document, value }, { timeout: 1000 }) as { document: unknown; value: unknown };
  expect(result.document).toBe(document); expect(result.value).toBe(value);
  await input.write(NEXT_DEV_PRIVATE_CLIENT, '"use client";\nexport const client = false;\n');
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow(/(?:hash|byte)/u);
});

test("missing, foreign, unmarked and imported private artifacts fail without a source fallback", async () => {
  const input = await fixture();
  await input.seal({ ...input.manifest, buildTools: input.manifest.buildTools.filter(entry => entry.path !== NEXT_DEV_PRIVATE_BOOTSTRAP) });
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow("exact build-tool inventory");
  await input.write("package.json", '{"name":"@fixture/foreign","version":"0.5.14"}\n');
  await input.seal({ ...input.manifest, package: { name: "@fixture/foreign", version: "0.5.14" } });
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow("UI adapter package");
  await input.write("package.json", '{"name":"@hraness/ui","version":"0.5.14"}\n');
  await input.write(NEXT_DEV_PRIVATE_CLIENT, "export const client = true;\n");
  await input.seal({ ...input.manifest, buildTools: await Promise.all(input.manifest.buildTools.map(entry => artifactForFile(input.root, entry.path))) });
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow("client boundary");
  await input.write(NEXT_DEV_PRIVATE_CLIENT, '"use client";\nexport const client = true;\n');
  await input.write(NEXT_DEV_PRIVATE_BOOTSTRAP, 'module.exports = require("react");\n');
  await input.seal({ ...input.manifest, buildTools: await Promise.all(input.manifest.buildTools.map(entry => artifactForFile(input.root, entry.path))) });
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow("self-contained");
  await expect(readNextDevPrivateArtifacts(pathToFileURL(join(input.root, "build/next-dev.ts")).href)).rejects.toThrow("built private adapter boundary");
});

test("private source identity cannot be supplied through a linked artifact", async () => {
  const input = await fixture();
  const source = await readFile(join(input.root, NEXT_DEV_PRIVATE_CLIENT), "utf8");
  await input.write("retained-client.js", source);
  await rm(join(input.root, NEXT_DEV_PRIVATE_CLIENT));
  await symlink(join(input.root, "retained-client.js"), join(input.root, NEXT_DEV_PRIVATE_CLIENT));
  await expect(readNextDevPrivateArtifacts(input.url)).rejects.toThrow(/symlink/u);
  assert.ok(source.startsWith('"use client";'));
});
