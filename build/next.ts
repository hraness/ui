import { stylexNextVersion, type StylexNextVersion } from "./next-profile.js";
import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeLogicalPath } from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_REQUIRED_VERSION,
  defaultStylexNextGraphMap,
  defineStylexNextGraphMap,
  resolveStylexNextTarget,
  stylexNextDeliveryEntries,
  type StylexNextBuildRecordV2,
  type StylexNextGraphMapV1,
  type StylexNextProductionMode,
  type StylexNextTarget,
  type StylexNextWebpackContext,
} from "./next-contracts.js";
import {
  acquireStylexNextOutputLease,
  completeStylexNextBuild,
  finalizeStylexNextDiscovery,
  prepareStylexNextAttempt,
  readStylexNextAttemptPlan,
  releaseStylexNextOutputLease,
  STYLEX_NEXT_GENERATED_ENTRY_SOURCE,
  type StylexNextAttemptHandle,
} from "./next-generation.js";
import { StylexNextWebpackPlugin } from "./next-plugin.js";
import { runOwnedStylexNextProcess, UncollectedNextProcessError } from "./next-process.js";
import {
  beginStylexNextTypeScriptLifecycle,
  endStylexNextTypeScriptLifecycle,
  observeStylexNextTypeScriptInputs,
  projectStylexNextTypeScript,
  readStylexNextTypeScriptVersion,
  settleStylexNextTypeScriptPass,
  type StylexNextTypeScriptLifecycle,
} from "./next-typescript.js";

const ENV_ATTEMPT_DIRECTORY = "HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY";
const ENV_MODE = "HRANESS_STYLEX_NEXT_MODE";
const ENV_PLAN_SHA256 = "HRANESS_STYLEX_NEXT_PLAN_SHA256";

export type StylexNextRequiredSources = Readonly<{
  client: readonly string[];
  edgeRsc: readonly string[];
  nodeRsc: readonly string[];
}>;

export type StylexNextConfigOptions = Readonly<{
  nextVersion?: StylexNextVersion;
  graphMap?: StylexNextGraphMapV1;
  outputDirectory?: string;
  packageManifests: readonly string[];
  rootDirectory: string;
  stateDirectory?: string;
}>;

export type RunStylexNextBuildOptions = StylexNextConfigOptions & Readonly<{
  attemptId: string;
  requiredSources: StylexNextRequiredSources;
}>;

type NextWebpackConfig = Record<string, unknown> & Readonly<{
  entry?: unknown;
  module?: Readonly<{ rules?: readonly unknown[] }>;
  plugins?: readonly unknown[];
}>;

type NextWebpackCallbackContext = StylexNextWebpackContext & Readonly<{
  webpack: Readonly<{ version?: unknown }>;
}>;

type WebpackEntryOptionHook = Readonly<{
  tap(
    options: Readonly<{ name: string; stage: number }>,
    callback: (context: string, entry: unknown) => void,
  ): void;
}>;

type WebpackCompiler = Readonly<{
  hooks: Readonly<{ entryOption: WebpackEntryOptionHook }>;
}>;

type NextConfig = Record<string, unknown> & Readonly<{
  distDir?: unknown;
  productionBrowserSourceMaps?: unknown;
  turbopack?: unknown;
  webpack?: (config: NextWebpackConfig, context: NextWebpackCallbackContext) => NextWebpackConfig;
}>;

type ParsedConfigOptions = Readonly<{
  nextVersion: StylexNextVersion;
  graphMap: StylexNextGraphMapV1;
  outputDirectory: string;
  packageManifests: readonly string[];
  rootDirectory: string;
  stateDirectory: string;
}>;

type OperationalPass = Readonly<{
  attempt: StylexNextAttemptHandle;
  mode: StylexNextProductionMode;
}>;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  return value as Record<string, unknown>;
}

function logicalList(value: unknown, description: string): readonly string[] {
  assert.ok(Array.isArray(value), `${description} must be an array`);
  const output = value.map((path, index) => normalizeLogicalPath(path, `${description}[${String(index)}]`));
  assert.deepEqual(output, [...output].sort(), `${description} must be sorted`);
  assert.equal(new Set(output).size, output.length, `${description} must be unique`);
  return output;
}

function configOptions(value: StylexNextConfigOptions): ParsedConfigOptions {
  const record = object(value, "StyleX Next config options");
  assert.deepEqual(
    Object.keys(record).sort(),
    Object.keys(record).sort().filter((key) => ["graphMap", "nextVersion", "outputDirectory", "packageManifests", "rootDirectory", "stateDirectory"].includes(key)),
    "StyleX Next config options contain unknown keys",
  );
  assert.ok(typeof record.rootDirectory === "string" && resolve(record.rootDirectory) === record.rootDirectory, "StyleX Next rootDirectory must be absolute");
  assert.ok(Array.isArray(record.packageManifests) && record.packageManifests.length > 0, "StyleX Next packageManifests must be a nonempty array");
  const packageManifests = logicalList(record.packageManifests, "StyleX Next packageManifests");
  const stateDirectory = normalizeLogicalPath(record.stateDirectory ?? ".stylex-next", "StyleX Next stateDirectory");
  const outputDirectory = normalizeLogicalPath(record.outputDirectory ?? ".next", "StyleX Next outputDirectory");
  assert.ok(
    stateDirectory !== outputDirectory
      && !stateDirectory.startsWith(`${outputDirectory}/`)
      && !outputDirectory.startsWith(`${stateDirectory}/`),
    "StyleX Next state and output directories must be path-disjoint",
  );
  return {
    graphMap: defineStylexNextGraphMap(record.graphMap ?? defaultStylexNextGraphMap),
    nextVersion: stylexNextVersion(record.nextVersion === undefined ? STYLEX_NEXT_REQUIRED_VERSION : record.nextVersion),
    outputDirectory,
    packageManifests,
    rootDirectory: resolve(record.rootDirectory),
    stateDirectory,
  };
}

function requiredSources(value: unknown): Readonly<Record<StylexNextTarget, readonly string[]>> {
  const requiredRecord = object(value, "StyleX Next requiredSources");
  assert.deepEqual(
    Object.keys(requiredRecord).sort(),
    ["client", "edgeRsc", "nodeRsc"],
    "StyleX Next requiredSources must explicitly inventory every production target",
  );
  const client = logicalList(requiredRecord.client, "StyleX Next requiredSources.client");
  const edgeRsc = logicalList(requiredRecord.edgeRsc, "StyleX Next requiredSources.edgeRsc");
  const nodeRsc = logicalList(requiredRecord.nodeRsc, "StyleX Next requiredSources.nodeRsc");
  assert.ok(
    client.length + edgeRsc.length + nodeRsc.length > 0,
    "StyleX Next requiredSources must inventory at least one repository-owned production source",
  );
  return {
    client,
    "edge-rsc": edgeRsc,
    "node-rsc": nodeRsc,
  };
}

function passFromEnvironment(root: string): OperationalPass {
  const attemptDirectory = process.env[ENV_ATTEMPT_DIRECTORY];
  const planSha256 = process.env[ENV_PLAN_SHA256];
  const mode = process.env[ENV_MODE];
  assert.ok(typeof attemptDirectory === "string" && resolve(attemptDirectory) === attemptDirectory, "StyleX Next config must run through runStylexNextBuild (attempt missing)");
  assert.ok(typeof planSha256 === "string" && /^[a-f0-9]{64}$/u.test(planSha256), "StyleX Next config must run through runStylexNextBuild (plan hash missing)");
  assert.ok(mode === "delivery" || mode === "discovery", "StyleX Next config rejects dev/HMR and unknown build modes; development never emits a production receipt");
  const logical = relative(root, attemptDirectory).split(sep).join("/");
  normalizeLogicalPath(logical, "StyleX Next attempt directory");
  return { attempt: { directory: attemptDirectory, planSha256 }, mode };
}

function verifyGeneratedEntryForInjection(path: string): string {
  const absolute = resolve(path);
  const entryStat = lstatSync(absolute);
  assert.ok(entryStat.isFile() && !entryStat.isSymbolicLink(), "Next generated entry must be an ordinary nonsymlink file before injection");
  assert.equal(realpathSync(absolute), absolute, "Next generated entry must not traverse a symlink before injection");
  assert.equal(readFileSync(absolute, "utf8"), STYLEX_NEXT_GENERATED_ENTRY_SOURCE, "Next generated entry bytes changed before injection");
  return absolute;
}

class StylexNextDeliveryEntryPlugin {
  readonly #generatedEntry: string;

  constructor(generatedEntry: string) {
    this.#generatedEntry = generatedEntry;
  }

  apply(compiler: WebpackCompiler): void {
    compiler.hooks.entryOption.tap(
      { name: "StylexNextDeliveryEntryPlugin", stage: -1_000 },
      (_context, entry) => {
        const original = object(entry, "Next webpack final client entry map");
        const settled = stylexNextDeliveryEntries(
          original,
          verifyGeneratedEntryForInjection(this.#generatedEntry),
        );
        assert.deepEqual(
          Object.keys(settled),
          Object.keys(original),
          "StyleX Next delivery entry settlement must preserve the final client entry key set",
        );
        for (const [name, value] of Object.entries(settled)) original[name] = value;
      },
    );
  }
}

function loaderPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "next-loader.cjs");
}

function configureWebpack(
  value: NextWebpackConfig,
  context: NextWebpackCallbackContext,
  options: ParsedConfigOptions,
  pass: OperationalPass,
): NextWebpackConfig {
  assert.ok(typeof context.webpack?.version === "string" && /^5\./u.test(context.webpack.version), "StyleX Next requires Next's webpack 5 compiler and rejects Rspack");
  const target = resolveStylexNextTarget({ dev: context.dev, isServer: context.isServer, ...(context.nextRuntime === undefined ? {} : { nextRuntime: context.nextRuntime }) });
  const moduleRecord = value.module === undefined ? {} : object(value.module, "Next webpack module config");
  const rules = moduleRecord.rules === undefined ? [] : moduleRecord.rules;
  assert.ok(Array.isArray(rules), "Next webpack module.rules must be an array");
  const excluded = [
    resolve(options.rootDirectory, ...options.stateDirectory.split("/")),
    resolve(options.rootDirectory, ...options.outputDirectory.split("/")),
    resolve(options.rootDirectory, "node_modules"),
  ];
  const deliveryEntryPlugin = pass.mode === "delivery" && target === "client"
    ? new StylexNextDeliveryEntryPlugin(resolve(pass.attempt.directory, "generated", "entry.mjs"))
    : undefined;
  return {
    ...value,
    devtool: "source-map",
    module: {
      ...moduleRecord,
      rules: [
        ...rules,
        {
          enforce: "pre",
          exclude: excluded,
          include: [options.rootDirectory],
          test: /\.[cm]?[jt]sx?$/u,
          use: [{
            loader: loaderPath(),
            options: {
              attemptDirectory: pass.attempt.directory,
              mode: pass.mode,
              planSha256: pass.attempt.planSha256,
              rootDirectory: options.rootDirectory,
              target,
            },
          }],
        },
      ],
    },
    plugins: [
      ...((value.plugins ?? []) as readonly unknown[]),
      ...(deliveryEntryPlugin === undefined ? [] : [deliveryEntryPlugin]),
      new StylexNextWebpackPlugin({
        attemptDirectory: pass.attempt.directory,
        graphMap: options.graphMap,
        mode: pass.mode,
        outputDirectory: options.outputDirectory,
        packageManifests: options.packageManifests,
        planSha256: pass.attempt.planSha256,
        rootDirectory: options.rootDirectory,
        stateDirectory: options.stateDirectory,
        target,
      }),
    ],
  };
}

export function withStylexNext<T extends NextConfig>(config: T, rawOptions: StylexNextConfigOptions): T {
  const options = configOptions(rawOptions);
  const pass = passFromEnvironment(options.rootDirectory);
  assert.equal(readStylexNextTypeScriptVersion(pass.attempt), options.nextVersion, "Next config profile differs from the build attempt");
  assert.equal(config.turbopack, undefined, "StyleX Next production receipts reject Turbopack configuration");
  assert.ok(config.distDir === undefined || config.distDir === options.outputDirectory, "StyleX Next outputDirectory differs from next.config distDir");
  const originalWebpack = config.webpack;
  const distDir = pass.mode === "discovery"
    ? normalizeLogicalPath(relative(options.rootDirectory, resolve(pass.attempt.directory, "next-discovery")).split(sep).join("/"), "StyleX Next discovery distDir")
    : options.outputDirectory;
  const tsconfigPath = projectStylexNextTypeScript({
    attempt: pass.attempt, config, distDir, mode: pass.mode,
    root: options.rootDirectory, stateDirectory: options.stateDirectory,
  });
  const originalTypeScript = config.typescript === undefined ? {} : object(config.typescript, "Next TypeScript configuration");
  return {
    ...config,
    distDir,
    productionBrowserSourceMaps: true,
    typescript: { ...originalTypeScript, ignoreBuildErrors: false, tsconfigPath },
    webpack: (webpackConfig: NextWebpackConfig, context: NextWebpackCallbackContext) => {
      assert.equal(context.dev, false, "StyleX Next production adapter rejects dev/HMR; no production receipt is emitted for development");
      observeStylexNextTypeScriptInputs(options.rootDirectory, pass.attempt, pass.mode);
      const prior = originalWebpack === undefined ? webpackConfig : originalWebpack(webpackConfig, context);
      assert.ok(
        typeof prior === "object" && prior !== null && typeof (prior as { then?: unknown }).then !== "function",
        "StyleX Next rejects asynchronous next.config webpack callbacks",
      );
      return configureWebpack(prior, context, options, pass);
    },
  } as T;
}

async function nextInstallation(root: string, nextVersion: StylexNextVersion): Promise<Readonly<{ bin: string; packageRoot: string }>> {
  const require = createRequire(join(root, "package.json"));
  const manifestPath = await realpath(require.resolve("next/package.json"));
  const packageRoot = dirname(manifestPath);
  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = object(raw, "Installed Next package manifest");
  assert.equal(manifest.name, "next", "Resolved Next package has the wrong name");
  assert.equal(manifest.version, nextVersion, `StyleX Next requires its selected exact next@${nextVersion} profile`);
  const bin = await realpath(join(packageRoot, "dist", "bin", "next"));
  const binStat = await stat(bin);
  assert.ok(binStat.isFile(), "Installed Next CLI must be an ordinary file");
  return { bin, packageRoot };
}

async function runNextPass(
  root: string,
  nextBin: string,
  attempt: StylexNextAttemptHandle,
  mode: StylexNextProductionMode,
  lifecycle: StylexNextTypeScriptLifecycle,
): Promise<void> {
  let failure: unknown;
  try {
    await runOwnedStylexNextProcess({
      command: process.execPath,
      args: [nextBin, "build", "--webpack"],
      cwd: root,
      env: {
        ...process.env,
        [ENV_ATTEMPT_DIRECTORY]: attempt.directory,
        [ENV_MODE]: mode,
        [ENV_PLAN_SHA256]: attempt.planSha256,
        NODE_ENV: "production",
      },
    });
  } catch (error) {
    failure = error;
  }
  if (failure instanceof UncollectedNextProcessError) throw failure;
  try {
    await settleStylexNextTypeScriptPass(lifecycle, mode);
  } catch (error) {
    failure = failure === undefined ? error : new AggregateError([failure, error], `Next ${mode} child and TypeScript settlement both failed`);
  }
  if (failure !== undefined) throw failure;
}

export async function runStylexNextBuild(rawOptions: RunStylexNextBuildOptions): Promise<StylexNextBuildRecordV2> {
  assert.ok(process.platform === "darwin" || process.platform === "linux", "StyleX Next process custody supports macOS and Linux only");
  const runRecord = object(rawOptions, "StyleX Next build options");
  assert.deepEqual(
    Object.keys(runRecord).sort(),
    Object.keys(runRecord).sort().filter((key) => [
      "attemptId", "graphMap", "nextVersion", "outputDirectory", "packageManifests", "requiredSources", "rootDirectory", "stateDirectory",
    ].includes(key)),
    "StyleX Next build options contain unknown keys; the adapter always runs the exact full production build",
  );
  assert.ok(typeof rawOptions.attemptId === "string", "StyleX Next attemptId is required");
  const parsedRequiredSources = requiredSources(rawOptions.requiredSources);
  assert.equal(Reflect.has(globalThis, "Bun"), false, "StyleX Next build orchestration requires genuine Node, not Bun's Node compatibility runtime");
  assert.equal(process.release.name, "node", "StyleX Next build orchestration requires the Node runtime");
  const major = Number(process.versions.node.split(".", 1)[0]);
  assert.equal(major, 24, "StyleX Next build orchestration requires Node 24");
  const options = configOptions({
    ...(rawOptions.nextVersion === undefined ? {} : { nextVersion: rawOptions.nextVersion }),
    ...(rawOptions.graphMap === undefined ? {} : { graphMap: rawOptions.graphMap }),
    ...(rawOptions.outputDirectory === undefined ? {} : { outputDirectory: rawOptions.outputDirectory }),
    packageManifests: rawOptions.packageManifests,
    rootDirectory: rawOptions.rootDirectory,
    ...(rawOptions.stateDirectory === undefined ? {} : { stateDirectory: rawOptions.stateDirectory }),
  });
  const root = await realpath(options.rootDirectory);
  assert.equal(root, options.rootDirectory, "StyleX Next rootDirectory must not traverse a symlink");
  const installation = await nextInstallation(root, options.nextVersion);
  const nextRelative = relative(root, installation.packageRoot).split(sep).join("/");
  assert.ok(
    nextRelative.length > 0
      && nextRelative !== ".."
      && !nextRelative.startsWith("../")
      && nextRelative.split("/").includes("node_modules"),
    "Next package must resolve from this application's node_modules tree",
  );
  const attempt = await prepareStylexNextAttempt({
    attemptId: rawOptions.attemptId,
    nextVersion: options.nextVersion,
    graphMap: options.graphMap,
    outputDirectory: options.outputDirectory,
    packageManifests: options.packageManifests,
    requiredSources: parsedRequiredSources,
    rootDirectory: root,
    stateDirectory: options.stateDirectory,
  });
  const plan = await readStylexNextAttemptPlan(attempt);
  assert.equal(plan.nextVersion, options.nextVersion);
  const lease = await acquireStylexNextOutputLease(root, options.outputDirectory, plan.attemptId);
  let uncollected = false;
  try {
    const lifecycle = await beginStylexNextTypeScriptLifecycle(root, attempt, options.outputDirectory);
    let lifecycleFailure: unknown;
    try {
      await runNextPass(root, installation.bin, attempt, "discovery", lifecycle);
      await finalizeStylexNextDiscovery(attempt, root);
      await runNextPass(root, installation.bin, attempt, "delivery", lifecycle);
      return await completeStylexNextBuild(attempt, root);
    } catch (error) {
      lifecycleFailure = error;
      uncollected = error instanceof UncollectedNextProcessError;
      throw error;
    } finally {
      if (!uncollected) {
        try { endStylexNextTypeScriptLifecycle(lifecycle); }
        catch (error) {
          throw lifecycleFailure === undefined ? error : new AggregateError([lifecycleFailure, error], "Next build failed and TypeScript ownership could not be returned safely");
        }
      }
    }
  } finally {
    if (!uncollected) await releaseStylexNextOutputLease(lease);
  }
}

export { STYLEX_NEXT_ADAPTER_VERSION, STYLEX_NEXT_REQUIRED_VERSION };

export type { StylexNextVersion } from "./next-profile.js";
