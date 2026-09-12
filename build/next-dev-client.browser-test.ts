import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  acquireViteMatrixResource, childClosed, collectViteMatrixGroup, createViteMatrixCustody,
  matrixDeadline, viteMatrixGroup,
} from "../fixtures/vite8-adopter/custody.ts";

// Focused genuine-Node worker; no Next server, compiler output or HMR claim.
const scenarios = ["ssr-strict", "abandoned", "initial-unready", "stale-siblings", "future", "suspension", "foreign"];
const [directory, executablePath] = process.argv.slice(2);
assert.ok(directory && executablePath);
assert.equal(process.versions.bun, undefined);
assert.match(process.versions.node, /^24\./u);
const bundle = await readFile(join(directory, "fixture.js"));
const fixtureSha256 = createHash("sha256").update(bundle).digest("hex");
const signals = new EventEmitter();
const custody = createViteMatrixCustody({ signals, onCancel: () => {} });
const signalHandlers = (["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const).map((signal) => {
  const listener = () => { process.exitCode = 1; signals.emit("SIGTERM"); };
  process.on(signal, listener);
  return { signal, listener };
});
const evidence: { scenario: string; assertions: number }[] = [];
const browserPids: number[] = [];
let failure: unknown;
try {
  const http = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle); }
    else if (request.url === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } else { response.statusCode = 404; response.end(); }
  });
  // Register the server before starting it, and join the original listen on
  // cancellation so a late successful bind cannot escape collection.
  const listening = new Promise<void>((resolve, reject) => {
    http.once("error", reject); http.listen(0, "127.0.0.1", resolve);
  });
  custody.own("React fixture HTTP server", async () => {
    await listening.catch(() => {});
    http.closeAllConnections();
    await matrixDeadline(new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())), 5_000, "Fixture HTTP server did not close");
    assert.equal(http.listening, false);
  });
  await listening; custody.check();
  const address = http.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const environment: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"] as const) {
    const value = process.env[key]; if (value !== undefined) environment[key] = value;
  }
  const native = await acquireViteMatrixResource(custody, "React fixture native browser", async () => {
    const server = await chromium.launchServer({
      executablePath, headless: true, host: "127.0.0.1", timeout: 10_000, env: environment,
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
    return { server, closed: childClosed(server.process()) };
  }, async ({ server, closed }) => {
    const pid = server.process().pid;
    let closeFailure: unknown;
    try { await matrixDeadline(server.close(), 5_000, "React fixture browser did not close"); }
    catch (error) { closeFailure = error; }
    if (pid !== undefined && browserPids.includes(pid)) await collectViteMatrixGroup(viteMatrixGroup(pid));
    await matrixDeadline(closed, 5_000, "React fixture browser streams did not close");
    if (closeFailure !== undefined) throw closeFailure;
  });
  const pid = native.value.server.process().pid;
  assert.ok(pid !== undefined && pid > 1);
  assert.deepEqual(execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid="], {
    encoding: "utf8", timeout: 2_000,
  }).trim().split(/\s+/u).map(Number), [pid, process.pid, pid]);
  browserPids.push(pid);
  const connection = await acquireViteMatrixResource(custody, "React fixture browser connection", () => chromium.connect(native.value.server.wsEndpoint(), { timeout: 10_000 }), (browser) => browser.close());
  for (const scenario of scenarios) {
    custody.check();
    const context = await acquireViteMatrixResource(custody, "React fixture fresh context", () => connection.value.newContext({ serviceWorkers: "block" }), (value) => value.close());
    const failures: string[] = [];
    const requests = new Set<unknown>();
    const routing = new Set<Promise<void>>();
    await context.value.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const allowed = url.origin === origin && ["/", "/fixture.js"].includes(url.pathname);
      if (!allowed) failures.push("Unexpected fixture request");
      const pending = allowed ? route.continue() : route.abort();
      routing.add(pending); void pending.catch(() => { failures.push("Fixture route failed"); }).finally(() => { routing.delete(pending); });
      return pending;
    });
    context.value.on("request", (request) => { requests.add(request); });
    context.value.on("requestfinished", (request) => { requests.delete(request); });
    context.value.on("requestfailed", (request) => { requests.delete(request); failures.push("Fixture request failed"); });
    const page = await context.value.newPage();
    page.on("pageerror", (error) => { failures.push(error.message); });
    page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
    let result: { scenario: string; assertions: number } | undefined;
    let caseFailure: unknown;
    let evaluation: Promise<{ scenario: string; assertions: number }> | undefined;
    try {
      await page.goto(origin, { waitUntil: "load", timeout: 5_000 });
      evaluation = page.evaluate((name) => globalThis.runNextDevClientScenario(name), scenario);
      result = await matrixDeadline(evaluation, 10_000, "React bridge scenario exceeded its finite deadline");
      assert.equal(requests.size, 0, "Fixture requests remained pending");
    } catch (error) { caseFailure = error; }
    try { await context.close(); }
    catch (error) { caseFailure = caseFailure === undefined ? error : new AggregateError([caseFailure, error]); }
    if (evaluation !== undefined) await matrixDeadline(evaluation.catch(() => {}), 5_000, "Original React probe did not settle after context closure");
    await Promise.allSettled([...routing]);
    assert.equal(requests.size, 0);
    if (failures.length > 0) caseFailure = new AggregateError([caseFailure, ...failures], "React fixture emitted browser or request errors");
    if (caseFailure !== undefined) throw caseFailure;
    assert.ok(result && result.scenario === scenario && result.assertions > 0);
    evidence.push(result);
    console.log(JSON.stringify(result));
  }
} catch (error) { failure = error; }
try { await custody.close(); custody.check(); }
catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "React fixture proof and collection failed"); }
for (const pid of browserPids) assert.equal(viteMatrixGroup(pid).probe(), false, "React fixture browser group survived");
const receipt = { status: failure === undefined ? "passed" : "failed", fixtureSha256, browserPids, resources: custody.activeResources, evidence };
await writeFile(join(directory, "result.json"), `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
if (custody.activeResources === 0) custody.dispose();
for (const { signal, listener } of signalHandlers) process.off(signal, listener);
if (failure !== undefined) throw failure;
assert.equal(evidence.length, scenarios.length);
