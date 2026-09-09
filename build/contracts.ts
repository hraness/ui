export const STYLEX_COMPILER_CONTRACT_VERSION = "hraness-stylex-compiler-v1" as const;
export const STYLEX_COMPLETE_RECORD_SCHEMA_VERSION = 2 as const;
export const STYLEX_GENERATION_SCHEMA_VERSION = 2 as const;
export const STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION = 1 as const;
export const STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const STYLEX_TEMPLATE_CSS_PLACEHOLDER = "__HRANESS_STYLEX_CSS__" as const;

export type StylexArtifactV1 = Readonly<{
  bytes: number;
  path: string;
  sha256: string;
}>;

export type StylexRuleValueV1 = Readonly<{
  constKey?: string;
  constVal?: number | string;
  ltr: string;
  rtl?: null | string;
}>;

export type StylexRuleV1 = readonly [
  key: string,
  value: StylexRuleValueV1,
  priority: number,
];

export type StylexCompilerContractV1 = Readonly<{
  compilerContractVersion: typeof STYLEX_COMPILER_CONTRACT_VERSION;
  css: Readonly<{
    filename: "stylex.css";
    layerPrelude: "complete-finite";
    topLevelLayers: readonly ["base", "components"];
    targets: Readonly<{
      chrome: 7143424;
      firefox: 7536640;
      ios_saf: 1049600;
      safari: 1049600;
    }>;
  }>;
  schemaVersion: 1;
  serializer: Readonly<{
    enableLTRRTLComments: false;
    useLayers: Readonly<{
      before: readonly [
        "components.hraness-ui.legacy.base",
        "components.hraness-ui.legacy",
      ];
      prefix: "components.hraness-ui";
    }>;
  }>;
  tools: Readonly<{
    babelCore: "7.29.7";
    lightningcss: "1.33.0";
    stylex: "0.19.0";
    stylexBabelCompatibility: Readonly<{
      entry: "lib/index.js";
      patchId: string;
      patchSha256: string;
      patchedSourceBytes: number;
      patchedSourceSha256: string;
      sourceBytes: number;
      sourceSha256: string;
    }>;
  }>;
  transform: Readonly<{
    classNamePrefix: "x";
    dev: false;
    enableMediaQueryOrder: true;
    importSources: readonly ["@stylexjs/stylex"];
    logicalRoot: "<graph-root>";
    moduleResolution: "commonJS";
    propertyValidationMode: "throw";
    sourceType: "unambiguous";
    styleResolution: "property-specificity";
    sxPropName: false;
    treeshakeCompensation: true;
  }>;
}>;

export type StylexStandaloneSerializerV1 = Readonly<{
  before: readonly string[];
  prefix: string;
}>;

export type StylexPackageManifestV1 = Readonly<{
  buildTools: readonly StylexArtifactV1[];
  compiler: StylexCompilerContractV1;
  compilerSha256: string;
  compilerFoundation: string;
  kind: "hraness-stylex-package-manifest";
  package: Readonly<{
    name: string;
    version: string;
  }>;
  rules: readonly StylexRuleV1[];
  rulesSha256: string;
  runtime: readonly StylexArtifactV1[];
  schemaVersion: typeof STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION;
  standaloneCss: StylexArtifactV1;
  standaloneSerializer: StylexStandaloneSerializerV1;
  stylesheets: readonly StylexArtifactV1[];
}>;

export type StylexGraphAdapterV1 = "bun" | "vite";
export type StylexGraphKindV1 = "client" | "ssr";

export type StylexGraphExpectationV1 = Readonly<{
  adapter: StylexGraphAdapterV1;
  entrypoints: readonly string[];
  id: string;
  kind: StylexGraphKindV1;
}>;

export type StylexTemplateV1 = Readonly<{
  cssHref: string;
  graphId?: string;
  outputPath: string;
  sourcePath: string;
  stylesheetGraphId: string;
}>;

export type StylexPackageIdentityV1 = Readonly<{
  manifestSha256: string;
  name: string;
  version: string;
}>;

export type StylexGenerationPlanV1 = Readonly<{
  compiler: StylexCompilerContractV1;
  compilerSha256: string;
  expectedGraphs: readonly StylexGraphExpectationV1[];
  finalCssPath: string;
  generationId: string;
  kind: "hraness-stylex-generation";
  packages: readonly StylexPackageIdentityV1[];
  schemaVersion: 1;
  templates: readonly StylexTemplateV1[];
}>;

/** Cross-package deliveries bind a separate union policy without changing
 * immutable package compiler or standalone serializer identities. */
export type StylexGenerationPlanV2 = Readonly<Omit<StylexGenerationPlanV1, "schemaVersion"> & {
  schemaVersion: typeof STYLEX_GENERATION_SCHEMA_VERSION;
  unionPolicySha256: string;
}>;

export type StylexGenerationHandleV1 = Readonly<{
  directory: string;
  planSha256: string;
}>;

export type StylexGraphEdgeV1 = Readonly<{
  external: boolean;
  from: string;
  kind: string;
  to: string;
}>;

export type StylexGraphReceiptV1 = Readonly<{
  adapter: StylexGraphAdapterV1;
  compilerSha256: string;
  edges: readonly StylexGraphEdgeV1[];
  entrypoints: readonly string[];
  generationId: string;
  graphId: string;
  inputs: readonly StylexArtifactV1[];
  kind: "hraness-stylex-graph-receipt";
  outputRoot: string;
  outputs: readonly StylexArtifactV1[];
  packages: readonly StylexPackageIdentityV1[];
  planSha256: string;
  rules: readonly StylexRuleV1[];
  rulesSha256: string;
  schemaVersion: typeof STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION;
  state: "complete";
  target: StylexGraphKindV1;
}>;

export type StylexCompleteGraphV1 = Readonly<{
  id: string;
  receiptSha256: string;
}>;

export type StylexCompleteRecordV1 = Readonly<{
  artifacts: readonly StylexArtifactV1[];
  compilerSha256: string;
  finalCss: StylexArtifactV1;
  generationId: string;
  graphs: readonly StylexCompleteGraphV1[];
  kind: "hraness-stylex-complete-generation";
  packages: readonly StylexPackageIdentityV1[];
  planSha256: string;
  schemaVersion: 1;
  state: "complete";
}>;

export type StylexCompleteRecordV2 = Readonly<Omit<StylexCompleteRecordV1, "schemaVersion"> & {
  schemaVersion: typeof STYLEX_COMPLETE_RECORD_SCHEMA_VERSION;
  unionPolicySha256: string;
}>;

export type CreateStylexGenerationOptions = Readonly<{
  expectedGraphs: readonly StylexGraphExpectationV1[];
  finalCssPath?: string;
  generationId: string;
  outputDirectory: string;
  packageManifests: readonly string[];
  rootDirectory: string;
  templates?: readonly StylexTemplateV1[];
}>;

export type FinalizeStylexGenerationOptions = Readonly<{
  failAfter?: "artifacts" | "complete-record" | "css" | "promotion" | "templates";
  generation: StylexGenerationHandleV1;
  outputDirectory: string;
  rootDirectory: string;
}>;
