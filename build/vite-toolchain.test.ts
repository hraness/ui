import { expect, test } from "bun:test";
import { assertViteMatrixNativeToolchain, viteMatrixToolchain, viteMatrixToolchains } from "../fixtures/vite8-adopter/toolchain.ts";

test("every matrix profile binds its native engine rather than Vite's floating dependency range", () => {
  expect(viteMatrixToolchains).toHaveLength(3);
  expect(new Set(viteMatrixToolchains.map((profile) => `${profile.vite}/${profile.version}`)).size).toBe(3);
  for (const profile of viteMatrixToolchains) {
    expect(viteMatrixToolchain(profile.vite, profile.version)).toBe(profile);
    const meta = { viteVersion: profile.vite, rollupVersion: profile.bundler === "rollup" ? profile.version : "4.23.0",
      ...(profile.bundler === "rolldown" ? { rolldownVersion: profile.version } : {}) };
    expect(() => assertViteMatrixNativeToolchain(meta, profile)).not.toThrow();
    for (const foreign of [null, [], {}, { ...meta, viteVersion: "8.2.2" },
      { ...meta, [profile.bundler === "rollup" ? "rollupVersion" : "rolldownVersion"]: "unqualified" },
      ...(profile.bundler === "rollup" ? [{ ...meta, rolldownVersion: "1.2.8" }] : [])]) {
      expect(() => assertViteMatrixNativeToolchain(foreign, profile)).toThrow();
    }
  }
  for (const pair of [["8.2.1", "1.2.9"], ["8.2.2", "1.2.8"], ["7.3.6", "1.2.8"], [undefined, "1.2.8"], ["8.2.1", null]]) {
    expect(() => viteMatrixToolchain(...pair as [unknown, unknown])).toThrow("Unqualified");
  }
});
