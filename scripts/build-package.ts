import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
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
  "src/compiler-foundation-tailwind.css",
  "src/compiler-foundation.css",
  "src/compiler-reset.css",
  "src/components.css",
  "src/reset.css",
  "src/styles.css",
  "src/tailwind.css",
  "src/tokens.css",
] as const;

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
  for (const entrypoint of ["index.ts", "bun.ts", "vite.ts"]) {
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
        "compilerContract",
        "compilerSha256",
        "createStylexGeneration",
        "finalizeStylexGeneration",
        "prepareStylexProducedTemplate",
        "readStylexPackageManifest",
        "sealStylexProducedTemplate",
        "serializeStylexRules",
        "validateStylexPackageManifest",
      ],
      functions: [
        "createStylexGeneration",
        "finalizeStylexGeneration",
        "prepareStylexProducedTemplate",
        "readStylexPackageManifest",
        "sealStylexProducedTemplate",
        "serializeStylexRules",
        "validateStylexPackageManifest",
      ],
    }],
    ["build/vite.js", { exports: ["stylexVite"], functions: ["stylexVite"] }],
  ] as const);
  assert.deepEqual(paths, [...expectedBuildTools.keys()].sort(), "Build-tool build must emit exactly its three public entrypoints");
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
  assert.ok(paths.every((path) => path.endsWith(".js")), "Build-tool build emitted an unexpected non-JavaScript artifact");
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
  const manifest = validateStylexPackageManifest({
    buildTools: await distArtifacts(stage, buildToolPaths),
    compiler: compilerContract,
    compilerSha256,
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

export async function commitDistPromotion(
  repository: string,
  stage: string,
  renamePath: RenamePath = rename,
): Promise<CommittedDistPromotion> {
  const destinationPath = resolve(repository, "dist");
  const backupPath = resolve(repository, `.dist-backup-${randomUUID()}`);
  let movedOld = false;
  try {
    if (await exists(destinationPath)) {
      const stat = await lstat(destinationPath);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Existing dist must be an ordinary directory");
      await renamePath(destinationPath, backupPath);
      movedOld = true;
    }
    await renamePath(stage, destinationPath);
  } catch (error) {
    if (movedOld && !(await exists(destinationPath))) {
      try {
        await renamePath(backupPath, destinationPath);
      } catch (restorationError) {
        throw new DistPromotionRestoreError(
          destinationPath,
          backupPath,
          stage,
          error,
          restorationError,
        );
      }
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
    const promotion = await commitDistPromotion(root, stage);
    promoted = true;
    await cleanupDistPromotion(promotion);
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
