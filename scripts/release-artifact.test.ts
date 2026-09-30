import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "bun:test";
import { releaseFilename, verifyNpmMirror, verifyPackedPaths, verifyReleaseArtifact, verifyReleaseState, verifyReleaseTag, type ReleaseArtifact, type ReleaseIdentity } from "./release-artifact.ts";

const identity: ReleaseIdentity = { tag: "v0.5.22", commit: "1".repeat(40), tree: "2".repeat(40) };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function command(argv: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert.equal(code, 0, error);
  return output;
}

async function fixture(packageVersion = "0.5.22"): Promise<{ directory: string; artifact: ReleaseArtifact }> {
  const directory = await mkdtemp(join(tmpdir(), "hraness-ui-release-test-"));
  directories.push(directory);
  const content = join(directory, "content");
  await mkdir(join(content, "package"), { recursive: true });
  await writeFile(join(content, "package/package.json"), JSON.stringify({ name: "@hraness/ui", version: packageVersion }));
  const filename = releaseFilename(identity);
  const child = Bun.spawn(["tar", "-czf", join(directory, filename), "-C", content, "package"], { stdout: "ignore", stderr: "pipe" });
  assert.equal(await child.exited, 0, await new Response(child.stderr).text());
  const archive = await readFile(join(directory, filename));
  const artifact: ReleaseArtifact = {
    schemaVersion: 1, repository: "hraness/ui", name: "@hraness/ui", version: "0.5.22", ...identity, filename,
    sha256: createHash("sha256").update(archive).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    toolchain: { bun: "1.3.14", node: 24, npm: "11.19.0" },
  };
  await writeFile(join(directory, "release.json"), JSON.stringify(artifact));
  await writeFile(join(directory, "SHA256SUMS"), `${artifact.sha256}  ${filename}\n`);
  return { directory, artifact };
}

test("a release tarball must match governed source, package identity, and both byte digests", async () => {
  const { directory, artifact } = await fixture();
  assert.deepEqual(await verifyReleaseArtifact(directory, identity), artifact);
  await assert.rejects(verifyReleaseArtifact(directory, { ...identity, commit: "3".repeat(40) }), /governed source/u);
  await assert.rejects(verifyReleaseArtifact(directory, { ...identity, tree: "4".repeat(40) }), /governed source/u);
  await writeFile(join(directory, artifact.filename), "corrupted bytes");
  await assert.rejects(verifyReleaseArtifact(directory, identity), /SHA256 differs/u);
});

test("a valid checksum cannot admit an archive with the wrong package version", async () => {
  const { directory } = await fixture("0.5.21");
  await assert.rejects(verifyReleaseArtifact(directory, identity), /Archived package version differs/u);
});

test("checksum files, fixed archive names, and ordinary files are required", async () => {
  const { directory, artifact } = await fixture();
  await writeFile(join(directory, "SHA256SUMS"), `${artifact.sha256}  different.tgz\n`);
  await assert.rejects(verifyReleaseArtifact(directory, identity), /checksum file differs/u);
  await writeFile(join(directory, "SHA256SUMS"), `${artifact.sha256}  ${artifact.filename}\n`);
  await writeFile(join(directory, "release.json"), JSON.stringify({ ...artifact, filename: "../outside.tgz" }));
  await assert.rejects(verifyReleaseArtifact(directory, identity), /filename differs/u);
  await writeFile(join(directory, "release.json"), JSON.stringify(artifact));
  const target = join(directory, "target.tgz");
  await writeFile(target, await readFile(join(directory, artifact.filename)));
  await rm(join(directory, artifact.filename));
  await symlink(target, join(directory, artifact.filename));
  await assert.rejects(verifyReleaseArtifact(directory, identity), /ordinary file/u);
});

test("an optional npm mirror must retain canonical integrity and provenance", async () => {
  const { artifact } = await fixture();
  const metadata = {
    name: artifact.name, version: artifact.version,
    dist: { integrity: artifact.integrity, attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } } },
  };
  verifyNpmMirror(metadata, artifact);
  assert.throws(() => verifyNpmMirror({ ...metadata, version: "0.5.21" }, artifact), /version differs/u);
  assert.throws(() => verifyNpmMirror({ ...metadata, dist: { ...metadata.dist, integrity: `sha512-${Buffer.alloc(64).toString("base64")}` } }, artifact), /canonical bytes/u);
  assert.throws(() => verifyNpmMirror({ ...metadata, dist: { integrity: artifact.integrity } }, artifact), /report provenance/u);
});

test("GitHub release reconciliation admits complete drafts and immutable publication only", async () => {
  const { artifact } = await fixture();
  const state = {
    tagName: artifact.tag, isDraft: false, isPrerelease: false, isImmutable: true,
    assets: [artifact.filename, "SHA256SUMS", "release.json", "provenance.jsonl"].map((name) => ({ name })),
  };
  verifyReleaseState(state, artifact);
  verifyReleaseState({ ...state, isDraft: true, isImmutable: false }, artifact);
  assert.throws(() => verifyReleaseState({ ...state, isImmutable: false }, artifact), /must be immutable/u);
  assert.throws(() => verifyReleaseState({ ...state, assets: [] }, artifact), /canonical assets/u);
  assert.throws(() => verifyReleaseState({ ...state, assets: [...state.assets, { name: "other.tgz" }] }, artifact), /canonical assets/u);
  assert.throws(() => verifyReleaseState({ ...state, tagName: "v0.5.21" }, artifact), /tag differs/u);
});

test("live lightweight and annotated release tags must peel to the governed commit", async () => {
  const tagObject = "3".repeat(40);
  await verifyReleaseTag(identity, async () => ({ type: "commit", sha: identity.commit }));
  await verifyReleaseTag(identity, async (path) => path.endsWith(`/tags/${identity.tag}`)
    ? { type: "tag", sha: tagObject } : { type: "commit", sha: identity.commit });
  await assert.rejects(verifyReleaseTag(identity, async () => ({ type: "commit", sha: "4".repeat(40) })), /governed commit/u);
  await assert.rejects(verifyReleaseTag(identity, async () => ({ type: "blob", sha: identity.commit })), /peel to a commit/u);
  await assert.rejects(verifyReleaseTag(identity, async () => ({ type: "tag", sha: tagObject })), /nesting exceeds/u);
});

test("npm packing admits governed files and rejects ignored files inside an explicit files directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hraness-ui-release-pack-test-"));
  directories.push(directory);
  const source = join(directory, "source");
  const cleanPack = join(directory, "clean-pack");
  const ignoredPack = join(directory, "ignored-pack");
  await Promise.all([mkdir(join(source, "dist"), { recursive: true }), mkdir(cleanPack), mkdir(ignoredPack)]);
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "@hraness/ui", version: "0.5.22", files: ["dist"] }));
  await writeFile(join(source, ".gitignore"), "*.tsbuildinfo\nnode_modules/\n");
  await writeFile(join(source, "dist/index.js"), "export const value = 1;\n");
  await command(["git", "init", "--quiet"], source);
  await command(["git", "add", "."], source);
  await command(["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Release fixture", "-c", "user.email=release-fixture@example.invalid", "commit", "--quiet", "--no-gpg-sign", "--message=Governed package fixture"], source);
  const trackedPaths = (await command(["git", "ls-tree", "-r", "-z", "--name-only", "HEAD"], source)).split("\0").filter(Boolean);
  const pack = async (destination: string): Promise<unknown> => JSON.parse(await command(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", destination], source))[0];
  await mkdir(join(source, "node_modules/ignored"), { recursive: true });
  await writeFile(join(source, "node_modules/ignored/local.txt"), "An ignored file outside the archive is harmless.\n");
  verifyPackedPaths(await pack(cleanPack), trackedPaths);
  await writeFile(join(source, "dist/extra.tsbuildinfo"), "An ignored file inside the archive is not governed.\n");
  assert.equal(await command(["git", "status", "--porcelain=v1", "--untracked-files=all"], source), "");
  assert.throws(() => verifyPackedPaths({ files: [] }, trackedPaths), /must list its files/u);
  assert.throws(() => verifyPackedPaths({ files: [{ path: "../package.json" }] }, trackedPaths), /outside governed source/u);
  const report = await pack(ignoredPack);
  assert.throws(() => verifyPackedPaths(report, trackedPaths), /outside governed source: dist\/extra\.tsbuildinfo/u);
}, 30_000);
