import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, join, relative, sep } from "node:path";
import {
  createViteMatrixCustody, matrixDeadline, runViteMatrixCommand, writeViteMatrixSuccessReceipt,
} from "../fixtures/vite8-adopter/custody.ts";
import { resolveFirstBrowserExecutable } from "./browser-executable.ts";
import { runViteBrowserWorker } from "../fixtures/vite8-adopter/browser-control.ts";

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

async function fileIdentity(path: string): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function directoryIdentity(directory: string) {
  return Promise.all((await filesBelow(directory)).map(async (path) => ({ path, ...await fileIdentity(join(directory, path)) })));
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
  await runViteMatrixCommand(command, cwd, environment, custody);
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
    "copied-map-js", "copied-map-mjs", "copied-map-cjs",
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

async function verifyBrowser(directory: string, receipt: MatrixReceipt, node: string, consumer: string): Promise<unknown> {
  custody.check();
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
  const closeServer = custody.own("matrix HTTP server", async () => {
    await matrixDeadline(server.stop(true), 5_000, "Matrix HTTP server did not stop");
    assert.equal(server.pendingRequests, 0, "Matrix HTTP server retained requests after stopping");
  });
  try {
    const executablePath = await resolveFirstBrowserExecutable([
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? [process.env.CHROMIUM_EXECUTABLE_PATH] : []),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ], "The Vite compatibility matrix requires an installed Chrome or Chromium executable");
    const result = await runViteBrowserWorker(node, {
      schemaVersion: 1, mode: "acceptance", executablePath,
      origin: `http://127.0.0.1:${String(server.port)}`, foundationHref: receipt.foundationHref,
    }, consumer, custody);
    for (const path of ["/", receipt.foundationHref, "/stylex.css", ...receipt.clientHrefs]) {
      assert.ok(requests.has(path), `Browser did not request ${path}`);
    }
    custody.check();
    return { worker: result, requestedPaths: [...requests].sort() };
  } finally { await closeServer(); }
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
const custody = createViteMatrixCustody();
let successful = false;
try {
  custody.check();
  const inputPaths = [
    "package.json", "bun.lock", "scripts/vite8-adopter-smoke.ts", "scripts/browser-executable.ts",
    ...sourceFiles.map((path) => `fixtures/vite8-adopter/${path}`),
  ];
  const snapshotInputs = async () => Promise.all(inputPaths.map(async (path) => {
    return { path, ...await fileIdentity(join(repository, path)) };
  }));
  const inputs = await snapshotInputs();
  const node = nodeExecutable();
  const runtimes = { bun: await fileIdentity(process.execPath), node: await fileIdentity(node) };
  const archive = join(work, "ui.tgz");
  const temporary = join(work, "tmp");
  await mkdir(temporary, { mode: 0o700 });
  const environment = { ...process.env, BUN_TMPDIR: temporary, TMPDIR: temporary, NODE_ENV: "production" };
  await run([process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository, environment);
  const archiveHash = createHash("sha256").update(await readFile(archive)).digest("hex");
  const results: unknown[] = [];
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
    const finalDirectory = join(consumer, receipt.finalDirectory);
    const outputs = await directoryIdentity(finalDirectory);
    const browser = await verifyBrowser(finalDirectory, receipt, node, consumer);
    assert.deepEqual(await directoryIdentity(finalDirectory), outputs, "Matrix delivery changed during browser validation");
    const result = { archiveSha256: archiveHash, lockSha256: lockHash, receipt, outputs, browser };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await custody.close();
  custody.check();
  assert.equal(custody.activeResources, 0);
  assert.deepEqual(await filesBelow(source), sourceFiles, "Matrix fixture membership changed during validation");
  assert.deepEqual(await snapshotInputs(), inputs, "Matrix inputs changed during validation");
  assert.deepEqual({ bun: await fileIdentity(process.execPath), node: await fileIdentity(node) }, runtimes, "Matrix runtimes changed during validation");
  custody.check();
  const durable = await writeViteMatrixSuccessReceipt(join(fixtureRoot, "vite78-receipts"), `${basename(work)}.json`, {
    schemaVersion: 1, kind: "hraness-vite78-production-acceptance", state: "complete",
    archiveSha256: archiveHash, inputs, runtimes, results, custody: "all-owned-resources-collected",
  }, custody);
  successful = true;
  console.log(JSON.stringify({ successReceipt: durable }));
} catch (error) {
  console.error(`Vite 7/8 compatibility evidence retained at ${work}`);
  throw error;
} finally {
  await custody.close();
  custody.dispose();
  if (successful) {
    // The committed acceptance proof cannot be revoked by disposable cleanup.
    try { await rm(work, { recursive: true, force: true }); }
    catch { console.error(`Vite matrix passed; disposable consumer cleanup was incomplete at ${work}`); }
  }
}
