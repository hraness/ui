import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveFirstBrowserExecutable } from "../scripts/browser-executable.ts";
import { createViteMatrixCustody, matrixDeadline, ownViteMatrixCancellationOwner, viteMatrixGroup } from "../fixtures/vite8-adopter/custody.ts";

test("private React bridge stays out of production exports and fails closed on an untransformed marker", async () => {
  const source = await readFile(new URL("./next-dev-client.tsx", import.meta.url), "utf8");
  expect(source.startsWith('"use client";')).toBe(true);
  for (const forbidden of ["createNextDevBridgeOwner(", "installNextDevBrowserOwner(", "createNextDevDocumentOwner(", ".adopt(", "location.reload", "setTimeout(", "useEffect("]) {
    expect(source).not.toContain(forbidden);
  }
  expect(source).toContain('from "next/navigation"');
  expect(source).toContain('throw new Error("Next development revision marker was not transformed")');
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
  expect(pkg.exports["./stylex-build/next-dev-client"]).toBeUndefined();
});

test("real React SSR, Strict commits, abandoned work, stale/future responses and suspension preserve custody", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ui-next-dev-react-")));
  const node = execFileSync("/usr/bin/which", ["node"], { encoding: "utf8" }).trim();
  expect(execFileSync(node, ["--version"], { encoding: "utf8" }).trim()).toMatch(/^v24\./u);
  const executable = await resolveFirstBrowserExecutable([
    process.env.CHROMIUM_EXECUTABLE_PATH ?? "", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ], "Focused React bridge tests require an existing Chrome or Chromium executable");
  const bundle = await Bun.build({ entrypoints: [join(import.meta.dir, "next-dev-client.browser-fixture.tsx")], target: "browser", format: "iife",
    define: { "process.env.NODE_ENV": JSON.stringify("development") }, plugins: [{ name: "public-router-test-double", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/u }, () => ({ path: "router", namespace: "next-dev-react-test" }));
      build.onLoad({ filter: /.*/u, namespace: "next-dev-react-test" }, () => ({ loader: "js", contents:
        "const router=Object.freeze({refresh:()=>globalThis.nextDevTestRefresh()});export const useRouter=()=>router;" }));
    } }] });
  assert.ok(bundle.success, "React fixture bundle failed"); assert.equal(bundle.outputs.length, 1);
  const bytes = Buffer.from(await bundle.outputs[0]!.arrayBuffer());
  await writeFile(join(directory, "fixture.js"), bytes, { flag: "wx", mode: 0o600 });
  const custody = createViteMatrixCustody();
  let failure: unknown;
  try {
    const worker = ownViteMatrixCancellationOwner([node, join(import.meta.dir, "next-dev-client.browser-test.ts"), directory, executable],
      import.meta.dir, custody, async () => {
        const receipt = JSON.parse(await readFile(join(directory, "result.json"), "utf8")) as { browserPids: number[]; resources: number };
        assert.equal(receipt.resources, 0);
        for (const pid of receipt.browserPids) assert.equal(viteMatrixGroup(pid).probe(), false);
      });
    // Fixture diagnostics contain only synthetic source labels and PID-only
    // custody. Never print an inherited environment or process argument census.
    worker.child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    worker.child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    await worker.spawned;
    const terminal = await matrixDeadline(worker.closed, 120_000, "Focused React worker did not return");
    assert.equal(terminal.signal, null); assert.equal(terminal.code, 0);
    await worker.close();
    const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8")) as {
      status: string; fixtureSha256: string; evidence: { scenario: string; assertions: number }[];
    };
    expect(result.status).toBe("passed");
    expect(result.fixtureSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.evidence.map(({ scenario }) => scenario)).toEqual(["ssr-strict", "abandoned", "initial-unready", "stale-siblings", "future", "suspension", "foreign"]);
    expect(result.evidence.every(({ assertions }) => assertions > 0)).toBe(true);
    console.log(`Focused React lifecycle receipt: ${directory}/result.json`);
  } catch (error) { failure = error; }
  try { await custody.close(); custody.check(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error]); }
  if (custody.activeResources === 0) custody.dispose();
  if (failure !== undefined) throw failure;
}, 180_000);
