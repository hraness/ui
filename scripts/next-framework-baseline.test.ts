import { expect, test } from "bun:test";
import { FrameworkDiagnostic, isExactFrameworkMismatch, readClientManifestKey } from "./next-framework-baseline.ts";

test("framework diagnostics keep bounded nonduplicated head and tail", () => {
  const small = new FrameworkDiagnostic(128);
  small.append("a".repeat(100)); small.append("b".repeat(80)); small.finish();
  expect(small.text()).toBe("a".repeat(100) + "b".repeat(80));
  small.append("c".repeat(400)); small.finish();
  expect(small.text()).toBe("a".repeat(100) + "b".repeat(28) + "\n[324 diagnostic characters omitted]\n" + "c".repeat(128));
});

test("exact framework diagnostics survive stream chunk boundaries and head-tail omission", () => {
  const log = new FrameworkDiagnostic(128);
  log.append('Error occurred prerendering page "/index/manifest-proof".\nError [InvariantError]: Invariant: The client reference mani');
  log.append('fest for route "/index/manifest-proof" does not exist. This is a bug in Next.js.\n');
  log.append("x\n".repeat(400)); log.finish();
  expect(log.facts()).toEqual({ compileFailure: false, lineOverflow: false, missingManifestRoutes: ["/index/manifest-proof"], prerenderRoutes: ["/index/manifest-proof"] });
  const outcome = { exitCode: 1, signal: null, timedOut: false, interrupted: false, groupReleased: true, facts: log.facts() };
  expect(isExactFrameworkMismatch(outcome, true)).toBe(true);
  for (const change of [{ exitCode: 0 }, { exitCode: 2 }, { timedOut: true }, { interrupted: true }, { groupReleased: false }, { signal: "SIGTERM" as const }]) {
    expect(isExactFrameworkMismatch({ ...outcome, ...change }, true)).toBe(false);
  }
  expect(isExactFrameworkMismatch(outcome, false)).toBe(false);
  log.append('Error occurred prerendering page "/other".\n'); log.finish();
  expect(isExactFrameworkMismatch({ ...outcome, facts: log.facts() }, true)).toBe(false);
  const unrelated = new FrameworkDiagnostic(128);
  unrelated.append("Failed to compile.\n"); unrelated.finish();
  expect(isExactFrameworkMismatch({ ...outcome, facts: unrelated.facts() }, true)).toBe(false);
  const similar = new FrameworkDiagnostic(128);
  similar.append('Invariant: The client reference manifest for route /index/manifest-proof does not exist.\n'); similar.finish();
  expect(similar.facts().missingManifestRoutes).toEqual([]);
});

test("client manifest envelope is strict data with its original route key", () => {
  const prefix = 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/index/manifest-proof/page"]=';
  const payload = { moduleLoading: {}, ssrModuleMapping: {}, edgeSSRModuleMapping: {}, clientModules: {}, entryCSSFiles: {}, rscModuleMapping: {}, edgeRscModuleMapping: {} };
  const source = `${prefix}${JSON.stringify(payload)};`;
  expect(readClientManifestKey(source)).toBe("/index/manifest-proof/page");
  for (const bad of [source + "evil();", `${prefix}(()=>({}))();`, `${prefix}{};`, source.replace("globalThis", "self"), source.slice(0, -1)]) expect(() => readClientManifestKey(bad)).toThrow();
});
