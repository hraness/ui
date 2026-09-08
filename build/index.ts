import {
  STYLEX_COMPILER_CONTRACT_VERSION as COMPILER_CONTRACT_VERSION,
  STYLEX_COMPLETE_RECORD_SCHEMA_VERSION as COMPLETE_RECORD_SCHEMA_VERSION,
  STYLEX_GENERATION_SCHEMA_VERSION as GENERATION_SCHEMA_VERSION,
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION as GRAPH_RECEIPT_SCHEMA_VERSION,
  STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION as PACKAGE_MANIFEST_SCHEMA_VERSION,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER as TEMPLATE_CSS_PLACEHOLDER,
} from "./contracts.js";
import {
  artifactForFile as artifactForFileImplementation,
  canonicalJson as canonicalJsonImplementation,
  compilerContract as compilerContractValue,
  compilerSha256 as compilerSha256Value,
  createStylexTransformCollector as createStylexTransformCollectorImplementation,
  parseStylexSourceMap as parseStylexSourceMapImplementation,
  readStylexPackageManifest as readStylexPackageManifestImplementation,
  serializeStylexPackageRules as serializeStylexPackageRulesImplementation,
  serializeStylexRules as serializeStylexRulesImplementation,
  stylexRulesSha256 as stylexRulesSha256Implementation,
  validateStylexPackageManifest as validateStylexPackageManifestImplementation,
} from "./compiler.js";
import {
  createStylexGeneration as createStylexGenerationImplementation,
  finalizeStylexGeneration as finalizeStylexGenerationImplementation,
  prepareStylexProducedTemplate as prepareStylexProducedTemplateImplementation,
  sealStylexProducedTemplate as sealStylexProducedTemplateImplementation,
} from "./generation.js";

export const STYLEX_COMPILER_CONTRACT_VERSION = COMPILER_CONTRACT_VERSION;
export const STYLEX_COMPLETE_RECORD_SCHEMA_VERSION = COMPLETE_RECORD_SCHEMA_VERSION;
export const STYLEX_GENERATION_SCHEMA_VERSION = GENERATION_SCHEMA_VERSION;
export const STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION = GRAPH_RECEIPT_SCHEMA_VERSION;
export const STYLEX_PACKAGE_MANIFEST_SCHEMA_VERSION = PACKAGE_MANIFEST_SCHEMA_VERSION;
export const STYLEX_TEMPLATE_CSS_PLACEHOLDER = TEMPLATE_CSS_PLACEHOLDER;
export const artifactForFile: typeof artifactForFileImplementation = (...arguments_) => artifactForFileImplementation(...arguments_);
export const canonicalJson: typeof canonicalJsonImplementation = (...arguments_) => canonicalJsonImplementation(...arguments_);
export const compilerContract = compilerContractValue;
export const compilerSha256 = compilerSha256Value;
export const createStylexGeneration: typeof createStylexGenerationImplementation = (...arguments_) => createStylexGenerationImplementation(...arguments_);
export const createStylexTransformCollector: typeof createStylexTransformCollectorImplementation = (...arguments_) => createStylexTransformCollectorImplementation(...arguments_);
export const parseStylexSourceMap: typeof parseStylexSourceMapImplementation = (...arguments_) => parseStylexSourceMapImplementation(...arguments_);
export const finalizeStylexGeneration: typeof finalizeStylexGenerationImplementation = (...arguments_) => finalizeStylexGenerationImplementation(...arguments_);
export const prepareStylexProducedTemplate: typeof prepareStylexProducedTemplateImplementation = (...arguments_) => prepareStylexProducedTemplateImplementation(...arguments_);
export const readStylexPackageManifest: typeof readStylexPackageManifestImplementation = (...arguments_) => readStylexPackageManifestImplementation(...arguments_);
export const sealStylexProducedTemplate: typeof sealStylexProducedTemplateImplementation = (...arguments_) => sealStylexProducedTemplateImplementation(...arguments_);
export const serializeStylexPackageRules: typeof serializeStylexPackageRulesImplementation = (...arguments_) => serializeStylexPackageRulesImplementation(...arguments_);
export const serializeStylexRules: typeof serializeStylexRulesImplementation = (...arguments_) => serializeStylexRulesImplementation(...arguments_);
export const stylexRulesSha256: typeof stylexRulesSha256Implementation = (...arguments_) => stylexRulesSha256Implementation(...arguments_);
export const validateStylexPackageManifest: typeof validateStylexPackageManifestImplementation = (...arguments_) => validateStylexPackageManifestImplementation(...arguments_);
export type {
  CreateStylexGenerationOptions,
  FinalizeStylexGenerationOptions,
  StylexArtifactV1,
  StylexCompilerContractV1,
  StylexCompleteGraphV1,
  StylexCompleteRecordV1,
  StylexGenerationHandleV1,
  StylexGenerationPlanV1,
  StylexGraphAdapterV1,
  StylexGraphEdgeV1,
  StylexGraphExpectationV1,
  StylexGraphKindV1,
  StylexGraphReceiptV1,
  StylexPackageIdentityV1,
  StylexPackageManifestV1,
  StylexRuleV1,
  StylexRuleValueV1,
  StylexStandaloneSerializerV1,
  StylexTemplateV1,
} from "./contracts.js";
export type {
  StylexMappedTransformOptions,
  StylexMappedTransformResult,
  StylexSourceMapV1,
  StylexTransformCollector,
  StylexTransformResult,
} from "./compiler.js";
export type { PreparedStylexProducedTemplate } from "./generation.js";
