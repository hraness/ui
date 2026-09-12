/** Actual package bytes in genuine Node; constructed hooks are not native Next qualification. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "../build/compiler.js";

export async function checkNextDevPrivatePackage(repository: string) {
  assert.equal(Bun.version, "1.3.14");
  const discovered = Bun.which("node"); assert.ok(discovered !== null, "Private artifact checks require genuine Node24 on PATH");
  const node = await realpath(discovered), nodeBefore = await lstat(node);
  assert.ok(nodeBefore.isFile() && !nodeBefore.isSymbolicLink());
  const nodeSha256 = sha256(await readFile(node));
  const built = await Bun.build({ entrypoints: [resolve(repository, "build/next-dev-package.fixture.ts")], packages: "external",
    target: "node", format: "esm", splitting: false, minify: false, env: "disable", sourcemap: "none" });
  assert.equal(built.success, true, built.logs.map(String).join("\n")); assert.equal(built.logs.length, 0); assert.equal(built.outputs.length, 1);
  const code = await built.outputs[0]!.text(); assert.ok(Buffer.byteLength(code) <= 2 * 1024 * 1024);
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "CIRCLE_NODE_TOTAL", "GOMAXPROCS", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawnSync(node, ["--input-type=module", "--eval", `${code}\nprocess.stdout.write(JSON.stringify(await runNextDevPackageFixture(${JSON.stringify(repository)}))+'\\n');`], {
    cwd: repository, env, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024, killSignal: "SIGKILL",
  });
  const failures: unknown[] = [];
  try {
    assert.equal(child.error, undefined, "Private package child failed or exceeded its bound");
    assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr.slice(0, 16 * 1024)); assert.equal(child.stderr, "");
  } catch (error) { failures.push(error); }
  try {
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0, "Private package child was not acquired");
    assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "ESRCH", "Private package child survived terminal collection");
  } catch (error) { failures.push(error); }
  try {
    const after = await lstat(node);
    assert.ok(after.isFile() && after.dev === nodeBefore.dev && after.ino === nodeBefore.ino && after.size === nodeBefore.size && after.mtimeMs === nodeBefore.mtimeMs);
    assert.equal(sha256(await readFile(node)), nodeSha256);
  } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "Private packaged runtime gate failed");
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(typeof result === "object" && result !== null && !Array.isArray(result));
  assert.deepEqual(Object.keys(result).sort(), ["adapterSha256", "bootstrapSha256", "census", "checks", "copiedArtifacts", "kind", "manifestGateSha256", "manifestSha256", "nativeAcceptance", "node", "packageIdentity", "runtimeStages", "schemaVersion", "sourceMaps", "updateSha256"].sort());
  const receipt = result as Record<string, unknown>;
  assert.equal(receipt.kind, "constructed-packaged-next-dev-probe"); assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.nativeAcceptance, false);
  assert.ok(typeof receipt.node === "string" && /^24\./u.test(receipt.node));
  assert.equal(receipt.checks, 81);
  assert.equal(receipt.copiedArtifacts, 23);
  for (const field of ["adapterSha256", "bootstrapSha256", "manifestGateSha256", "manifestSha256", "packageIdentity", "updateSha256"]) {
    assert.ok(typeof receipt[field] === "string" && /^[a-f0-9]{64}$/u.test(receipt[field]));
  }
  assert.deepEqual(receipt.census, { timers: 0, observers: 0, listeners: 0 }); assert.deepEqual(receipt.runtimeStages, [5, 20]);
  assert.deepEqual(receipt.sourceMaps, ["app/client.tsx", "app/page.tsx", "app/unvisited/page.tsx"]);
  return { ...receipt, nativeAcceptance: false, childCollected: true, nodeSha256, workerSha256: sha256(code) };
}

if (import.meta.main) console.log(JSON.stringify(await checkNextDevPrivatePackage(process.cwd())));
