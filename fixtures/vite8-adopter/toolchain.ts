import assert from "node:assert/strict";

// Vite's own dependency range is not a qualification pin. Exercise both
// observed Rolldown bindings, including the current transitive release.
export const viteMatrixToolchains = [
  { vite: "7.3.6", bundler: "rollup", version: "4.63.1" },
  { vite: "8.2.1", bundler: "rolldown", version: "1.2.7" },
  { vite: "8.2.1", bundler: "rolldown", version: "1.2.8" },
] as const;

export type ViteMatrixToolchain = (typeof viteMatrixToolchains)[number];

export function viteMatrixToolchain(vite: unknown, version: unknown): ViteMatrixToolchain {
  const profile = viteMatrixToolchains.find((item) => item.vite === vite && item.version === version);
  assert.ok(profile !== undefined, "Unqualified Vite matrix toolchain");
  return profile;
}

export function assertViteMatrixNativeToolchain(meta: unknown, profile: ViteMatrixToolchain): void {
  assert.ok(typeof meta === "object" && meta !== null && !Array.isArray(meta), "Missing native Vite toolchain");
  assert.ok("viteVersion" in meta && meta.viteVersion === profile.vite, "Native Vite version drifted");
  if (profile.bundler === "rolldown") {
    assert.ok("rolldownVersion" in meta && meta.rolldownVersion === profile.version, "Native Rolldown version drifted");
  } else {
    assert.ok(!("rolldownVersion" in meta) && "rollupVersion" in meta && meta.rollupVersion === profile.version,
      "Native Rollup identity drifted");
  }
}
