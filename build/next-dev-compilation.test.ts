import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";

test("one genuine-Node compiler owner binds source markers, terminal CSS publication, serial targets and recovery", async () => {
  const node = Bun.which("node");
  assert.ok(node !== null, "Compiler-owner tests require genuine Node 24 on PATH");
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/next-dev-compilation.fixture.ts`], packages: "external",
    target: "node", format: "esm", splitting: false, minify: false, env: "disable", sourcemap: "none" });
  assert.equal(built.success, true); assert.equal(built.logs.length, 0); assert.equal(built.outputs.length, 1);
  const code = await built.outputs[0]!.text();
  assert.ok(Buffer.byteLength(code) <= 1024 * 1024);
  const child = spawnSync(node, ["--input-type=module", "--eval", `${code}\nprocess.stdout.write(JSON.stringify(await runNextDevCompilationFixture())+'\\n');`], {
    cwd: import.meta.dir, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024, killSignal: "SIGKILL",
  });
  assert.equal(child.error, undefined, "Compiler-owner child failed or exceeded its bound");
  assert.equal(child.signal, null, "Compiler-owner child was signalled");
  assert.equal(child.status, 0, `Compiler-owner child failed: ${child.stderr.slice(0, 4096)}`);
  assert.equal(child.stderr, "");
  assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
    && "code" in error && error.code === "ESRCH", "Compiler-owner child survived terminal collection");
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(typeof result === "object" && result !== null && "checks" in result && "node" in result);
  assert.deepEqual(Object.keys(result).sort(), ["checks", "node"]);
  expect(result.node).toMatch(/^24\./u);
  expect(result.checks).toBe(63);
}, 40_000);
