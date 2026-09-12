import { createHash } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createNextStartupErrorReader } from "./next-dev-diagnostics.ts";
import { expectedStableRestartDiagnostic, retainStoppedNextLog, stableRejectionProof, STABLE_NEXT_DEV_REJECTION, validateNextDevelopmentLog } from "./next-dev-restart.ts";

const origin = "http://127.0.0.1:45678";
const error = { timestamp: "00:00:01.000", source: "Server", level: "ERROR", message: STABLE_NEXT_DEV_REJECTION };
const log = `${JSON.stringify(error)}\n`;

test("stable diagnostic exceptions require the rejection phase and exact observed HTTP provenance", () => {
  const proof = stableRejectionProof(origin, `${origin}/`, 500, `<html>${STABLE_NEXT_DEV_REJECTION}</html>`);
  expect(proof).not.toBeNull();
  expect(proof?.bodySha256).toMatch(/^[a-f\d]{64}$/u);
  const diagnostic = { kind: "console" as const, text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)", url: `${origin}/` };
  expect(expectedStableRestartDiagnostic("rejection", diagnostic, [proof!])).toBeTrue();
  expect(expectedStableRestartDiagnostic("healthy", diagnostic, [proof!])).toBeFalse();
  expect(expectedStableRestartDiagnostic("rejection", diagnostic, [])).toBeFalse();
  expect(expectedStableRestartDiagnostic("rejection", { ...diagnostic, url: `${origin}/unrelated` }, [proof!])).toBeFalse();
  expect(expectedStableRestartDiagnostic("rejection", { ...diagnostic, kind: "pageerror" }, [proof!])).toBeFalse();
  expect(expectedStableRestartDiagnostic("rejection", { ...diagnostic, text: `${diagnostic.text}\nUnrelated error` }, [proof!])).toBeFalse();
  expect(expectedStableRestartDiagnostic("healthy", { ...diagnostic, text: STABLE_NEXT_DEV_REJECTION }, [proof!])).toBeFalse();
  expect(expectedStableRestartDiagnostic("rejection", { ...diagnostic, text: `Next development server revision ${"a".repeat(64)} has no successfully published client stylesheet` }, [proof!])).toBeFalse();
  for (const [url, status, body] of [
    [`${origin}/`, 200, STABLE_NEXT_DEV_REJECTION], [`${origin}/`, 500, "Unrelated failure"],
    ["http://127.0.0.1:45679/", 500, STABLE_NEXT_DEV_REJECTION], [`${origin}/#fragment`, 500, STABLE_NEXT_DEV_REJECTION],
  ] as const) expect(stableRejectionProof(origin, url, status, body)).toBeNull();
});

test("stopped log validation accepts only complete bounded native NDJSON", () => {
  expect(validateNextDevelopmentLog(Buffer.from(log))).toBe(1);
  expect(validateNextDevelopmentLog(Buffer.from(log + log))).toBe(2);
  expect(validateNextDevelopmentLog(new Uint8Array())).toBe(0);
  for (const value of [log.slice(0, -1), "not JSON\n", "{}\n", JSON.stringify({ ...error, extra: true }) + "\n",
    JSON.stringify({ ...error, source: "Unknown" }) + "\n", JSON.stringify({ ...error, timestamp: "yesterday" }) + "\n",
    JSON.stringify({ ...error, level: "made-up" }) + "\n", JSON.stringify({ ...error, message: 1 }) + "\n"]) {
    expect(() => validateNextDevelopmentLog(Buffer.from(value))).toThrow();
  }
  expect(() => validateNextDevelopmentLog(new Uint8Array([0xff]))).toThrow();
});

test("rotation preserves exact log identity and old errors while the next epoch starts unread from zero", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "next-dev-restart-proof-")));
  try {
    const consumer = join(root, "consumer");
    const evidence = join(root, "evidence");
    const logs = join(consumer, ".next/dev/logs");
    await mkdir(logs, { recursive: true }); await mkdir(evidence);
    const source = join(logs, "next-development.log");
    await writeFile(source, log);
    const before = await lstat(source);
    let stoppedChecks = 0;
    const receipt = await retainStoppedNextLog(consumer, evidence, () => { stoppedChecks += 1; });
    expect(receipt.kind).toBe("retained");
    if (receipt.kind !== "retained") throw new Error("Expected retained log");
    expect(stoppedChecks).toBe(3);
    expect(receipt.ino).toBe(before.ino);
    expect(receipt.sha256).toBe(createHash("sha256").update(log).digest("hex"));
    expect((await lstat(join(evidence, receipt.retained))).nlink).toBe(1);
    expect(await readFile(join(evidence, receipt.retained), "utf8")).toBe(log);
    await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
    const reader = createNextStartupErrorReader(source);
    expect(await reader()).toBeNull();
    const nextLog = JSON.stringify({ ...error, message: "New unexpected startup failure" }) + "\n";
    await writeFile(source, nextLog);
    expect(await reader()).toBe("New unexpected startup failure");
    const second = await retainStoppedNextLog(consumer, evidence, () => undefined);
    expect(second.kind).toBe("retained");
    if (second.kind !== "retained") throw new Error("Expected next retained log");
    expect(second.retained).not.toBe(receipt.retained);
    expect(await readFile(join(evidence, receipt.retained), "utf8")).toBe(log);
    expect(await readFile(join(evidence, second.retained), "utf8")).toBe(nextLog);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rotation rejects live ownership, symlinks, hardlinks and malformed evidence without removing sources", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "next-dev-restart-rejection-")));
  try {
    const evidence = join(root, "evidence"); await mkdir(evidence);
    for (const scenario of ["live", "symlink", "hardlink", "invalid"] as const) {
      const consumer = join(root, scenario); const logs = join(consumer, ".next/dev/logs");
      await mkdir(logs, { recursive: true }); const source = join(logs, "next-development.log");
      const other = join(consumer, "other.log");
      if (scenario === "symlink") { await writeFile(other, log); await symlink(other, source); }
      else { await writeFile(source, scenario === "invalid" ? "invalid\n" : log); if (scenario === "hardlink") await link(source, other); }
      await expect(retainStoppedNextLog(consumer, evidence, () => { if (scenario === "live") throw new Error("Owned process still live"); })).rejects.toThrow();
      expect(await readFile(source, "utf8")).toBe(scenario === "invalid" ? "invalid\n" : log);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
