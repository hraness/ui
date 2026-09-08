import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import {
  acquireViteMatrixResource, childClosed, collectViteMatrixGroup, createViteMatrixCustody,
  matrixDeadline, viteMatrixGroup,
} from "./custody.ts";
import { viteMatrixBrowserEndpoint } from "./browser-endpoint.ts";
import {
  assertViteBrowserNodeRuntime, parseViteBrowserRequest, prepareViteBrowserServer, viteBrowserFileIdentity, writeViteBrowserJson,
} from "./browser-control.ts";

// Playwright's server and client must share genuine Node. Bun remains the
// compiler/coordinator runtime; forwarding only the endpoint does not fix the
// demonstrated Bun-hosted WebSocket connection failure.
async function runBrowserWorker(inputPath: string): Promise<void> {
  assertViteBrowserNodeRuntime(process.versions);
  assert.equal(await realpath(inputPath), inputPath);
  const request = parseViteBrowserRequest(JSON.parse(await readFile(inputPath, "utf8")) as unknown);
  const requestIdentity = await viteBrowserFileIdentity(inputPath);
  const directory = dirname(inputPath);
  const custody = createViteMatrixCustody();
  const browserPids: number[] = [];
  let evidence: unknown = null;
  let failure: unknown;
  let cancelled = false;
  const waitForCancellation = () => new Promise<void>((resolve) => {
    if (custody.signal.aborted) resolve();
    else custody.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  try {
    const executableIdentity = await viteBrowserFileIdentity(request.executablePath);
    custody.check();
    const ownedServer = await acquireViteMatrixResource(custody, "matrix browser process", async () => {
      const server = await chromium.launchServer({
        executablePath: request.executablePath, host: "127.0.0.1", headless: true, timeout: 30_000,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      });
      let closed: ReturnType<typeof childClosed> | undefined;
      let group: ReturnType<typeof viteMatrixGroup> | undefined;
      const prepared = await prepareViteBrowserServer(custody, async () => {
        let closeFailure: unknown;
        try { await matrixDeadline(server.close(), 5_000, "Matrix browser server did not close"); }
        catch (error) { closeFailure = error; }
        // Only a positively verified group may be signaled. Before that proof,
        // Playwright must close its actual native child and streams itself.
        if (group !== undefined) await collectViteMatrixGroup(group);
        assert.ok(closed !== undefined, "Native browser child closure is unproved");
        await matrixDeadline(closed, 5_000, "Matrix browser process streams did not close");
        if (closeFailure !== undefined) throw closeFailure;
      }, async () => {
        closed = childClosed(server.process());
        const pid = server.process().pid;
        // Verify the actual detached group before ever signaling -PID.
        assert.ok(pid !== undefined && Number.isSafeInteger(pid) && pid > 1);
        const identity = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 2000 }).trim().split(/\s+/u).map(Number);
        assert.deepEqual(identity, [pid, process.pid, pid], "Browser did not establish its own owned process group");
        group = viteMatrixGroup(pid);
        browserPids.push(pid);
        await writeViteBrowserJson(join(directory, "browser-launch.json"), { owner: process.pid, pid, port: Number(new URL(viteMatrixBrowserEndpoint(server.wsEndpoint())).port) });
        if (request.mode === "cancel-during-launch") {
          // Exercise a real successful native launch whose acquisition promise
          // has not yet returned. Cancellation must collect the late resource.
          await waitForCancellation();
        }
        return server;
      });
      return { server: prepared.value, closeNative: prepared.close };
    }, ({ closeNative }) => closeNative());
    try {
      const endpoint = viteMatrixBrowserEndpoint(ownedServer.value.server.wsEndpoint());
      const ownedBrowser = await acquireViteMatrixResource(custody, "matrix browser connection",
        () => chromium.connect(endpoint, { timeout: 30_000 }), async (browser) => {
          await matrixDeadline(browser.close(), 5_000, "Matrix browser connection did not close");
          assert.equal(browser.isConnected(), false);
        });
      try {
        const browser = ownedBrowser.value;
        const ownedContext = await acquireViteMatrixResource(custody, "matrix browser context",
          () => browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" }),
          (context) => matrixDeadline(context.close(), 5_000, "Matrix browser context did not close"));
        try {
          if (request.mode === "cancel-connected") {
            await writeViteBrowserJson(join(directory, "browser-ready.json"), { owner: process.pid, pid: browserPids[0] });
            await waitForCancellation(); custody.check();
            throw new Error("Connected cancellation regression continued without cancellation");
          }
          assert.equal(request.mode, "acceptance");
          const page = await ownedContext.value.newPage();
          const failures: string[] = [];
          page.on("pageerror", (error) => failures.push(error.message));
          page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
          page.on("requestfailed", (resource) => failures.push(`${resource.url()}: ${resource.failure()?.errorText ?? "failed"}`));
          await page.route("**/*", async (route) => {
            if (route.request().url().startsWith(`${request.origin}/`)) await route.continue();
            else { failures.push(`Unexpected external request: ${route.request().url()}`); await route.abort(); }
          });
          const response = await page.goto(request.origin, { waitUntil: "networkidle" });
          assert.equal(response?.status(), 200);
          await page.waitForFunction(() => document.querySelector('[data-hydrated="true"]') !== null
            && document.querySelector('[data-lazy="ready"]') !== null && document.querySelector('[data-secondary="ready"]') !== null);
          await page.getByRole("button", { name: "Count 0", exact: true }).click();
          await page.getByRole("button", { name: "Count 1", exact: true }).waitFor();
          const presentation = await page.evaluate(() => {
            const shell = document.querySelector<HTMLElement>("[data-shell]");
            const secondary = document.querySelector<HTMLElement>("[data-secondary]");
            const packageTag = document.querySelector<HTMLElement>('[data-slot="tag"]');
            if (shell === null || secondary === null || packageTag === null) throw new Error("Missing rendered fixture");
            const style = getComputedStyle(shell);
            return {
              client: style.scrollMarginBottom, lazy: style.scrollPaddingInlineStart,
              secondary: getComputedStyle(secondary).marginInlineEnd, server: style.outlineOffset,
              foundation: style.getPropertyValue("--vite-foundation-proof").trim(),
              stylesheets: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => link.getAttribute("href")),
              runtimeStyleElements: document.querySelectorAll("style").length,
              packageTagDisplay: getComputedStyle(packageTag).display,
              count: document.querySelector("[data-count]")?.textContent,
            };
          });
          assert.deepEqual(presentation, {
            client: "314159px", lazy: "271828px", secondary: "161803px", server: "141421px",
            foundation: "present", stylesheets: [request.foundationHref, "/stylex.css"], runtimeStyleElements: 0, packageTagDisplay: "inline-flex", count: "1",
          });
          assert.deepEqual(failures, [], "The matrix must report every unexpected browser error");
          custody.check();
          assert.deepEqual(await viteBrowserFileIdentity(request.executablePath), executableIdentity, "Browser executable changed during validation");
          evidence = { browser: browser.version(), executable: executableIdentity, evidence: presentation };
        } finally { await ownedContext.close(); }
      } finally { await ownedBrowser.close(); }
    } finally { await ownedServer.close(); }
  } catch (error) {
    failure = error;
  } finally {
    // An uncertain close deliberately prevents a complete/cancelled receipt.
    // The outer coordinator retains this owner and its evidence on that fence.
    await custody.close();
    assert.equal(custody.activeResources, 0);
    for (const pid of browserPids) assert.equal(viteMatrixGroup(pid).probe(), false);
    assert.deepEqual(await viteBrowserFileIdentity(inputPath), requestIdentity);
    cancelled = custody.signal.aborted;
    await writeViteBrowserJson(join(directory, "browser-result.json"), {
      schemaVersion: 1, state: cancelled ? "cancelled" : failure === undefined ? "complete" : "failed",
      owner: process.pid, node: process.versions.node, requestSha256: requestIdentity.sha256,
      resources: 0, browserPids, evidence: failure === undefined && !cancelled ? evidence : null,
    });
    custody.dispose();
  }
  if (failure !== undefined && !cancelled) throw failure;
}

if (import.meta.main) {
  const [inputPath] = process.argv.slice(2);
  assert.ok(inputPath !== undefined);
  await runBrowserWorker(inputPath);
}
