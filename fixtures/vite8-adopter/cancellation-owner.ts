import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createViteMatrixCustody, matrixDeadline, runViteMatrixCommand, waitForViteMatrixJson,
} from "./custody.ts";
import { ownViteBrowserWorker, writeViteBrowserJson } from "./browser-control.ts";
import { createBoundedDiagnostics } from "./diagnostics.ts";

// Run only as an isolated native regression owner, never from the production consumer.
const [work, mode, executable, node] = process.argv.slice(2);
assert.ok(work !== undefined && (mode === "command" || mode === "browser" || mode === "browser-pending"));
const custody = createViteMatrixCustody();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("owned regression server") });
custody.own("regression HTTP server", async () => {
  await matrixDeadline(server.stop(true), 5_000, "Regression HTTP server did not stop");
  assert.equal(server.pendingRequests, 0);
});
await writeFile(join(work, "server.json"), JSON.stringify({ port: server.port, owner: process.pid }), { flag: "wx" });
try {
  if (mode === "command") {
    // The leader ignores TERM while its child exits normally on group TERM.
    // The leader reaps that child before KILL, avoiding orphan-zombie ambiguity.
    await runViteMatrixCommand([process.execPath, "--eval", `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      process.on("SIGTERM", () => {});
      const child = spawn(process.execPath, ["--eval", 'process.stdout.write("ready"); setInterval(() => {}, 1000);'], { stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.once("data", () => writeFileSync(${JSON.stringify(join(work, "ready.json"))}, JSON.stringify({ pid: process.pid, descendant: child.pid }), { flag: "wx" }));
      setInterval(() => {}, 1000);
    `], work, process.env, custody);
  } else {
    assert.ok(executable !== undefined && node !== undefined);
    const workerDirectory = join(work, "browser-worker");
    await mkdir(workerDirectory);
    const inputPath = join(workerDirectory, "browser-request.json");
    await writeViteBrowserJson(inputPath, {
      schemaVersion: 1, mode: mode === "browser" ? "cancel-connected" : "cancel-during-launch",
      executablePath: executable, origin: `http://127.0.0.1:${String(server.port)}`,
      foundationHref: "/graphs/client/unused.css",
    });
    const owned = await ownViteBrowserWorker(node, inputPath, custody);
    const diagnostics = createBoundedDiagnostics();
    owned.child.stdout.on("data", (bytes: Buffer) => diagnostics.append(bytes));
    owned.child.stderr.on("data", (bytes: Buffer) => diagnostics.append(bytes));
    try {
      await owned.spawned;
      const launch = await waitForViteMatrixJson(join(workerDirectory, "browser-launch.json"), custody.signal);
      assert.ok(typeof launch === "object" && launch !== null && "pid" in launch && "owner" in launch && "port" in launch);
      assert.equal(launch.owner, owned.child.pid);
      if (mode === "browser") await waitForViteMatrixJson(join(workerDirectory, "browser-ready.json"), custody.signal);
      await writeFile(join(work, "ready.json"), JSON.stringify({ pid: launch.pid, worker: launch.owner, browserPort: launch.port }), { flag: "wx" });
      await new Promise<never>((_, reject) => {
        const cancelled = () => reject(custody.signal.reason);
        custody.signal.addEventListener("abort", cancelled, { once: true });
        if (custody.signal.aborted) cancelled();
      });
    } finally {
      try {
        await owned.close();
        const result = await owned.readResult();
        assert.equal(result.state, "cancelled");
        const terminal = await owned.closed;
        assert.equal(terminal.signal, null);
        assert.equal(terminal.code, 143);
      } finally {
        // Missing/failed collection receipts must not hide the subordinate
        // worker's bounded diagnostics behind the cooperative-owner error.
        process.stderr.write(diagnostics.render("stderr"));
      }
    }
  }
  throw new Error("Cancellation regression unexpectedly completed without a signal");
} catch (error) {
  assert.equal(custody.signal.aborted, true, "Regression must fail because of its requested signal");
  await custody.close();
  await writeFile(join(work, "cancelled.json"), JSON.stringify({
    state: "cancelled", resources: custody.activeResources,
    cause: error instanceof Error ? error.message : String(error),
  }), { flag: "wx" });
} finally {
  await custody.close();
  custody.dispose();
}
