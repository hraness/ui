import assert from "node:assert/strict";

// Each exact profile retains its own audited creator closure. No semver ranges,
// installed-version inference, or unknown-version fallback are admitted.
export const STYLEX_NEXT_REQUIRED_VERSION = "16.2.12" as const;
export const STYLEX_NEXT_PRODUCTION_VERSIONS = Object.freeze(["16.2.12", "16.3.3"] as const);
export type StylexNextVersion = (typeof STYLEX_NEXT_PRODUCTION_VERSIONS)[number];
export function stylexNextVersion(value: unknown): StylexNextVersion {
  assert.ok(value === "16.2.12" || value === "16.3.3", "Next production profile must be exactly 16.2.12 or 16.3.3");
  return value;
}

export const STYLEX_NEXT_FRAMEWORK_INPUTS = {
  "build-manifest": ["dist/build/webpack/plugins/build-manifest-plugin.js", "692c330f4409ea48f411627f578942ca8dcf2d24eb4df11d58b110257f580ed1"],
  "client-reference-manifest": ["dist/build/webpack/plugins/flight-manifest-plugin.js", "2da1604d0f0d8f58db53b486e880a81279f7ce9c7af429994c5c9083c6dca83c"],
  "dynamic-css-manifest": ["dist/build/webpack/plugins/react-loadable-plugin.js", "499bedae83deb834a9095733b19f54285b1510a0360cf6b391eb6dd08193f319"],
  "interception-rewrite-manifest": ["dist/build/webpack/plugins/middleware-plugin.js", "a5f6ba8cf8b1b172f9ed80f157ddfb20d27653f57c513ad8bdc3438a2e6c8cc7"],
  "middleware-build-manifest": ["dist/build/webpack/plugins/build-manifest-plugin.js", "692c330f4409ea48f411627f578942ca8dcf2d24eb4df11d58b110257f580ed1"],
  "next-font-manifest": ["dist/build/webpack/plugins/next-font-manifest-plugin.js", "54be807a169ba5d46651e8d324daac1feb7b9bd2340d6f8ecf539072ddcfe413"],
  "polyfill-nomodule": ["dist/build/polyfills/polyfill-nomodule.js", "0973c1d64c88adc8e3c950410cb58b288f72118d5965b78049438deb8f2f9683"],
  "react-loadable-manifest": ["dist/build/webpack/plugins/react-loadable-plugin.js", "499bedae83deb834a9095733b19f54285b1510a0360cf6b391eb6dd08193f319"],
  "server-reference-manifest": ["dist/build/webpack/plugins/flight-client-entry-plugin.js", "706cc85161af67344b454f0c32d4e0080a97910a3f6e81f71e23d181aa48cc60"],
  "ssg-manifest": ["dist/build/webpack/plugins/build-manifest-plugin.js", "692c330f4409ea48f411627f578942ca8dcf2d24eb4df11d58b110257f580ed1"],
} as const;
for (const input of Object.values(STYLEX_NEXT_FRAMEWORK_INPUTS)) Object.freeze(input);
Object.freeze(STYLEX_NEXT_FRAMEWORK_INPUTS);

export const STYLEX_NEXT_AUXILIARY_TRACE_CREATOR = Object.freeze([
  "dist/build/webpack/plugins/next-trace-entrypoints-plugin.js",
  "6178f6d18b0b96c38cff2b0df1494aabdcdee37d631e62e77974f14e244f2c5b",
] as const);

export const STYLEX_NEXT_PROXY_RENAME_CREATOR = Object.freeze([
  "dist/build/index.js",
  "52cb337f5b0037a81ff0452cfbeb55760d3eafd026a5d5dc5f1c6cc5c4fe35c4",
] as const);

export const STYLEX_NEXT_EMPTY_ENTRY_INPUTS = Object.freeze([
  Object.freeze(["dist/build/webpack/loaders/next-flight-client-entry-loader.js", "b5e8df94598e87dfd8be3a6676473bd3fb03731471cfe9525e2236a3f2c6ad40"] as const),
  Object.freeze(["dist/build/webpack/plugins/flight-client-entry-plugin.js", "706cc85161af67344b454f0c32d4e0080a97910a3f6e81f71e23d181aa48cc60"] as const),
  Object.freeze(["dist/build/webpack/plugins/minify-webpack-plugin/src/index.js", "650f861407d459333cc56ce12b78aa12cb8cf4da34a7b03d0dd90bb287263458"] as const),
  Object.freeze(["dist/compiled/webpack/bundle5.js", "4293b6eb020382002a67bccdc2ccdaf6760fe041dd42de314e20fea7ca5a7ab7"] as const),
]);

export const STYLEX_NEXT_SSG_INPUTS = Object.freeze([
  Object.freeze(["dist/build/generate-routes-manifest.js", "3f0dd0b6de1e9ed575287e06938ec5f29eb9aff7f09e9753e32d5f75a3356a63"] as const),
  Object.freeze(["dist/build/index.js", "52cb337f5b0037a81ff0452cfbeb55760d3eafd026a5d5dc5f1c6cc5c4fe35c4"] as const),
  Object.freeze(["dist/build/manifests/formatter/format-manifest.js", "faaffe04142094339e505513e4bd87e38bccc738ebbee515c7ff35defd1aba08"] as const),
  Object.freeze(["dist/build/webpack/plugins/build-manifest-plugin-utils.js", "5b78265200c7de40ead5e72a861c4e760ccf88f2b08c160158397df7d6e0a833"] as const),
  Object.freeze(STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"]),
  Object.freeze(["dist/build/webpack/plugins/minify-webpack-plugin/src/index.js", "650f861407d459333cc56ce12b78aa12cb8cf4da34a7b03d0dd90bb287263458"] as const),
  Object.freeze(["dist/compiled/devalue/devalue.umd.js", "5ad710b029a96bce551c39237bd04d23ac09b44f0e702afc9fcc2809b4160c2d"] as const),
  Object.freeze(["dist/shared/lib/i18n/normalize-locale-path.js", "40cbb5497856644b8cae7ea217d2d2677bc01f910db9d598852a214cc4496031"] as const),
]);

const TYPE_INPUTS_16212 = {
  "dist/build/index.js": "52cb337f5b0037a81ff0452cfbeb55760d3eafd026a5d5dc5f1c6cc5c4fe35c4",
  "dist/build/webpack/plugins/next-types-plugin/index.js": "13423b82cc011e96aa60b086b3e48ed8e74773d87b7a8748ae99de844abd5eb8",
  "dist/lib/typescript/writeConfigurationDefaults.js": "a634ad2820c47afd37f26382bc1986ca6895cf8cb251d2023889893674d3704d",
  "dist/lib/typescript/writeAppTypeDeclarations.js": "bfaa647d1011ff22f39fac8f8bfdaac4637afe784826ec56f6fb53a757d5baeb",
  "dist/server/lib/router-utils/route-types-utils.js": "d3a25af9b04fa6551d3961f88d4899d69c4cf0144262822ac1c8890f6ee11098",
  "dist/server/lib/router-utils/typegen.js": "5671ce0ea3fc6fc5fdc0fe7d2a98bf8cd77aff67b0d101375973dbc47a06d447",
  "dist/server/lib/router-utils/cache-life-type-utils.js": "81d55d26cd176ebb6e81e864e8acef656ad1d601802c839e8e32aa5053bf2caa",
} as const;

const TYPE_INPUTS_1633 = {
  ...TYPE_INPUTS_16212,
  "dist/build/index.js": "2c9f8a3988652a411219f032fda2a5b2a5c5fe1e0808c58f17f58dffaee751e6",
  "dist/build/webpack/plugins/next-types-plugin/index.js": "41717f26d693be54182ec45a4936f7057fdce2721ac0caade0f4054998906107",
  "dist/lib/typescript/writeAppTypeDeclarations.js": "3973ebf0093b08136059a790442951ba498421627a52bfcf06e1584360e034c9",
  "dist/server/lib/router-utils/route-types-utils.js": "e58d369918d9e3c9f50b429cc5cc85881aa57b9c73791fc3bad5cfadcf26c952",
  "dist/server/lib/router-utils/typegen.js": "ae5c59e939b908320e9e90247e478b607977dd61ea88b451cb0f4c39da05ff00",
  "dist/server/lib/router-utils/cache-life-type-utils.js": "aefb34d4c524542e5fd8d5c3d8da7d8697d428901efa1c79a526bac4769be714",
  "dist/server/lib/router-utils/root-params-type-utils.js": "d08e53213b27e02f5b7825c863f90c27d6885f096b6234781068c0cf0678e0a2",
} as const;

type Creator = readonly [path: string, sha256: string];
export const STYLEX_NEXT_BUILTIN_GLOBAL_ERROR_ENTRY = "next/dist/client/components/builtin/global-error" as const;
const builtinGlobalErrorInputs = (loaderHash: string): readonly Creator[] => Object.freeze([
  Object.freeze(["dist/build/webpack/loaders/next-app-loader/index.js", loaderHash] as const),
  Object.freeze(STYLEX_NEXT_FRAMEWORK_INPUTS["server-reference-manifest"]),
  Object.freeze(["dist/client/components/builtin/global-error.js", "773bfaf8baf4d1a40a58e887d1be8c071bd821063a643c91f34d8d2bf73150bf"] as const),
]);
type Profile = Readonly<{
  version: StylexNextVersion;
  frameworkInputs: typeof STYLEX_NEXT_FRAMEWORK_INPUTS;
  auxiliaryTraceCreator: Creator;
  proxyRenameCreator: Creator;
  emptyEntryInputs: readonly Creator[];
  builtinGlobalErrorInputs: readonly Creator[];
  ssgInputs: readonly Creator[];
  typeInputs: Readonly<Record<string, string>>;
  nativeTypeNames: readonly string[];
  requiredNativeTypeNames: readonly string[];
  rootParams: boolean;
}>;

const profiles: Readonly<Record<StylexNextVersion, Profile>> = Object.freeze({
  "16.2.12": Object.freeze({
    version: "16.2.12", frameworkInputs: STYLEX_NEXT_FRAMEWORK_INPUTS,
    auxiliaryTraceCreator: STYLEX_NEXT_AUXILIARY_TRACE_CREATOR,
    proxyRenameCreator: STYLEX_NEXT_PROXY_RENAME_CREATOR,
    emptyEntryInputs: STYLEX_NEXT_EMPTY_ENTRY_INPUTS, ssgInputs: STYLEX_NEXT_SSG_INPUTS,
    builtinGlobalErrorInputs: builtinGlobalErrorInputs("4a539177b3c57dd972bbe82c520d65f529a9c42856c61d2226f1e0cc75c0859c"),
    typeInputs: Object.freeze(TYPE_INPUTS_16212),
    nativeTypeNames: Object.freeze(["cache-life.d.ts", "link.d.ts", "routes.d.ts", "validator.ts"]),
    requiredNativeTypeNames: Object.freeze(["routes.d.ts", "validator.ts"]), rootParams: false,
  }),
  "16.3.3": Object.freeze({
    version: "16.3.3", frameworkInputs: STYLEX_NEXT_FRAMEWORK_INPUTS,
    // This writer also traces root proxy sources and module-sync candidates.
    // Its NFT output remains bounded observation-only metadata, not authority
    // to follow dependencies or admit additional compiler entrypoints.
    auxiliaryTraceCreator: Object.freeze([
      "dist/build/webpack/plugins/next-trace-entrypoints-plugin.js",
      "06f4f8021a332ce2dcb384c349bac7d89e770856bb381b1a1350c3c864fcfbb2",
    ] as const),
    proxyRenameCreator: Object.freeze(["dist/build/index.js", TYPE_INPUTS_1633["dist/build/index.js"]] as const),
    builtinGlobalErrorInputs: builtinGlobalErrorInputs("b04a8fa83526dda4e4b906f68cf5b1f5890692d452f47cfb4f492cfbaba0396b"),
    emptyEntryInputs: Object.freeze(STYLEX_NEXT_EMPTY_ENTRY_INPUTS.map(([path, hash]): Creator => Object.freeze([
      path, path === "dist/compiled/webpack/bundle5.js" ? "1a8627c55931e3486fc71af9cf2d7de1f0ccf34d6011607fe05ed5404f3b77b9" : hash,
    ]))),
    ssgInputs: Object.freeze(STYLEX_NEXT_SSG_INPUTS.map(([path, hash]): Creator => Object.freeze([
      path, path === "dist/build/index.js" ? TYPE_INPUTS_1633["dist/build/index.js"]
        : path === "dist/compiled/devalue/devalue.umd.js" ? "af28257cb157845d45caf6f06e582bdd5bd438e2ad066949bdfd2186837d0232" : hash,
    ]))),
    typeInputs: Object.freeze(TYPE_INPUTS_1633),
    nativeTypeNames: Object.freeze(["cache-life.d.ts", "link.d.ts", "root-params.d.ts", "routes.d.ts", "validator.ts"]),
    requiredNativeTypeNames: Object.freeze(["root-params.d.ts", "routes.d.ts", "validator.ts"]), rootParams: true,
  }),
});

export function stylexNextProfile(version: StylexNextVersion): Profile {
  return profiles[stylexNextVersion(version)];
}
