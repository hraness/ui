import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { createNextDevDiagnostics, createNextStartupErrorReader, nextDevOutboundHmrFrame, nextDevRequestFailure, nextDevResponseSummary, nextStartupServerError } from "./next-dev-diagnostics.ts";

test("RSC response diagnostics discriminate HTML fallback without retaining private headers or bodies", () => {
  const request = { url: "http://127.0.0.1:4321/?_rsc=secret", method: "GET", resourceType: "fetch",
    headers: { rsc: "1", "next-router-state-tree": "secret router state", "next-hmr-refresh": "1", cookie: "private cookie" } };
  const response = { status: 200, headers: { "content-type": "text/x-component; charset=utf-8", "x-nextjs-deployment-id": "secret identity", "set-cookie": "private cookie" } };
  const summary = nextDevResponseSummary(request, "http://127.0.0.1:4321", response);
  expect(summary).toEqual({ method: "GET", resourceType: "fetch", path: "/", hasQuery: true, status: 200,
    contentType: "text/x-component", rsc: true, routerState: true, hmrRefresh: true, deploymentIdentity: true });
  expect(Object.isFrozen(summary)).toBe(true);
  expect(JSON.stringify(summary)).not.toMatch(/secret|private|cookie/iu);
  expect(nextDevResponseSummary({ ...request, headers: {} }, "http://127.0.0.1:4321",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })).toMatchObject({ contentType: "text/html", rsc: false, routerState: false, hmrRefresh: false, deploymentIdentity: false });
  expect(nextDevResponseSummary({ ...request, url: "https://foreign.example/secret" }, "http://127.0.0.1:4321",
    { status: Number.NaN, headers: { "content-type": "private payload" } })).toMatchObject({ path: "<unrecorded-url>", status: null, contentType: "other" });
});

test("outbound reload diagnostics retain the cause and public dependency chain without private payloads", () => {
  const value: unknown = JSON.parse(nextDevOutboundHmrFrame(JSON.stringify({
    event: "client-full-reload", hadRuntimeError: false, authorization: "Bearer private-token", source: "private source",
    stackTrace: "Error: Aborted because (app-pages-browser)/./app/client.stylex.ts?credential=private-token is not accepted\n    at https://name:password@localhost/?token=private-token",
    dependencyChain: ["(app-pages-browser)/./app/client.stylex.ts", "/private/checkout/node_modules/@hraness/ui/dist/index.js?token=private-token", "/private/checkout/private-file"],
  })));
  expect(value).toEqual({ event: "client-full-reload", cause: "unaccepted-module", hadRuntimeError: false,
    unacceptedModule: "app/client.stylex.ts", dependencyChain: ["app/client.stylex.ts", "node_modules/@hraness/ui/dist/index.js", "<unrecorded-module>"], dependencyChainTruncated: false });
  expect(JSON.stringify(value)).not.toMatch(/private-token|password|checkout|authorization|private source/u);
  for (const [stackTrace, cause] of [["ChunkLoadError: Loading chunk app/page failed.", "chunk-load-failed"],
    ["TypeError: Failed to fetch https://private.example/?token=secret", "fetch-failed"], ["", "no-error-stack"], ["secret", "other-error"]]) {
    const frame: unknown = JSON.parse(nextDevOutboundHmrFrame(JSON.stringify({ event: "client-full-reload", hadRuntimeError: true, stackTrace })));
    expect(frame).toMatchObject({ event: "client-full-reload", cause, hadRuntimeError: true });
  }
});

test("outbound frame diagnostics bound payload and dependency counts and suppress unknown content", () => {
  for (const event of ["client-reload-page", "server-component-reload-page", "client-success"]) {
    expect(nextDevOutboundHmrFrame(JSON.stringify({ event, token: "secret", query: "private" }))).toBe(JSON.stringify({ event }));
  }
  expect(nextDevOutboundHmrFrame(Buffer.from('{"event":"client-error","message":"secret"}'))).toBe('{"event":"client-error"}');
  expect(nextDevOutboundHmrFrame('{"event":"secret"}')).toBe('{"event":"other-event"}');
  expect(nextDevOutboundHmrFrame("secret")).toBe('{"event":"non-json-frame"}');
  expect(nextDevOutboundHmrFrame("null")).toBe('{"event":"unrecorded-frame"}');
  expect(nextDevOutboundHmrFrame("x".repeat(16 * 1024 + 1))).toBe('{"event":"oversize-frame"}');
  const frame: unknown = JSON.parse(nextDevOutboundHmrFrame(JSON.stringify({ event: "client-full-reload",
    dependencyChain: Array.from({ length: 20 }, () => "app/client.tsx") })));
  expect(frame).toMatchObject({ dependencyChain: Array.from({ length: 16 }, () => "app/client.tsx"), dependencyChainTruncated: true });
});

test("request failure diagnostics keep only bounded loopback paths and classified failures", () => {
  const request = { url: "http://127.0.0.1:4321/?_rsc=private-token", method: "GET", resourceType: "fetch" };
  const value = nextDevRequestFailure(request, "http://127.0.0.1:4321", "fetch", new Error("route.fetch: Timeout 30000ms exceeded. Cookie: secret"));
  expect(value).toEqual({ phase: "fetch", method: "GET", resourceType: "fetch", path: "/", hasQuery: true, failure: "timeout" });
  expect(Object.isFrozen(value)).toBe(true);
  expect(JSON.stringify(value)).not.toMatch(/private-token|Cookie|secret/u);
  for (const [message, failure] of [["Target page, context or browser has been closed", "target-closed"],
    ["connect ECONNREFUSED", "connection-refused"], ["read ECONNRESET", "connection-reset"],
    ["Request aborted", "aborted"], ["net::ERR_FAILED", "net::ERR_FAILED"], ["arbitrary secret", "other-error"]] as const) {
    expect(nextDevRequestFailure(request, "http://127.0.0.1:4321", "browser", message).failure).toBe(failure);
  }
  expect(nextDevRequestFailure({ ...request, url: "http://127.0.0.1:4321/_next/static/webpack/hash.hot-update.json?secret=value" },
    "http://127.0.0.1:4321", "fulfill", undefined).path).toBe("/_next/static/webpack/hash.hot-update.json");
  for (const url of ["https://private.example/path?token=secret", "http://name:password@127.0.0.1:4321/", "http://127.0.0.1:4322/", "http://127.0.0.1:4321/private-token", "invalid", "x".repeat(16 * 1024 + 1)]) {
    expect(nextDevRequestFailure({ ...request, url }, "http://127.0.0.1:4321", "fetch", null).path).toBe("<unrecorded-url>");
  }
});

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
