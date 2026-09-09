import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import { canonicalJson, compilerSha256, sha256, stylexUnionPolicySha256 } from "./compiler.js";
import { STYLEX_NEXT_ADAPTER_VERSION, defaultStylexNextGraphMap, validateStylexNextAuxiliaryTraceAsset, validateStylexNextAuxiliaryTraceSnapshot, validateStylexNextEmptyEntryBootstrap, validateStylexNextPostprocessingReceipt } from "./next-contracts.js";
import { validateStylexNextAttemptPlan } from "./next-generation.js";
import { STYLEX_NEXT_REQUIRED_VERSION, STYLEX_NEXT_PRODUCTION_VERSIONS, stylexNextProfile, stylexNextVersion } from "./next-profile.js";
import { stylexNextTypeEnvironment, validateStylexNextNativeTypeObservation } from "./next-typescript.js";

describe("exact Next production profiles", () => {
  test("retains the legacy default and rejects every unqualified version without coercion", () => {
    assert.equal(STYLEX_NEXT_REQUIRED_VERSION, "16.2.12");
    assert.deepEqual(STYLEX_NEXT_PRODUCTION_VERSIONS, ["16.2.12", "16.3.3"]);
    for (const version of STYLEX_NEXT_PRODUCTION_VERSIONS) assert.equal(stylexNextVersion(version), version);
    for (const version of [undefined, null, 16.3, "16.3.1", "16.3.4", "^16.3.3", "16.3.3-canary.1", " 16.3.3", { toString: () => "16.3.3" }]) {
      assert.throws(() => stylexNextVersion(version));
    }
  });

  test("keeps creator matrices immutable and each version's changed writers separate", () => {
    const old = stylexNextProfile("16.2.12");
    const next = stylexNextProfile("16.3.3");
    assert.equal(old.frameworkInputs, next.frameworkInputs, "byte-identical manifest writers retain exactly the same pins");
    assert.notDeepEqual(old.auxiliaryTraceCreator, next.auxiliaryTraceCreator);
    assert.equal(old.auxiliaryTraceCreator[1], "6178f6d18b0b96c38cff2b0df1494aabdcdee37d631e62e77974f14e244f2c5b");
    assert.equal(next.auxiliaryTraceCreator[1], "06f4f8021a332ce2dcb384c349bac7d89e770856bb381b1a1350c3c864fcfbb2");
    assert.notDeepEqual(old.proxyRenameCreator, next.proxyRenameCreator);
    assert.notDeepEqual(old.emptyEntryInputs, next.emptyEntryInputs);
    assert.notDeepEqual(old.ssgInputs, next.ssgInputs);
    assert.equal(old.typeInputs["dist/server/lib/router-utils/root-params-type-utils.js"], undefined);
    assert.equal(next.typeInputs["dist/server/lib/router-utils/root-params-type-utils.js"], "d08e53213b27e02f5b7825c863f90c27d6885f096b6234781068c0cf0678e0a2");
    for (const profile of [old, next]) {
      for (const value of [profile, profile.frameworkInputs, profile.auxiliaryTraceCreator, profile.proxyRenameCreator, profile.emptyEntryInputs, ...profile.emptyEntryInputs, profile.ssgInputs, ...profile.ssgInputs, profile.typeInputs, profile.nativeTypeNames]) assert.ok(Object.isFrozen(value));
      for (const inputs of [profile.emptyEntryInputs, profile.ssgInputs]) {
        assert.deepEqual(inputs.map(([path]) => path), [...new Set(inputs.map(([path]) => path))].sort());
        for (const [path, hash] of inputs) { assert.match(path, /^dist\//u); assert.match(hash, /^[a-f0-9]{64}$/u); }
      }
    }
  });

  test("keeps trace and proxy rename creators version-bound without admitting new server entries", () => {
    const artifact = (path: string) => ({ path, bytes: 1, sha256: sha256(path) });
    const creator = ([path, hash]: readonly [string, string]) => ({ path: `node_modules/next/${path}`, bytes: 1, sha256: hash });
    for (const version of STYLEX_NEXT_PRODUCTION_VERSIONS) {
      const profile = stylexNextProfile(version);
      const opposite = stylexNextProfile(version === "16.2.12" ? "16.3.3" : "16.2.12");
      const asset = { kind: "next-node-dependency-trace", entrypoint: "proxy", creator: creator(profile.auxiliaryTraceCreator), initial: artifact("server/proxy.js.nft.json") };
      assert.deepEqual(validateStylexNextAuxiliaryTraceAsset(asset, version), asset);
      assert.throws(() => validateStylexNextAuxiliaryTraceAsset(asset, opposite.version), /selected Next profile/u);
      assert.throws(() => validateStylexNextAuxiliaryTraceAsset({ ...asset, creator: creator(opposite.auxiliaryTraceCreator) }, version), /selected Next profile/u);
      for (const entrypoint of ["middleware", "src/middleware", "src/proxy", "proxy-extra"]) {
        assert.throws(() => validateStylexNextAuxiliaryTraceAsset({ ...asset, entrypoint, initial: artifact(`server/${entrypoint}.js.nft.json`) }, version), /entrypoint/u);
      }
      const initial = artifact("server/proxy.js");
      const snapshot = { asset, output: artifact("server/middleware.js.nft.json"), semantics: "observation-only", proxyRename: {
        absent: ["server/proxy.js", "server/proxy.js.nft.json"], creator: creator(profile.proxyRenameCreator),
        initial, output: { ...initial, path: "server/middleware.js" }, sourceMap: artifact("server/proxy.js.map"),
      } };
      assert.deepEqual(validateStylexNextAuxiliaryTraceSnapshot(snapshot, version), snapshot);
      assert.throws(() => validateStylexNextAuxiliaryTraceSnapshot({ ...snapshot, proxyRename: { ...snapshot.proxyRename, creator: creator(opposite.proxyRenameCreator) } }, version), /selected Next profile/u);
      assert.throws(() => validateStylexNextAuxiliaryTraceSnapshot({ ...snapshot, semantics: "deployment-proof" }, version), /dependency or deployment proof/u);
    }
  });

  test("binds exact profile identity into canonical attempt bytes", () => {
    const base = { adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "profile", compilerSha256, graphMap: defaultStylexNextGraphMap,
      kind: "hraness-stylex-next-attempt", outputDirectory: ".next", packageManifests: [{ artifact: { path: "manifest.json", bytes: 0, sha256: sha256("") }, identity: { name: "@fixture/ui", version: "1.0.0", manifestSha256: sha256("") } }],
      requiredSources: { client: ["app/page.tsx"], "edge-rsc": [], "node-rsc": [] }, schemaVersion: 2, unionPolicySha256: stylexUnionPolicySha256 };
    const plans = STYLEX_NEXT_PRODUCTION_VERSIONS.map((nextVersion) => validateStylexNextAttemptPlan({ ...base, nextVersion }));
    assert.notEqual(sha256(canonicalJson(plans[0])), sha256(canonicalJson(plans[1])));
    assert.throws(() => validateStylexNextAttemptPlan({ ...base, nextVersion: "16.3.2" }));
  });

  test("requires only the selected native type inventory and rejects mixed creators, omissions and foreign roots", () => {
    const distDir = ".next";
    const plan = sha256("plan");
    const artifact = (name: string) => ({ path: `${distDir}/types/${name}`, bytes: 0, sha256: sha256("") });
    for (const nextVersion of STYLEX_NEXT_PRODUCTION_VERSIONS) {
      const profile = stylexNextProfile(nextVersion);
      const opposite = stylexNextProfile(nextVersion === "16.2.12" ? "16.3.3" : "16.2.12");
      const observation = { artifacts: profile.nativeTypeNames.map(artifact), distDir, kind: "hraness-next-native-type-writers", mode: "discovery", nativeInputs: profile.typeInputs, nextVersion, planSha256: plan, schemaVersion: 1 };
      const validate = (value: unknown) => validateStylexNextNativeTypeObservation(value, plan, "discovery", distDir, nextVersion);
      assert.deepEqual(validate(observation), observation.artifacts);
      assert.throws(() => validate({ ...observation, nextVersion: opposite.version }), /profile/u);
      assert.throws(() => validate({ ...observation, nativeInputs: opposite.typeInputs }), /pins/u);
      assert.throws(() => validate({ ...observation, planSha256: sha256("other") }));
      assert.throws(() => validate({ ...observation, artifacts: [...observation.artifacts, artifact("unknown.d.ts")].sort((a, b) => a.path.localeCompare(b.path)) }));
      for (const required of profile.requiredNativeTypeNames) assert.throws(() => validate({ ...observation, artifacts: observation.artifacts.filter(({ path }) => path !== artifact(required).path) }));
      for (const replacement of [artifact("../foreign.d.ts"), { ...artifact("routes.d.ts"), path: ".other/types/routes.d.ts" }]) assert.throws(() => validate({ ...observation, artifacts: [replacement] }));
    }
  });

  test("projects the exact version-specific native environment imports with unchanged authored line endings", () => {
    for (const strictRouteTypes of [false, true]) for (const typedRoutes of [false, true]) for (const eol of ["\n", "\r\n"]) {
      const config = { experimental: { strictRouteTypes }, typedRoutes };
      const prior = { source: `// retained${eol}// original${eol}`, mode: 0o644 };
      const old = stylexNextTypeEnvironment(config, ".next", prior, "16.2.12");
      const next = stylexNextTypeEnvironment(config, ".next", prior, "16.3.3");
      assert.equal(next, old.replace(`import "./.next/types/routes.d.ts";${eol}`, `import "./.next/types/routes.d.ts";${eol}import "./.next/types/root-params.d.ts";${eol}`));
      assert.ok(!old.includes("root-params"));
    }
  });

  test("rejects mixing profile creator rows inside empty-entry and postprocessing records", () => {
    const graph = { chunkIds: [1], dependencies: [], entryModuleId: 2, entrypoints: ["empty"], loader: "node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js", loaderOptions: "server=false", originalSource: { bytes: 0, sha256: sha256("") } };
    const output = { path: "static/empty.js", bytes: 0, sha256: sha256("") };
    for (const nextVersion of STYLEX_NEXT_PRODUCTION_VERSIONS) {
      const profile = stylexNextProfile(nextVersion);
      const inputs = profile.emptyEntryInputs.map(([path, hash]) => ({ path: `node_modules/next/${path}`, sha256: hash, bytes: 1 }));
      assert.deepEqual(validateStylexNextEmptyEntryBootstrap({ graph, inputs, output }, nextVersion).inputs, inputs);
      assert.throws(() => validateStylexNextEmptyEntryBootstrap({ graph, inputs, output }, nextVersion === "16.2.12" ? "16.3.3" : "16.2.12"));
      const receipt = { adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "profile", auxiliaryTraceSnapshots: [], compilerSha256, graphs: ["client", "edge-rsc", "node-rsc"].map((target) => ({ graphId: target, target, receiptSha256: sha256(target) })), kind: "hraness-stylex-next-postprocessing", mode: "discovery", nextVersion, outputDirectory: ".next", planSha256: sha256(nextVersion), schemaVersion: 1, ssg: [] };
      assert.equal(validateStylexNextPostprocessingReceipt(receipt).nextVersion, nextVersion);
    }
  });
});
