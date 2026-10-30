import assert from "node:assert/strict";
import { normalizeLogicalPath } from "./compiler.js";
import type { StylexNextVersion } from "./next-profile.js";

/** A separate opt-in, never an interpretation of an ordinary server receipt. */
export type StylexNextStaticExportProfileV1 = Readonly<{
  kind: "static-export";
  schemaVersion: 1;
  directory: string;
}>;

export type StylexNextProductionLocations = Readonly<{
  nativeDirectory: string;
  retainedDirectory: string;
  exportDirectory: string | null;
}>;

export function validateStylexNextStaticExportProfile(value: unknown, nextVersion: StylexNextVersion): StylexNextStaticExportProfileV1 {
  assert.equal(nextVersion, "16.2.12", "The static-export profile requires its exact source-pinned Next version");
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "Static-export profile must be an object");
  const item = value as Record<string, unknown>;
  assert.ok(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, "Static-export profile must be a plain object");
  assert.deepEqual(Object.keys(item).sort(), ["directory", "kind", "schemaVersion"], "Static-export profile has unknown or missing keys");
  assert.equal(item.kind, "static-export");
  assert.equal(item.schemaVersion, 1);
  const directory = normalizeLogicalPath(item.directory, "Static-export directory");
  // Next recursively removes this destination. No application, package, public
  // asset, or native-output root can be interpreted as an export destination.
  for (const reserved of [".git", ".next", "node_modules", "app", "src", "pages", "public", "static"]) {
    assert.ok(directory !== reserved && !directory.startsWith(`${reserved}/`), "Static-export directory overlaps a protected input root");
  }
  return { kind: "static-export", schemaVersion: 1, directory };
}

function disjoint(left: string, right: string): void {
  assert.ok(left !== right && !left.startsWith(`${right}/`) && !right.startsWith(`${left}/`), "Next production directories must be path-disjoint");
}

/** Native origins and retained storage are distinct identities. An export
 * archive is not a compiler outputPath, tsconfig include root, or executable. */
export function stylexNextProductionLocations(options: Readonly<{
  attemptId: string;
  mode: "discovery" | "delivery";
  nextVersion: StylexNextVersion;
  outputDirectory: string;
  stateDirectory: string;
  staticExport?: StylexNextStaticExportProfileV1;
}>): StylexNextProductionLocations {
  assert.match(options.attemptId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Next attempt identity must be one safe segment");
  assert.ok(options.mode === "discovery" || options.mode === "delivery", "Unknown Next production phase");
  const output = normalizeLogicalPath(options.outputDirectory, "Next native output directory");
  const state = normalizeLogicalPath(options.stateDirectory, "Next state directory");
  disjoint(output, state);
  const attempt = `${state}/${options.attemptId}`;
  if (options.staticExport === undefined) {
    const nativeDirectory = options.mode === "discovery" ? `${attempt}/next-discovery` : output;
    return { nativeDirectory, retainedDirectory: nativeDirectory, exportDirectory: null };
  }
  const profile = validateStylexNextStaticExportProfile(options.staticExport, options.nextVersion);
  assert.equal(output, ".next", "Native static-export output is exactly .next, independently of the export destination");
  disjoint(profile.directory, state);
  disjoint(profile.directory, output);
  return {
    nativeDirectory: ".next",
    retainedDirectory: options.mode === "discovery" ? `${attempt}/next-discovery` : ".next",
    exportDirectory: options.mode === "discovery" ? `${attempt}/export-discovery` : profile.directory,
  };
}

/** Config factories remain in the native child. Its already-resolved config
 * must agree with the explicit attempt, including compile-time export mode. */
export function assertStylexNextStaticExportConfig(config: Readonly<Record<string, unknown>>, profile: StylexNextStaticExportProfileV1): void {
  assert.equal(config.output, "export", "The static-export attempt requires compile-time output: export");
  assert.ok(config.distDir === undefined || config.distDir === ".next" || config.distDir === profile.directory,
    "Authored static-export distDir differs from the declared export destination");
  assert.notEqual(config.cleanDistDir, false, "Static-export requires the next genuine native build to clean its own output");
}
