import { describe, expect, test } from "bun:test";

import type { StylexRuleV1, StylexStandaloneSerializerV1 } from "./contracts.js";
import {
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  auditCssWithoutStylexUnionNamespace,
  canonicalJson,
  serializeStylexRuleUnionV1,
  sha256,
  stylexUnionPolicy,
  stylexUnionPolicySha256,
} from "./compiler.js";
import {
  auditCssWithoutStylexUnionNamespace as publicAuditCssWithoutStylexUnionNamespace,
  serializeStylexRuleUnionV1 as publicSerializeStylexRuleUnionV1,
  stylexUnionPolicy as publicStylexUnionPolicy,
  stylexUnionPolicySha256 as publicStylexUnionPolicySha256,
} from "./index.js";

const designKitSerializer = {
  before: [
    "components.hraness-design-kit.legacy.base",
    "components.hraness-design-kit.legacy",
  ],
  prefix: "components.hraness-design-kit",
} as const satisfies StylexStandaloneSerializerV1;

const uiSerializer = {
  before: [
    "components.hraness-ui.legacy.base",
    "components.hraness-ui.legacy",
  ],
  prefix: "components.hraness-ui",
} as const satisfies StylexStandaloneSerializerV1;

const sharedRule = [
  "x-shared",
  { ltr: ".x-shared{color:red}" },
  1000,
] as const satisfies StylexRuleV1;

const conditionalRule = [
  "x-conditional",
  { ltr: "@media (forced-colors:active){.x-conditional:hover{background-color:Canvas}}" },
  3130,
] as const satisfies StylexRuleV1;

const keyframesRule = [
  "x-spin",
  { ltr: "@keyframes x-spin{to{opacity:0}}" },
  0,
] as const satisfies StylexRuleV1;

describe("cross-package StyleX rule union", () => {
  test("binds a public policy without changing package standalone namespaces", () => {
    expect(stylexUnionPolicy).toEqual({
      foundationOrder: "all-package-foundations-before-union",
      kind: "hraness-stylex-rule-union-policy",
      legacyLayerOrder: "canonical-package-prefix-then-declared",
      policyVersion: "hraness-stylex-rule-union-v1",
      prefix: "components.hraness-stylex",
      priorityLayers: "complete-finite",
      ruleUnion: "dedupe-identical-reject-conflicts",
      schemaVersion: 1,
    });
    expect(Object.isFrozen(stylexUnionPolicy)).toBeTrue();
    expect(Reflect.set(stylexUnionPolicy, "prefix", "components.attacker")).toBeFalse();
    expect(stylexUnionPolicy.prefix).toBe("components.hraness-stylex");
    expect(stylexUnionPolicySha256).toBe(sha256(canonicalJson(stylexUnionPolicy)));
    expect(stylexUnionPolicySha256).toBe(
      "1ceced1f1bf6359413ca6425ede61e1fdae272b897f4455c2347e2431d75caa1",
    );
    expect(publicStylexUnionPolicy).toEqual(stylexUnionPolicy);
    expect(publicStylexUnionPolicySha256).toBe(stylexUnionPolicySha256);
  });

  test("serializes a canonical package-and-graph union exactly once in the late namespace", () => {
    const rules = [sharedRule, conditionalRule, keyframesRule, sharedRule];
    const css = serializeStylexRuleUnionV1(rules, [uiSerializer, designKitSerializer]);
    const reversed = serializeStylexRuleUnionV1(
      [...rules].reverse(),
      [designKitSerializer, uiSerializer],
    );

    expect(reversed).toBe(css);
    expect(css).toStartWith(
      "@layer base, components;\n@layer components.hraness-design-kit.legacy.base, components.hraness-design-kit.legacy, components.hraness-ui.legacy.base, components.hraness-ui.legacy, components.hraness-stylex.priority1, components.hraness-stylex.priority2, components.hraness-stylex.priority3;",
    );
    expect(css.match(/\.x-shared\b/gu)).toHaveLength(1);
    expect(css).toContain("@keyframes x-spin");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain(".x-conditional:hover");
    expect(css).not.toContain("components.hraness-ui.priority");
    expect(css).not.toContain("components.hraness-design-kit.priority");
    expect(publicSerializeStylexRuleUnionV1(rules, [uiSerializer, designKitSerializer])).toBe(css);
  });

  test("rejects conflicting rules and ambiguous package or reserved namespaces", () => {
    expect(() => serializeStylexRuleUnionV1([
      sharedRule,
      ["x-shared", { ltr: ".x-shared{color:blue}" }, 1000],
    ], [uiSerializer])).toThrow(/Conflicting StyleX rule/u);
    expect(() => serializeStylexRuleUnionV1([], [])).toThrow(/nonempty array/u);

    for (const serializer of [
      { before: ["components.hraness-stylex.legacy"], prefix: "components.hraness-stylex" },
      { before: ["components.hraness-stylex.child.legacy"], prefix: "components.hraness-stylex.child" },
    ]) {
      expect(() => serializeStylexRuleUnionV1([], [serializer])).toThrow(/reserved rule-union namespace/u);
    }
    expect(() => serializeStylexRuleUnionV1([], [
      { before: ["components.hraness.legacy"], prefix: "components.hraness" },
    ])).not.toThrow();
    expect(() => serializeStylexRuleUnionV1([], [
      { before: ["components.legacy"], prefix: "components" },
    ])).toThrow(/non-bare components namespace/u);

    expect(() => serializeStylexRuleUnionV1([], [
      { before: ["components.fixture.legacy"], prefix: "components.fixture" },
      { before: ["components.fixture.child.legacy"], prefix: "components.fixture.child" },
    ])).toThrow(/package namespaces overlap/u);
  });

  test("structurally reserves only the union namespace and its descendants", () => {
    for (const css of [
      "@layer components;",
      "@layer components.hraness-ui.legacy;",
      "@layer components { @layer hraness-design-kit.legacy { .fixture { display:block } } }",
    ]) {
      expect(() => auditCssWithoutStylexUnionNamespace(css)).not.toThrow();
      expect(() => publicAuditCssWithoutStylexUnionNamespace(css)).not.toThrow();
    }

    for (const css of [
      "@layer components.hraness-stylex;",
      "@layer components.hraness-stylex.priority1 { .fixture { display:block } }",
      "@layer components { @layer hraness-stylex { @layer priority2; } }",
      "@layer components.\\68 raness-stylex.priority3;",
    ]) {
      expect(() => auditCssWithoutStylexUnionNamespace(css, "Fixture foundation")).toThrow(
        /reserved StyleX rule-union namespace/u,
      );
    }
  });

  test("reserves decoded import layer names through every graph audit without blocking unrelated imports", () => {
    for (const css of [
      '@import "./foundation.css" layer(components.hraness-stylex);',
      '@import url("./foundation.css") layer(components.hraness-stylex.priority99) screen;',
      '@import "./foundation.css" layer(components.\\68 raness-stylex.priority2) supports(display: grid);',
      '@import "./foundation.css" layer(components.hraness-stylex.priority3.nested);',
    ]) {
      expect(() => auditCssWithoutStylexUnionNamespace(css)).toThrow(/reserved StyleX rule-union namespace/u);
      expect(() => publicAuditCssWithoutStylexUnionNamespace(css)).toThrow(/reserved StyleX rule-union namespace/u);
      expect(() => auditCssWithoutStylexRules(css, [])).toThrow(/reserved StyleX rule-union namespace/u);
      expect(() => auditCssWithoutStandaloneRecipes(css, [])).toThrow(/reserved StyleX rule-union namespace/u);
    }
    for (const css of [
      '@import "./foundation.css";',
      '@import "./foundation.css" layer;',
      '@import "./foundation.css" layer(components);',
      '@import "./foundation.css" layer(components.hraness-ui.legacy);',
      '@import "./foundation.css" layer(components.hraness-stylex-sibling.priority1);',
    ]) {
      expect(() => auditCssWithoutStylexUnionNamespace(css)).not.toThrow();
      expect(() => auditCssWithoutStylexRules(css, [])).not.toThrow();
      expect(() => auditCssWithoutStandaloneRecipes(css, [])).not.toThrow();
    }
    expect(() => auditCssWithoutStylexRules(
      '@import "./foundation.css" layer(components.hraness-ui.priority2);', [],
    )).toThrow(/independently serialized recipe layer/u);
  });
});
