import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

const route = "/index/manifest-proof";
const routeKey = `${route}/page`;
const manifestSuffix = "_client-reference-manifest.js";
const expectedManifest = `server/app${routeKey}${manifestSuffix}`;
const emittedManifest = `server/app/index${routeKey}${manifestSuffix}`;
const dependencies = { next: "16.2.12", react: "19.2.3", "react-dom": "19.2.3" } as const;
const devDependencies = { "@types/node": "24.13.3", "@types/react": "19.2.14", "@types/react-dom": "19.2.3", typescript: "6.0.3" } as const;
const frameworkInputs = {
  "dist/server/load-components.js": "cc12f798c766b643b05d2ca680d31a2c7a933fa38e18ce1174b1d9d0fc8ecac8",
  "dist/build/webpack/plugins/flight-manifest-plugin.js": "2da1604d0f0d8f58db53b486e880a81279f7ce9c7af429994c5c9083c6dca83c",
  "dist/shared/lib/page-path/normalize-page-path.js": "341bb66e308e93580e4b122dead46b45ff6afbe12237703c9546bab84b7cc834",
} as const;
const hash = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

/** Retain one bounded head/tail diagnostic, with incremental exact failure facts. */
export class FrameworkDiagnostic {
  #head = "";
  #tail = "";
  #pendingLine = "";
  #characters = 0;
  readonly prerenderRoutes = new Set<string>();
  readonly missingManifestRoutes = new Set<string>();
  compileFailure = false;
  lineOverflow = false;
  constructor(readonly limit = 32_768) { assert.ok(Number.isSafeInteger(limit) && limit >= 128); }
  append(text: string): void {
    this.#characters += text.length;
    const available = this.limit - this.#head.length;
    this.#head += text.slice(0, Math.max(0, available));
    this.#tail = (this.#tail + text.slice(Math.max(0, available))).slice(-this.limit);
    const lines = (this.#pendingLine + text).split("\n");
    this.#pendingLine = lines.pop() ?? "";
    for (const line of lines) this.#inspect(line);
    if (this.#pendingLine.length > 16_384) {
      this.lineOverflow = true;
      this.#pendingLine = this.#pendingLine.slice(-16_384);
    }
  }
  #inspect(raw: string): void {
    const line = raw.replace(/\u001b\[[0-9;]*m/gu, "");
    const add = (routes: Set<string>, value: string) => {
      assert.ok(routes.has(value) || routes.size < 32, "Framework diagnostic route count exceeds its bound");
      routes.add(value);
    };
    for (const match of line.matchAll(/Error occurred prerendering page "([^"\r\n]+)"\./gu)) add(this.prerenderRoutes, match[1]!);
    for (const match of line.matchAll(/Invariant: The client reference manifest for route "([^"\r\n]+)" does not exist\. This is a bug in Next\.js\./gu)) add(this.missingManifestRoutes, match[1]!);
    if (line.includes("Failed to compile.")) this.compileFailure = true;
  }
  finish(): void { this.#inspect(this.#pendingLine); this.#pendingLine = ""; }
  text(): string {
    const omitted = this.#characters - this.#head.length - this.#tail.length;
    return this.#head + (omitted > 0 ? `\n[${String(omitted)} diagnostic characters omitted]\n` : "") + this.#tail;
  }
  facts() {
    return { compileFailure: this.compileFailure, lineOverflow: this.lineOverflow,
      missingManifestRoutes: [...this.missingManifestRoutes].sort(), prerenderRoutes: [...this.prerenderRoutes].sort() };
  }
}

export function readClientManifestKey(text: string): string {
  assert.ok(text.length <= 2_097_152, "Client manifest exceeds its bound");
  const prefix = "globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[";
  assert.ok(text.startsWith(prefix) && text.endsWith(";"), "Unexpected native client manifest envelope");
  const match = /^("(?:[^"\\]|\\.)*")\]=/u.exec(text.slice(prefix.length));
  assert.ok(match !== null, "Native client manifest key is not a JSON string");
  const key: unknown = JSON.parse(match[1]!);
  assert.equal(typeof key, "string");
  const payload: unknown = JSON.parse(text.slice(prefix.length + match[0].length, -1));
  assert.ok(typeof payload === "object" && payload !== null && !Array.isArray(payload), "Native client manifest payload is not data");
  for (const name of ["moduleLoading", "ssrModuleMapping", "edgeSSRModuleMapping", "clientModules", "entryCSSFiles", "rscModuleMapping", "edgeRscModuleMapping"]) {
    assert.ok(Object.hasOwn(payload, name), `Native client manifest omitted ${name}`);
  }
  return key as string;
}

type CommandResult = Readonly<{
  command: readonly string[]; exitCode: number | null; signal: NodeJS.Signals | null;
  timedOut: boolean; interrupted: boolean; groupReleased: boolean;
  stdout: string; stderr: string;
  facts: ReturnType<FrameworkDiagnostic["facts"]>;
}>;
export function isExactFrameworkMismatch(result: Pick<CommandResult, "exitCode" | "signal" | "timedOut" | "interrupted" | "groupReleased" | "facts">, inventoryMatches: boolean): boolean {
  return result.exitCode === 1 && result.signal === null && !result.timedOut && !result.interrupted && result.groupReleased
    && !result.facts.compileFailure && !result.facts.lineOverflow && inventoryMatches
    && JSON.stringify(result.facts.prerenderRoutes) === JSON.stringify([route])
    && JSON.stringify(result.facts.missingManifestRoutes) === JSON.stringify([route]);
}

const delay = async (milliseconds: number): Promise<void> => { await new Promise((done) => setTimeout(done, milliseconds)); };
function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
async function releaseOwnedGroup(pid: number): Promise<boolean> {
  if (!groupExists(pid)) return true;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try { process.kill(-pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    for (let count = 0; count < 20; count += 1) {
      if (!groupExists(pid)) return true;
      await delay(100);
    }
  }
  return !groupExists(pid);
}

async function runOwned(command: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, signal: AbortSignal, timeoutMs: number): Promise<CommandResult> {
  assert.ok(process.platform !== "win32", "Framework baseline requires POSIX owned process groups");
  assert.ok(!signal.aborted, "Framework baseline was interrupted before child admission");
  assert.ok(command[0] !== undefined);
  const stdout = new FrameworkDiagnostic();
  const stderr = new FrameworkDiagnostic();
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  const child = spawn(command[0], command.slice(1), { cwd, env: environment, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let streamFailure: Error | undefined;
  const append = (log: FrameworkDiagnostic, decoder: StringDecoder, chunk: Buffer) => {
    if (streamFailure !== undefined) return;
    try { log.append(decoder.write(chunk)); }
    catch (error) { streamFailure = error instanceof Error ? error : new Error(String(error)); }
  };
  child.stdout.on("data", (chunk: Buffer) => append(stdout, stdoutDecoder, chunk));
  child.stderr.on("data", (chunk: Buffer) => append(stderr, stderrDecoder, chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, childSignal) => done({ code, signal: childSignal }));
  });
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let groupReleased = false;
  try {
    const outcome = await Promise.race([
      exited.then((result) => ({ kind: "exited" as const, result })),
      new Promise<{ kind: "timeout" }>((done) => { timer = setTimeout(() => done({ kind: "timeout" }), timeoutMs); }),
      new Promise<{ kind: "interrupted" }>((done) => {
        abort = () => done({ kind: "interrupted" });
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
    if (child.pid !== undefined) groupReleased = await releaseOwnedGroup(child.pid);
    assert.ok(groupReleased, "Owned framework child process group survived terminal collection");
    const result = outcome.kind === "exited" ? outcome.result : await Promise.race([
      exited, delay(2_000).then(() => { throw new Error("Owned framework leader did not report its exit"); }),
    ]);
    await Promise.race([closed, delay(2_000)]);
    stdout.append(stdoutDecoder.end()); stderr.append(stderrDecoder.end());
    stdout.finish(); stderr.finish();
    if (streamFailure !== undefined) throw streamFailure;
    const outFacts = stdout.facts(); const errFacts = stderr.facts();
    return { command, exitCode: result.code, signal: result.signal, timedOut: outcome.kind === "timeout", interrupted: outcome.kind === "interrupted", groupReleased,
      stdout: stdout.text(), stderr: stderr.text(), facts: {
        compileFailure: outFacts.compileFailure || errFacts.compileFailure, lineOverflow: outFacts.lineOverflow || errFacts.lineOverflow,
        missingManifestRoutes: [...new Set([...outFacts.missingManifestRoutes, ...errFacts.missingManifestRoutes])].sort(),
        prerenderRoutes: [...new Set([...outFacts.prerenderRoutes, ...errFacts.prerenderRoutes])].sort(),
      } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    if (!groupReleased && child.pid !== undefined) assert.ok(await releaseOwnedGroup(child.pid), "Owned framework process group remains active");
    child.stdout.destroy(); child.stderr.destroy();
  }
}

async function file(path: string, maximum = 2_097_152) {
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= maximum, `Expected bounded ordinary file: ${path}`);
  const contents = await readFile(path);
  assert.equal(contents.byteLength, info.size, `File changed while reading: ${path}`);
  return { bytes: contents.byteLength, sha256: hash(contents), contents };
}
async function optionalFile(path: string) {
  try { return await file(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function executableIdentity(path: string) {
  const before = await lstat(path);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 256 * 1024 * 1024, "Node executable must be a bounded ordinary file");
  const digest = createHash("sha256");
  let count = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65_536 })) {
    assert.ok(Buffer.isBuffer(chunk)); count += chunk.byteLength;
    assert.ok(count <= before.size, "Node executable grew during hashing"); digest.update(chunk);
  }
  const after = await lstat(path);
  assert.ok(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && count === before.size, "Node executable changed during hashing");
  return { bytes: count, sha256: digest.digest("hex") };
}
async function resolveNode24() {
  const candidates = [...new Set([...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => resolve(directory, "node")), "/opt/homebrew/opt/node@24/bin/node"])];
  assert.ok(candidates.length <= 128, "Node search path exceeds its bound");
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--input-type=commonjs", "--eval", 'if(typeof Bun!=="undefined"||process.release.name!=="node"||!process.versions.node.startsWith("24."))process.exit(1);process.stdout.write(process.version)'],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
    if (probe.status === 0 && /^v24\.\d+\.\d+$/u.test(probe.stdout)) {
      const path = await realpath(candidate);
      return { path, version: probe.stdout, executable: await executableIdentity(path) };
    }
  }
  throw new Error("Framework baseline requires a genuine Node 24 executable");
}

async function main(): Promise<void> {
  assert.equal(Bun.version, "1.3.14");
  assert.equal(await realpath(process.cwd()), await realpath(resolve(import.meta.dir, "..")), "Run the baseline from the UI checkout root");
  const root = await realpath(process.cwd());
  const fixtures = join(root, ".stylex-fixtures");
  await mkdir(fixtures, { recursive: true });
  const directory = await lstat(fixtures);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  const retained = await mkdtemp(join(fixtures, "next-framework-baseline-"));
  const consumer = join(retained, "consumer");
  const temporary = join(retained, "tmp");
  await mkdir(consumer, { mode: 0o700 }); await mkdir(temporary, { mode: 0o700 });
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const commands: CommandResult[] = [];
  const receipt: Record<string, unknown> = { kind: "next-framework-baseline", uiGatePassed: false, retained,
    route, routeKey, dependencies, devDependencies, commands, classification: "unexpected-failure" };
  let terminalCode = 1;
  try {
    const node = await resolveNode24();
    receipt.node = { path: node.path, version: node.version, bytes: node.executable.bytes, sha256: node.executable.sha256 };
    receipt.bun = Bun.version;
    const environment: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(node.path)}${delimiter}${process.env.PATH ?? ""}`, BUN_TMPDIR: temporary, TMPDIR: temporary, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", NODE_PATH: "" };
    for (const key of Object.keys(environment)) if (key.startsWith("HRANESS_STYLEX_") || key.startsWith("__NEXT_") || key.startsWith("NEXT_PRIVATE_") || key === "TURBOPACK") delete (environment as NodeJS.ProcessEnv)[key];
    // Keep scheduler memory limits, but reject preload/evaluation/module aliases.
    assert.ok((environment.NODE_OPTIONS ?? "").split(/\s+/u).filter(Boolean).every((option) => /^--max-(?:old|semi)-space-size=\d+$/u.test(option)), "Baseline NODE_OPTIONS may contain only scheduler heap limits");
    const sources: Record<string, string> = {
      "package.json": JSON.stringify({ name: "next-framework-index-baseline", private: true, type: "module", dependencies, devDependencies }, null, 2) + "\n",
      "next.config.mjs": 'export default { outputFileTracingRoot: process.cwd(), reactStrictMode: true };\n',
      "app/layout.tsx": 'import type { ReactNode } from "react";\nexport default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n',
      "app/page.tsx": 'export default function Page() { return <main data-next-framework-control="true">Framework control route</main>; }\n',
      "app/index/manifest-proof/page.tsx": 'export default function IndexManifestProof() { return <main data-next-index-manifest="true">Index manifest route</main>; }\n',
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, incremental: true, module: "esnext", esModuleInterop: true, moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", plugins: [{ name: "next" }] }, include: ["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts", "**/*.ts", "**/*.tsx"], exclude: ["node_modules"] }, null, 2) + "\n",
    };
    for (const [path, contents] of Object.entries(sources)) {
      await mkdir(dirname(join(consumer, path)), { recursive: true });
      await writeFile(join(consumer, path), contents, { flag: "wx", mode: 0o600 });
    }
    receipt.sources = Object.fromEntries(Object.entries(sources).map(([path, contents]) => [path, { bytes: Buffer.byteLength(contents), sha256: hash(contents) }]));
    const install = await runOwned([process.execPath, "install", "--ignore-scripts"], consumer, { ...environment, NODE_ENV: "development" }, controller.signal, 300_000);
    commands.push(install);
    assert.equal(install.exitCode, 0, "Vanilla baseline install failed");
    assert.ok(!install.timedOut && !install.interrupted && install.signal === null);
    const lock = await file(join(consumer, "bun.lock")); receipt.lock = { bytes: lock.bytes, sha256: lock.sha256 };
    for (const [name, version] of Object.entries({ ...dependencies, ...devDependencies })) {
      const manifest: unknown = JSON.parse((await file(join(consumer, "node_modules", name, "package.json"))).contents.toString("utf8"));
      assert.ok(typeof manifest === "object" && manifest !== null && "version" in manifest && manifest.version === version, `Installed ${name} version differs`);
    }
    const framework: Record<string, unknown> = {};
    for (const [path, expectedHash] of Object.entries(frameworkInputs)) {
      const input = await file(join(consumer, "node_modules/next", path));
      assert.equal(input.sha256, expectedHash, `Pinned Next framework source changed: ${path}`);
      framework[path] = { bytes: input.bytes, sha256: input.sha256 };
    }
    receipt.framework = framework;
    const build = await runOwned([node.path, join(consumer, "node_modules/next/dist/bin/next"), "build", "--webpack"], consumer, environment, controller.signal, 300_000);
    commands.push(build);
    for (const [path, contents] of Object.entries(sources)) assert.equal((await file(join(consumer, path))).sha256, hash(contents), `Framework baseline authored input changed: ${path}`);
    assert.equal((await file(join(consumer, "bun.lock"))).sha256, lock.sha256, "Framework build changed the installation lock");
    for (const [path, expectedHash] of Object.entries(frameworkInputs)) assert.equal((await file(join(consumer, "node_modules/next", path))).sha256, expectedHash, `Framework build changed pinned source: ${path}`);
    const output = join(consumer, ".next");
    const emitted = await optionalFile(join(output, emittedManifest));
    const expected = await optionalFile(join(output, expectedManifest));
    const control = await optionalFile(join(output, `server/app/page${manifestSuffix}`));
    const appPathsFile = await optionalFile(join(output, "server/app-paths-manifest.json"));
    const appPaths: unknown = appPathsFile === undefined ? undefined : JSON.parse(appPathsFile.contents.toString("utf8"));
    const emittedKey = emitted === undefined ? undefined : readClientManifestKey(emitted.contents.toString("utf8"));
    const controlKey = control === undefined ? undefined : readClientManifestKey(control.contents.toString("utf8"));
    const inventoryMatches = emitted !== undefined && expected === undefined && emittedKey === routeKey && controlKey === "/page"
      && typeof appPaths === "object" && appPaths !== null && Object.hasOwn(appPaths, routeKey)
      && Reflect.get(appPaths, routeKey) === `app/index${routeKey}.js`;
    const describe = (path: string, value: Awaited<ReturnType<typeof optionalFile>>) => ({ path, exists: value !== undefined, ...(value === undefined ? {} : { bytes: value.bytes, sha256: value.sha256 }) });
    receipt.manifests = { emitted: { ...describe(emittedManifest, emitted), routeKey: emittedKey }, readerExpected: describe(expectedManifest, expected),
      control: { ...describe(`server/app/page${manifestSuffix}`, control), routeKey: controlKey }, appPaths: describe("server/app-paths-manifest.json", appPathsFile), inventoryMatches };
    if (isExactFrameworkMismatch(build, inventoryMatches)) {
      receipt.classification = "expected-framework-failure";
      receipt.conclusion = "Pinned Next manifest writer and reader disagree for the static /index route. This does not pass the UI adapter gate.";
      terminalCode = 2;
    } else if (build.exitCode === 0 && build.signal === null && !build.timedOut && !build.interrupted && build.groupReleased) {
      receipt.classification = "baseline-build-succeeded";
      receipt.conclusion = "The minimal vanilla build did not reproduce the adapter fixture failure; investigate the remaining configuration delta. This is not UI adapter acceptance.";
      terminalCode = 0;
    } else throw new Error("Vanilla baseline failed outside the exact retained manifest-path mismatch");
  } catch (error) {
    receipt.error = (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 8_192);
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
    await writeFile(join(retained, "evidence.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ classification: receipt.classification, uiGatePassed: false, retained, exitCode: terminalCode, error: receipt.error }, null, 2));
    process.exitCode = terminalCode;
  }
}

if (import.meta.main) await main();
