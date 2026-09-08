import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { createNextDevDiagnostics, createNextStartupErrorReader, nextStartupServerError } from "./next-dev-diagnostics.ts";

test("retains one bounded nonoverlapping diagnostic and drains later chunks", () => {
  for (const chunks of [["abc"], ["abc", "def"], ["abc", "defgh"], ["abcdefghijklmnop"], ["abcd", "efgh", "ijkl", "mnop"]]) {
    const diagnostic = createNextDevDiagnostics(8);
    for (const chunk of chunks) diagnostic.append(Buffer.from(chunk));
    const source = chunks.join("");
    expect(diagnostic.retainedBytes).toBe(Math.min(8, source.length));
    const output = diagnostic.take();
    if (source.length <= 8) expect(output).toBe(source);
    else {
      expect(output.startsWith(source.slice(0, 4))).toBeTrue();
      expect(output.endsWith(source.slice(-4))).toBeTrue();
      expect(output).toContain(`${String(source.length - 8)} diagnostic bytes omitted`);
    }
    expect(diagnostic.take()).toBe("");
    diagnostic.append(Buffer.alloc(1024 * 1024, 97));
    expect(diagnostic.retainedBytes).toBe(8);
    expect(diagnostic.take()).toBe("");
  }
});

test("parses exact Next startup server records without guessing error substrings", () => {
  const record = { timestamp: "00:00:11.008", source: "Server", level: "ERROR", message: "Compilation failed" };
  expect(nextStartupServerError(JSON.stringify(record))).toBe(record.message);
  for (const value of [
    { ...record, source: "Browser" }, { ...record, level: "LOG" }, { ...record, timestamp: null },
    { ...record, message: { text: "error" } }, { ...record, message: "" }, [], null,
  ]) expect(nextStartupServerError(JSON.stringify(value))).toBeNull();
  for (const text of ["Error: compile failed", '{"level":"ERROR"}', JSON.stringify(record).slice(0, -1)]) {
    expect(nextStartupServerError(text)).toBeNull();
  }
  expect(nextStartupServerError(JSON.stringify({ ...record, message: "x".repeat(2000) }))).toHaveLength(1036);
  expect(nextStartupServerError(JSON.stringify({ ...record, message: "x".repeat(20_000) }))).toBeNull();
});

test("reads only bounded complete appended log records during initial readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-startup-diagnostics-"));
  try {
    const path = join(root, "development.log");
    const read = createNextStartupErrorReader(path);
    expect(await read()).toBeNull();
    await writeFile(path, `${JSON.stringify({ timestamp: "00:00:01.000", source: "Server", level: "LOG", message: "Ready error-looking text" })}\n`);
    expect(await read()).toBeNull();
    const failure = JSON.stringify({ timestamp: "00:00:02.000", source: "Server", level: "ERROR", message: "Native compilation failed" });
    await appendFile(path, failure.slice(0, 30));
    expect(await read()).toBeNull();
    await appendFile(path, `${failure.slice(30)}\n`);
    expect(await read()).toBe("Native compilation failed");

    const longPath = join(root, "oversize.log");
    await writeFile(longPath, `${"x".repeat(40_000)}\n${failure}\n`);
    const bounded = createNextStartupErrorReader(longPath);
    expect(await bounded()).toBeNull();
    expect(await bounded()).toBeNull();
    expect(await bounded()).toBe("Native compilation failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});
