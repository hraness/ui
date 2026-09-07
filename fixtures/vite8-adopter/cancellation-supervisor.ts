import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createViteMatrixCustody, ownViteMatrixCancellationOwner, waitForViteMatrixJson,
} from "./custody.ts";
import { createBoundedDiagnostics } from "./diagnostics.ts";

// Importing this path in the native test also includes this isolated executable
// in the root typecheck. It never runs when imported by the test runner.
export const cancellationSupervisorScript = fileURLToPath(import.meta.url);

async function runSupervisor(work: string): Promise<void> {
  const custody = createViteMatrixCustody();
  const diagnostics = createBoundedDiagnostics();
  const owned = ownViteMatrixCancellationOwner([
    process.execPath, join(dirname(cancellationSupervisorScript), "cancellation-owner.ts"), work, "command",
  ], work, custody);
  owned.child.stdout.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  owned.child.stderr.on("data", (bytes: Buffer) => diagnostics.append(bytes));
  try {
    await owned.spawned;
    const nested: unknown = await waitForViteMatrixJson(join(work, "ready.json"), custody.signal);
    await writeFile(join(work, "supervisor-ready.json"), JSON.stringify({
      owner: owned.child.pid, nested, state: "waiting-for-readiness-admission",
    }), { flag: "wx" });
    // The native test cancels this outer owner while readiness admission is
    // pending, with a real nested process tree and listener already alive.
    await waitForViteMatrixJson(join(work, "admit-readiness.json"), custody.signal);
    throw new Error("Supervisor readiness unexpectedly admitted without cancellation");
  } catch (error) {
    assert.equal(custody.signal.aborted, true, diagnostics.render("stderr").toString("utf8"));
    await custody.close();
    const terminal = await owned.closed;
    assert.equal(terminal.code, 143, diagnostics.render("stderr").toString("utf8"));
    assert.equal(terminal.signal, null);
    const inner: unknown = JSON.parse(await readFile(join(work, "cancelled.json"), "utf8"));
    assert.ok(typeof inner === "object" && inner !== null && "resources" in inner && inner.resources === 0);
    await writeFile(join(work, "supervisor-cancelled.json"), JSON.stringify({
      state: "cancelled", resources: custody.activeResources,
      cause: error instanceof Error ? error.message : String(error),
    }), { flag: "wx" });
  } finally {
    await custody.close();
    custody.dispose();
  }
}

if (import.meta.main) {
  const [work] = process.argv.slice(2);
  assert.ok(work !== undefined);
  await runSupervisor(work);
}
