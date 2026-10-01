import assert from "node:assert/strict";
import { test } from "bun:test";
import { assertStylexNextStaticExportConfig, stylexNextProductionLocations, validateStylexNextStaticExportProfile } from "./next-export-profile.js";

const profile = { kind: "static-export", schemaVersion: 1, directory: "out" } as const;
const options = { attemptId: "export-a", nextVersion: "16.2.12", outputDirectory: ".next", stateDirectory: ".stylex-next" } as const;

test("ordinary production locations retain their original phase semantics", () => {
  for (const nextVersion of ["16.2.12", "16.3.3"] as const) {
    assert.deepEqual(stylexNextProductionLocations({ ...options, nextVersion, mode: "discovery" }), {
      nativeDirectory: ".stylex-next/export-a/next-discovery", retainedDirectory: ".stylex-next/export-a/next-discovery", exportDirectory: null,
    });
    assert.deepEqual(stylexNextProductionLocations({ ...options, nextVersion, outputDirectory: "custom-build", mode: "delivery" }), {
      nativeDirectory: "custom-build", retainedDirectory: "custom-build", exportDirectory: null,
    });
  }
});

test("export destinations never select a different native origin or output lease identity", () => {
  for (const directory of ["out", "export-other", "artifacts/site"]) {
    const staticExport = { ...profile, directory };
    assert.deepEqual(stylexNextProductionLocations({ ...options, staticExport, mode: "discovery" }), {
      nativeDirectory: ".next", retainedDirectory: ".stylex-next/export-a/next-discovery", exportDirectory: ".stylex-next/export-a/export-discovery",
    });
    assert.deepEqual(stylexNextProductionLocations({ ...options, staticExport, mode: "delivery" }), {
      nativeDirectory: ".next", retainedDirectory: ".next", exportDirectory: directory,
    });
  }
});

test("static export is exact, opt-in and path-disjoint", () => {
  assert.deepEqual(validateStylexNextStaticExportProfile(profile, "16.2.12"), profile);
  for (const value of [null, [], {}, { ...profile, output: "export" }, { ...profile, schemaVersion: 2 }, { ...profile, kind: "server" }]) {
    assert.throws(() => validateStylexNextStaticExportProfile(value, "16.2.12"));
  }
  assert.throws(() => validateStylexNextStaticExportProfile(profile, "16.3.3"));
  for (const directory of ["", ".", "..", "../out", "/out", "out/../other", "out\\other", ".next", ".next/out", "public", "static/out", "app", "src/out", "node_modules/out", ".git/out"]) {
    assert.throws(() => validateStylexNextStaticExportProfile({ ...profile, directory }, "16.2.12"), `Reject directory ${JSON.stringify(directory)}`);
  }
  for (const directory of [".stylex-next", ".stylex-next/export-a", "state", "state/outer"] as const) {
    assert.throws(() => stylexNextProductionLocations({ ...options, stateDirectory: directory.startsWith("state") ? "state/outer" : ".stylex-next", staticExport: { ...profile, directory }, mode: "discovery" }));
  }
  assert.throws(() => stylexNextProductionLocations({ ...options, outputDirectory: "out", staticExport: profile, mode: "discovery" }));
  assert.throws(() => stylexNextProductionLocations({ ...options, attemptId: "../prior", staticExport: profile, mode: "discovery" }));
});

test("resolved config must preserve export mode without invoking a factory", () => {
  for (const distDir of [undefined, ".next", "out"]) assertStylexNextStaticExportConfig({ output: "export", ...(distDir === undefined ? {} : { distDir }) }, profile);
  for (const config of [{}, { output: "standalone" }, { output: "export", distDir: "other" }, { output: "export", cleanDistDir: false }]) {
    assert.throws(() => assertStylexNextStaticExportConfig(config, profile));
  }
});
