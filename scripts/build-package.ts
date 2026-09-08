import { dlopen, FFIType, read, type Pointer } from "bun:ffi";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  readFileSync,
  type BigIntStats,
} from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  artifactForFile,
  canonicalJson,
  compilerContract,
  compilerSha256,
  createStylexTransformCollector,
  serializeStylexRules,
  stylexRulesSha256,
  validateStylexPackageManifest,
  verifyCompilerContract,
} from "../build/compiler.js";
import {
  STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION,
  type StylexArtifactV1,
  type StylexPackageManifestV1,
} from "../build/contracts.js";
import { markReactClientPackage } from "./mark-react-client-package.js";

const COMPILER_STYLESHEET_PATHS = [
  "src/compiler-foundation.css",
  "src/compiler-reset.css",
  "src/components.css",
  "src/reset.css",
  "src/styles.css",
  "src/tokens.css",
] as const;
const PUBLIC_CSS_EXPORTS = {
  "./compiler-foundation.css": "./src/compiler-foundation.css",
  "./components.css": "./src/components.css",
  "./reset.css": "./src/reset.css",
  "./styles.css": "./src/styles.css",
  "./stylex.css": "./dist/stylex.css",
  "./tokens.css": "./src/tokens.css",
} as const;

function relativeBelow(root: string, path: string, description: string): string {
  const logical = relative(root, path).split(sep).join("/");
  assert.ok(
    logical.length > 0
      && logical !== ".."
      && !logical.startsWith("../")
      && !logical.startsWith("/"),
    `${description} escapes its output root`,
  );
  return logical;
}

function loaderFor(path: string): "js" | "jsx" | "ts" | "tsx" {
  switch (extname(path)) {
    case ".ts": return "ts";
    case ".tsx": return "tsx";
    case ".jsx": return "jsx";
    default: return "js";
  }
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Build output contains a symlink: ${relativeBelow(root, path, "output")}`);
    if (entry.isDirectory()) output.push(...await filesBelow(root, path));
    else {
      assert.ok(entry.isFile(), `Build output is not an ordinary file: ${relativeBelow(root, path, "output")}`);
      output.push(relativeBelow(root, path, "output"));
    }
  }
  return output.sort();
}

async function requireBuildSuccess(
  result: Awaited<ReturnType<typeof Bun.build>>,
  description: string,
): Promise<void> {
  if (!result.success) {
    throw new Error(`${description} failed:\n${result.logs.map(String).join("\n")}`);
  }
}

async function buildRuntime(repository: string, stage: string): Promise<{
  rules: ReturnType<ReturnType<typeof createStylexTransformCollector>["seal"]>;
  runtimePaths: readonly string[];
}> {
  const collector = createStylexTransformCollector(repository);
  const sourceRoot = resolve(repository, "src");
  const escapedSourceRoot = sourceRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const plugin: Bun.BunPlugin = {
    name: "hraness-ui-package-stylex",
    setup(build) {
      build.onLoad(
        { filter: new RegExp(`^${escapedSourceRoot}/.*\\.[cm]?[jt]sx?$`, "u") },
        async ({ path }) => {
          const source = await readFile(path, "utf8");
          const transformed = await collector.transform(source, path);
          return { contents: transformed.code, loader: loaderFor(path) };
        },
      );
    },
  };
  const result = await Bun.build({
    conditions: ["production", "browser", "module"],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [resolve(sourceRoot, "index.ts")],
    env: "disable",
    format: "esm",
    metafile: true,
    minify: true,
    naming: {
      asset: "assets/[name]-[hash].[ext]",
      chunk: "chunks/[name]-[hash].js",
      entry: "[name].js",
    },
    outdir: stage,
    packages: "external",
    plugins: [plugin],
    root: sourceRoot,
    splitting: true,
    target: "browser",
    throw: false,
  });
  await requireBuildSuccess(result, "UI runtime build");
  const rules = collector.seal();
  const outputPaths = await filesBelow(stage);
  assert.ok(outputPaths.length > 0, "UI runtime build emitted no artifacts");
  assert.deepEqual(
    outputPaths,
    result.outputs.map((output) => relativeBelow(stage, resolve(output.path), "runtime output")).sort(),
    "UI runtime result differs from settled output files",
  );
  assert.ok(outputPaths.every((path) => path.endsWith(".js")), "UI runtime build emitted an unexpected non-JavaScript artifact");
  await markReactClientPackage(stage, outputPaths);
  return { rules, runtimePaths: outputPaths };
}

async function buildTools(repository: string, stage: string): Promise<readonly string[]> {
  const sourceRoot = resolve(repository, "build");
  const outdir = resolve(stage, "build");
  const outputPaths: string[] = [];
  for (const entrypoint of ["index.ts", "bun.ts", "vite.ts", "next-dev.ts", "next-dev-session.ts", "next-output-settlement.ts"]) {
    const result = await Bun.build({
      entrypoints: [resolve(sourceRoot, entrypoint)],
      env: "disable",
      format: "esm",
      minify: true,
      naming: {
        asset: "assets/[name]-[hash].[ext]",
        chunk: "chunks/[name]-[hash].js",
        entry: "[name].js",
      },
      outdir,
      packages: "external",
      splitting: false,
      target: "node",
      throw: false,
    });
    await requireBuildSuccess(result, `StyleX build-tool build (${entrypoint})`);
    outputPaths.push(
      ...result.outputs.map((output) => relativeBelow(stage, resolve(output.path), "build-tool output")),
    );
  }
  const loaders = ["next-dev-loader.cjs", "next-dev-css-loader.cjs"] as const;
  for (const loader of loaders) {
    await writeFile(resolve(outdir, loader), await readFile(resolve(sourceRoot, loader)), { flag: "wx" });
    outputPaths.push(`build/${loader}`);
  }
  const paths = (await filesBelow(outdir)).map((path) => `build/${path}`);
  assert.deepEqual(
    paths,
    outputPaths.sort(),
    "Build-tool result differs from settled output files",
  );
  const expectedBuildTools = new Map([
    ["build/bun.js", {
      exports: ["STYLEX_BUN_ADAPTER_VERSION", "collectBunStylexGraph"],
      functions: ["collectBunStylexGraph"],
    }],
    ["build/index.js", {
      exports: [
        "STYLEX_COMPILER_CONTRACT_VERSION",
        "STYLEX_COMPLETE_RECORD_SCHEMA_VERSION",
        "STYLEX_GENERATION_SCHEMA_VERSION",
        "STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION",
        "STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION",
        "STYLEX_TEMPLATE_CSS_PLACEHOLDER",
        "artifactForFile",
        "canonicalJson",
        "compilerContract",
        "compilerSha256",
        "createStylexGeneration",
        "createStylexTransformCollector",
        "finalizeStylexGeneration",
        "parseStylexSourceMap",
        "prepareStylexProducedTemplate",
        "readStylexPackageManifest",
        "sealStylexProducedTemplate",
        "serializeStylexPackageRules",
        "serializeStylexRules",
        "stylexRulesSha256",
        "validateStylexPackageManifest",
      ],
      functions: [
        "artifactForFile",
        "canonicalJson",
        "createStylexGeneration",
        "createStylexTransformCollector",
        "finalizeStylexGeneration",
        "parseStylexSourceMap",
        "prepareStylexProducedTemplate",
        "readStylexPackageManifest",
        "sealStylexProducedTemplate",
        "serializeStylexPackageRules",
        "serializeStylexRules",
        "stylexRulesSha256",
        "validateStylexPackageManifest",
      ],
    }],
    ["build/vite.js", { exports: ["stylexVite"], functions: ["stylexVite"] }],
    ["build/next-dev.js", {
      exports: ["STYLEX_NEXT_DEV_CSS_ENTRY", "STYLEX_NEXT_DEV_VERSION", "withStylexNextDev"],
      functions: ["withStylexNextDev"],
    }],
    ["build/next-dev-session.js", {
      exports: [
        "STYLEX_NEXT_DEV_CONTEXT", "STYLEX_NEXT_DEV_CSS_ENTRY", "STYLEX_NEXT_DEV_EXTENSION_ALIASES", "STYLEX_NEXT_DEV_EXTENSIONS", "STYLEX_NEXT_DEV_VERSION",
        "assertNextDevRuntime", "auditNextDevCss", "composeNextDevSnapshot", "createNextDevRevisionCoordinator", "createNextDevSession", "isNextDevSource",
        "loadNextDevModule", "nextDevLogicalPath", "parseNextDevOptions", "renderNextDevCss", "requireNextDevSnapshot", "transformNextDevSource",
      ],
      functions: ["assertNextDevRuntime", "auditNextDevCss", "loadNextDevModule"],
    }],
    ["build/next-output-settlement.js", {
      exports: [
        "STYLEX_NEXT_OUTPUT_MAX_DIRECTORIES", "STYLEX_NEXT_OUTPUT_MAX_FILES", "STYLEX_NEXT_OUTPUT_MAX_PRIVATE_MAPS", "STYLEX_NEXT_OUTPUT_MAX_TEXT_BYTES",
        "STYLEX_NEXT_OUTPUT_MAX_TOTAL_BYTES", "STYLEX_NEXT_OUTPUT_SETTLEMENT_SCHEMA_VERSION", "STYLEX_NEXT_OUTPUT_SETTLEMENT_SCOPE",
        "revalidateStylexNextOutputSettlement", "settleStylexNextPrivateOutput",
      ],
      functions: ["revalidateStylexNextOutputSettlement", "settleStylexNextPrivateOutput"],
    }],
  ] as const);
  assert.deepEqual(paths, [...expectedBuildTools.keys(), ...loaders.map((loader) => `build/${loader}`)].sort(), "Build-tool build must emit exactly its reviewed entries and internal loaders");
  for (const loader of loaders) {
    assert.ok((await readFile(resolve(outdir, loader))).equals(await readFile(resolve(sourceRoot, loader))), `Next development loader bytes changed: ${loader}`);
  }
  for (const [entrypoint, contract] of expectedBuildTools) {
    const module: unknown = await import(pathToFileURL(resolve(stage, ...entrypoint.split("/"))).href);
    assert.ok(typeof module === "object" && module !== null, `Build-tool output did not load as a module: ${entrypoint}`);
    assert.deepEqual(Object.keys(module).sort(), [...contract.exports].sort(), `Build-tool public exports changed: ${entrypoint}`);
    for (const name of contract.functions) {
      assert.equal(
        typeof (module as Record<string, unknown>)[name],
        "function",
        `Build-tool output omitted callable export ${name}: ${entrypoint}`,
      );
    }
  }
  assert.ok(paths.every((path) => /\.[cm]?js$/u.test(path)), "Build-tool build emitted an unexpected non-JavaScript artifact");
  for (const path of paths) {
    assert.ok(
      !(await readFile(resolve(stage, ...path.split("/")), "utf8")).startsWith('"use client";'),
      `Build-tool artifact was client-marked: ${path}`,
    );
  }
  return paths;
}

async function artifacts(
  root: string,
  paths: readonly string[],
): Promise<readonly StylexArtifactV1[]> {
  return await Promise.all(
    [...paths]
      .sort()
      .map((path) => artifactForFile(root, path)),
  );
}

async function distArtifacts(
  root: string,
  paths: readonly string[],
): Promise<readonly StylexArtifactV1[]> {
  return (await artifacts(root, paths)).map((artifact) => ({
    ...artifact,
    path: `dist/${artifact.path}`,
  }));
}

async function writePackageManifest(
  repository: string,
  stage: string,
  runtimePaths: readonly string[],
  buildToolPaths: readonly string[],
  rules: StylexPackageManifestV1["rules"],
): Promise<void> {
  const rawPackage: unknown = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8"));
  assert.ok(typeof rawPackage === "object" && rawPackage !== null && !Array.isArray(rawPackage));
  const packageRecord = rawPackage as Record<string, unknown>;
  assert.ok(typeof packageRecord.name === "string" && typeof packageRecord.version === "string");
  assert.ok(
    typeof packageRecord.exports === "object"
      && packageRecord.exports !== null
      && !Array.isArray(packageRecord.exports),
    "Package exports must be an object",
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(packageRecord.exports).filter(([key]) => key.endsWith(".css")),
    ),
    PUBLIC_CSS_EXPORTS,
    "Build must publish exactly the six standards-based CSS entrypoints",
  );
  const manifest = validateStylexPackageManifest({
    buildTools: await distArtifacts(stage, buildToolPaths),
    compiler: compilerContract,
    compilerSha256,
    compilerFoundation: "src/compiler-foundation.css",
    kind: "hraness-stylex-package-manifest",
    package: { name: packageRecord.name, version: packageRecord.version },
    rules,
    rulesSha256: stylexRulesSha256(rules),
    runtime: await distArtifacts(stage, runtimePaths),
    schemaVersion: STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION,
    standaloneCss: {
      ...await artifactForFile(stage, "stylex.css"),
      path: "dist/stylex.css",
    },
    standaloneSerializer: compilerContract.serializer.useLayers,
    stylesheets: await artifacts(repository, COMPILER_STYLESHEET_PATHS),
  });
  const source = `${canonicalJson(manifest)}\n`;
  await writeFile(resolve(stage, "stylex-manifest.json"), source, { flag: "wx", mode: 0o644 });
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  });
}

type RenamePath = (source: string, destination: string) => Promise<void>;
type RemoveTree = (path: string) => Promise<void>;

const DIST_PROMOTION_LOCK_KIND = "hraness-ui-dist-promotion-lock";
const DIST_PROMOTION_STATE_KIND = "hraness-ui-dist-promotion-state";
const DIST_PROMOTION_LOCK_SCHEMA_VERSION = 6;
const LOCK_EX = 0x02;
const LOCK_NB = 0x04;
const EINTR = 4;

type DistPromotionPhase =
  | "committed"
  | "discarding-previous-dist"
  | "moving-previous-dist"
  | "prepared"
  | "previous-dist-discarded"
  | "previous-dist-moved"
  | "promoting-prepared-dist"
  | "recovering-previous-dist"
  | "released";

type DistPromotionDisposition = "active" | "recovery-required";

export interface DistPromotionLockRecord {
  readonly acquiredAt: string;
  readonly backupPath: string;
  readonly claimPath: string;
  readonly discardPath: string;
  readonly kind: typeof DIST_PROMOTION_LOCK_KIND;
  readonly phasePath: string;
  readonly pid: number;
  readonly previousDistDevice: string | null;
  readonly previousDistInode: string | null;
  readonly previousDistTreeEntries: readonly DirectoryTreeEntry[] | null;
  readonly previousDistTreeSha256: string | null;
  readonly processIdentity: string;
  readonly schemaVersion: typeof DIST_PROMOTION_LOCK_SCHEMA_VERSION;
  readonly stageDevice: string;
  readonly stageInode: string;
  readonly stagePath: string;
  readonly stageTreeSha256: string;
  readonly token: string;
}

interface DistPromotionStateRecord {
  readonly acquiredAt: string;
  readonly backupPath: string;
  readonly disposition: DistPromotionDisposition;
  readonly discardPath: string;
  readonly kind: typeof DIST_PROMOTION_STATE_KIND;
  readonly phase: DistPromotionPhase;
  readonly pid: number;
  readonly previousDistDevice: string | null;
  readonly previousDistInode: string | null;
  readonly previousDistTreeEntries: readonly DirectoryTreeEntry[] | null;
  readonly previousDistTreeSha256: string | null;
  readonly processIdentity: string;
  readonly schemaVersion: typeof DIST_PROMOTION_LOCK_SCHEMA_VERSION;
  readonly stageDevice: string;
  readonly stageInode: string;
  readonly stagePath: string;
  readonly stageTreeSha256: string;
  readonly token: string;
}

interface LockFileLease {
  readonly device: string;
  readonly inode: string;
  readonly path: string;
  readonly repository: string;
  readonly source: string;
}

interface AdvisoryLockLease extends LockFileLease {
  readonly handle: FileHandle;
  readonly key: string;
}

interface DistPromotionLockLease extends LockFileLease {
  readonly advisoryLock: AdvisoryLockLease;
  readonly backupPath: string;
  readonly claimPath: string;
  readonly discardPath: string;
  readonly phasePath: string;
  readonly stagePath: string;
  readonly token: string;
}

let nativeFlock: ((descriptor: number, operation: number) => number) | undefined;
let nativeErrnoLocation: (() => Pointer | null) | undefined;
const nativeLibraries: unknown[] = [];
const activeAdvisoryLocks = new Map<string, FileHandle>();

function advisoryCloseOnExecOpenFlag(): number {
  if (process.platform === "darwin") return 0x01000000;
  if (process.platform === "linux") return 0x00080000;
  throw new Error(`Dist promotion advisory locking is unsupported on ${process.platform}`);
}

function linuxLibcCandidates(): readonly string[] {
  const candidates: string[] = [];
  const append = (candidate: string): void => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  try {
    for (const line of readFileSync("/proc/self/maps", "utf8").split("\n")) {
      const pathStart = line.indexOf("/");
      if (pathStart < 0 || line.endsWith(" (deleted)")) continue;
      const path = line.slice(pathStart).replace(
        /\\([0-7]{3})/gu,
        (_, octal: string) => String.fromCodePoint(Number.parseInt(octal, 8)),
      );
      if (
        /\/(?:libc(?:-[^/]+)?\.so(?:\.[0-9]+)*|libc\.musl-[^/]+\.so(?:\.[0-9]+)*)$/u
          .test(path)
      ) append(path);
    }
  } catch {
    // Fall through to the platform-default loader names.
  }
  append("libc.so.6");
  if (process.arch === "x64") append("/lib/ld-musl-x86_64.so.1");
  if (process.arch === "arm64") append("/lib/ld-musl-aarch64.so.1");
  return candidates;
}

function initializeNativeLocking(): void {
  if (
    nativeFlock !== undefined
    && nativeErrnoLocation !== undefined
  ) return;
  if (process.platform === "darwin") {
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      __error: { args: [], returns: FFIType.ptr },
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
    nativeLibraries.push(library);
    nativeErrnoLocation = library.symbols.__error;
    nativeFlock = library.symbols.flock;
    return;
  }
  if (process.platform === "linux") {
    const failures: string[] = [];
    for (const candidate of linuxLibcCandidates()) {
      try {
        const library = dlopen(candidate, {
          __errno_location: { args: [], returns: FFIType.ptr },
          flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
        });
        nativeLibraries.push(library);
        nativeErrnoLocation = library.symbols.__errno_location;
        nativeFlock = library.symbols.flock;
        return;
      } catch (error) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Dist promotion could not load the host Linux libc (${failures.join("; ")})`);
  }
  throw new Error(`Dist promotion advisory locking is unsupported on ${process.platform}`);
}

function currentErrno(): number {
  initializeNativeLocking();
  const pointer = nativeErrnoLocation?.();
  if (pointer === undefined || pointer === null) {
    throw new Error("Dist promotion could not read the native errno");
  }
  return read.i32(pointer);
}

function tryAdvisoryLock(descriptor: number): boolean {
  initializeNativeLocking();
  for (;;) {
    if (nativeFlock?.(descriptor, LOCK_EX | LOCK_NB) === 0) return true;
    const errno = currentErrno();
    if (errno === EINTR) continue;
    if ((process.platform === "darwin" ? [35] : [11]).includes(errno)) return false;
    throw new Error(`Dist promotion flock failed with errno ${String(errno)}`);
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : undefined;
}

function validDistPromotionToken(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function validDeviceOrInode(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

async function processIdentity(pid: number): Promise<string | null> {
  if (process.platform === "linux") {
    try {
      const [bootId, stat] = await Promise.all([
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readFile(`/proc/${String(pid)}/stat`, "utf8"),
      ]);
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
      const startTicks = fields[19];
      if (startTicks !== undefined && /^\d+$/u.test(startTicks)) {
        return `linux-boot-start:${bootId.trim()}:${startTicks}`;
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return null;
    }
    return null;
  }
  if (process.platform !== "darwin") return null;
  const ps = Bun.spawn(["/bin/ps", "-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const sysctl = Bun.spawn(["/usr/sbin/sysctl", "-n", "kern.boottime"], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [psExitCode, psStdout, sysctlExitCode, sysctlStdout] = await Promise.all([
    ps.exited,
    new Response(ps.stdout).text(),
    sysctl.exited,
    new Response(sysctl.stdout).text(),
  ]);
  const startedAt = psStdout.trim();
  const bootTime = sysctlStdout.trim();
  if (
    psExitCode !== 0
    || sysctlExitCode !== 0
    || startedAt.length === 0
    || bootTime.length === 0
  ) return null;
  return `darwin-boot-start-sha256:${createHash("sha256")
    .update(bootTime)
    .update("\0")
    .update(startedAt)
    .digest("hex")}`;
}

async function currentProcessIdentity(): Promise<string> {
  const identity = await processIdentity(process.pid);
  assert.ok(identity !== null, `Could not establish process birth identity for ${String(process.pid)}`);
  return identity;
}

function parseDistPromotionLockRecord(source: string): DistPromotionLockRecord {
  const value: unknown = JSON.parse(source);
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Dist promotion lock must contain an object");
  const record = value as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(record).sort(),
    [
      "acquiredAt",
      "backupPath",
      "claimPath",
      "discardPath",
      "kind",
      "phasePath",
      "pid",
      "previousDistDevice",
      "previousDistInode",
      "previousDistTreeEntries",
      "previousDistTreeSha256",
      "processIdentity",
      "schemaVersion",
      "stageDevice",
      "stageInode",
      "stagePath",
      "stageTreeSha256",
      "token",
    ],
    "Dist promotion lock contains unexpected fields",
  );
  assert.ok(
    typeof record.acquiredAt === "string"
      && !Number.isNaN(Date.parse(record.acquiredAt))
      && new Date(record.acquiredAt).toISOString() === record.acquiredAt,
    "Dist promotion lock has an invalid acquisition time",
  );
  assert.ok(typeof record.backupPath === "string", "Dist promotion lock has an invalid backup path");
  assert.ok(typeof record.claimPath === "string", "Dist promotion lock has an invalid claim path");
  assert.ok(typeof record.discardPath === "string", "Dist promotion lock has an invalid discard path");
  assert.equal(record.kind, DIST_PROMOTION_LOCK_KIND, "Dist promotion lock has the wrong kind");
  assert.ok(typeof record.phasePath === "string", "Dist promotion lock has an invalid phase path");
  assert.ok(Number.isSafeInteger(record.pid) && Number(record.pid) > 0, "Dist promotion lock has an invalid process identifier");
  assert.ok(
    (record.previousDistDevice === null && record.previousDistInode === null)
      || (validDeviceOrInode(record.previousDistDevice) && validDeviceOrInode(record.previousDistInode)),
    "Dist promotion lock has an invalid previous-dist identity",
  );
  assert.ok(
    (record.previousDistDevice === null && record.previousDistTreeSha256 === null)
      || (record.previousDistDevice !== null && validSha256(record.previousDistTreeSha256)),
    "Dist promotion lock has an invalid previous-dist tree witness",
  );
  const previousDistTreeEntries = record.previousDistTreeEntries === null
    ? null
    : validateDirectoryTreeEntries(record.previousDistTreeEntries, "Dist promotion lock previous-dist tree");
  assert.equal(
    record.previousDistDevice === null,
    previousDistTreeEntries === null,
    "Dist promotion lock has inconsistent previous-dist tree entries",
  );
  if (previousDistTreeEntries !== null) {
    const rootEntry = previousDistTreeEntries[0];
    assert.ok(rootEntry?.kind === "directory", "Dist promotion lock previous-dist root entry is invalid");
    assert.deepEqual(
      { device: rootEntry.device, inode: rootEntry.inode },
      { device: record.previousDistDevice, inode: record.previousDistInode },
      "Dist promotion lock previous-dist root entry has the wrong identity",
    );
    assert.equal(
      directoryTreeSha256(previousDistTreeEntries),
      record.previousDistTreeSha256,
      "Dist promotion lock previous-dist tree entries do not match their hash",
    );
  }
  assert.ok(typeof record.processIdentity === "string" && record.processIdentity.length > 0, "Dist promotion lock has an invalid process identity");
  assert.equal(record.schemaVersion, DIST_PROMOTION_LOCK_SCHEMA_VERSION, "Dist promotion lock has the wrong schema version");
  assert.ok(validDeviceOrInode(record.stageDevice), "Dist promotion lock has an invalid stage device");
  assert.ok(validDeviceOrInode(record.stageInode), "Dist promotion lock has an invalid stage inode");
  assert.ok(typeof record.stagePath === "string", "Dist promotion lock has an invalid stage path");
  assert.ok(validSha256(record.stageTreeSha256), "Dist promotion lock has an invalid stage tree witness");
  assert.ok(validDistPromotionToken(record.token), "Dist promotion lock has an invalid owner token");
  assert.equal(record.backupPath, `.dist-backup-${String(record.token)}`, "Dist promotion lock backup is not token-derived");
  assert.equal(record.claimPath, `.dist-promotion-claim-${String(record.token)}.lock`, "Dist promotion lock claim is not token-derived");
  assert.equal(record.discardPath, `.dist-discard-${String(record.token)}`, "Dist promotion lock discard is not token-derived");
  assert.equal(record.phasePath, `.dist-promotion-state-${String(record.token)}.json`, "Dist promotion lock phase record is not token-derived");
  assert.ok(
    record.stagePath.startsWith(".dist-build-")
      && !record.stagePath.includes("/")
      && !record.stagePath.includes("\\"),
    "Dist promotion lock stage must be a direct build directory",
  );
  return record as unknown as DistPromotionLockRecord;
}

function parseDistPromotionStateRecord(source: string): DistPromotionStateRecord {
  const value: unknown = JSON.parse(source);
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Dist promotion state must contain an object");
  const record = value as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(record).sort(),
    [
      "acquiredAt",
      "backupPath",
      "discardPath",
      "disposition",
      "kind",
      "phase",
      "pid",
      "previousDistDevice",
      "previousDistInode",
      "previousDistTreeEntries",
      "previousDistTreeSha256",
      "processIdentity",
      "schemaVersion",
      "stageDevice",
      "stageInode",
      "stagePath",
      "stageTreeSha256",
      "token",
    ],
    "Dist promotion state contains unexpected fields",
  );
  assert.ok(
    typeof record.acquiredAt === "string"
      && !Number.isNaN(Date.parse(record.acquiredAt))
      && new Date(record.acquiredAt).toISOString() === record.acquiredAt,
    "Dist promotion state has an invalid acquisition time",
  );
  assert.ok(typeof record.backupPath === "string", "Dist promotion state has an invalid backup path");
  assert.ok(
    record.disposition === "active" || record.disposition === "recovery-required",
    "Dist promotion state has an invalid owner disposition",
  );
  assert.ok(typeof record.discardPath === "string", "Dist promotion state has an invalid discard path");
  assert.equal(record.kind, DIST_PROMOTION_STATE_KIND, "Dist promotion state has the wrong kind");
  assert.ok(
    record.phase === "committed"
      || record.phase === "discarding-previous-dist"
      || record.phase === "moving-previous-dist"
      || record.phase === "prepared"
      || record.phase === "previous-dist-discarded"
      || record.phase === "previous-dist-moved"
      || record.phase === "promoting-prepared-dist"
      || record.phase === "recovering-previous-dist"
      || record.phase === "released",
    "Dist promotion state has an invalid phase",
  );
  assert.ok(Number.isSafeInteger(record.pid) && Number(record.pid) > 0, "Dist promotion state has an invalid process identifier");
  assert.ok(
    (record.previousDistDevice === null && record.previousDistInode === null)
      || (validDeviceOrInode(record.previousDistDevice) && validDeviceOrInode(record.previousDistInode)),
    "Dist promotion state has an invalid previous-dist identity",
  );
  assert.ok(
    (record.previousDistDevice === null && record.previousDistTreeSha256 === null)
      || (record.previousDistDevice !== null && validSha256(record.previousDistTreeSha256)),
    "Dist promotion state has an invalid previous-dist tree witness",
  );
  const previousDistTreeEntries = record.previousDistTreeEntries === null
    ? null
    : validateDirectoryTreeEntries(record.previousDistTreeEntries, "Dist promotion state previous-dist tree");
  assert.equal(
    record.previousDistDevice === null,
    previousDistTreeEntries === null,
    "Dist promotion state has inconsistent previous-dist tree entries",
  );
  if (previousDistTreeEntries !== null) {
    const rootEntry = previousDistTreeEntries[0];
    assert.ok(rootEntry?.kind === "directory", "Dist promotion state previous-dist root entry is invalid");
    assert.deepEqual(
      { device: rootEntry.device, inode: rootEntry.inode },
      { device: record.previousDistDevice, inode: record.previousDistInode },
      "Dist promotion state previous-dist root entry has the wrong identity",
    );
    assert.equal(
      directoryTreeSha256(previousDistTreeEntries),
      record.previousDistTreeSha256,
      "Dist promotion state previous-dist tree entries do not match their hash",
    );
  }
  assert.ok(typeof record.processIdentity === "string" && record.processIdentity.length > 0, "Dist promotion state has an invalid process identity");
  assert.equal(record.schemaVersion, DIST_PROMOTION_LOCK_SCHEMA_VERSION, "Dist promotion state has the wrong schema version");
  assert.ok(validDeviceOrInode(record.stageDevice), "Dist promotion state has an invalid stage device");
  assert.ok(validDeviceOrInode(record.stageInode), "Dist promotion state has an invalid stage inode");
  assert.ok(typeof record.stagePath === "string", "Dist promotion state has an invalid stage path");
  assert.ok(validSha256(record.stageTreeSha256), "Dist promotion state has an invalid stage tree witness");
  assert.ok(validDistPromotionToken(record.token), "Dist promotion state has an invalid owner token");
  assert.equal(record.backupPath, `.dist-backup-${String(record.token)}`, "Dist promotion state backup is not token-derived");
  assert.equal(record.discardPath, `.dist-discard-${String(record.token)}`, "Dist promotion state discard is not token-derived");
  assert.ok(
    record.stagePath.startsWith(".dist-build-")
      && !record.stagePath.includes("/")
      && !record.stagePath.includes("\\"),
    "Dist promotion state stage must be a direct build directory",
  );
  return record as unknown as DistPromotionStateRecord;
}

export class DistPromotionLockConflictError extends Error {
  readonly lockPath: string;
  readonly owner: DistPromotionLockRecord;
  readonly state = "promotion-lock-held" as const;

  constructor(lockPath: string, owner: DistPromotionLockRecord) {
    super(`Dist promotion is already locked at ${lockPath} by process ${String(owner.pid)} (state: promotion-lock-held)`);
    this.name = "DistPromotionLockConflictError";
    this.lockPath = lockPath;
    this.owner = owner;
  }
}

export class DistPromotionLockIntegrityError extends Error {
  readonly lockPath: string;
  readonly state = "promotion-lock-integrity-failed" as const;

  constructor(lockPath: string, message: string, cause?: unknown) {
    super(`Dist promotion lock integrity failed at ${lockPath}: ${message} (state: promotion-lock-integrity-failed)`, cause === undefined ? undefined : { cause });
    this.name = "DistPromotionLockIntegrityError";
    this.lockPath = lockPath;
  }
}

export class DistPromotionLockReleaseRecoveryError extends AggregateError {
  readonly lockPath: string;
  readonly retainedPath: string;
  readonly state = "promotion-lock-release-recovery-required" as const;

  constructor(lockPath: string, retainedPath: string, errors: readonly unknown[]) {
    super(
      errors,
      `Dist promotion lock release could not safely complete or restore the detached identity; inspect ${lockPath} and retained ${retainedPath} (state: promotion-lock-release-recovery-required)`,
      { cause: errors[0] },
    );
    this.name = "DistPromotionLockReleaseRecoveryError";
    this.lockPath = lockPath;
    this.retainedPath = retainedPath;
  }
}

async function readOrdinaryFile(path: string, description: string): Promise<{
  readonly device: string;
  readonly inode: string;
  readonly source: string;
}> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`${description} is not an ordinary file: ${path}`);
    }
    const source = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat({ bigint: true });
    assert.deepEqual(
      {
        device: after.dev.toString(),
        inode: after.ino.toString(),
        mode: after.mode.toString(),
        size: after.size.toString(),
      },
      {
        device: before.dev.toString(),
        inode: before.ino.toString(),
        mode: before.mode.toString(),
        size: before.size.toString(),
      },
      `${description} descriptor changed while reading it: ${path}`,
    );
    const pathStat = await lstat(path, { bigint: true });
    assert.ok(pathStat.isFile() && !pathStat.isSymbolicLink(), `${description} is not an ordinary file: ${path}`);
    assert.deepEqual(
      { device: pathStat.dev.toString(), inode: pathStat.ino.toString() },
      { device: after.dev.toString(), inode: after.ino.toString() },
      `${description} pathname changed while reading it: ${path}`,
    );
    return {
      device: after.dev.toString(),
      inode: after.ino.toString(),
      source,
    };
  } finally {
    await handle.close();
  }
}

async function readOptionalOrdinaryFile(
  path: string,
  description: string,
): Promise<Awaited<ReturnType<typeof readOrdinaryFile>> | null> {
  try {
    return await readOrdinaryFile(path, description);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function readDistPromotionLock(lockPath: string): Promise<{
  readonly device: string;
  readonly inode: string;
  readonly owner: DistPromotionLockRecord;
  readonly source: string;
}> {
  let settled: Awaited<ReturnType<typeof readOrdinaryFile>>;
  try {
    settled = await readOrdinaryFile(lockPath, "Dist promotion lock");
  } catch (error) {
    throw new DistPromotionLockIntegrityError(lockPath, "the lock could not be read", error);
  }
  let owner: DistPromotionLockRecord;
  try {
    owner = parseDistPromotionLockRecord(settled.source);
  } catch (error) {
    throw new DistPromotionLockIntegrityError(lockPath, "the owner record is malformed", error);
  }
  if (settled.source !== `${canonicalJson(owner)}\n`) {
    throw new DistPromotionLockIntegrityError(lockPath, "the owner record is not byte-canonical");
  }
  return { ...settled, owner };
}

async function acquireAdvisoryLock(
  expected: LockFileLease,
  description: string,
): Promise<AdvisoryLockLease> {
  const handle = await open(
    expected.path,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | advisoryCloseOnExecOpenFlag(),
  );
  let key: string | undefined;
  let registered = false;
  try {
    const before = await handle.stat({ bigint: true });
    assert.ok(before.isFile(), `${description} must be an ordinary file: ${expected.path}`);
    const device = before.dev.toString();
    const inode = before.ino.toString();
    assert.deepEqual(
      { device, inode },
      { device: expected.device, inode: expected.inode },
      `${description} identity changed before advisory admission: ${expected.path}`,
    );
    key = `${device}:${inode}`;
    if (activeAdvisoryLocks.has(key) || !tryAdvisoryLock(handle.fd)) {
      throw new Error(`${description} is already owned by another process: ${expected.path}`);
    }
    activeAdvisoryLocks.set(key, handle);
    registered = true;
    const source = await handle.readFile({ encoding: "utf8" });
    const [after, canonical] = await Promise.all([
      handle.stat({ bigint: true }),
      readOrdinaryFile(expected.path, description),
    ]);
    assert.deepEqual(
      {
        device: after.dev.toString(),
        inode: after.ino.toString(),
        source,
      },
      {
        device: expected.device,
        inode: expected.inode,
        source: expected.source,
      },
      `${description} descriptor changed during advisory admission: ${expected.path}`,
    );
    assert.deepEqual(
      canonical,
      { device: expected.device, inode: expected.inode, source: expected.source },
      `${description} pathname changed during advisory admission: ${expected.path}`,
    );
    return { ...expected, handle, key };
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        `${description} advisory admission failed and its descriptor could not be closed`,
        { cause: error },
      );
    }
    if (registered && key !== undefined && activeAdvisoryLocks.get(key) === handle) {
      activeAdvisoryLocks.delete(key);
    }
    throw error;
  }
}

async function releaseAdvisoryLock(lease: AdvisoryLockLease): Promise<void> {
  assert.equal(
    activeAdvisoryLocks.get(lease.key),
    lease.handle,
    `Dist promotion advisory registration changed before release: ${lease.path}`,
  );
  await lease.handle.close();
  if (activeAdvisoryLocks.get(lease.key) === lease.handle) {
    activeAdvisoryLocks.delete(lease.key);
  }
}

async function unlinkOwnedPaths(paths: readonly string[]): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const path of paths) {
    try {
      await unlink(path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") failures.push(error);
    }
  }
  return failures;
}

async function writeSettledExclusiveFile(
  path: string,
  source: string,
): Promise<{ readonly device: string; readonly inode: string }> {
  const handle = await open(path, "wx", 0o600);
  const failures: unknown[] = [];
  let stat: Awaited<ReturnType<typeof handle.stat>> | undefined;
  try {
    await handle.writeFile(source);
    await handle.sync();
    stat = await handle.stat({ bigint: true });
  } catch (error) {
    failures.push(error);
  }
  try {
    await handle.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0 || stat === undefined) {
    failures.push(...await unlinkOwnedPaths([path]));
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(
      failures,
      `Exclusive file preparation failed and cleanup was incomplete at ${path}`,
      { cause: failures[0] },
    );
  }
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}

function stateRecord(
  owner: DistPromotionLockRecord,
  phase: DistPromotionPhase,
  disposition: DistPromotionDisposition,
): DistPromotionStateRecord {
  return {
    acquiredAt: owner.acquiredAt,
    backupPath: owner.backupPath,
    disposition,
    discardPath: owner.discardPath,
    kind: DIST_PROMOTION_STATE_KIND,
    phase,
    pid: owner.pid,
    previousDistDevice: owner.previousDistDevice,
    previousDistInode: owner.previousDistInode,
    previousDistTreeEntries: owner.previousDistTreeEntries,
    previousDistTreeSha256: owner.previousDistTreeSha256,
    processIdentity: owner.processIdentity,
    schemaVersion: DIST_PROMOTION_LOCK_SCHEMA_VERSION,
    stageDevice: owner.stageDevice,
    stageInode: owner.stageInode,
    stagePath: owner.stagePath,
    stageTreeSha256: owner.stageTreeSha256,
    token: owner.token,
  };
}

function assertMatchingState(
  owner: DistPromotionLockRecord,
  state: DistPromotionStateRecord,
): void {
  assert.deepEqual(
    {
      acquiredAt: state.acquiredAt,
      backupPath: state.backupPath,
      discardPath: state.discardPath,
      pid: state.pid,
      previousDistDevice: state.previousDistDevice,
      previousDistInode: state.previousDistInode,
      previousDistTreeEntries: state.previousDistTreeEntries,
      previousDistTreeSha256: state.previousDistTreeSha256,
      processIdentity: state.processIdentity,
      schemaVersion: state.schemaVersion,
      stageDevice: state.stageDevice,
      stageInode: state.stageInode,
      stagePath: state.stagePath,
      stageTreeSha256: state.stageTreeSha256,
      token: state.token,
    },
    {
      acquiredAt: owner.acquiredAt,
      backupPath: owner.backupPath,
      discardPath: owner.discardPath,
      pid: owner.pid,
      previousDistDevice: owner.previousDistDevice,
      previousDistInode: owner.previousDistInode,
      previousDistTreeEntries: owner.previousDistTreeEntries,
      previousDistTreeSha256: owner.previousDistTreeSha256,
      processIdentity: owner.processIdentity,
      schemaVersion: owner.schemaVersion,
      stageDevice: owner.stageDevice,
      stageInode: owner.stageInode,
      stagePath: owner.stagePath,
      stageTreeSha256: owner.stageTreeSha256,
      token: owner.token,
    },
    "Dist promotion state does not match its owner lock",
  );
}

async function readDistPromotionState(
  repository: string,
  owner: DistPromotionLockRecord,
): Promise<DistPromotionStateRecord> {
  const settled = await readOrdinaryFile(
    resolve(repository, owner.phasePath),
    "Dist promotion state",
  );
  const state = parseDistPromotionStateRecord(settled.source);
  assertMatchingState(owner, state);
  assert.equal(settled.source, `${canonicalJson(state)}\n`, "Dist promotion state is not byte-canonical");
  return state;
}

async function assertDistPromotionLease(lease: DistPromotionLockLease): Promise<void> {
  assert.ok(
    activeAdvisoryLocks.get(lease.advisoryLock.key) === lease.advisoryLock.handle,
    `Dist promotion advisory ownership is no longer active: ${lease.path}`,
  );
  assert.deepEqual(
    {
      device: lease.device,
      inode: lease.inode,
      path: lease.path,
      repository: lease.repository,
      source: lease.source,
    },
    {
      device: lease.advisoryLock.device,
      inode: lease.advisoryLock.inode,
      path: lease.advisoryLock.path,
      repository: lease.advisoryLock.repository,
      source: lease.advisoryLock.source,
    },
    `Dist promotion transaction lease differs from its advisory lease: ${lease.path}`,
  );
  const descriptor = await lease.advisoryLock.handle.stat({ bigint: true });
  assert.deepEqual(
    { device: descriptor.dev.toString(), inode: descriptor.ino.toString() },
    { device: lease.device, inode: lease.inode },
    `Dist promotion advisory descriptor identity changed: ${lease.path}`,
  );
  const settled = await readDistPromotionLock(lease.path);
  if (
    settled.device !== lease.device
    || settled.inode !== lease.inode
    || settled.source !== lease.source
  ) {
    throw new DistPromotionLockIntegrityError(
      lease.path,
      "the live lock is no longer the admitted owner lock",
    );
  }
}

async function updateDistPromotionState(
  lease: DistPromotionLockLease,
  phase: DistPromotionPhase,
  disposition?: DistPromotionDisposition,
): Promise<void> {
  await assertDistPromotionLease(lease);
  const owner = parseDistPromotionLockRecord(lease.source);
  const priorState = await readOrdinaryFile(
    lease.phasePath,
    "Current dist promotion state",
  );
  const currentState = await readDistPromotionState(lease.repository, owner);
  const temporaryPath = resolve(
    lease.repository,
    `.dist-promotion-state-${lease.token}-${randomUUID()}.tmp`,
  );
  const nextDisposition = disposition ?? currentState.disposition;
  const source = `${canonicalJson(stateRecord(owner, phase, nextDisposition))}\n`;
  await writeSettledExclusiveFile(temporaryPath, source);
  try {
    await assertDistPromotionLease(lease);
    assert.deepEqual(
      await readOrdinaryFile(lease.phasePath, "Current dist promotion state"),
      priorState,
      `Dist promotion phase record changed before update: ${lease.phasePath}`,
    );
    await rename(temporaryPath, lease.phasePath);
  } catch (error) {
    const cleanupFailures = await unlinkOwnedPaths([temporaryPath]);
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        `Dist promotion phase update failed and its temporary record was retained at ${temporaryPath}`,
        { cause: error },
      );
    }
    throw error;
  }
  const settled = await readDistPromotionState(lease.repository, owner);
  assert.equal(settled.phase, phase, "Dist promotion phase did not settle");
  assert.equal(settled.disposition, nextDisposition, "Dist promotion disposition did not settle");
}

async function markDistPromotionRecoveryRequired(
  lease: DistPromotionLockLease,
): Promise<void> {
  const owner = parseDistPromotionLockRecord(lease.source);
  const state = await readDistPromotionState(lease.repository, owner);
  await updateDistPromotionState(lease, state.phase, "recovery-required");
}

interface DirectoryIdentity {
  readonly device: string;
  readonly inode: string;
}

interface DirectoryTreeDigest extends DirectoryIdentity {
  readonly treeSha256: string;
}

interface DirectoryWitness extends DirectoryTreeDigest {
  readonly treeEntries: readonly DirectoryTreeEntry[];
}

type DirectoryTreeEntry =
  | {
      readonly device: string;
      readonly inode: string;
      readonly kind: "directory";
      readonly mode: number;
      readonly path: string;
    }
  | {
      readonly device: string;
      readonly inode: string;
      readonly kind: "file";
      readonly mode: number;
      readonly path: string;
      readonly sha256: string;
      readonly size: string;
    };

function validateDirectoryTreeEntries(
  value: unknown,
  description: string,
): readonly DirectoryTreeEntry[] {
  assert.ok(Array.isArray(value) && value.length > 0, `${description} must be a nonempty array`);
  let previousPath: string | undefined;
  for (const [index, item] of value.entries()) {
    assert.ok(typeof item === "object" && item !== null && !Array.isArray(item), `${description} entry must be an object`);
    const record = item as Record<string, unknown>;
    assert.ok(record.kind === "directory" || record.kind === "file", `${description} entry has an invalid kind`);
    assert.deepEqual(
      Object.keys(record).sort(),
      record.kind === "directory"
        ? ["device", "inode", "kind", "mode", "path"]
        : ["device", "inode", "kind", "mode", "path", "sha256", "size"],
      `${description} entry contains unexpected fields`,
    );
    assert.ok(validDeviceOrInode(record.device), `${description} entry has an invalid device`);
    assert.ok(validDeviceOrInode(record.inode), `${description} entry has an invalid inode`);
    assert.ok(Number.isInteger(record.mode) && Number(record.mode) >= 0 && Number(record.mode) <= 0o7777, `${description} entry has an invalid mode`);
    assert.ok(typeof record.path === "string", `${description} entry has an invalid path`);
    const path = String(record.path);
    if (index === 0) {
      assert.equal(path, ".", `${description} root entry must be first`);
      assert.equal(record.kind, "directory", `${description} root entry must be a directory`);
    } else {
      assert.ok(
        path.length > 0
          && path !== "."
          && path !== ".."
          && !path.startsWith("../")
          && !path.startsWith("/")
          && !path.includes("\\")
          && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
        `${description} entry has an invalid relative path`,
      );
      assert.ok(previousPath !== undefined && path > previousPath, `${description} entries are not strictly path-sorted`);
    }
    previousPath = path;
    if (record.kind === "file") {
      assert.ok(validSha256(record.sha256), `${description} file entry has an invalid content hash`);
      assert.ok(validDeviceOrInode(record.size), `${description} file entry has an invalid size`);
    }
  }
  return value as readonly DirectoryTreeEntry[];
}

function directoryTreeSha256(entries: readonly DirectoryTreeEntry[]): string {
  return createHash("sha256").update(canonicalJson(entries)).digest("hex");
}

function directoryWitnessIsDeletionOnlySubset(
  actual: DirectoryWitness | null,
  recordedEntries: readonly DirectoryTreeEntry[] | null,
): boolean {
  if (actual === null || recordedEntries === null) return false;
  const recordedByPath = new Map(
    recordedEntries.map((entry) => [entry.path, canonicalJson(entry)] as const),
  );
  return actual.treeEntries.every(
    (entry) => recordedByPath.get(entry.path) === canonicalJson(entry),
  );
}

function statSettlement(stat: BigIntStats): {
  readonly ctimeNs: string;
  readonly device: string;
  readonly inode: string;
  readonly mode: string;
  readonly mtimeNs: string;
  readonly size: string;
} {
  return {
    ctimeNs: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: stat.mode.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    size: stat.size.toString(),
  };
}

async function directoryTreeEntries(
  root: string,
  directory: string,
): Promise<readonly DirectoryTreeEntry[]> {
  const output: DirectoryTreeEntry[] = [];
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const logical = relativeBelow(root, path, "dist transaction tree entry");
    const pathStat = await lstat(path, { bigint: true });
    assert.ok(!pathStat.isSymbolicLink(), `Dist transaction tree contains a symlink: ${logical}`);
    if (pathStat.isDirectory()) {
      output.push({
        device: pathStat.dev.toString(),
        inode: pathStat.ino.toString(),
        kind: "directory",
        mode: Number(pathStat.mode & 0o7777n),
        path: logical,
      });
      output.push(...await directoryTreeEntries(root, path));
      const settledDirectory = await lstat(path, { bigint: true });
      assert.deepEqual(
        statSettlement(settledDirectory),
        statSettlement(pathStat),
        `Dist transaction directory changed while hashing it: ${logical}`,
      );
      continue;
    }
    assert.ok(pathStat.isFile(), `Dist transaction tree contains a non-file entry: ${logical}`);
    const handle = await open(path, "r");
    try {
      const before = await handle.stat({ bigint: true });
      assert.deepEqual(
        { device: before.dev.toString(), inode: before.ino.toString() },
        { device: pathStat.dev.toString(), inode: pathStat.ino.toString() },
        `Dist transaction file identity changed while opening it: ${logical}`,
      );
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const settledPath = await lstat(path, { bigint: true });
      assert.deepEqual(
        statSettlement(after),
        statSettlement(before),
        `Dist transaction file changed while reading it: ${logical}`,
      );
      assert.equal(after.size, BigInt(bytes.byteLength), `Dist transaction file read was incomplete: ${logical}`);
      assert.deepEqual(
        statSettlement(settledPath),
        statSettlement(after),
        `Dist transaction file path changed while hashing it: ${logical}`,
      );
      output.push({
        device: after.dev.toString(),
        inode: after.ino.toString(),
        kind: "file",
        mode: Number(after.mode & 0o7777n),
        path: logical,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: String(bytes.byteLength),
      });
    } finally {
      await handle.close();
    }
  }
  return output.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function ordinaryDirectoryWitness(
  path: string,
  description: string,
): Promise<DirectoryWitness | null> {
  const before = await ordinaryDirectoryIdentity(path, description);
  if (before === null) return null;
  const snapshot = async (): Promise<{
    readonly entries: readonly DirectoryTreeEntry[];
    readonly root: ReturnType<typeof statSettlement>;
  }> => {
    const rootBefore = await lstat(path, { bigint: true });
    const entries: DirectoryTreeEntry[] = [
      {
        device: rootBefore.dev.toString(),
        inode: rootBefore.ino.toString(),
        kind: "directory",
        mode: Number(rootBefore.mode & 0o7777n),
        path: ".",
      },
      ...await directoryTreeEntries(path, path),
    ];
    const rootAfter = await lstat(path, { bigint: true });
    assert.deepEqual(
      statSettlement(rootAfter),
      statSettlement(rootBefore),
      `${description} changed while hashing: ${path}`,
    );
    return { entries, root: statSettlement(rootAfter) };
  };
  const first = await snapshot();
  const second = await snapshot();
  assert.deepEqual(second, first, `${description} did not settle across two tree walks: ${path}`);
  assert.deepEqual(
    { device: second.root.device, inode: second.root.inode },
    before,
    `${description} identity changed while hashing: ${path}`,
  );
  return {
    ...before,
    treeEntries: second.entries,
    treeSha256: directoryTreeSha256(second.entries),
  };
}

export async function inspectDistPromotionDirectoryWitness(
  path: string,
): Promise<DirectoryWitness | null> {
  return ordinaryDirectoryWitness(path, "Dist promotion directory witness");
}

async function ordinaryDirectoryIdentity(
  path: string,
  description: string,
): Promise<DirectoryIdentity | null> {
  const inspect = async (): Promise<DirectoryIdentity | null> => {
    try {
      const stat = await lstat(path, { bigint: true });
      assert.ok(
        stat.isDirectory() && !stat.isSymbolicLink(),
        `${description} must be an ordinary directory: ${path}`,
      );
      return { device: stat.dev.toString(), inode: stat.ino.toString() };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    }
  };
  const first = await inspect();
  if (first !== null) return first;
  const second = await inspect();
  assert.equal(second, null, `${description} appeared while proving absence: ${path}`);
  return null;
}

function sameDirectoryIdentity(
  actual: DirectoryIdentity | null,
  device: string | null,
  inode: string | null,
): boolean {
  return actual !== null
    && device !== null
    && inode !== null
    && actual.device === device
    && actual.inode === inode;
}

function sameDirectoryWitness(
  actual: DirectoryWitness | null,
  device: string | null,
  inode: string | null,
  treeSha256: string | null,
): boolean {
  return sameDirectoryIdentity(actual, device, inode)
    && treeSha256 !== null
    && actual?.treeSha256 === treeSha256;
}

async function assertDirectoryWitness(
  path: string,
  expected: DirectoryTreeDigest,
  description: string,
): Promise<void> {
  const actual = await ordinaryDirectoryWitness(path, description);
  assert.deepEqual(
    actual === null
      ? null
      : { device: actual.device, inode: actual.inode, treeSha256: actual.treeSha256 },
    expected,
    `${description} tree witness changed: ${path}`,
  );
}

async function assertDirectoryAbsent(path: string, description: string): Promise<void> {
  assert.equal(
    await ordinaryDirectoryIdentity(path, description),
    null,
    `${description} unexpectedly exists: ${path}`,
  );
}

async function acquireDistPromotionLock(
  repository: string,
  stage: string,
): Promise<DistPromotionLockLease> {
  const root = resolve(repository);
  const settledStage = resolve(stage);
  const stagePath = relativeBelow(root, settledStage, "dist build stage");
  assert.ok(
    !stagePath.includes("/") && stagePath.startsWith(".dist-build-"),
    "Dist build stage must be a direct tokenized repository directory",
  );
  const stageWitness = await ordinaryDirectoryWitness(settledStage, "Dist build stage");
  assert.ok(stageWitness !== null, "Dist build stage must exist");
  const previousDist = await ordinaryDirectoryWitness(resolve(root, "dist"), "Existing dist");
  const token = randomUUID();
  const owner: DistPromotionLockRecord = {
    acquiredAt: new Date().toISOString(),
    backupPath: `.dist-backup-${token}`,
    claimPath: `.dist-promotion-claim-${token}.lock`,
    discardPath: `.dist-discard-${token}`,
    kind: DIST_PROMOTION_LOCK_KIND,
    phasePath: `.dist-promotion-state-${token}.json`,
    pid: process.pid,
    previousDistDevice: previousDist?.device ?? null,
    previousDistInode: previousDist?.inode ?? null,
    previousDistTreeEntries: previousDist?.treeEntries ?? null,
    previousDistTreeSha256: previousDist?.treeSha256 ?? null,
    processIdentity: await currentProcessIdentity(),
    schemaVersion: DIST_PROMOTION_LOCK_SCHEMA_VERSION,
    stageDevice: stageWitness.device,
    stageInode: stageWitness.inode,
    stagePath,
    stageTreeSha256: stageWitness.treeSha256,
    token,
  };
  const source = `${canonicalJson(owner)}\n`;
  const claimPath = resolve(root, owner.claimPath);
  const lockPath = resolve(root, ".dist-promotion.lock");
  const phasePath = resolve(root, owner.phasePath);
  let statePrepared = false;
  let claimPrepared = false;
  let linked = false;
  let advisoryLock: AdvisoryLockLease | undefined;
  let claimStat: Awaited<ReturnType<typeof writeSettledExclusiveFile>> | undefined;
  let stateStat: Awaited<ReturnType<typeof writeSettledExclusiveFile>> | undefined;
  try {
    stateStat = await writeSettledExclusiveFile(
      phasePath,
      `${canonicalJson(stateRecord(owner, "prepared", "active"))}\n`,
    );
    statePrepared = true;
    claimStat = await writeSettledExclusiveFile(claimPath, source);
    claimPrepared = true;
    for (;;) {
      try {
        await link(claimPath, lockPath);
        linked = true;
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        try {
          const current = await readDistPromotionLock(lockPath);
          throw new DistPromotionLockConflictError(lockPath, current.owner);
        } catch (lockError) {
          if (errorCode(lockError) === "ENOENT") continue;
          throw lockError;
        }
      }
    }
    const settled = await readDistPromotionLock(lockPath);
    assert.ok(claimStat !== undefined, "Dist promotion claim was not prepared");
    if (
      settled.device !== claimStat.device
      || settled.inode !== claimStat.inode
      || settled.source !== source
    ) {
      throw new DistPromotionLockIntegrityError(lockPath, `the admitted lock differs from its settled claim ${claimPath}`);
    }
    advisoryLock = await acquireAdvisoryLock(
      {
        device: settled.device,
        inode: settled.inode,
        path: lockPath,
        repository: root,
        source: settled.source,
      },
      "Dist promotion owner lock",
    );
    await releaseOptionalOwnedLockPathOrVerifyRetained({
      device: claimStat.device,
      inode: claimStat.inode,
      path: claimPath,
      repository: root,
      source,
    });
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    let canonicalReleased = !linked;
    if (linked && claimStat !== undefined && advisoryLock !== undefined) {
      try {
        await releaseDistPromotionLock({
          device: claimStat.device,
          inode: claimStat.inode,
          path: lockPath,
          repository: root,
          source,
        });
        canonicalReleased = true;
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
        if (advisoryLock !== undefined) {
          try {
            await markDistPromotionRecoveryRequired({
              advisoryLock,
              backupPath: resolve(root, owner.backupPath),
              claimPath,
              discardPath: resolve(root, owner.discardPath),
              device: claimStat.device,
              inode: claimStat.inode,
              path: lockPath,
              phasePath,
              repository: root,
              source,
              stagePath: settledStage,
              token,
            });
          } catch (markError) {
            cleanupFailures.push(markError);
          }
        }
      }
    }
    if (canonicalReleased && statePrepared && stateStat !== undefined) {
      try {
        await releaseDistPromotionLock({
          device: stateStat.device,
          inode: stateStat.inode,
          path: phasePath,
          repository: root,
          source: `${canonicalJson(stateRecord(owner, "prepared", "active"))}\n`,
        });
        statePrepared = false;
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (claimPrepared && claimStat !== undefined) {
      try {
        await releaseOptionalOwnedLockPath({
          device: claimStat.device,
          inode: claimStat.inode,
          path: claimPath,
          repository: root,
          source,
        });
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    // The advisory descriptor remains open until every owned pathname has
    // either been released or retained with a recovery disposition.
    if (advisoryLock !== undefined) {
      try {
        await releaseAdvisoryLock(advisoryLock);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        `Dist promotion lock acquisition failed and owned preparation paths were retained`,
        { cause: error },
      );
    }
    throw error;
  }
  assert.ok(claimStat !== undefined, "Dist promotion claim was not prepared");
  assert.ok(advisoryLock !== undefined, "Dist promotion advisory lock was not admitted");
  return {
    advisoryLock,
    backupPath: resolve(root, owner.backupPath),
    claimPath,
    discardPath: resolve(root, owner.discardPath),
    device: claimStat.device,
    inode: claimStat.inode,
    path: lockPath,
    phasePath,
    repository: root,
    source,
    stagePath: settledStage,
    token,
  };
}

async function restoreDetachedLock(
  lease: LockFileLease,
  detachedPath: string,
  releaseDirectory: string,
  releaseError: unknown,
): Promise<never> {
  const recoveryErrors: unknown[] = [releaseError];
  try {
    await link(detachedPath, lease.path);
  } catch (error) {
    recoveryErrors.push(error);
    throw new DistPromotionLockReleaseRecoveryError(
      lease.path,
      detachedPath,
      recoveryErrors,
    );
  }
  try {
    const [restored, retained] = await Promise.all([
      readOrdinaryFile(lease.path, "Restored dist promotion lock"),
      readOrdinaryFile(detachedPath, "Retained dist promotion lock"),
    ]);
    assert.deepEqual(
      { device: restored.device, inode: restored.inode, source: restored.source },
      { device: lease.device, inode: lease.inode, source: lease.source },
      "Restored lock identity differs from the detached lock",
    );
    assert.deepEqual(
      { device: retained.device, inode: retained.inode, source: retained.source },
      { device: lease.device, inode: lease.inode, source: lease.source },
      "Retained lock identity differs from the detached lock",
    );
    await unlink(detachedPath);
    await rmdir(releaseDirectory);
  } catch (error) {
    recoveryErrors.push(error);
    throw new DistPromotionLockReleaseRecoveryError(
      lease.path,
      detachedPath,
      recoveryErrors,
    );
  }
  throw new DistPromotionLockIntegrityError(
    lease.path,
    "a displaced lock identity was restored without clobbering it",
    releaseError,
  );
}

async function restoreUnreadableDetachedLock(
  lease: LockFileLease,
  detachedPath: string,
  releaseDirectory: string,
  releaseError: unknown,
): Promise<never> {
  const recoveryErrors: unknown[] = [releaseError];
  try {
    // link(2) restores ordinary special files and symlinks without replacing a
    // newer canonical owner. Directories cannot be hard-linked and fall back
    // to an exclusive integrity sentinel below.
    await link(detachedPath, lease.path);
  } catch (error) {
    recoveryErrors.push(error);
    if (errorCode(error) !== "EEXIST") {
      try {
        await writeFile(
          lease.path,
          `${canonicalJson({
            kind: "hraness-ui-dist-promotion-integrity-sentinel",
            retainedPath: relativeBelow(lease.repository, detachedPath, "retained dist promotion lock"),
            schemaVersion: 1,
          })}\n`,
          { flag: "wx", mode: 0o600 },
        );
      } catch (sentinelError) {
        recoveryErrors.push(sentinelError);
      }
    }
    throw new DistPromotionLockReleaseRecoveryError(
      lease.path,
      detachedPath,
      recoveryErrors,
    );
  }
  try {
    await unlink(detachedPath);
    await rmdir(releaseDirectory);
  } catch (error) {
    recoveryErrors.push(error);
    throw new DistPromotionLockReleaseRecoveryError(
      lease.path,
      detachedPath,
      recoveryErrors,
    );
  }
  throw new DistPromotionLockIntegrityError(
    lease.path,
    "a displaced unreadable or nonordinary lock identity was restored without clobbering it",
    releaseError,
  );
}

async function releaseDistPromotionLock(
  lease: LockFileLease,
  renamePath: RenamePath = rename,
  allowMissing = false,
): Promise<void> {
  const releaseDirectory = await mkdtemp(resolve(lease.repository, ".dist-promotion-release-"));
  const detachedPath = resolve(releaseDirectory, "owner.lock");
  try {
    await renamePath(lease.path, detachedPath);
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    try {
      await rmdir(releaseDirectory);
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (allowMissing && errorCode(error) === "ENOENT" && cleanupFailures.length === 0) return;
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        `Dist promotion owner lock could not be detached and its release directory was retained at ${releaseDirectory}`,
        { cause: error },
      );
    }
    throw new DistPromotionLockIntegrityError(lease.path, "the owner lock could not be atomically detached", error);
  }
  let detached: Awaited<ReturnType<typeof readOrdinaryFile>>;
  try {
    detached = await readOrdinaryFile(detachedPath, "Detached dist promotion lock");
  } catch (error) {
    return restoreUnreadableDetachedLock(
      lease,
      detachedPath,
      releaseDirectory,
      error,
    );
  }
  if (
    detached.device !== lease.device
    || detached.inode !== lease.inode
    || detached.source !== lease.source
  ) {
    return restoreDetachedLock(
      {
        device: detached.device,
        inode: detached.inode,
        path: lease.path,
        repository: lease.repository,
        source: detached.source,
      },
      detachedPath,
      releaseDirectory,
      new Error("Detached lock identity differs from the admitted owner lock"),
    );
  }
  try {
    await unlink(detachedPath);
  } catch (error) {
    return restoreDetachedLock(lease, detachedPath, releaseDirectory, error);
  }
  try {
    await rmdir(releaseDirectory);
  } catch (error) {
    throw new DistPromotionLockIntegrityError(
      lease.path,
      `the detached owner was released but its empty release directory was retained at ${releaseDirectory}`,
      error,
    );
  }
}

async function releaseOptionalOwnedLockPath(lease: LockFileLease): Promise<void> {
  await releaseDistPromotionLock(lease, rename, true);
}

async function releaseOptionalOwnedLockPathOrVerifyRetained(
  lease: LockFileLease,
): Promise<void> {
  try {
    await releaseOptionalOwnedLockPath(lease);
  } catch (error) {
    // Admission may proceed with a redundant claim only when it still names
    // the exact owner. A detached claim or foreign replacement is not safe.
    if (error instanceof DistPromotionLockReleaseRecoveryError) throw error;
    let retained: Awaited<ReturnType<typeof readOptionalOrdinaryFile>>;
    try {
      retained = await readOptionalOrdinaryFile(lease.path, "Retained dist promotion claim");
    } catch (inspectionError) {
      throw new AggregateError(
        [error, inspectionError],
        `Dist promotion claim release failed and its retained identity could not be proved: ${lease.path}`,
        { cause: error },
      );
    }
    if (
      retained !== null
      && retained.device === lease.device
      && retained.inode === lease.inode
      && retained.source === lease.source
    ) return;
    throw error;
  }
}

export interface DistPromotionRecoveryInspection {
  readonly backupPath: string;
  readonly backupPresent: boolean;
  readonly backupMatchesPreviousDist: boolean;
  readonly claimPath: string;
  readonly claimMatchesOwner: boolean;
  readonly claimPresent: boolean;
  readonly destinationPath: string;
  readonly destinationPresent: boolean;
  readonly destinationMatchesPreviousDist: boolean;
  readonly destinationMatchesStage: boolean;
  readonly discardMatchesPreviousDistRoot: boolean;
  readonly discardMatchesPreviousDist: boolean;
  readonly discardIsRecordedDeletionSubset: boolean;
  readonly discardPath: string;
  readonly discardPresent: boolean;
  readonly lockPath: string;
  readonly owner: DistPromotionLockRecord;
  readonly ownerDisposition: DistPromotionDisposition;
  readonly ownerStatus: "active" | "absent" | "unknown";
  readonly phase: DistPromotionPhase;
  readonly phasePath: string;
  readonly stagePath: string;
  readonly stagePresent: boolean;
  readonly stageMatchesStage: boolean;
}

export class DistPromotionRecoveryRefusedError extends Error {
  readonly inspection: DistPromotionRecoveryInspection;
  readonly state = "promotion-recovery-refused" as const;

  constructor(inspection: DistPromotionRecoveryInspection, message: string) {
    super(`Dist promotion recovery refused: ${message} (state: promotion-recovery-refused)`);
    this.name = "DistPromotionRecoveryRefusedError";
    this.inspection = inspection;
  }
}

async function distPromotionOwnerStatus(
  pid: number,
  expectedIdentity: string,
): Promise<"active" | "absent" | "unknown"> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (errorCode(error) === "ESRCH") return "absent";
    if (errorCode(error) === "EPERM") return "active";
    return "unknown";
  }
  const actualIdentity = await processIdentity(pid);
  if (actualIdentity === null) return "unknown";
  return actualIdentity === expectedIdentity ? "active" : "absent";
}

export async function inspectDistPromotionRecovery(
  repository: string,
): Promise<DistPromotionRecoveryInspection> {
  const root = resolve(repository);
  const rootStat = await lstat(root);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Repository must be an ordinary directory");
  const lockPath = resolve(root, ".dist-promotion.lock");
  const settled = await readDistPromotionLock(lockPath);
  const owner = settled.owner;
  const phasePath = resolve(root, owner.phasePath);
  const stagePath = resolve(root, owner.stagePath);
  const backupPath = resolve(root, owner.backupPath);
  const claimPath = resolve(root, owner.claimPath);
  const discardPath = resolve(root, owner.discardPath);
  const state = await readDistPromotionState(root, owner);
  const destinationPath = resolve(root, "dist");
  const [backup, claim, destination, discard, stage, ownerStatus] = await Promise.all([
    ordinaryDirectoryWitness(backupPath, "Recorded dist backup"),
    readOptionalOrdinaryFile(claimPath, "Recorded dist claim"),
    ordinaryDirectoryWitness(destinationPath, "Dist destination"),
    ordinaryDirectoryWitness(discardPath, "Recorded dist discard"),
    ordinaryDirectoryWitness(stagePath, "Recorded dist stage"),
    distPromotionOwnerStatus(owner.pid, owner.processIdentity),
  ]);
  return {
    backupPath,
    backupPresent: backup !== null,
    backupMatchesPreviousDist: sameDirectoryWitness(
      backup,
      owner.previousDistDevice,
      owner.previousDistInode,
      owner.previousDistTreeSha256,
    ),
    claimPath,
    claimMatchesOwner: claim !== null
      && claim.device === settled.device
      && claim.inode === settled.inode
      && claim.source === settled.source,
    claimPresent: claim !== null,
    destinationPath,
    destinationPresent: destination !== null,
    destinationMatchesPreviousDist: sameDirectoryWitness(
      destination,
      owner.previousDistDevice,
      owner.previousDistInode,
      owner.previousDistTreeSha256,
    ),
    destinationMatchesStage: sameDirectoryWitness(
      destination,
      owner.stageDevice,
      owner.stageInode,
      owner.stageTreeSha256,
    ),
    discardMatchesPreviousDist: sameDirectoryWitness(
      discard,
      owner.previousDistDevice,
      owner.previousDistInode,
      owner.previousDistTreeSha256,
    ),
    discardMatchesPreviousDistRoot: sameDirectoryIdentity(
      discard,
      owner.previousDistDevice,
      owner.previousDistInode,
    ),
    discardIsRecordedDeletionSubset: directoryWitnessIsDeletionOnlySubset(
      discard,
      owner.previousDistTreeEntries,
    ),
    discardPath,
    discardPresent: discard !== null,
    lockPath,
    owner,
    ownerDisposition: state.disposition,
    ownerStatus,
    phase: state.phase,
    phasePath,
    stagePath,
    stagePresent: stage !== null,
    stageMatchesStage: sameDirectoryWitness(
      stage,
      owner.stageDevice,
      owner.stageInode,
      owner.stageTreeSha256,
    ),
  };
}

async function acquireDistPromotionRecoveryLock(
  repository: string,
  token: string,
): Promise<AdvisoryLockLease> {
  const root = resolve(repository);
  const lockPath = resolve(root, ".dist-promotion.lock");
  const settled = await readDistPromotionLock(lockPath);
  if (settled.owner.token !== token) {
    throw new Error(`Dist promotion owner token changed before recovery admission: ${lockPath}`);
  }
  return acquireAdvisoryLock(
    {
      device: settled.device,
      inode: settled.inode,
      path: lockPath,
      repository: root,
      source: settled.source,
    },
    "Dist promotion recovery lease",
  );
}

export async function recoverInterruptedDistPromotion(
  repository: string,
  expectedToken: string,
  hooks: {
    readonly afterAdvisoryLock?: () => Promise<void>;
  } = {},
): Promise<"completed-new-dist" | "released-untouched" | "restored-previous-dist"> {
  assert.ok(validDistPromotionToken(expectedToken), "Expected recovery token must be a version-4 UUID");
  const root = resolve(repository);
  const recoveryLease = await acquireDistPromotionRecoveryLock(root, expectedToken);
  let failure: unknown;
  let failed = false;
  let result: "completed-new-dist" | "released-untouched" | "restored-previous-dist" | undefined;
  try {
    await hooks.afterAdvisoryLock?.();
    const recoveryOwner = parseDistPromotionLockRecord(recoveryLease.source);
    const lease: DistPromotionLockLease = {
      advisoryLock: recoveryLease,
      backupPath: resolve(root, recoveryOwner.backupPath),
      claimPath: resolve(root, recoveryOwner.claimPath),
      discardPath: resolve(root, recoveryOwner.discardPath),
      device: recoveryLease.device,
      inode: recoveryLease.inode,
      path: recoveryLease.path,
      phasePath: resolve(root, recoveryOwner.phasePath),
      repository: root,
      source: recoveryLease.source,
      stagePath: resolve(root, recoveryOwner.stagePath),
      token: recoveryOwner.token,
    };
    await assertDistPromotionLease(lease);
    let inspection = await inspectDistPromotionRecovery(root);
    if (inspection.owner.token !== expectedToken) {
      throw new DistPromotionRecoveryRefusedError(inspection, "the owner token changed");
    }
    if (
      inspection.lockPath !== lease.path
      || inspection.phasePath !== lease.phasePath
      || inspection.stagePath !== lease.stagePath
      || inspection.backupPath !== lease.backupPath
      || inspection.claimPath !== lease.claimPath
      || inspection.discardPath !== lease.discardPath
      || `${canonicalJson(inspection.owner)}\n` !== lease.source
    ) {
      throw new DistPromotionRecoveryRefusedError(
        await inspectDistPromotionRecovery(root),
        "the owner lock changed during recovery preflight",
      );
    }
    await assertDistPromotionLease(lease);
    if (inspection.claimPresent) {
      if (!inspection.claimMatchesOwner) {
        throw new DistPromotionRecoveryRefusedError(
          inspection,
          "the original acquisition claim differs from the owner lock",
        );
      }
      await releaseOptionalOwnedLockPath({
        device: lease.device,
        inode: lease.inode,
        path: inspection.claimPath,
        repository: root,
        source: lease.source,
      });
      inspection = await inspectDistPromotionRecovery(root);
      if (
        inspection.owner.token !== expectedToken
        || inspection.claimPresent
      ) {
        throw new DistPromotionRecoveryRefusedError(
          inspection,
          "the owner changed while removing its redundant acquisition claim",
        );
      }
      await assertDistPromotionLease(lease);
    }

    const previousDistRecorded = inspection.owner.previousDistDevice !== null;
    const topology = (): string => [
      inspection.destinationPresent ? "D" : "-",
      inspection.stagePresent ? "S" : "-",
      inspection.backupPresent ? "B" : "-",
      inspection.discardPresent ? "X" : "-",
    ].join("");
    const partialCommittedDiscardIsValid = (): boolean => (
      inspection.phase === "previous-dist-discarded"
      && inspection.destinationMatchesStage
      && !inspection.stagePresent
      && !inspection.backupPresent
      && inspection.discardIsRecordedDeletionSubset
    );
    const identitiesAreValid = (): boolean => (
      (!inspection.stagePresent || inspection.stageMatchesStage)
      && (!inspection.backupPresent || inspection.backupMatchesPreviousDist)
      && (
        !inspection.discardPresent
        || inspection.discardMatchesPreviousDist
        || partialCommittedDiscardIsValid()
      )
      && (
        !inspection.destinationPresent
        || inspection.destinationMatchesPreviousDist
        || inspection.destinationMatchesStage
      )
    );
    if (!identitiesAreValid()) {
      throw new DistPromotionRecoveryRefusedError(
        inspection,
        "a transaction directory no longer has its recorded identity",
      );
    }

    type RecoveryAction = "complete-new" | "release" | "rollback-empty" | "rollback-previous";
    const actionFor = (): RecoveryAction | null => {
      const key = topology();
      switch (inspection.phase) {
        case "prepared":
          if (key === (previousDistRecorded ? "DS--" : "-S--")) return "release";
          return null;
        case "moving-previous-dist":
          if (previousDistRecorded && key === "DS--") return "release";
          if (previousDistRecorded && key === "-SB-") return "rollback-previous";
          return null;
        case "previous-dist-moved":
          return previousDistRecorded && key === "-SB-" ? "rollback-previous" : null;
        case "promoting-prepared-dist":
          if (previousDistRecorded && (key === "-SB-" || key === "D-B-")) {
            return "rollback-previous";
          }
          if (previousDistRecorded && key === "DS--" && inspection.destinationMatchesPreviousDist) {
            return "release";
          }
          if (!previousDistRecorded && key === "-S--") return "release";
          if (!previousDistRecorded && key === "D---" && inspection.destinationMatchesStage) {
            return "rollback-empty";
          }
          return null;
        case "recovering-previous-dist":
          if (previousDistRecorded && (key === "-SB-" || key === "D-B-")) {
            return "rollback-previous";
          }
          if (previousDistRecorded && key === "DS--" && inspection.destinationMatchesPreviousDist) {
            return "release";
          }
          if (!previousDistRecorded && key === "D---" && inspection.destinationMatchesStage) {
            return "rollback-empty";
          }
          if (!previousDistRecorded && key === "-S--") return "release";
          return null;
        case "committed":
          if (!previousDistRecorded && key === "D---") return "complete-new";
          if (previousDistRecorded && key === "D-B-") return "complete-new";
          return null;
        case "discarding-previous-dist":
          if (previousDistRecorded && (key === "D-B-" || key === "D--X")) {
            return "complete-new";
          }
          return null;
        case "previous-dist-discarded":
          if (previousDistRecorded && (key === "D--X" || key === "D---")) {
            return "complete-new";
          }
          return null;
        case "released":
          if (key === "D---" && inspection.destinationMatchesStage) return "release";
          if (previousDistRecorded && key === "DS--" && inspection.destinationMatchesPreviousDist) {
            return "release";
          }
          if (!previousDistRecorded && key === "-S--") return "release";
          return null;
      }
    };

    let action = actionFor();
    if (action === null) {
      throw new DistPromotionRecoveryRefusedError(
        inspection,
        `phase ${inspection.phase} has unsupported topology ${topology()}`,
      );
    }
    if (inspection.phase === "released") {
      result = inspection.destinationMatchesStage ? "completed-new-dist" : "released-untouched";
    } else if (action === "rollback-previous" || action === "rollback-empty") {
      if (inspection.phase !== "recovering-previous-dist") {
        await updateDistPromotionState(lease, "recovering-previous-dist");
        inspection = await inspectDistPromotionRecovery(root);
        action = actionFor();
        if (action !== "rollback-previous" && action !== "rollback-empty") {
          throw new DistPromotionRecoveryRefusedError(
            inspection,
            "the rollback topology changed after journaling recovery",
          );
        }
      }
      if (
        action === "rollback-previous"
        && inspection.destinationPresent
        && inspection.destinationMatchesStage
        && !inspection.stagePresent
        && inspection.backupMatchesPreviousDist
      ) {
        await assertDistPromotionLease(lease);
        await rename(inspection.destinationPath, inspection.stagePath);
        inspection = await inspectDistPromotionRecovery(root);
      }
      if (
        action === "rollback-previous"
        && !inspection.destinationPresent
        && inspection.stageMatchesStage
        && inspection.backupMatchesPreviousDist
      ) {
        await assertDistPromotionLease(lease);
        await rename(inspection.backupPath, inspection.destinationPath);
        inspection = await inspectDistPromotionRecovery(root);
      } else if (
        action === "rollback-empty"
        && inspection.destinationMatchesStage
        && !inspection.stagePresent
      ) {
        await assertDistPromotionLease(lease);
        await rename(inspection.destinationPath, inspection.stagePath);
        inspection = await inspectDistPromotionRecovery(root);
      }
      const rolledBackPrevious = previousDistRecorded
        && inspection.destinationMatchesPreviousDist
        && inspection.stageMatchesStage
        && !inspection.backupPresent
        && !inspection.discardPresent;
      const rolledBackEmpty = !previousDistRecorded
        && !inspection.destinationPresent
        && inspection.stageMatchesStage
        && !inspection.backupPresent
        && !inspection.discardPresent;
      if (!rolledBackPrevious && !rolledBackEmpty) {
        throw new DistPromotionRecoveryRefusedError(
          inspection,
          "the rollback did not settle at the recorded pre-promotion topology",
        );
      }
      result = rolledBackPrevious ? "restored-previous-dist" : "released-untouched";
    } else if (action === "complete-new") {
      if (!inspection.destinationMatchesStage || inspection.stagePresent) {
        throw new DistPromotionRecoveryRefusedError(
          inspection,
          "the committed destination no longer matches the recorded stage",
        );
      }
      if (inspection.backupPresent) {
        await updateDistPromotionState(lease, "discarding-previous-dist");
        inspection = await inspectDistPromotionRecovery(root);
        if (!inspection.backupMatchesPreviousDist || inspection.discardPresent) {
          throw new DistPromotionRecoveryRefusedError(
            inspection,
            "the previous-dist discard topology changed before rename",
          );
        }
        await assertDistPromotionLease(lease);
        await rename(inspection.backupPath, inspection.discardPath);
        inspection = await inspectDistPromotionRecovery(root);
      }
      if (inspection.discardPresent) {
        if (
          inspection.phase !== "previous-dist-discarded"
          && (!inspection.discardMatchesPreviousDist || inspection.backupPresent)
        ) {
          throw new DistPromotionRecoveryRefusedError(
            inspection,
            "the previous-dist discard no longer has its recorded identity",
          );
        }
        if (inspection.phase !== "previous-dist-discarded") {
          await updateDistPromotionState(lease, "previous-dist-discarded");
          inspection = await inspectDistPromotionRecovery(root);
        }
        if (
          !inspection.destinationMatchesStage
          || inspection.stagePresent
          || inspection.backupPresent
          || !inspection.discardIsRecordedDeletionSubset
        ) {
          throw new DistPromotionRecoveryRefusedError(
            inspection,
            "the previous-dist discard topology changed after journaling removal",
          );
        }
        await assertDistPromotionLease(lease);
        await removeTree(inspection.discardPath);
        inspection = await inspectDistPromotionRecovery(root);
      }
      if (
        !inspection.destinationMatchesStage
        || inspection.stagePresent
        || inspection.backupPresent
        || inspection.discardPresent
      ) {
        throw new DistPromotionRecoveryRefusedError(
          inspection,
          "the committed promotion did not reach its terminal topology",
        );
      }
      result = "completed-new-dist";
    } else {
      result = inspection.destinationMatchesStage ? "completed-new-dist" : "released-untouched";
    }
    if (inspection.phase !== "released") await updateDistPromotionState(lease, "released");
    await assertDistPromotionLease(lease);
    await releaseOptionalOwnedLockPath({
      device: lease.device,
      inode: lease.inode,
      path: lease.claimPath,
      repository: root,
      source: lease.source,
    });
    const terminalPhase = await readOrdinaryFile(inspection.phasePath, "Terminal dist promotion state");
    await releaseDistPromotionLock(lease);
    await releaseDistPromotionLock({
      ...terminalPhase,
      path: inspection.phasePath,
      repository: root,
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await releaseAdvisoryLock(recoveryLease);
  } catch (releaseError) {
    if (failed) {
      throw new AggregateError(
        [failure, releaseError],
        `Dist promotion recovery failed and its advisory lease could not be released at ${recoveryLease.path}`,
        { cause: failure },
      );
    }
    throw releaseError;
  }
  if (failed) throw failure;
  assert.ok(result !== undefined, "Dist promotion recovery finished without a result");
  return result;
}

async function retainedDistBackups(repository: string): Promise<readonly string[]> {
  return (await readdir(repository))
    .filter((name) => name.startsWith(".dist-backup-"))
    .sort();
}

export interface CommittedDistPromotion {
  readonly backupPath: string | null;
  readonly destinationPath: string;
}

export class DistPromotionCleanupError extends Error {
  readonly backupPath: string;
  readonly destinationPath: string;
  readonly state = "promoted-with-retained-backup" as const;

  constructor(promotion: CommittedDistPromotion, cause: unknown) {
    assert.ok(promotion.backupPath !== null);
    super(
      `The new dist is live at ${promotion.destinationPath}, but backup cleanup failed; the previous dist is retained at ${promotion.backupPath} (state: promoted-with-retained-backup)`,
      { cause },
    );
    this.name = "DistPromotionCleanupError";
    this.backupPath = promotion.backupPath;
    this.destinationPath = promotion.destinationPath;
  }
}

export class DistPromotionRestoreError extends AggregateError {
  readonly backupPath: string;
  readonly destinationPath: string;
  readonly stagePath: string;
  readonly state = "promotion-failed-with-retained-backup" as const;

  constructor(
    destinationPath: string,
    backupPath: string,
    stagePath: string,
    promotionError: unknown,
    restorationError: unknown,
  ) {
    super(
      [promotionError, restorationError],
      `Dist promotion failed at ${destinationPath}, and restoration also failed; the previous dist is retained at ${backupPath} and the prepared dist is retained at ${stagePath} (state: promotion-failed-with-retained-backup)`,
      { cause: promotionError },
    );
    this.name = "DistPromotionRestoreError";
    this.backupPath = backupPath;
    this.destinationPath = destinationPath;
    this.stagePath = stagePath;
  }
}

export class DistPromotionInterferenceError extends Error {
  readonly backupPath: string | null;
  readonly destinationPath: string;
  readonly stagePath: string;
  readonly state = "promotion-failed-with-concurrent-destination" as const;

  constructor(
    destinationPath: string,
    backupPath: string | null,
    stagePath: string,
    cause: unknown,
  ) {
    super(
      `Dist promotion failed at ${destinationPath} after an unexpected destination appeared; the prepared dist is retained at ${stagePath}${backupPath === null ? "" : ` and the previous dist is retained at ${backupPath}`} (state: promotion-failed-with-concurrent-destination)`,
      { cause },
    );
    this.name = "DistPromotionInterferenceError";
    this.backupPath = backupPath;
    this.destinationPath = destinationPath;
    this.stagePath = stagePath;
  }
}

export class DistPromotionRecoveryRequiredError extends Error {
  readonly lockPath: string;
  readonly state = "promotion-recovery-required" as const;
  readonly transaction: unknown;

  constructor(
    lockPath: string,
    transaction: unknown,
  ) {
    super(
      `Dist promotion requires recovery before another writer can proceed; the owner lock is retained at ${lockPath} (state: promotion-recovery-required)`,
      { cause: transaction },
    );
    this.name = "DistPromotionRecoveryRequiredError";
    this.lockPath = lockPath;
    this.transaction = transaction;
  }
}

interface DistPromotionJournal {
  readonly assertAfterMove: () => Promise<void>;
  readonly assertAfterPromotion: () => Promise<void>;
  readonly assertAfterRestoration: () => Promise<void>;
  readonly assertBeforeMove: () => Promise<void>;
  readonly assertBeforePromotion: () => Promise<void>;
  readonly assertBeforeRestoration: () => Promise<void>;
  readonly backupPath: string;
  readonly previousDistPresent: boolean;
  readonly setPhase: (phase: DistPromotionPhase) => Promise<void>;
}

export async function commitDistPromotion(
  repository: string,
  stage: string,
  renamePath: RenamePath = rename,
  journal?: DistPromotionJournal,
): Promise<CommittedDistPromotion> {
  const destinationPath = resolve(repository, "dist");
  const backupPath = journal?.backupPath
    ?? resolve(repository, `.dist-backup-${randomUUID()}`);
  let movedOld = false;
  let previousMoveStarted = false;
  let stagePromotionStarted = false;
  try {
    const destinationPresent = journal === undefined
      ? await exists(destinationPath)
      : journal.previousDistPresent;
    if (destinationPresent) {
      const stat = await lstat(destinationPath);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Existing dist must be an ordinary directory");
      await journal?.assertBeforeMove();
      await journal?.setPhase("moving-previous-dist");
      await journal?.assertBeforeMove();
      previousMoveStarted = true;
      await renamePath(destinationPath, backupPath);
      movedOld = true;
      await journal?.assertAfterMove();
      await journal?.setPhase("previous-dist-moved");
    }
    await journal?.setPhase("promoting-prepared-dist");
    await journal?.assertBeforePromotion();
    stagePromotionStarted = true;
    await renamePath(stage, destinationPath);
    await journal?.assertAfterPromotion();
  } catch (error) {
    const destinationExists = await exists(destinationPath);
    if (previousMoveStarted) {
      if (destinationExists) {
        if (!movedOld && journal !== undefined) {
          let originalDestinationIsIntact = false;
          try {
            await journal.assertBeforeMove();
            originalDestinationIsIntact = true;
          } catch {
            // A changed destination is classified as interference below.
          }
          if (originalDestinationIsIntact) throw error;
        } else if (!movedOld) {
          throw error;
        }
        throw new DistPromotionInterferenceError(
          destinationPath,
          backupPath,
          stage,
          error,
        );
      }
      try {
        await journal?.setPhase("recovering-previous-dist");
        await journal?.assertBeforeRestoration();
        await renamePath(backupPath, destinationPath);
        await journal?.assertAfterRestoration();
      } catch (restorationError) {
        throw new DistPromotionRestoreError(
          destinationPath,
          backupPath,
          stage,
          error,
          restorationError,
        );
      }
    } else if (stagePromotionStarted && destinationExists) {
      throw new DistPromotionInterferenceError(
        destinationPath,
        movedOld ? backupPath : null,
        stage,
        error,
      );
    }
    throw error;
  }
  return {
    backupPath: movedOld ? backupPath : null,
    destinationPath,
  };
}

async function removeTree(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

export async function cleanupDistPromotion(
  promotion: CommittedDistPromotion,
  remove: RemoveTree = removeTree,
): Promise<void> {
  if (promotion.backupPath === null) return;
  try {
    await remove(promotion.backupPath);
  } catch (error) {
    throw new DistPromotionCleanupError(promotion, error);
  }
}

export async function promotePreparedDist(
  repository: string,
  stage: string,
  renamePath: RenamePath = rename,
  remove: RemoveTree = removeTree,
  releaseRenamePath: RenamePath = rename,
): Promise<void> {
  const lease = await acquireDistPromotionLock(repository, stage);
  const owner = parseDistPromotionLockRecord(lease.source);
  const stageIdentity: DirectoryTreeDigest = {
    device: owner.stageDevice,
    inode: owner.stageInode,
    treeSha256: owner.stageTreeSha256,
  };
  const previousDistIdentity = owner.previousDistDevice === null
    ? null
    : {
        device: owner.previousDistDevice,
        inode: owner.previousDistInode as string,
        treeSha256: owner.previousDistTreeSha256 as string,
      };
  const destinationPath = resolve(lease.repository, "dist");
  const assertStage = () => assertDirectoryWitness(lease.stagePath, stageIdentity, "Recorded dist stage");
  const assertNoStage = () => assertDirectoryAbsent(lease.stagePath, "Recorded dist stage");
  const assertNoBackup = () => assertDirectoryAbsent(lease.backupPath, "Recorded dist backup");
  const assertNoDiscard = () => assertDirectoryAbsent(lease.discardPath, "Recorded dist discard");
  const assertPreviousAt = async (path: string, description: string): Promise<void> => {
    assert.ok(previousDistIdentity !== null, "No previous dist identity was recorded");
    await assertDirectoryWitness(path, previousDistIdentity, description);
  };
  const assertPromotedDestination = () => assertDirectoryWitness(
    destinationPath,
    stageIdentity,
    "Promoted dist destination",
  );
  let retainLock = false;
  let failed = false;
  let failure: unknown;
  let promotionFinished = false;
  try {
    const retainedBackups = await retainedDistBackups(repository);
    assert.deepEqual(
      retainedBackups,
      [],
      `Dist promotion cannot begin while retained transaction backups exist: ${retainedBackups.join(", ")}`,
    );
    const promotion = await commitDistPromotion(repository, stage, renamePath, {
      assertAfterMove: async () => {
        await Promise.all([
          assertStage(),
          assertDirectoryAbsent(destinationPath, "Dist destination"),
          assertPreviousAt(lease.backupPath, "Recorded dist backup"),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      assertAfterPromotion: async () => {
        await Promise.all([
          assertNoStage(),
          assertPromotedDestination(),
          previousDistIdentity === null
            ? assertNoBackup()
            : assertPreviousAt(lease.backupPath, "Recorded dist backup"),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      assertAfterRestoration: async () => {
        await Promise.all([
          assertStage(),
          assertPreviousAt(destinationPath, "Restored dist destination"),
          assertNoBackup(),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      assertBeforeMove: async () => {
        await Promise.all([
          assertStage(),
          assertPreviousAt(destinationPath, "Existing dist"),
          assertNoBackup(),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      assertBeforePromotion: async () => {
        await Promise.all([
          assertStage(),
          assertDirectoryAbsent(destinationPath, "Dist destination"),
          previousDistIdentity === null
            ? assertNoBackup()
            : assertPreviousAt(lease.backupPath, "Recorded dist backup"),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      assertBeforeRestoration: async () => {
        await Promise.all([
          assertStage(),
          assertDirectoryAbsent(destinationPath, "Dist destination"),
          assertPreviousAt(lease.backupPath, "Recorded dist backup"),
          assertNoDiscard(),
        ]);
        await assertDistPromotionLease(lease);
      },
      backupPath: lease.backupPath,
      previousDistPresent: previousDistIdentity !== null,
      setPhase: (phase) => updateDistPromotionState(lease, phase),
    });
    promotionFinished = true;
    await updateDistPromotionState(lease, "committed");
    await Promise.all([
      assertDistPromotionLease(lease),
      assertNoStage(),
      assertPromotedDestination(),
      promotion.backupPath === null
        ? assertNoBackup()
        : assertPreviousAt(promotion.backupPath, "Recorded dist backup"),
      assertNoDiscard(),
    ]);
    if (promotion.backupPath !== null) {
      await updateDistPromotionState(lease, "discarding-previous-dist");
      await Promise.all([
        assertPromotedDestination(),
        assertNoStage(),
        assertPreviousAt(promotion.backupPath, "Recorded dist backup"),
        assertNoDiscard(),
      ]);
      await assertDistPromotionLease(lease);
      await renamePath(promotion.backupPath, lease.discardPath);
      await Promise.all([
        assertDistPromotionLease(lease),
        assertPromotedDestination(),
        assertNoStage(),
        assertNoBackup(),
        assertPreviousAt(lease.discardPath, "Recorded dist discard"),
      ]);
      await updateDistPromotionState(lease, "previous-dist-discarded");
      await Promise.all([
        assertDistPromotionLease(lease),
        assertPromotedDestination(),
        assertNoStage(),
        assertNoBackup(),
        assertPreviousAt(lease.discardPath, "Recorded dist discard"),
      ]);
      await assertDistPromotionLease(lease);
      await cleanupDistPromotion(
        { backupPath: lease.discardPath, destinationPath: promotion.destinationPath },
        remove,
      );
      await assertNoDiscard();
    }
  } catch (error) {
    failed = true;
    if (
      error instanceof DistPromotionInterferenceError
      || error instanceof DistPromotionRestoreError
      || promotionFinished
    ) {
      retainLock = true;
      failure = new DistPromotionRecoveryRequiredError(lease.path, error);
    } else {
      failure = error;
    }
  }

  if (retainLock) {
    try {
      await markDistPromotionRecoveryRequired(lease);
    } catch (markError) {
      failure = new AggregateError(
        [failure, markError],
        `Dist promotion failed and could not mark its retained owner for recovery at ${lease.path}`,
        { cause: failure },
      );
    }
  }

  let completionError = failed ? failure : undefined;
  if (!retainLock) {
    try {
      await updateDistPromotionState(lease, "released");
      await assertDistPromotionLease(lease);
      await releaseOptionalOwnedLockPath({
        device: lease.device,
        inode: lease.inode,
        path: lease.claimPath,
        repository: lease.repository,
        source: lease.source,
      });
      const terminalPhase = await readOrdinaryFile(
        lease.phasePath,
        "Terminal dist promotion state",
      );
      await releaseDistPromotionLock(lease, releaseRenamePath);
      await releaseDistPromotionLock({
        ...terminalPhase,
        path: lease.phasePath,
        repository: lease.repository,
      });
    } catch (terminalError) {
      completionError = completionError === undefined
        ? terminalError
        : new AggregateError(
            [completionError, terminalError],
            `Dist promotion failed and terminal owner cleanup also failed at ${lease.path}`,
            { cause: completionError },
          );
    }
  }
  if (completionError !== undefined && !retainLock) {
    try {
      const retainedOwner = await readOptionalOrdinaryFile(
        lease.path,
        "Retained dist promotion owner",
      );
      if (
        retainedOwner !== null
        && retainedOwner.device === lease.device
        && retainedOwner.inode === lease.inode
        && retainedOwner.source === lease.source
      ) {
        await markDistPromotionRecoveryRequired(lease);
      }
    } catch (markError) {
      completionError = new AggregateError(
        [completionError, markError],
        `Dist promotion failed and its retained owner could not be marked for recovery at ${lease.path}`,
        { cause: completionError },
      );
    }
  }
  try {
    await releaseAdvisoryLock(lease.advisoryLock);
  } catch (advisoryError) {
    completionError = completionError === undefined
      ? advisoryError
      : new AggregateError(
          [completionError, advisoryError],
          `Dist promotion failed and its advisory lease could not be released at ${lease.path}`,
          { cause: completionError },
        );
  }
  if (completionError !== undefined) throw completionError;
}

export async function buildPackage(repository: string): Promise<void> {
  assert.equal(Bun.version, "1.3.14", "Package builds require Bun 1.3.14");
  verifyCompilerContract();
  const root = resolve(repository);
  const rootStat = await lstat(root);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "Repository must be an ordinary directory");
  const stage = await mkdtemp(resolve(root, ".dist-build-"));
  let prepared = false;
  let promoted = false;
  const originalNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const runtime = await buildRuntime(root, stage);
    await writeFile(resolve(stage, "stylex.css"), serializeStylexRules(runtime.rules), { flag: "wx" });
    const buildToolPaths = await buildTools(root, stage);
    await writePackageManifest(root, stage, runtime.runtimePaths, buildToolPaths, runtime.rules);
    prepared = true;
    await promotePreparedDist(root, stage);
    promoted = true;
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
    if (!prepared && !promoted) await rm(stage, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  assert.equal(process.argv.length, 2, "This script accepts no command-line arguments");
  await buildPackage(process.cwd());
}
