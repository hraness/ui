import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ReleaseIdentity = Readonly<{ tag: string; commit: string; tree: string }>;
export type ReleaseArtifact = Readonly<{
  schemaVersion: 1;
  repository: "hraness/ui";
  name: "@hraness/ui";
  version: string;
  tag: string;
  commit: string;
  tree: string;
  filename: string;
  sha256: string;
  integrity: string;
  toolchain: Readonly<{ bun: "1.3.14"; node: 24; npm: "11.19.0" }>;
}>;

async function command(argv: readonly string[], trimOutput = true): Promise<string> {
  const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${argv[0]} failed: ${error.trim()}`);
  return trimOutput ? output.trim() : output;
}

function releaseVersion(identity: ReleaseIdentity): string {
  assert.match(identity.tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, "Release tag must be stable");
  assert.match(identity.commit, /^[a-f0-9]{40}$/u, "Release commit must be a full SHA");
  assert.match(identity.tree, /^[a-f0-9]{40}$/u, "Release tree must be a full SHA");
  return identity.tag.slice(1);
}

export function releaseFilename(identity: ReleaseIdentity): string {
  return `hraness-ui-${releaseVersion(identity)}.tgz`;
}

export function verifyPackedPaths(report: unknown, trackedPaths: readonly string[]): void {
  assert.ok(report !== null && typeof report === "object" && !Array.isArray(report), "npm pack report must be an object");
  const files = (report as { files?: unknown }).files;
  assert.ok(Array.isArray(files) && files.length > 0, "npm pack must list its files");
  const governed = new Set(trackedPaths);
  for (const file of files) {
    assert.ok(file !== null && typeof file === "object" && !Array.isArray(file), "npm pack must describe every file");
    const path = (file as { path?: unknown }).path;
    assert.ok(typeof path === "string" && governed.has(path), `Packed path is outside governed source: ${String(path)}`);
  }
}

export async function verifyReleaseTag(
  identity: ReleaseIdentity,
  readObject: (path: string) => Promise<unknown> = async (path) => JSON.parse(await command(["gh", "api", path, "--jq", ".object"])),
): Promise<void> {
  releaseVersion(identity);
  let value = await readObject(`/repos/hraness/ui/git/ref/tags/${identity.tag}`);
  for (let depth = 0; depth < 8; depth += 1) {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Release tag must identify a Git object");
    const object = value as { type?: unknown; sha?: unknown };
    assert.ok(typeof object.sha === "string" && /^[a-f0-9]{40}$/u.test(object.sha), "Release tag object must have a full SHA");
    if (object.type === "commit") {
      assert.equal(object.sha, identity.commit, "Live release tag differs from governed commit");
      return;
    }
    assert.equal(object.type, "tag", "Release tag must peel to a commit");
    value = await readObject(`/repos/hraness/ui/git/tags/${object.sha}`);
  }
  assert.fail("Release tag annotation nesting exceeds its bound");
}

async function ordinaryFile(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${path} must be an ordinary file`);
  return readFile(path);
}

async function archivedPackage(archive: string): Promise<{ name: unknown; version: unknown }> {
  return JSON.parse(await command(["tar", "-xOf", archive, "package/package.json"]));
}

function assertArtifactMetadata(value: unknown, identity: ReleaseIdentity): asserts value is ReleaseArtifact {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Release metadata must be an object");
  const artifact = value as ReleaseArtifact;
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.repository, "hraness/ui");
  assert.equal(artifact.name, "@hraness/ui");
  assert.equal(artifact.version, releaseVersion(identity), "Release version differs from tag");
  assert.equal(artifact.tag, identity.tag);
  assert.equal(artifact.commit, identity.commit, "Release commit differs from governed source");
  assert.equal(artifact.tree, identity.tree, "Release tree differs from governed source");
  assert.equal(artifact.filename, releaseFilename(identity), "Release filename differs from package identity");
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.match(artifact.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u);
  assert.deepEqual(artifact.toolchain, { bun: "1.3.14", node: 24, npm: "11.19.0" });
}

export async function verifyReleaseArtifact(directory: string, identity: ReleaseIdentity): Promise<ReleaseArtifact> {
  const metadata: unknown = JSON.parse((await ordinaryFile(resolve(directory, "release.json"))).toString("utf8"));
  assertArtifactMetadata(metadata, identity);
  const archivePath = resolve(directory, metadata.filename);
  const archive = await ordinaryFile(archivePath);
  assert.equal(createHash("sha256").update(archive).digest("hex"), metadata.sha256, "Release archive SHA256 differs");
  assert.equal(`sha512-${createHash("sha512").update(archive).digest("base64")}`, metadata.integrity, "Release archive integrity differs");
  assert.equal(
    (await ordinaryFile(resolve(directory, "SHA256SUMS"))).toString("utf8"),
    `${metadata.sha256}  ${metadata.filename}\n`,
    "Release checksum file differs",
  );
  const manifest = await archivedPackage(archivePath);
  assert.equal(manifest.name, metadata.name, "Archived package name differs");
  assert.equal(manifest.version, metadata.version, "Archived package version differs");
  return metadata;
}

export function verifyNpmMirror(value: unknown, artifact: ReleaseArtifact): void {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "npm metadata must be an object");
  const manifest = value as { name?: unknown; version?: unknown; dist?: { integrity?: unknown; attestations?: { provenance?: { predicateType?: unknown } } } };
  assert.equal(manifest.name, artifact.name, "npm mirror name differs");
  assert.equal(manifest.version, artifact.version, "npm mirror version differs");
  assert.equal(manifest.dist?.integrity, artifact.integrity, "npm mirror integrity differs from canonical bytes");
  assert.equal(manifest.dist?.attestations?.provenance?.predicateType, "https://slsa.dev/provenance/v1", "npm mirror must report provenance");
}

export function verifyReleaseState(value: unknown, artifact: ReleaseArtifact): void {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "GitHub Release metadata must be an object");
  const state = value as { tagName?: unknown; isDraft?: unknown; isImmutable?: unknown; isPrerelease?: unknown; assets?: { name: string }[] };
  assert.equal(state.tagName, artifact.tag, "GitHub Release tag differs");
  assert.equal(typeof state.isDraft, "boolean");
  assert.equal(state.isPrerelease, false, "GitHub Release must be stable");
  assert.equal(state.isImmutable, !state.isDraft, "Published GitHub Release must be immutable");
  assert.ok(Array.isArray(state.assets), "GitHub Release must list its assets");
  assert.deepEqual(state.assets.map((asset) => asset.name).sort(),
    [artifact.filename, "SHA256SUMS", "release.json", "provenance.jsonl"].sort(),
    "GitHub Release must contain exactly the canonical assets");
}

async function verifyProvenance(directory: string, artifact: ReleaseArtifact): Promise<void> {
  const bundle = resolve(directory, "provenance.jsonl");
  await ordinaryFile(bundle);
  await command(["gh", "attestation", "verify", resolve(directory, artifact.filename),
    "--bundle", bundle, "--repo", artifact.repository,
    "--signer-workflow", "hraness/ui/.github/workflows/release.yml",
    "--source-ref", `refs/tags/${artifact.tag}`, "--source-digest", artifact.commit,
    "--deny-self-hosted-runners",
  ]);
}

async function governedIdentity(tag: string, commit: string): Promise<ReleaseIdentity> {
  assert.equal(await command(["git", "rev-parse", "HEAD"]), commit, "Checkout differs from governed commit");
  return { tag, commit, tree: await command(["git", "rev-parse", "HEAD^{tree}"]) };
}

async function stageReleaseArtifact(directory: string, identity: ReleaseIdentity): Promise<ReleaseArtifact> {
  assert.equal(Bun.version, "1.3.14");
  assert.equal((await command(["node", "--version"])).split(".")[0], "v24");
  assert.equal(await command(["npm", "--version"]), "11.19.0");
  assert.equal(await command(["git", "status", "--porcelain=v1", "--untracked-files=all"]), "", "Release source must be clean");
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { name: unknown; version: unknown };
  assert.equal(manifest.name, "@hraness/ui");
  assert.equal(manifest.version, releaseVersion(identity));
  await mkdir(directory);
  const packed = JSON.parse(await command(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", directory])) as { filename: unknown }[];
  assert.equal(packed.length, 1, "Release must contain one package");
  const filename = releaseFilename(identity);
  assert.equal(packed[0]?.filename, filename);
  const trackedPaths = (await command(["git", "ls-tree", "-r", "-z", "--name-only", identity.commit], false)).split("\0").filter(Boolean);
  verifyPackedPaths(packed[0], trackedPaths);
  const archive = await ordinaryFile(resolve(directory, filename));
  const artifact: ReleaseArtifact = {
    schemaVersion: 1, repository: "hraness/ui", name: "@hraness/ui", version: manifest.version as string,
    ...identity, filename,
    sha256: createHash("sha256").update(archive).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    toolchain: { bun: "1.3.14", node: 24, npm: "11.19.0" },
  };
  await writeFile(resolve(directory, "release.json"), `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  await writeFile(resolve(directory, "SHA256SUMS"), `${artifact.sha256}  ${filename}\n`, { flag: "wx" });
  return verifyReleaseArtifact(directory, identity);
}

if (import.meta.main) {
  const [operation, inputDirectory, tag, commit, recordPath, ...extra] = process.argv.slice(2);
  assert.ok(["stage", "verify", "mirror", "state"].includes(operation ?? ""), "Expected stage, verify, mirror, or state");
  assert.ok(inputDirectory && tag && commit && extra.length === 0);
  assert.equal(recordPath !== undefined, operation === "mirror" || operation === "state", "Only mirror and state accept metadata");
  const identity = await governedIdentity(tag, commit);
  const directory = resolve(inputDirectory);
  const artifact = operation === "stage"
    ? await stageReleaseArtifact(directory, identity)
    : await verifyReleaseArtifact(directory, identity);
  if (operation !== "stage") {
    assert.deepEqual((await readdir(directory)).sort(),
      [artifact.filename, "SHA256SUMS", "release.json", "provenance.jsonl"].sort(),
      "Canonical artifact directory must contain exactly the release files");
    await verifyProvenance(directory, artifact);
  }
  if (operation === "mirror") verifyNpmMirror(JSON.parse(await readFile(recordPath!, "utf8")), artifact);
  if (operation === "state") verifyReleaseState(JSON.parse(await readFile(recordPath!, "utf8")), artifact);
  await verifyReleaseTag(identity);
  console.log(JSON.stringify(artifact));
}
