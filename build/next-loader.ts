import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  canonicalJson,
  canonicalizeStylexRules,
  compilerSha256,
  createStylexTransformCollector,
  normalizeLogicalPath,
  sha256,
  stylexRulesSha256,
  type StylexSourceMapV1,
} from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_MODULE_SCHEMA_VERSION,
  graphIdForStylexNextTarget,
  parseStylexNextTarget,
  validateStylexNextModuleReceipt,
  type StylexNextMode,
  type StylexNextModuleReceiptV1,
  type StylexNextTarget,
} from "./next-contracts.js";
import {
  readStylexNextAttemptPlan,
  writeStylexNextModuleReceipt,
  type StylexNextAttemptHandle,
} from "./next-generation.js";

export type StylexNextLoaderOptions = Readonly<{
  attemptDirectory: string;
  mode: StylexNextMode;
  planSha256: string;
  rootDirectory: string;
  target: StylexNextTarget;
}>;

export type StylexNextLoaderRequest = Readonly<{
  inputSourceMap?: unknown;
  options: unknown;
  resourcePath: string;
  source: string | Uint8Array;
}>;

export type StylexNextLoaderResult = Readonly<{
  code: string;
  map: StylexSourceMapV1;
  receipt: StylexNextModuleReceiptV1;
}>;

function object(value: unknown, description: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${description} must be an object`);
  const prototype = Object.getPrototypeOf(value) as unknown;
  assert.ok(prototype === Object.prototype || prototype === null, `${description} must be a plain object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, description: string): string {
  assert.ok(typeof value === "string" && value.length > 0 && !value.includes("\0"), `${description} must be a nonempty string`);
  return value;
}

function loaderOptions(value: unknown): StylexNextLoaderOptions {
  const record = object(value, "StyleX Next loader options");
  assert.deepEqual(
    Object.keys(record).sort(),
    ["attemptDirectory", "mode", "planSha256", "rootDirectory", "target"],
    "StyleX Next loader options contain unknown or missing keys",
  );
  assert.ok(record.mode === "delivery" || record.mode === "discovery", "Production StyleX Next loader accepts only discovery or delivery mode");
  assert.ok(typeof record.planSha256 === "string" && /^[a-f0-9]{64}$/u.test(record.planSha256), "StyleX Next loader planSha256 is invalid");
  return {
    attemptDirectory: resolve(string(record.attemptDirectory, "StyleX Next loader attemptDirectory")),
    mode: record.mode,
    planSha256: record.planSha256,
    rootDirectory: resolve(string(record.rootDirectory, "StyleX Next loader rootDirectory")),
    target: parseStylexNextTarget(record.target, "StyleX Next loader target"),
  };
}

function belowRoot(root: string, path: string): string {
  const logical = relative(root, path).split(sep).join("/");
  assert.ok(logical.length > 0 && logical !== ".." && !logical.startsWith("../"), "StyleX Next loader resource escaped rootDirectory");
  assert.ok(!logical.split("/").includes("node_modules"), "StyleX Next loader transforms repository-owned source only");
  return normalizeLogicalPath(logical, "StyleX Next module path");
}

export async function transformStylexNextModule(request: StylexNextLoaderRequest): Promise<StylexNextLoaderResult> {
  const options = loaderOptions(request.options);
  const root = await realpath(options.rootDirectory);
  assert.equal(root, options.rootDirectory, "StyleX Next loader rootDirectory must not traverse a symlink");
  const resourcePath = await realpath(resolve(string(request.resourcePath, "StyleX Next loader resourcePath")));
  const logicalPath = belowRoot(root, resourcePath);
  assert.ok(/\.[cm]?[jt]sx?$/u.test(logicalPath), `StyleX Next loader received an unsupported source type: ${logicalPath}`);
  const sourceBytes = typeof request.source === "string" ? Buffer.from(request.source) : Buffer.from(request.source);
  const settledSource = await readFile(resourcePath);
  assert.ok(settledSource.equals(sourceBytes), `StyleX Next loader received pre-transformed or stale source: ${logicalPath}`);
  const attempt: StylexNextAttemptHandle = {
    directory: options.attemptDirectory,
    planSha256: options.planSha256,
  };
  const plan = await readStylexNextAttemptPlan(attempt);
  assert.equal(plan.compilerSha256, compilerSha256, "StyleX Next loader compiler differs from attempt plan");
  const graphId = graphIdForStylexNextTarget(options.target, plan.graphMap);
  const collector = createStylexTransformCollector(root);
  const transformed = await collector.transformWithMap(
    sourceBytes.toString("utf8"),
    resourcePath,
    {
      ...(request.inputSourceMap === undefined ? {} : { inputSourceMap: request.inputSourceMap }),
      logicalSourceFileName: logicalPath,
    },
  );
  const sealed = collector.seal();
  assert.deepEqual(sealed, canonicalizeStylexRules(transformed.rules), "StyleX Next one-module collector did not seal to its transformed rules");
  const outputBytes = Buffer.from(transformed.code);
  const mapSource = canonicalJson(transformed.map);
  const receipt = validateStylexNextModuleReceipt({
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: plan.attemptId,
    compilerSha256,
    graphId,
    input: { bytes: sourceBytes.byteLength, path: logicalPath, sha256: sha256(sourceBytes) },
    kind: "hraness-stylex-next-module",
    mode: options.mode,
    output: { bytes: outputBytes.byteLength, sha256: sha256(outputBytes) },
    rules: sealed,
    rulesSha256: stylexRulesSha256(sealed),
    schemaVersion: STYLEX_NEXT_MODULE_SCHEMA_VERSION,
    sourceMap: {
      inputSha256: transformed.inputMapSha256,
      logicalSourceFileName: transformed.logicalSourceFileName,
      output: { bytes: Buffer.byteLength(mapSource), sha256: sha256(mapSource) },
      sources: transformed.map.sources,
    },
    target: options.target,
  });
  await writeStylexNextModuleReceipt({
    attempt,
    mode: options.mode,
    receipt,
    rootDirectory: root,
  });
  return { code: transformed.code, map: transformed.map, receipt };
}
