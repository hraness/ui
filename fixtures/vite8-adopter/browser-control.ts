import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import {
  matrixDeadline, ownViteMatrixCancellationOwner, viteMatrixGroup, type ViteMatrixCustody,
} from "./custody.ts";
import { createBoundedDiagnostics } from "./diagnostics.ts";
// Include the separately executed worker in the root typecheck without loading
// Playwright into the Bun coordinator's module graph at runtime.
import type {} from "./browser-worker.ts";

export const viteBrowserWorkerScript = join(dirname(fileURLToPath(import.meta.url)), "browser-worker.ts");
export type ViteBrowserRequest = Readonly<{
  schemaVersion: 1;
  mode: "acceptance" | "cancel-connected" | "cancel-during-launch";
  origin: string;
  executablePath: string;
  foundationHref: string;
}>;

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function parseViteBrowserRequest(value: unknown): ViteBrowserRequest {
  const input = record(value);
  assert.deepEqual(Object.keys(input).sort(), ["executablePath", "foundationHref", "mode", "origin", "schemaVersion"]);
  assert.equal(input.schemaVersion, 1);
  assert.ok(input.mode === "acceptance" || input.mode === "cancel-connected" || input.mode === "cancel-during-launch");
  assert.ok(typeof input.origin === "string" && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(input.origin));
  assert.ok(Number(new URL(input.origin).port) > 0 && Number(new URL(input.origin).port) <= 65_535);
  assert.ok(typeof input.executablePath === "string" && input.executablePath.length <= 4096 && resolve(input.executablePath) === input.executablePath);
  assert.ok(typeof input.foundationHref === "string" && /^\/graphs\/client\/[A-Za-z0-9_.\/-]+\.css$/u.test(input.foundationHref));
  assert.ok(!input.foundationHref.split("/").some((part) => part === "." || part === ".."));
  return input as ViteBrowserRequest;
}

export function assertViteBrowserNodeRuntime(versions: Readonly<{ node: string; bun?: string }>): void {
  assert.ok(versions.bun === undefined && /^24\.[0-9]+\.[0-9]+$/u.test(versions.node), "Vite browser control requires genuine Node 24");
}

export async function viteBrowserFileIdentity(path: string) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** A resolved native launch already owns a resource. Keep its close sticky
 * before identity checks or journal writes can reject resource preparation. */
export async function prepareViteBrowserServer<T>(
  custody: ViteMatrixCustody, closeNative: () => Promise<void>, prepare: () => Promise<T>,
) {
  const close = custody.own("acquired native browser server", closeNative);
  try {
    const value = await prepare();
    custody.check();
    return { value, close };
  } catch (failure) {
    try { await close(); }
    catch (collection) { throw new AggregateError([failure, collection], "Native browser preparation and collection failed; retain ownership"); }
    throw failure;
  }
}

/** These private per-worker receipts are read only after the owner has exited.
 * Sync before exit; never replace an earlier attempt or remove failed evidence. */
export async function writeViteBrowserJson(path: string, value: unknown): Promise<void> {
  const source = `${JSON.stringify(value)}\n`;
  assert.ok(Buffer.byteLength(source) <= 1024 * 1024);
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}

export function parseViteBrowserResult(value: unknown, requestSha256: string, ownerPid: number) {
  const result = record(value);
  assert.deepEqual(Object.keys(result).sort(), ["browserPids", "evidence", "node", "owner", "requestSha256", "resources", "schemaVersion", "state"]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.requestSha256, requestSha256);
  assert.equal(result.owner, ownerPid);
  assert.equal(result.resources, 0);
  assert.ok(typeof result.node === "string");
  assertViteBrowserNodeRuntime({ node: result.node });
  assert.ok(result.state === "complete" || result.state === "cancelled" || result.state === "failed");
  assert.ok(Array.isArray(result.browserPids) && result.browserPids.length <= 1);
  if (result.state !== "failed") assert.equal(result.browserPids.length, 1);
  for (const pid of result.browserPids) assert.ok(typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1 && pid !== ownerPid);
  if (result.state === "complete") assert.ok(result.evidence !== null);
  else assert.equal(result.evidence, null);
  return {
    schemaVersion: result.schemaVersion, state: result.state, owner: result.owner,
    node: result.node, requestSha256: result.requestSha256, resources: result.resources,
    evidence: result.evidence, browserPids: result.browserPids as number[],
  };
}

export async function ownViteBrowserWorker(node: string, inputPath: string, custody: ViteMatrixCustody) {
  const requestIdentity = await viteBrowserFileIdentity(inputPath);
  const directory = dirname(inputPath);
  const output = join(directory, "browser-result.json");
  const readResult = async (pid: number) => {
    assert.equal(await realpath(output), output);
    const stat = await lstat(output);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024);
    const result = parseViteBrowserResult(JSON.parse(await readFile(output, "utf8")) as unknown, requestIdentity.sha256, pid);
    for (const browserPid of result.browserPids) assert.equal(viteMatrixGroup(browserPid).probe(), false, "Worker returned with a surviving browser group");
    assert.deepEqual(await viteBrowserFileIdentity(inputPath), requestIdentity);
    return result;
  };
  const owned = ownViteMatrixCancellationOwner([node, viteBrowserWorkerScript, inputPath], directory, custody,
    async (child) => { assert.ok(child.pid !== undefined); await readResult(child.pid); });
  return { ...owned, readResult: () => { assert.ok(owned.child.pid !== undefined); return readResult(owned.child.pid); }, output };
}

/** The Bun coordinator owns a genuine Node worker before awaiting readiness.
 * Do not use the ordinary command runner: it may KILL a detached browser owner
 * before that owner has collected its separately detached Chromium group. */
export async function runViteBrowserWorker(
  node: string, request: ViteBrowserRequest, directory: string, custody: ViteMatrixCustody,
): Promise<unknown> {
  custody.check();
  assert.equal(request.mode, "acceptance");
  const inputPath = join(directory, "browser-request.json");
  await writeViteBrowserJson(inputPath, parseViteBrowserRequest(request));
  const owned = await ownViteBrowserWorker(node, inputPath, custody);
  const diagnostics = createBoundedDiagnostics();
  owned.child.stdout.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  owned.child.stderr.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  try {
    await owned.spawned;
    const terminal = await matrixDeadline(owned.closed, 180_000, "Node browser worker did not finish its unchanged browser gates");
    custody.check();
    assert.equal(terminal.signal, null, diagnostics.render("stderr").toString("utf8"));
    assert.equal(terminal.code, 0, diagnostics.render("stderr").toString("utf8"));
    assert.equal(owned.group.probe(), false);
    const result = await owned.readResult();
    assert.equal(result.state, "complete");
    return { ...result, receipt: await viteBrowserFileIdentity(owned.output) };
  } finally {
    await owned.close();
    process.stderr.write(diagnostics.render("stderr"));
  }
}
