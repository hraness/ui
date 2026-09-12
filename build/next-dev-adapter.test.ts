import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";
test("private adapter preserves serial native hook, graph/query, transition, failure and watch custody in genuine Node", async () => {
  const node = Bun.which("node"); assert.ok(node !== null, "Adapter checks require genuine Node24 on PATH");
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/next-dev-adapter.fixture.ts`], packages: "external",
    target: "node", format: "esm", splitting: false, minify: false, env: "disable", sourcemap: "none" });
  assert.equal(built.success, true, built.logs.map(String).join("\n")); assert.equal(built.logs.length, 0); assert.equal(built.outputs.length, 1);
  const code = await built.outputs[0]!.text(); assert.ok(Buffer.byteLength(code) <= 2 * 1024 * 1024);
  const child = spawnSync(node, ["--input-type=module", "--eval", `${code}\nprocess.stdout.write(JSON.stringify(await runNextDevAdapterFixture())+'\\n');`], {
    cwd: import.meta.dir, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024, killSignal: "SIGKILL",
  });
  assert.equal(child.error, undefined, "Adapter child failed or exceeded its bound");
  assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr.slice(0, 4096)); assert.equal(child.stderr, "");
  assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
    && "code" in error && error.code === "ESRCH", "Adapter child survived terminal collection");
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(typeof result === "object" && result !== null && "checks" in result && "node" in result);
  assert.deepEqual(Object.keys(result).sort(), ["checks", "node"]);
  expect(result.node).toMatch(/^24\./u);
  expect(result.checks).toBe(167);
  console.log(`Private adapter constructed-hook receipt: ${JSON.stringify(result)}`);
}, 70_000);
