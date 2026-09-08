import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { createBoundedDiagnostics } from "../fixtures/vite8-adopter/diagnostics.ts";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";

const VITE_VERSIONS = ["7.3.6", "8.2.1"] as const;
const PINNED = {
  "@babel/core": "7.29.7",
  "@types/babel__core": "7.20.5",
  "@stylexjs/babel-plugin": "0.19.0",
  "@stylexjs/stylex": "0.19.0",
  "@types/node": "24.13.3",
  lightningcss: "1.33.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  typescript: "6.0.3",
} as const;

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    assert.ok(!item.isSymbolicLink(), `Unexpected fixture symlink: ${path}`);
    if (item.isDirectory()) files.push(...await filesBelow(root, path));
    else {
      assert.ok(item.isFile(), `Unexpected fixture non-file: ${path}`);
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

async function writeNew(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { flag: "wx" });
}

function nodeExecutable(): string {
  const candidates = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, "node"));
  for (const candidate of new Set(candidates)) {
    try {
      const identity = Bun.spawnSync([candidate, "--eval", "if (process.versions.bun || !process.versions.node.startsWith('24.')) process.exit(1)"], {
        stdin: "ignore", stdout: "ignore", stderr: "ignore",
      });
      if (identity.exitCode === 0) return candidate;
    } catch { /* An inaccessible candidate is not a compatible Node runtime. */ }
  }
  throw new Error("The Vite 7/8 matrix requires genuine Node 24 on PATH");
}

async function run(command: readonly string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<void> {
  assert.ok(process.platform !== "win32", "This host-scheduled fixture requires POSIX process groups");
  const executable = command[0];
  assert.ok(executable !== undefined);
  const child = spawn(executable, command.slice(1), { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const output = createBoundedDiagnostics();
  const errorOutput = createBoundedDiagnostics();
  child.stdout.on("data", (bytes: Buffer) => { output.append(bytes); });
  child.stderr.on("data", (bytes: Buffer) => { errorOutput.append(bytes); });
  const settled = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => accept({ code, signal }));
  });
  void settled.catch(() => undefined);
  const signalOwnedGroup = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  };
  const ownedGroupExists = (): boolean => {
    if (child.pid === undefined) return false;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const terminateOwnedGroup = async (): Promise<void> => {
    if (ownedGroupExists()) signalOwnedGroup("SIGTERM");
    const gracefulDeadline = Date.now() + 2_000;
    while (ownedGroupExists() && Date.now() < gracefulDeadline) await Bun.sleep(50);
    if (ownedGroupExists()) signalOwnedGroup("SIGKILL");
    const killDeadline = Date.now() + 5_000;
    while (ownedGroupExists() && Date.now() < killDeadline) await Bun.sleep(50);
    assert.equal(ownedGroupExists(), false, `Command retained an owned process group: ${String(child.pid)}`);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let survivorAfterCompletion = false;
  try {
    const result = await Promise.race([
      settled,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Command timed out: ${command.join(" ")}`)), 300_000);
      }),
    ]);
    survivorAfterCompletion = ownedGroupExists();
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, `Command failed: ${command.join(" ")}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      await terminateOwnedGroup();
    } finally {
      process.stdout.write(output.render("stdout"));
      process.stderr.write(errorOutput.render("stderr"));
    }
  }
  assert.equal(survivorAfterCompletion, false, `Command left an owned process group: ${String(child.pid)}`);
}

type MatrixReceipt = Readonly<{
  finalDirectory: string;
  foundationHref: string;
  clientHrefs: readonly string[];
  graphReceipts: readonly Readonly<{ id: string; inputs: number; outputs: number; rules: number }>[];
  externalImports: readonly string[];
  negatives: readonly string[];
  vite: string;
}>;

function parseReceipt(value: unknown, expectedVersion: string): MatrixReceipt {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["clientHrefs", "externalImports", "finalDirectory", "foundationHref", "graphReceipts", "negatives", "vite"]);
  assert.equal(record.vite, expectedVersion);
  assert.equal(record.finalDirectory, "output/vite-production-matrix");
  assert.ok(typeof record.foundationHref === "string" && /^\/graphs\/client\/[A-Za-z0-9_.\/-]+\.css$/u.test(record.foundationHref));
  assert.ok(Array.isArray(record.clientHrefs) && record.clientHrefs.length === 3);
  for (const href of record.clientHrefs) assert.ok(typeof href === "string" && /^\/graphs\/client\/[A-Za-z0-9_.\/-]+\.[cm]?js$/u.test(href));
  assert.equal(new Set(record.clientHrefs).size, 3);
  assert.deepEqual(record.externalImports, ["node:assert/strict", "node:fs/promises", "react", "react-dom/server"]);
  assert.deepEqual(record.negatives, [
    "map-true", "map-hidden", "map-inline",
    "rollupoptions-input", "rollupoptions-output", "rollupoptions-external",
    "rolldownoptions-input", "rolldownoptions-output", "rolldownoptions-external",
    "late-map", "late-bytes",
    "external-relative-file", "external-absolute-file",
  ]);
  assert.ok(Array.isArray(record.graphReceipts) && record.graphReceipts.length === 2);
  for (const [index, graph] of record.graphReceipts.entries()) {
    assert.ok(typeof graph === "object" && graph !== null && !Array.isArray(graph));
    assert.deepEqual(Object.keys(graph).sort(), ["id", "inputs", "outputs", "rules"]);
    assert.equal(graph.id, index === 0 ? "client" : "ssr");
    for (const field of ["inputs", "outputs", "rules"] as const) assert.ok(Number.isSafeInteger(graph[field]) && graph[field] > 0);
  }
  return record as MatrixReceipt;
}

async function verifyBrowser(directory: string, receipt: MatrixReceipt): Promise<unknown> {
  const knownFiles = new Set(await filesBelow(directory));
  const requests = new Set<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.add(path);
      const file = path === "/" ? "index.html" : path.slice(1);
      if (!knownFiles.has(file)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(join(directory, file)), { headers: { "cache-control": "no-store" } });
    },
  });
  try {
    const executablePath = await resolveFirstBrowserExecutable([
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ], "The Vite compatibility matrix requires an installed Chrome or Chromium executable");
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const context = await browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const failures: string[] = [];
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
        page.on("requestfailed", (request) => failures.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
        const origin = `http://127.0.0.1:${String(server.port)}`;
        await page.route("**/*", async (route) => {
          if (route.request().url().startsWith(`${origin}/`)) await route.continue();
          else { failures.push(`Unexpected external request: ${route.request().url()}`); await route.abort(); }
        });
        const response = await page.goto(origin, { waitUntil: "networkidle" });
        assert.equal(response?.status(), 200);
        await page.waitForFunction(() => document.querySelector('[data-hydrated="true"]') !== null
          && document.querySelector('[data-lazy="ready"]') !== null && document.querySelector('[data-secondary="ready"]') !== null);
        await page.getByRole("button", { name: "Count 0", exact: true }).click();
        await page.getByRole("button", { name: "Count 1", exact: true }).waitFor();
        const evidence = await page.evaluate(() => {
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
        assert.deepEqual(evidence, {
          client: "314159px", lazy: "271828px", secondary: "161803px", server: "141421px",
          foundation: "present", stylesheets: [receipt.foundationHref, "/stylex.css"], runtimeStyleElements: 0, packageTagDisplay: "inline-flex", count: "1",
        });
        assert.deepEqual(failures, [], "The matrix must report every unexpected browser error");
        for (const path of ["/", receipt.foundationHref, "/stylex.css", ...receipt.clientHrefs]) assert.ok(requests.has(path), `Browser did not request ${path}`);
        return { browser: browser.version(), evidence, requestedPaths: [...requests].sort() };
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } finally { await server.stop(true); }
}

assert.equal(Bun.version, "1.3.14");
const repository = await realpath(process.cwd());
const source = join(repository, "fixtures/vite8-adopter");
const sourceFiles = await filesBelow(source);
const fixtureRoot = join(repository, ".stylex-fixtures");
await mkdir(fixtureRoot, { recursive: true });
assert.ok((await lstat(fixtureRoot)).isDirectory());
assert.equal(await realpath(fixtureRoot), fixtureRoot);
const work = await realpath(await mkdtemp(join(fixtureRoot, "vite78-production-")));
let successful = false;
try {
  const node = nodeExecutable();
  const archive = join(work, "ui.tgz");
  const temporary = join(work, "tmp");
  await mkdir(temporary, { mode: 0o700 });
  const environment = { ...process.env, BUN_TMPDIR: temporary, TMPDIR: temporary, NODE_ENV: "production" };
  await run([process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository, environment);
  const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
  for (const version of VITE_VERSIONS) {
    const consumer = join(work, `vite-${version}`);
    await mkdir(consumer);
    for (const file of sourceFiles) await writeNew(join(consumer, file), await readFile(join(source, file)));
    await writeNew(join(consumer, "package.json"), `${JSON.stringify({
      name: "hraness-vite-production-compatibility", private: true, type: "module",
      dependencies: { ...PINNED, "@hraness/ui": `file:${archive}`, vite: version },
    }, null, 2)}\n`);
    await run([process.execPath, "install", "--ignore-scripts"], consumer, environment);
    for (const [name, expected] of Object.entries({ ...PINNED, vite: version })) {
      const metadata: unknown = JSON.parse(await readFile(join(consumer, "node_modules", name, "package.json"), "utf8"));
      assert.ok(typeof metadata === "object" && metadata !== null && "version" in metadata);
      assert.equal(metadata.version, expected, `Unexpected ${name} version`);
    }
    const lockHash = createHash("sha256").update(await readFile(join(consumer, "bun.lock"))).digest("hex");
    await run([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], consumer, environment);
    assert.equal(createHash("sha256").update(await readFile(join(consumer, "bun.lock"))).digest("hex"), lockHash);
    for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
      const config = `tsconfig.${moduleResolution}.json`;
      await writeNew(join(consumer, config), `${JSON.stringify({ compilerOptions: {
        exactOptionalPropertyTypes: true, lib: ["ES2023", "DOM", "DOM.Iterable"], module: moduleResolution === "Bundler" ? "Preserve" : "NodeNext",
        moduleResolution, noEmit: true, skipLibCheck: false, strict: true, target: "ES2023", types: ["node"], verbatimModuleSyntax: true,
      }, files: ["type-contract.ts"] })}\n`);
      await run([node, "./node_modules/typescript/bin/tsc", "-p", config], consumer, environment);
    }
    await run([node, "./build.mjs", version], consumer, environment);
    const receipt = parseReceipt(JSON.parse(await readFile(join(consumer, "matrix-receipt.json"), "utf8")), version);
    const browser = await verifyBrowser(join(consumer, receipt.finalDirectory), receipt);
    console.log(JSON.stringify({ archiveSha256: archiveHash, lockSha256: lockHash, receipt, browser }));
  }
  successful = true;
} catch (error) {
  console.error(`Vite 7/8 compatibility evidence retained at ${work}`);
  throw error;
} finally {
  if (successful) await rm(work, { recursive: true, force: true });
}
