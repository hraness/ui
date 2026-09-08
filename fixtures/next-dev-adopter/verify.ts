import assert from "node:assert/strict";
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsoleMessage, Page, Response } from "playwright-core";
import { expectedStableRestartDiagnostic, stableRejectionProof, type RestartDiagnostic, type StableRejectionProof } from "../../scripts/next-dev-restart.ts";

type CoherenceAudit = { failures: string[]; frame: number; samples: number };
type AuditedWindow = Window & { __hranessNextDevCoherence?: CoherenceAudit };

/** The caller owns a disposable installed fixture, Next process, browser, and cleanup. */
export async function verifyNextDevAdopter(page: Page, origin: string, fixture: string, hasEdge: boolean): Promise<Readonly<{ coherenceFrames: number; sealedDocuments: readonly { route: string; samples: number }[]; stages: readonly string[] }>> {
  assert.equal(typeof hasEdge, "boolean", "Next development verifier requires an explicit route-runtime expectation");
  assert.equal(await realpath(fixture), fixture, "Next development verifier requires an ordinary disposable fixture");
  assert.equal(new URL(origin).hostname, "127.0.0.1", "Next development fixture must be loopback-only");
  const marker = await readFile(join(fixture, "next.config.mjs"), "utf8");
  assert.ok(marker.includes("This fixture only supports next dev --webpack."));
  const paths = ["app/client.stylex.ts", "app/shared.stylex.ts", "app/lazy.tsx", "app/unvisited/page.tsx", "app/recovery.stylex.ts"];
  const originals = new Map(await Promise.all(paths.map(async (path) => {
    const absolute = join(fixture, path);
    assert.equal(await realpath(absolute), absolute, "Next development fixture input must not traverse a symlink");
    assert.ok((await lstat(absolute)).isFile(), "Next development fixture input must be a regular file");
    return [path, await readFile(absolute, "utf8")] as const;
  })));
  const edgeRuntimeDeclaration = 'export const runtime = "edge";\n';
  const routeSource = originals.get("app/unvisited/page.tsx")!;
  assert.equal(routeSource.split(edgeRuntimeDeclaration).length, hasEdge ? 2 : 1, "Next development route runtime differs from the requested browser variant");
  const routeRuntime = hasEdge ? "edge" : "node";
  const modified = new Set<string>();
  let addedOwned = false;
  const failures: string[] = [];
  let expectedCompilationError: RegExp | null = null;
  const consoleListener = (message: { type(): string; text(): string }): void => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (expectedCompilationError === null || !expectedCompilationError.test(text)) failures.push(text);
  };
  const pageErrorListener = (error: Error): void => { failures.push(error.message); };
  page.on("console", consoleListener);
  page.on("pageerror", pageErrorListener);
  const stages: string[] = [];
  const diagnostics: { stage: string; page: string; kind: string; value: string }[] = [];
  const trace = (subject: string, kind: string, value: string): void => {
    if (diagnostics.length >= 256) return;
    diagnostics.push({ stage: stages.at(-1) ?? "startup", page: subject, kind,
      value: diagnostics.length === 255 ? "Diagnostic inventory reached its 256-record bound"
        : value.length <= 8192 ? value : `${value.slice(0, 8192)} [truncated]` });
  };
  const tracePage = (subject: Page, label: string): void => {
    subject.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") trace(label, `console-${message.type()}`, message.text());
    });
    subject.on("framenavigated", (frame) => { if (frame === subject.mainFrame()) trace(label, "navigation", frame.url()); });
    subject.on("websocket", (socket) => {
      const url = new URL(socket.url());
      if (url.hostname !== "127.0.0.1" || url.port !== new URL(origin).port || url.pathname !== "/_next/webpack-hmr") return;
      socket.on("framereceived", ({ payload }) => trace(label, "hmr-frame", String(payload)));
    });
  };
  tracePage(page, "/");
  const sealedDocuments: { route: string; samples: number }[] = [];
  let routePage: Page | null = null;
  const css = async (): Promise<string> => page.evaluate(() => {
    const visit = (rules: CSSRuleList): string => Array.from(rules, (rule) => `${rule.cssText}${"cssRules" in rule ? visit((rule as CSSGroupingRule).cssRules) : ""}`).join("\n");
    return Array.from(document.styleSheets, (sheet) => visit(sheet.cssRules)).join("\n").replace(/\s+/gu, "");
  });
  const eventually = async (predicate: () => Promise<boolean>, description: string): Promise<void> => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) { if (await predicate()) return; await page.waitForTimeout(100); }
    throw new Error(description);
  };
  const edit = async (path: string, before: string, after: string): Promise<void> => {
    const source = await readFile(join(fixture, path), "utf8");
    assert.ok(source !== undefined && source.split(before).length === 2, `Fixture edit must match once: ${path}`);
    await writeFile(join(fixture, path), source.replace(before, after));
    modified.add(path);
  };
  try {
    // Calibrate on a separate native-only page, never on the compiled fixture.
    // Chromium quantizes outline-offset; margins retain these binary fractions
    // and distinguish adjacent revisions without rounding either observation.
    const control = await page.context().newPage();
    try {
      await control.setContent('<style>#before{margin-left:91.875px;outline-offset:91.875px}#after{margin-left:92.875px}</style><div id="before"></div><div id="after"></div>');
      const lengths = await control.evaluate(() => ({
        before: getComputedStyle(document.querySelector("#before")!).marginLeft,
        after: getComputedStyle(document.querySelector("#after")!).marginLeft,
        outlineOffset: getComputedStyle(document.querySelector("#before")!).outlineOffset,
      }));
      assert.equal(lengths.before, "91.875px", "Native margin canary must preserve the exact source fraction");
      assert.equal(lengths.after, "92.875px", "Native margin canary must distinguish the next source revision");
      assert.notEqual(lengths.before, lengths.after);
      console.log(JSON.stringify({ kind: "next-dev-native-length-control", ...lengths }));
      stages.push("native-fractional-length-control");
    } finally { await control.close(); }
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    for (let count = 0; count < 3; count += 1) await page.locator("[data-dev-counter]").click();
    await page.locator("[data-dev-draft]").fill("Preserved draft");
    const epoch = await page.evaluate(() => performance.timeOrigin);
    const installCoherenceAudit = async (subject: Page): Promise<void> => subject.evaluate(() => {
      const target = window as AuditedWindow;
      const audit: CoherenceAudit = { failures: [], frame: 0, samples: 0 };
      target.__hranessNextDevCoherence = audit;
      // Observe paint opportunities, not intermediate React DOM operations. The
      // expectations are rendered by the real client, lazy, and RSC modules.
      const sample = (): void => {
        audit.samples += 1;
        if (document.querySelectorAll("[data-dev-coherence-root]").length !== 1) audit.failures.push("The current rendered graph disappeared during HMR");
        for (const element of document.querySelectorAll<HTMLElement>("[data-dev-expected-margin], [data-dev-expected-background]")) {
          const computed = getComputedStyle(element);
          const expectedMargin = element.dataset.devExpectedMargin;
          const expectedBackground = element.dataset.devExpectedBackground;
          if (expectedMargin !== undefined && computed.marginLeft !== expectedMargin) audit.failures.push(`JS/CSS margin mismatch: ${expectedMargin} != ${computed.marginLeft}`);
          if (expectedBackground !== undefined && computed.backgroundColor !== expectedBackground) audit.failures.push(`JS/CSS background mismatch: ${expectedBackground} != ${computed.backgroundColor}`);
        }
        if (audit.failures.length < 50) audit.frame = requestAnimationFrame(sample);
      };
      audit.frame = requestAnimationFrame(sample);
    });
    await installCoherenceAudit(page);
    const assertCoherence = async (subject: Page, seal = false): Promise<number> => {
      const audit = await subject.evaluate(async (seal) => {
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const current = (window as AuditedWindow).__hranessNextDevCoherence;
        if (seal && current !== undefined) cancelAnimationFrame(current.frame);
        return current === undefined ? null : { failures: [...current.failures], samples: current.samples };
      }, seal);
      assert.ok(audit !== null && audit.samples > 0, "Native Next HMR lost its frame-level JS/CSS coherence observer");
      assert.deepEqual(audit.failures, [], "A native Next update exposed JavaScript from a different CSS revision");
      return audit.samples;
    };
    const preserveState = async (): Promise<void> => {
      assert.equal(await page.evaluate(() => performance.timeOrigin), epoch, "Next development update navigated instead of applying HMR");
      assert.equal(await page.locator("[data-dev-counter]").textContent(), "Count 3");
      assert.equal(await page.locator("[data-dev-draft]").inputValue(), "Preserved draft");
      await assertCoherence(page);
      if (routePage !== null && !routePage.isClosed()) await assertCoherence(routePage);
    };
    await eventually(async () => (await css()).includes("91.875px") && (await css()).includes("62.625px"), "Unvisited RSC and lazy rules must exist before navigation or import");
    stages.push("initial-complete-union");
    routePage = await page.context().newPage();
    tracePage(routePage, "/unvisited");
    routePage.on("console", consoleListener);
    routePage.on("pageerror", pageErrorListener);
    await routePage.goto(`${origin}/unvisited`, { waitUntil: "networkidle" });
    await installCoherenceAudit(routePage);
    assert.equal(await routePage.locator("[data-dev-edge]").getAttribute("data-dev-expected-margin"), "91.875px", `Real ${routeRuntime} fixture rendered the wrong source revision`);
    assert.equal(await routePage.locator("[data-dev-edge]").evaluate((element) => getComputedStyle(element).marginLeft), "91.875px", `Real ${routeRuntime} fixture rendered without its complete StyleX sheet`);
    stages.push(`real-${routeRuntime}-route`);
    await edit("app/client.stylex.ts", "rgb(151, 92, 179)", "rgb(152, 93, 180)");
    await eventually(async () => page.locator("[data-dev-counter]").evaluate((element) => getComputedStyle(element).backgroundColor === "rgb(152, 93, 180)"), "Client StyleX HMR did not apply");
    await preserveState();
    stages.push("client-edit-state-preserved");
    await edit("app/shared.stylex.ts", "38.375", "39.375");
    await eventually(async () => page.locator("[data-dev-server]").evaluate((element) => getComputedStyle(element).marginLeft === "39.375px"), "Server recipe HMR did not apply");
    await preserveState();
    await eventually(async () => !(await css()).includes("38.375px"), "Replaced server recipe remains in native CSS");
    stages.push("server-edit-stale-rule-removed");
    await page.getByRole("button", { name: "Open lazy content" }).click();
    await eventually(async () => page.locator("[data-dev-lazy]").count().then((count) => count === 1), "Lazy component did not load");
    await edit("app/lazy.tsx", "62.625", "63.625");
    await eventually(async () => page.locator("[data-dev-lazy]").evaluate((element) => getComputedStyle(element).marginLeft === "63.625px"), "Lazy StyleX HMR did not apply");
    await preserveState();
    stages.push("lazy-edit");
    await edit("app/unvisited/page.tsx", "91.875", "92.875");
    await eventually(async () => (await css()).includes("92.875px") && !(await css()).includes("91.875px"), "Unvisited server edit did not replace its native CSS");
    sealedDocuments.push({ route: "/unvisited", samples: await assertCoherence(routePage, true) });
    await routePage.reload({ waitUntil: "networkidle" });
    await installCoherenceAudit(routePage);
    assert.equal(await routePage.locator("[data-dev-edge]").getAttribute("data-dev-expected-margin"), "92.875px", `Real ${routeRuntime} route did not compile the edited source revision`);
    assert.equal(await routePage.locator("[data-dev-edge]").evaluate((element) => getComputedStyle(element).marginLeft), "92.875px", `Real ${routeRuntime} route exposed JavaScript without its matching StyleX sheet`);
    await preserveState();
    stages.push(`${routeRuntime}-route-edit-coherent`);
    const added = join(fixture, "app/added.stylex.ts");
    await writeFile(added, 'import * as stylex from "@stylexjs/stylex"; export const added = stylex.create({ root: { marginLeft: 143.375 } });\n', { flag: "wx" });
    addedOwned = true;
    await eventually(async () => (await css()).includes("143.375px"), "Added source was not observed by native watching");
    await unlink(added);
    addedOwned = false;
    await eventually(async () => !(await css()).includes("143.375px"), "Deleted source left stale native CSS");
    await preserveState();
    stages.push("addition-deletion");
    expectedCompilationError = /app[/\\]recovery\.stylex\.ts.*(?:Unexpected token|SyntaxError|Syntax Error|Parsing ecmascript)|(?:Unexpected token|SyntaxError|Syntax Error|Parsing ecmascript).*app[/\\]recovery\.stylex\.ts/u;
    await writeFile(join(fixture, "app/recovery.stylex.ts"), "export const broken = ;\n");
    modified.add("app/recovery.stylex.ts");
    await eventually(async () => {
      const response = await page.request.get(`${origin}/`);
      return response.status() === 500 && (await response.text()).includes("recovery.stylex.ts");
    }, "Invalid bounded source did not produce its normal Next compilation error");
    assert.ok((await css()).includes("117.125px"), "Failed compilation discarded last-good CSS");
    await writeFile(join(fixture, "app/recovery.stylex.ts"), originals.get("app/recovery.stylex.ts")!);
    await eventually(async () => (await page.request.get(`${origin}/`)).status() === 200, "Next did not recover after the source repair");
    await preserveState();
    expectedCompilationError = null;
    stages.push("failed-revision-recovery");
    assert.deepEqual(failures, [], "Next development browser reported unexpected diagnostics");
    return { coherenceFrames: sealedDocuments.reduce((sum, document) => sum + document.samples, 0)
      + await assertCoherence(page) + (routePage === null ? 0 : await assertCoherence(routePage)),
      sealedDocuments: Object.freeze(sealedDocuments), stages: Object.freeze(stages) };
  } catch (error) {
    // A failed native proof keeps bounded transport/navigation evidence inside
    // its retained disposable fixture. It does not change any HMR assertion.
    await writeFile(join(fixture, "stylex-hmr-failure.json"), JSON.stringify({ stages, diagnostics }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    throw error;
  } finally {
    page.off("console", consoleListener);
    page.off("pageerror", pageErrorListener);
    try {
      if (routePage !== null && !routePage.isClosed()) await routePage.close();
      if (!page.isClosed()) await page.evaluate(() => {
        const target = window as AuditedWindow;
        if (target.__hranessNextDevCoherence !== undefined) cancelAnimationFrame(target.__hranessNextDevCoherence.frame);
        delete target.__hranessNextDevCoherence;
      });
    } finally {
      await Promise.all([...modified].map((path) => writeFile(join(fixture, path), originals.get(path)!)));
      if (addedOwned) await unlink(join(fixture, "app/added.stylex.ts"));
    }
  }
}

/** Stable identities are a restart contract, separate from ordinary atomic HMR.
 * The caller stops the exact owned server before an optional offline mutation,
 * then starts a fresh server and waits for clean readiness at the same origin. */
export async function verifyNextDevStableRestarts(
  page: Page,
  origin: string,
  fixture: string,
  hasEdge: boolean,
  restart: (beforeStart?: () => Promise<void>) => Promise<void>,
): Promise<Readonly<{ stages: readonly string[]; observations: readonly { stage: string; route: string; selector: string; expected: string; actual: string }[]; rejections: readonly StableRejectionProof[] }>> {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const path = join(fixture, "app/shared.stylex.ts");
  assert.equal(await realpath(path), path);
  assert.ok((await lstat(path)).isFile());
  const original = await readFile(path, "utf8");
  const runtimeDeclaration = 'export const runtime = "edge";\n';
  const routeSource = await readFile(join(fixture, "app/unvisited/page.tsx"), "utf8");
  assert.equal(routeSource.split(runtimeDeclaration).length, hasEdge ? 2 : 1, "Stable restart route-runtime inventory differs");
  const routeRuntime = hasEdge ? "edge" : "node";
  const context = page.context();
  const stages: string[] = [];
  const observations: { stage: string; route: string; selector: string; expected: string; actual: string }[] = [];
  const rejections: StableRejectionProof[] = [];
  const diagnostics: { phase: "healthy" | "rejection"; diagnostic: RestartDiagnostic }[] = [];
  const proofByUrl = new Map<string, StableRejectionProof>();
  const pending = new Set<Promise<void>>();
  let phase: "healthy" | "rejection" = "healthy";
  let rootPage: Page | null = page;
  let routePage: Page | null = null;
  let changed = false;
  const record = (diagnostic: RestartDiagnostic, capturedPhase: "healthy" | "rejection" = phase): void => {
    if (diagnostics.length >= 100) return;
    diagnostics.push({ phase: capturedPhase, diagnostic: diagnostics.length === 99
      ? { kind: "pageerror", text: "Stable restart diagnostic count exceeded its bound", url: "" }
      : diagnostic.text.length <= 16_384 ? diagnostic : { kind: "pageerror", text: "Stable restart diagnostic text exceeded its bound", url: diagnostic.url } });
  };
  const consoleError = (message: ConsoleMessage): void => {
    if (message.type() === "error") record({ kind: "console", text: message.text(), url: message.location().url });
  };
  const pageError = (error: Error): void => record({ kind: "pageerror", text: error.message, url: "" });
  const responseListener = (response: Response): void => {
    if (response.status() < 400) return;
    const capturedPhase = phase;
    if (capturedPhase === "healthy") { record({ kind: "pageerror", text: `Healthy restart response HTTP ${response.status()}`, url: response.url() }); return; }
    if (pending.size >= 64 || proofByUrl.size >= 64) { record({ kind: "pageerror", text: "Stable rejection response inventory exceeded its bound", url: response.url() }); return; }
    const read = (async () => {
      const proof = stableRejectionProof(origin, response.url(), response.status(), await response.text());
      if (proof === null) record({ kind: "pageerror", text: `Unrelated rejection-phase response HTTP ${response.status()}`, url: response.url() }, capturedPhase);
      else proofByUrl.set(proof.url, proof);
    })().catch((error: unknown) => record({ kind: "pageerror", text: String(error), url: response.url() }, capturedPhase));
    pending.add(read); void read.finally(() => pending.delete(read));
  };
  const attach = (subject: Page): void => { subject.on("console", consoleError); subject.on("pageerror", pageError); subject.on("response", responseListener); };
  attach(page);
  const drainResponses = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all([...pending]), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stable restart response evidence did not settle")), 10_000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const assertDiagnostics = async (): Promise<void> => {
    await drainResponses();
    assert.deepEqual(diagnostics.filter((entry) => !expectedStableRestartDiagnostic(entry.phase, entry.diagnostic, [...proofByUrl.values()])), [], "Stable restart fixture reported an unrelated browser error");
  };
  const closePages = async (): Promise<void> => {
    await drainResponses();
    for (const subject of [rootPage, routePage]) if (subject !== null && !subject.isClosed()) {
      await subject.close();
      subject.off("console", consoleError); subject.off("pageerror", pageError); subject.off("response", responseListener);
    }
    rootPage = null; routePage = null;
    await drainResponses();
  };
  const assertTokens = async (stage: string, defaultColor: string, themeColor: string): Promise<void> => {
    if (rootPage === null) { rootPage = await context.newPage(); attach(rootPage); }
    if (routePage === null) { routePage = await context.newPage(); attach(routePage); }
    for (const [subject, route] of [[rootPage, "/"], [routePage, "/unvisited"]] as const) {
      const response = await subject.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, `${stage}: ${route} must load from the fresh process`);
    }
    // Recheck both still-open documents after the Node and Edge graph joins.
    for (const [subject, route, selectors] of [
      [rootPage, "/", ["[data-dev-server]", "[data-dev-server-theme]"]],
      [routePage, "/unvisited", ["[data-dev-edge]", "[data-dev-edge-theme]"]],
    ] as const) {
      await subject.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      for (const [index, selector] of selectors.entries()) {
        const expected = index === 0 ? defaultColor : themeColor;
        const element = subject.locator(selector);
        assert.equal(await element.count(), 1, `${stage}: exact token witness required`);
        assert.equal(await element.getAttribute("data-dev-expected-background"), expected, `${stage}: ${route} rendered the wrong token JavaScript`);
        const actual = await element.evaluate((element) => getComputedStyle(element).backgroundColor);
        assert.equal(actual, expected, `${stage}: ${route} rendered JavaScript without matching native token CSS`);
        observations.push({ stage, route, selector, expected, actual });
      }
    }
    await assertDiagnostics();
  };
  try {
    for (const [before, after, stage] of [
      ["rgb(43, 73, 103)", "rgb(44, 74, 104)", "define-vars"],
      ["rgb(83, 113, 143)", "rgb(84, 114, 144)", "create-theme"],
    ] as const) {
      assert.equal(await readFile(path, "utf8"), original);
      assert.equal(original.split(before).length, 2, "Stable token edit must match exactly once");
      await assertTokens(`${stage}/before`, "rgb(43, 73, 103)", "rgb(83, 113, 143)");
      phase = "rejection";
      await writeFile(path, original.replace(before, after)); changed = true;
      const deadline = Date.now() + 45_000;
      let rejected = false;
      while (Date.now() < deadline) {
        const response = await context.request.get(`${origin}/`);
        assert.equal(response.url(), `${origin}/`, "Stable rejection must not follow a redirect");
        const proof = stableRejectionProof(origin, response.url(), response.status(), await response.text());
        if (proof !== null) { proofByUrl.set(proof.url, proof); rejected = true; break; }
        assert.equal(response.status(), 200, `Unexpected ${stage} restart-boundary response`);
        await new Promise<void>((done) => setTimeout(done, 100));
      }
      assert.ok(rejected, `${stage} must reject hot replacement of its stable identity`);
      // Seal the failure phase before stopping the server. Fresh pages cannot
      // inherit old HMR sockets or delayed expected diagnostics after restart.
      await closePages();
      await assertDiagnostics();
      rejections.push(...proofByUrl.values());
      diagnostics.length = 0; proofByUrl.clear(); phase = "healthy";
      await restart();
      await assertTokens(`${stage}/changed/${routeRuntime}`, stage === "define-vars" ? after : "rgb(43, 73, 103)", stage === "create-theme" ? after : "rgb(83, 113, 143)");
      stages.push(`${stage}-rejected-then-real-server-restart`);
      await closePages();
      await assertDiagnostics();
      await restart(async () => { await writeFile(path, original); changed = false; });
      await assertTokens(`${stage}/restored/${routeRuntime}`, "rgb(43, 73, 103)", "rgb(83, 113, 143)");
      stages.push(`${stage}-offline-original-restored-and-verified`);
    }
    await closePages();
    await assertDiagnostics();
    return { stages: Object.freeze(stages), observations: Object.freeze(observations), rejections: Object.freeze(rejections) };
  } finally {
    try { await closePages(); }
    finally { if (changed) await writeFile(path, original); }
  }
}
