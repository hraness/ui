import { describe, expect, test } from "bun:test";

import { placeQuietSiteFooterPriorityBeforeLegacy } from "./gallery-layer-counterfactual.js";

const legacyLayers = [
  "components.hraness-ui.legacy.base",
  "components.hraness-ui.legacy",
] as const;
const priorities = Array.from(
  { length: 7 },
  (_, index) => `components.hraness-stylex.priority${String(index + 1)}`,
);
const targetRule = `.x-footer-padding {
    padding-top: var(--space-5, 1.25rem);
  }`;

function fixture(rule = targetRule): string {
  return [
    "@layer base, components;",
    `@layer ${legacyLayers.join(", ")};`,
    "@layer components.hraness-ui.legacy {",
    "  .quiet-site-footer { padding-top: 9rem; }",
    "}",
    "@layer base, components;",
    `@layer ${[...legacyLayers, ...priorities].join(", ")};`,
    "@layer components.hraness-stylex.priority2 {",
    "  .priority-two-sibling { font: inherit; }",
    "}",
    "@layer components.hraness-stylex.priority5 {",
    "  .before-target { color: red; }",
    `  ${rule}`,
    "  .after-target { color: blue; }",
    "}",
    "@layer components.hraness-stylex.priority7 {",
    "  .last-priority-sibling { opacity: .5; }",
    "}",
    "",
  ].join("\n");
}

describe("quiet-site footer layer counterfactual", () => {
  test("moves exactly one atom before UI legacy without changing the remaining union bytes", () => {
    const source = fixture();
    const result = placeQuietSiteFooterPriorityBeforeLegacy(source);
    const resultAgain = placeQuietSiteFooterPriorityBeforeLegacy(source);
    const targetStart = source.indexOf(targetRule);
    const sourceWithoutTarget = source.slice(0, targetStart)
      + source.slice(targetStart + targetRule.length);
    const expectedPrelude = [
      "components.hraness-ui.before-legacy",
      ...legacyLayers,
      ...priorities,
    ].join(", ");
    const expectedPrefix = [
      "@layer base, components;",
      `@layer ${expectedPrelude};`,
      `@layer components.hraness-ui.before-legacy {\n${targetRule}\n}`,
    ].join("\n");

    expect(result.targetPriority).toBe("priority5");
    expect(result.css).toBe(`${expectedPrefix}\n${sourceWithoutTarget}`);
    expect(resultAgain).toEqual(result);
    expect(result.css.match(/padding-top:\s*var\(--space-5,\s*1\.25rem\)/gu)).toHaveLength(1);
    expect(result.css).toContain("@layer components.hraness-stylex.priority5 {\n  .before-target");
    expect(result.css).toContain("  .after-target { color: blue; }\n}");
    expect(result.css.indexOf("components.hraness-ui.before-legacy"))
      .toBeLessThan(result.css.indexOf("components.hraness-ui.legacy.base"));
    expect(result.css.indexOf("components.hraness-ui.legacy"))
      .toBeLessThan(result.css.indexOf("components.hraness-stylex.priority1"));
    expect(result.css).not.toContain("components.hraness-ui.priority5");
  });

  test("rejects duplicate, missing, misplaced, and non-atomic footer targets", () => {
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      fixture(`${targetRule}\n  .x-footer-padding-copy { padding-top: var(--space-5, 1.25rem); }`),
    )).toThrow(/exactly one quiet-site footer padding atom/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      fixture(".x-unrelated { padding-top: var(--space-4); }"),
    )).toThrow(/exactly one quiet-site footer padding atom/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      fixture(".x-footer-padding, .forged { padding-top: var(--space-5, 1.25rem); }"),
    )).toThrow(/single-class atomic rule/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      fixture(".x-footer-padding { padding-top: var(--space-5, 1.25rem); color: red; }"),
    )).toThrow(/single-class atomic rule/u);

    const misplaced = fixture().replace(
      "@layer components.hraness-stylex.priority5 {",
      "@layer components.hraness-stylex.priority4 {",
    );
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(misplaced))
      .toThrow(/direct rule in components\.hraness-stylex\.priority5/u);
  });

  test("rejects forged, incomplete, duplicate, and out-of-order priority inventories", () => {
    const source = fixture();
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      source.replace(
        "components.hraness-stylex.priority4, components.hraness-stylex.priority5",
        "components.hraness-stylex.priority5",
      ),
    )).toThrow(/contiguous, finite, and unique/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      `${source}\n@layer components.hraness-stylex.priority0;`,
    )).toThrow(/unknown shared StyleX layer/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      `${source}\n@layer ${priorities.join(", ")};`,
    )).toThrow(/exactly one complete shared priority statement/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      source.replace(
        "@layer components.hraness-stylex.priority7 {",
        "@layer components.hraness-stylex.priority5 {",
      ),
    )).toThrow(/duplicate priority block/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      source.replace(
        /(@layer components\.hraness-stylex\.priority2 \{[\s\S]*?\n\})\n(@layer components\.hraness-stylex\.priority5 \{[\s\S]*?\n\})/u,
        "$2\n$1",
      ),
    )).toThrow(/priority blocks must remain in ascending order/u);
  });

  test("rejects preexisting or nested counterfactual and union layers", () => {
    const source = fixture();
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      `@layer components.hraness-ui.before-legacy;\n${source}`,
    )).toThrow(/counterfactual layer is already declared/u);
    expect(() => placeQuietSiteFooterPriorityBeforeLegacy(
      `@layer components { @layer hraness-stylex.priority5; }\n${source}`,
    )).toThrow(/must be top-level/u);
  });
});
