import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function stylesheet(name: string): Promise<string> {
  return await readFile(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

type Oklch = readonly [
  lightness: number,
  chroma: number,
  hue: number,
];

function declarationBlock(source: string, selector: string): string {
  const selectorIndex = source.indexOf(selector);
  expect(selectorIndex).toBeGreaterThanOrEqual(0);
  const openingBrace = source.indexOf("{", selectorIndex);
  const closingBrace = source.indexOf("}", openingBrace);
  expect(openingBrace).toBeGreaterThanOrEqual(0);
  expect(closingBrace).toBeGreaterThan(openingBrace);
  return source.slice(openingBrace + 1, closingBrace);
}

function oklchProperty(block: string, property: string): Oklch {
  const declaration = block
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${property}: oklch(`));
  expect(declaration).toBeDefined();

  const components = declaration?.match(
    /oklch\(\s*(?<lightness>[\d.]+)\s+(?<chroma>[\d.]+)\s+(?<hue>[\d.]+)\s*\)/u,
  )?.groups;
  expect(components).toBeDefined();

  return [
    Number(components?.lightness),
    Number(components?.chroma),
    Number(components?.hue),
  ];
}

function relativeLuminance([lightness, chroma, hue]: Oklch): number {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
  const mPrime = lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
  const sPrime = lightness - 0.089_484_177_5 * a - 1.291_485_548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const red = clamp(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s);
  const green = clamp(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s);
  const blue = clamp(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: Oklch, right: Oklch): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test("the complete stylesheet composes its public layers in a stable order", async () => {
  const styles = await stylesheet("./styles.css");
  const imports = [
    '@import "./tokens.css";',
    '@import "./reset.css";',
    '@import "./components.css";',
    '@import "../dist/stylex.css";',
    '@import "./tailwind.css";',
  ];

  let previous = -1;
  for (const rule of imports) {
    const position = styles.indexOf(rule);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
});

test("portable layers expose namespaced roles and resilient interaction recipes", async () => {
  const [components, reset, tailwind, tokens] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./reset.css"),
    stylesheet("./tailwind.css"),
    stylesheet("./tokens.css"),
  ]);

  for (const role of [
    "--ui-background:",
    "--ui-foreground:",
    "--ui-primary:",
    "--ui-muted-foreground:",
    "--ui-destructive:",
    "--ui-ring:",
    "--ui-font-heading:",
  ]) expect(tokens).toContain(role);

  for (const contract of [
    ".hraness-dialog-overlay",
    ".hraness-toast-region",
    '[data-tone="success"]',
    "@media (pointer: coarse)",
    "@media (prefers-reduced-motion: reduce)",
    "@media (forced-colors: active)",
  ]) expect(components).toContain(contract);

  expect(reset.trimStart().startsWith([
    "@layer base, components;",
    "@layer components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2, components.hraness-ui.priority3, components.hraness-ui.priority4;",
    "",
    "@layer base {",
  ].join("\n"))).toBe(true);
  expect(declarationBlock(reset, ":where(h1, h2, h3, h4, h5, h6) {")).toContain(
    "font-family: var(--ui-font-heading);",
  );
  expect(
    components
      .trimStart()
      .startsWith("@layer components.hraness-ui.legacy.base {"),
  ).toBe(true);
  expect(components).not.toContain('[data-slot="');
  expect(components).toContain('.hraness-list-box[data-orientation="horizontal"]');
  const cardBridgePattern =
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu;
  expect(components.match(cardBridgePattern)).toHaveLength(1);
  expect(components.replace(cardBridgePattern, "")).not.toMatch(
    /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
  );
  expect(components).not.toMatch(/\.hraness-toolbar(?![A-Za-z0-9_-])/u);
  expect(components).not.toMatch(/\.hraness-key-hint(?![A-Za-z0-9_-])/u);
  expect(components).not.toMatch(/\.hraness-checkbox-field(?![A-Za-z0-9_-])/u);
  const renderedComponents = components.replace(
    /\/\* WebKit scrollbar pseudo-elements[^]*?\.hraness-segmented-control::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/u,
    "",
  );
  expect(renderedComponents).not.toMatch(/\.hraness-(?:tabs|disclosure|accordion|toggle-group|segmented-control|separator)(?![A-Za-z0-9_-])/u);
  expect(components).not.toMatch(
    /\.hraness-(?:action__spinner|(?:button|copy-button|icon-button|icon-link|inline-icon-link|link-button|toggle-button)(?:__[A-Za-z0-9_-]+)?)(?![A-Za-z0-9_-])/u,
  );
  expect(tailwind).toContain(
    ':not(:where([data-theme="light"], [data-theme="light"] *))',
  );
  expect(tailwind).toContain("--font-heading: var(--ui-font-heading);");
  expect(tokens).not.toContain("@theme");
  expect(reset).not.toContain("@theme");
});

test("forced-colors field placeholders use unfaded system text", async () => {
  const components = await stylesheet("./components.css");
  const forcedColors = components.slice(components.indexOf("@media (forced-colors: active)"));
  const placeholder = declarationBlock(forcedColors, ".hraness-field__input::placeholder {");

  expect(placeholder).toContain("color: CanvasText;");
  expect(placeholder).toContain("opacity: 1;");
});

test("content families compile presentation while legacy CSS retains no owned selectors", async () => {
  const [components, content, component] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./content.stylex.ts"),
    stylesheet("./content.tsx"),
  ]);

  expect(components).not.toMatch(
    /\.hraness-(?:page-intro|empty-state|inline-alert|settings-card)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  );
  for (const recipe of [
    "actions",
    "emptyStateDescription",
    "emptyStateIcon",
    "emptyStateRoot",
    "emptyStateTitle",
    "inlineAlertBody",
    "inlineAlertContent",
    "inlineAlertDanger",
    "inlineAlertIcon",
    "inlineAlertInfo",
    "inlineAlertRoot",
    "inlineAlertSuccess",
    "inlineAlertTitle",
    "inlineAlertWarning",
    "pageIntroCopy",
    "pageIntroDescription",
    "pageIntroEyebrow",
    "pageIntroRoot",
    "pageIntroTitle",
    "settingsCardBody",
    "settingsCardDescription",
    "settingsCardHeader",
    "settingsCardRectangular",
    "settingsCardRoot",
    "settingsCardTitle",
  ]) expect(content).toContain(`${recipe}: {`);

  expect(content).toContain('const compactViewport = "@media(max-width: 40rem)"');
  const pageIntroRoot = content.slice(
    content.indexOf("pageIntroRoot: {"),
    content.indexOf("pageIntroTitle: {"),
  );
  expect(pageIntroRoot).toContain('[compactViewport]: "start"');
  expect(pageIntroRoot).toContain(
    '[compactViewport]: "minmax(0, 1fr)"',
  );
  expect(content).toContain(
    'const forcedColors = "@media(forced-colors: active)"',
  );
  expect(content.match(/\[forcedColors\]: "CanvasText"/gu)).toHaveLength(5);
  expect(content).toContain('[forcedColors]: "auto"');
  for (const backgroundReset of [
    'backgroundAttachment: "scroll"',
    'backgroundClip: "border-box"',
    'backgroundImage: "none"',
    'backgroundOrigin: "padding-box"',
    'backgroundPosition: "0% 0%"',
    'backgroundRepeat: "repeat"',
    'backgroundSize: "auto auto"',
  ]) expect(content.match(new RegExp(backgroundReset, "gu"))).toHaveLength(5);
  for (const borderImageReset of [
    "borderImageOutset: 0",
    'borderImageRepeat: "stretch"',
    'borderImageSlice: "100%"',
    'borderImageSource: "none"',
    "borderImageWidth: 1",
  ]) expect(content.match(new RegExp(borderImageReset, "gu"))).toHaveLength(3);
  expect(content).not.toContain("@media(pointer: coarse)");
  expect(content).not.toContain("@media(prefers-reduced-motion: reduce)");
  expect(content).not.toContain("placeItems:");
  expect(content).not.toMatch(/^\s*(?:background|border|padding):/mu);

  expect(component).not.toContain('"use client"');
  expect(component).toMatch(
    /stylex\.props\(contentStyles\.pageIntroRoot, xstyle\)/u,
  );
  expect(component).toMatch(
    /stylex\.props\(contentStyles\.emptyStateRoot, xstyle\)/u,
  );
  expect(component).toMatch(
    /contentStyles\.inlineAlertRoot,[\s\S]*?inlineAlertToneStyles\[tone\],[\s\S]*?xstyle/u,
  );
  expect(component).toMatch(
    /contentStyles\.settingsCardRoot,[\s\S]*?shape === "rectangular" && contentStyles\.settingsCardRectangular,[\s\S]*?xstyle/u,
  );
  expect(
    component.match(
      /style=\{mergeStylexInlineStyles\(rootPresentation\.style, style\)\}/gu,
    ),
  ).toHaveLength(4);
});

test("field families compile presentation while legacy CSS keeps only native pseudo seams", async () => {
  const [components, fields, fieldComponents, select, selectComponent] =
    await Promise.all([
      stylesheet("./components.css"),
      stylesheet("./fields.stylex.ts"),
      stylesheet("./fields.tsx"),
      stylesheet("./select-field.stylex.ts"),
      stylesheet("./select-field.tsx"),
    ]);
  const fieldHookPattern =
    /\.hraness-(?:(?:field|text-area-field|text-field|search-field|number-field|checkbox-group|radio-group|radio-option|switch-field|native-select-field|file-field|select-field)(?:__[A-Za-z0-9_-]+)?)(?:::[A-Za-z-]+)?/gu;
  const remainingLegacyHooks = [
    ...new Set(components.match(fieldHookPattern) ?? []),
  ].sort();

  expect(remainingLegacyHooks).toEqual([
    ".hraness-field__file::file-selector-button",
    ".hraness-field__input::placeholder",
    ".hraness-file-field",
  ]);
  expect(components.match(/\.hraness-field__input::placeholder/gu)).toHaveLength(2);
  expect(
    components.match(/\.hraness-field__file::file-selector-button/gu),
  ).toHaveLength(4);
  expect(components).toContain(
    "--hraness-field-coarse-min: var(--interactive-target-min);",
  );
  expect(components).toContain("@media (pointer: coarse)");
  expect(components).toContain(
    ':where(.hraness-file-field[data-size="compact"])\n    .hraness-field__file::file-selector-button {',
  );
  expect(components).toContain(
    ':where(.hraness-file-field[data-size="large"])\n    .hraness-field__file::file-selector-button {',
  );
  const coarseFileButton = components.slice(
    components.indexOf("@media (pointer: coarse)"),
    components.indexOf("/* WebKit scrollbar pseudo-elements"),
  );
  expect(coarseFileButton).toContain(
    ".hraness-field__file::file-selector-button {",
  );
  expect(coarseFileButton).toContain(
    "min-height: calc(var(--interactive-target-min) - 2px);",
  );

  for (const source of [fields, select]) {
    expect(source).toContain('const coarsePointer = "@media(pointer: coarse)"');
    expect(source).toContain(
      'const syntheticCoarseMinimum = "var(--hraness-field-coarse-min, 0px)"',
    );
    expect(source).toContain('[coarsePointer]: "var(--interactive-target-min)"');
    expect(source).not.toMatch(/^\s*background:/mu);
  }
  for (const fallback of [
    "controlFocusWithinFallback",
    "numberStepNativeInteractions",
    "radioSwitchNativeFocus",
    "searchClearNativeInteractions",
  ]) expect(fields).toContain(`${fallback}: {`);
  expect(fieldComponents).toMatch(
    /function fieldControlPresentation[\s\S]*?fieldStyles\.controlFocusWithinFallback,[\s\S]*?state\.isInvalid && fieldStyles\.controlInvalid,[\s\S]*?controlXstyle/u,
  );
  expect(fieldComponents).not.toContain("state.isFocused");
  expect(fields).toContain('":dir(rtl)": {');
  expect(fields).toContain('transform: "translateX(-1rem)"');
  expect(fieldComponents).toContain(
    "!hasStylexPresentation(controlXstyle)",
  );
  expect(select).toContain("triggerNativeInteractions: {");
  expect(select).toContain("optionNativeInteraction: {");
  expect(select).toContain('[forcedColors]: "CanvasText"');
  expect(select).toContain('backgroundImage: "none"');
  expect(selectComponent).toContain(
    "!hasStylexPresentation(triggerXstyle)",
  );
  expect(selectComponent).toMatch(
    /!optionState\.isDisabled[\s\S]*?selectFieldStyles\.optionNativeInteraction/u,
  );

  const nativeSelect = fields.slice(
    fields.indexOf("nativeSelect: {"),
    fields.indexOf("numberControl: {"),
  );
  expect(nativeSelect).toContain('":dir(rtl)": {');
  expect(nativeSelect).toContain(
    'backgroundPosition: "0.75rem 50%, 1rem 50%"',
  );
  expect(nativeSelect).toContain('appearance: {');
  expect(nativeSelect).toContain('default: "none"');
  expect(nativeSelect).toContain('[forcedColors]: "auto"');
  expect(nativeSelect).toContain('backgroundImage: {');
  expect(nativeSelect).toContain(
    '"linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)"',
  );
  expect(nativeSelect).toContain('[forcedColors]: "none"');
  expect(nativeSelect).toContain(
    '"calc(100% - 1rem) 50%, calc(100% - 0.75rem) 50%"',
  );
  expect(nativeSelect).toContain(
    'backgroundSize: "0.25rem 0.25rem, 0.25rem 0.25rem"',
  );
  expect(nativeSelect).toContain('paddingInlineEnd: "2.5rem"');

  const fieldFocus = fields.slice(
    fields.indexOf("controlFocusWithinFallback: {"),
    fields.indexOf("controlInvalid: {"),
  );
  expect(fieldFocus).toContain('[forcedColors]: "none"');
  expect(fieldFocus).toContain('[forcedColors]: "Highlight"');
  expect(fieldFocus).toContain('outlineOffset: "2px"');
  expect(fieldFocus).toContain('outlineStyle: "solid"');
  expect(fieldFocus).toContain('outlineWidth: "2px"');

  for (const numberFocus of [
    fields.slice(
      fields.indexOf("numberStepFocusVisible: {"),
      fields.indexOf("numberStepHovered: {"),
    ),
    fields.slice(
      fields.indexOf("numberStepNativeInteractions: {"),
      fields.indexOf("options: {"),
    ),
  ]) {
    expect(numberFocus).toContain('[forcedColors]: "none"');
    expect(numberFocus).toContain('[forcedColors]: "Highlight"');
    expect(numberFocus).toContain('outlineOffset: "-2px"');
    expect(numberFocus).toContain('outlineStyle: "solid"');
    expect(numberFocus).toContain('outlineWidth: "2px"');
  }

  const radioSurfaces = fields.slice(
    fields.indexOf("radioDot: {"),
    fields.indexOf("radioSwitchControl: {"),
  );
  expect(radioSurfaces).toContain('[forcedColors]: "Canvas"');
  expect(radioSurfaces).toContain('[forcedColors]: "CanvasText"');
  expect(radioSurfaces).toContain('[forcedColors]: "Highlight"');
  expect(radioSurfaces).toContain('[forcedColors]: "HighlightText"');
  expect(radioSurfaces).toContain('[forcedColors]: "none"');

  const switchSurfaces = fields.slice(
    fields.indexOf("switchThumb: {"),
    fields.indexOf("textArea: {"),
  );
  expect(switchSurfaces).toContain('[forcedColors]: "Canvas"');
  expect(switchSurfaces).toContain('[forcedColors]: "CanvasText"');
  expect(switchSurfaces).toContain('[forcedColors]: "Highlight"');
  expect(switchSurfaces).toContain('[forcedColors]: "HighlightText"');
  expect(switchSurfaces).toContain('[forcedColors]: "none"');

  const selectIndicator = select.slice(
    select.indexOf("indicator: {"),
    select.indexOf("listBox: {"),
  );
  expect(selectIndicator).toContain('display: "block"');
  expect(selectIndicator).toContain('height: "1em"');
  expect(selectIndicator).toContain('transformOrigin: "center"');
  expect(selectIndicator).toContain('transform: "rotate(180deg)"');
  expect(selectIndicator).toContain('width: "1em"');

  const selectTrigger = select.slice(
    select.indexOf("trigger: {"),
    select.indexOf("triggerCard: {"),
  );
  expect(selectTrigger).toContain(
    'backgroundColor: "var(--hraness-field-surface, var(--ui-background))"',
  );
  expect(selectTrigger).toContain('backgroundImage: "none"');
});

test("segmented controls keep one compact selection surface without item dividers", async () => {
  const source = await Bun.file(
    new URL("./collections.stylex.ts", import.meta.url),
  ).text();

  expect(source).toContain('gap: "0.125rem"');
  expect(source).toContain('scrollbarWidth: "none"');
  expect(source).toContain('cursor: "pointer"');
  expect(source).toContain('userSelect: "none"');
  expect(source).toContain('transitionProperty: "background-color, box-shadow, color"');
  expect(source).toContain('paddingBlock: "0.125rem"');
  expect(source).toContain('paddingInline: "0.125rem"');
  expect(source).toContain('borderRadius: "var(--radius-md)"');
  expect(source).toContain('borderRadius: "var(--radius-sm)"');
  expect(source).toContain('backgroundColor: "var(--ui-accent)"');
  expect(source).toContain('display: "inline-grid"');
  expect(source).toContain('alignItems: "center"');
  expect(source).toContain('justifyItems: "center"');
  expect(source).toContain('minWidth: {');
  expect(source).toContain('[coarsePointer]: "var(--interactive-target-min)"');
});

test("Separator owns its physical orientation and shorthand resets in StyleX", async () => {
  const [components, source] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./separator.stylex.ts"),
  ]);

  expect(components).not.toMatch(/\.hraness-separator(?![A-Za-z0-9_-])/u);
  for (const declaration of [
    'backgroundAttachment: "scroll"',
    'backgroundClip: "border-box"',
    'backgroundColor: "var(--ui-border)"',
    'backgroundImage: "none"',
    'backgroundOrigin: "padding-box"',
    'backgroundPosition: "0% 0%"',
    'backgroundRepeat: "repeat"',
    'backgroundSize: "auto auto"',
    'borderColor: "currentColor"',
    'borderImageOutset: 0',
    'borderImageRepeat: "stretch"',
    'borderImageSlice: "100%"',
    'borderImageSource: "none"',
    'borderImageWidth: 1',
    'borderStyle: "none"',
    'borderWidth: 0',
    'flexBasis: "auto"',
    'flexGrow: 0',
    'flexShrink: 0',
    'height: "1px"',
    'width: "100%"',
    'alignSelf: "stretch"',
    'height: "auto"',
    'width: "1px"',
  ]) expect(source).toContain(declaration);
  expect(source).not.toMatch(/^\s*(?:background|border|flex):/mu);
});

test("inline icon links keep typographic scale without losing interaction states", async () => {
  const source = await stylesheet("./actions.stylex.ts");

  expect(source).toContain('inlineControl: {');
  expect(source).toContain('height: "1.5rem"');
  expect(source).toContain('minHeight: "1.5rem"');
  expect(source).toContain('minWidth: "1.5rem"');
  expect(source).toContain('width: "1.5rem"');
  expect(source).toContain('backgroundColor: "var(--ui-accent)"');
  expect(source).toContain('outlineColor: "var(--ui-ring)"');
  expect(source).toContain('inlineContent: {');
  expect(source).toContain('lineHeight: 0');
});

test("coarse-pointer seams preserve every action density without widening icon toggles", async () => {
  const [components, source] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./actions.stylex.ts"),
  ]);

  expect(source).toContain('const coarsePointer = "@media(pointer: coarse)"');
  expect(source).toContain('[coarsePointer]: "var(--interactive-target-min)"');
  expect(source).toContain('[coarsePointer]: "var(--control-height-primary)"');
  expect(source).toContain('[coarsePointer]: "var(--control-height-transport)"');
  expect(source).toContain('iconOnlyToggle: {');
  expect(source).toContain('max(var(--interactive-target-compact), ${syntheticCoarseMinimum})');
  const inlineControl = source.slice(
    source.indexOf("inlineControl: {"),
    source.indexOf("labeledDanger: {"),
  );
  expect(inlineControl).not.toContain("[coarsePointer]");
  expect(components).toContain(
    '--hraness-action-coarse-min: var(--interactive-target-min);',
  );
  expect(components).not.toMatch(
    /\.hraness-(?:(?:button|icon-button|icon-link|inline-icon-link|link-button|toggle-button)(?:__[A-Za-z0-9_-]+)?)(?![A-Za-z0-9_-])/u,
  );
});

test("copy buttons reserve both transient labels without layout shift", async () => {
  const source = await stylesheet("./actions.stylex.ts");

  expect(source).toContain('copyLabels: {\n    display: "inline-grid"');
  expect(source).toContain('copyLabel: {\n    gridColumn: "1",\n    gridRow: "1"');
  expect(source).toContain('hiddenCopyLabel: {\n    visibility: "hidden"');
});

test("SkipLink owns its offscreen and native focus presentation in StyleX", async () => {
  const [components, source] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./skip-link.stylex.ts"),
  ]);

  expect(components).not.toMatch(
    /\.hraness-skip-link(?![A-Za-z0-9_-])/u,
  );
  expect(source).toContain('alignItems: "center"');
  expect(source).toContain('position: "fixed"');
  expect(source).toContain('backgroundAttachment: "scroll"');
  expect(source).toContain('backgroundClip: "border-box"');
  expect(source).toContain('backgroundColor: "var(--ui-foreground)"');
  expect(source).toContain('backgroundImage: "none"');
  expect(source).toContain('backgroundOrigin: "padding-box"');
  expect(source).toContain('backgroundPosition: "0% 0%"');
  expect(source).toContain('backgroundRepeat: "repeat"');
  expect(source).toContain('backgroundSize: "auto auto"');
  expect(source).not.toContain('background: "');
  expect(source).toContain('borderRadius: "var(--radius-md)"');
  expect(source).toContain('color: "var(--ui-background)"');
  expect(source).toContain('display: "inline-flex"');
  expect(source).toContain('fontWeight: "var(--font-weight-medium)"');
  expect(source).toContain('zIndex: "var(--z-skip-link)"');
  expect(source).toContain('"inset-block-start": "var(--space-3)"');
  expect(source).toContain('"inset-inline-start": "var(--space-3)"');
  expect(source).not.toContain("insetBlockStart");
  expect(source).not.toContain("insetInlineStart");
  expect(source).toContain('minHeight: "var(--interactive-target-min)"');
  expect(source).toContain('paddingInline: "var(--space-4)"');
  expect(source).toContain(
    'transform: "translateY(calc(-100% - var(--space-6)))"',
  );
  expect(source).toContain('":focus": {\n      transform: "translateY(0)"');
  expect(source).not.toContain(":focus-visible");
});

test("breadcrumbs keep the current page on one shrinkable line", async () => {
  const components = await stylesheet("./components.css");
  const breadcrumbs = declarationBlock(
    components,
    ".hraness-breadcrumbs ol {",
  );
  const item = declarationBlock(components, ".hraness-breadcrumbs li {");
  const currentItem = declarationBlock(
    components,
    ".hraness-breadcrumbs li:last-child {",
  );
  const separator = declarationBlock(
    components,
    ".hraness-breadcrumbs li + li::before {",
  );
  const current = declarationBlock(
    components,
    '.hraness-breadcrumbs [aria-current="page"] {',
  );

  expect(breadcrumbs).toContain("flex-wrap: nowrap;");
  expect(breadcrumbs).toContain("overflow: hidden;");
  expect(item).toContain("display: inline-flex;");
  expect(item).toContain("min-width: 0;");
  expect(currentItem).toContain("flex: 1 1 auto;");
  expect(separator).toContain('content: "/";');
  expect(current).toContain("overflow: hidden;");
  expect(current).toContain("text-overflow: ellipsis;");
  expect(current).toContain("white-space: nowrap;");
});

test("collapsed disclosure panels do not retain their expanded inset", async () => {
  const source = await Bun.file(
    new URL("./collections.stylex.ts", import.meta.url),
  ).text();

  expect(source).toContain('paddingBlockEnd: "var(--space-4)"');
  expect(source).toContain("disclosurePanelHidden");
  expect(source).toContain("paddingBlockEnd: 0");
});

test("transport actions and slider thumbs use their compiled shared geometry", async () => {
  const [actions, components, indicators] = await Promise.all([
    stylesheet("./actions.stylex.ts"),
    stylesheet("./components.css"),
    stylesheet("./indicators.stylex.ts"),
  ]);

  expect(actions).toContain('transportIconControl: {');
  expect(actions).toContain(
    '`max(var(--control-height-transport), ${syntheticCoarseMinimum})`',
  );
  expect(actions).toContain(
    '[coarsePointer]: "var(--control-height-transport)"',
  );
  expect(components).not.toMatch(
    /\.hraness-(?:progress-bar|meter|slider|knob)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  );
  expect(components).toContain(
    "--hraness-slider-coarse-min: var(--interactive-target-min);",
  );
  expect(indicators).toContain('const coarsePointer = "@media(pointer: coarse)"');
  expect(indicators).toContain('const reducedMotion = "@media(prefers-reduced-motion: reduce)"');
  expect(indicators).toContain('const forcedColors = "@media(forced-colors: active)"');
  expect(indicators).toContain('sliderThumbHorizontal: {\n    top: "50%"');
  expect(indicators).toContain('sliderThumbVertical: {\n    left: "50%"');
  expect(indicators).toContain(
    'default: "max(1.25rem, var(--hraness-slider-coarse-min, 0px))"',
  );
  expect(indicators).toContain(
    '[coarsePointer]: "var(--interactive-target-min)"',
  );
  expect(indicators).toContain('width: "1.25rem"');
  expect(indicators).toContain('default: "hraness-progress-indeterminate"');
  expect(indicators).toContain('[reducedMotion]: "none"');
  expect(indicators).toContain('borderRadius: "inherit",\n    display: "block"');
  expect(components).toContain("@keyframes hraness-progress-indeterminate");
  expect(components).toContain("transform: translateX(-125%);");
  expect(components).toContain("transform: translateX(250%);");
  expect(indicators).toContain('[forcedColors]: "Highlight"');
  expect(indicators).toContain('[forcedColors]: "Canvas"');
  expect(indicators.match(/backgroundAttachment: "scroll"/gu)).toHaveLength(6);
  expect(indicators.match(/backgroundImage: "none"/gu)).toHaveLength(6);
  expect(indicators.match(/backgroundOrigin: "padding-box"/gu)).toHaveLength(6);
  expect(indicators.match(/backgroundSize: "auto auto"/gu)).toHaveLength(6);
  expect(indicators.match(/borderImageSource: "none"/gu)).toHaveLength(2);
});

test("knob densities keep a 48px gesture target and distinct dial sizes", async () => {
  const [components, knob, knobComponent] = await Promise.all([
    stylesheet("./components.css"),
    stylesheet("./knob.stylex.ts"),
    stylesheet("./knob.tsx"),
  ]);

  expect(components).not.toMatch(/\.hraness-knob(?![A-Za-z0-9_-])/u);
  expect(knob).toContain('control: {\n    cursor: "grab"');
  expect(knob).toContain('default: "3rem"');
  expect(knob).toContain(
    '[coarsePointer]: "max(3rem, var(--interactive-target-min))"',
  );
  expect(knob).toContain('dial: {');
  expect(knob).toContain('height: "2.5rem"');
  expect(knob).toContain('width: "2.5rem"');
  expect(knob).toContain('dialCompact: {\n    height: "2rem",\n    width: "2rem"');
  expect(knob).toContain('controlHorizontalTouchPan: {\n    touchAction: "pan-x"');
  expect(knob).toContain('controlDisabled: {\n    cursor: "not-allowed",\n    opacity: 0.5');
  expect(knob).toContain('thumb: {\n    alignItems: "center",\n    display: "grid",\n    justifyItems: "center"');
  expect(knob).not.toContain("placeItems:");
  expect(knob).toContain('":has(input:focus-visible)": {');
  expect(knob).toContain('[forcedColors]: "Canvas"');
  expect(knob).toContain('[forcedColors]: "CanvasText"');
  expect(knob).toContain('[forcedColors]: "GrayText"');
  expect(knob).toContain('[forcedColors]: "Highlight"');
  expect(knobComponent).toContain(
    "!hasStylexPresentation(controlXstyle) && knobStyles.controlNativeFocus",
  );
  expect(knobComponent).toMatch(
    /knobStyles\.control,[\s\S]*?knobStyles\.controlHorizontalTouchPan,[\s\S]*?knobStyles\.controlDragging,[\s\S]*?knobStyles\.controlDisabled,[\s\S]*?knobStyles\.controlNativeFocus,[\s\S]*?controlXstyle/u,
  );
  expect(knobComponent).toContain(
    'touchAction: touchPan === "horizontal" ? "pan-x" : "none"',
  );
  expect(knobComponent).toMatch(
    /mergeStylexInlineStyles\(presentation\.style,\s*\{\s*touchAction:/u,
  );
  expect(knobComponent).toMatch(
    /\.\.\.stylexStyle,[\s\S]*?\.\.\.KNOB_THUMB_GEOMETRY_STYLE/u,
  );
});

test("native Feedback Progress keeps its separate legacy CSS boundary", async () => {
  const components = await stylesheet("./components.css");

  for (const selector of [
    ".hraness-progress {",
    ".hraness-progress__label-row {",
    ".hraness-progress__control {",
    ".hraness-progress__control::-webkit-progress-bar {",
    ".hraness-progress__control::-webkit-progress-value {",
    ".hraness-progress__control::-moz-progress-bar {",
  ]) expect(components).toContain(selector);
  expect(components.match(/\.hraness-progress__control \{/gu)).toHaveLength(2);
  expect(components).toContain("color: Highlight;");
  expect(components).toContain("forced-color-adjust: none;");
});

test("status pills keep one compiled border geometry across their visual variants", async () => {
  const components = await stylesheet("./components.css");
  const compiled = await stylesheet("../dist/stylex.css");

  expect(components).not.toMatch(
    /\.hraness-(?:badge|tag|status-dot)(?![A-Za-z0-9_-])/u,
  );
  expect(compiled).toContain("border-style: solid;");
  expect(compiled).toContain("border-width: 1px;");
  expect(compiled).toContain("border-radius: var(--radius-round);");
  expect(compiled).toContain(
    "border-color: var(--hraness-tag-accent, var(--ui-border));",
  );
  expect(compiled).toContain("background-color: var(--ui-muted);");
  expect(compiled).toContain("color: var(--ui-muted-foreground);");
  expect(compiled).toContain("@media (forced-colors: active)");
  expect(compiled).toContain("border-color: canvastext;");
});

test("control curves stay bounded while pills and circles remain explicit", async () => {
  const tokens = await stylesheet("./tokens.css");
  const light = declarationBlock(tokens, ":root {");

  expect(light).toContain("--control-radius: 1rem;");
  expect(light).toContain("--radius-round: 999px;");
});

test("semantic token pairs retain accessible contrast in both themes", async () => {
  const tokens = await stylesheet("./tokens.css");
  const light = declarationBlock(tokens, ":root {");
  const dark = declarationBlock(tokens, ':root[data-theme="dark"],');
  const checks = [
    {
      background: "--ui-background",
      foreground: "--ui-input",
      minimum: 3,
      name: "light input boundary",
      theme: light,
    },
    {
      background: "--ui-background",
      foreground: "--ui-input",
      minimum: 3,
      name: "dark input boundary",
      theme: dark,
    },
    {
      background: "--ui-destructive",
      foreground: "--ui-destructive-foreground",
      minimum: 4.5,
      name: "light danger action",
      theme: light,
    },
    {
      background: "--ui-destructive",
      foreground: "--ui-destructive-foreground",
      minimum: 4.5,
      name: "dark danger action",
      theme: dark,
    },
    {
      background: "--ui-warning-soft",
      foreground: "--ui-warning",
      minimum: 4.5,
      name: "light warning badge",
      theme: light,
    },
    {
      background: "--ui-warning-soft",
      foreground: "--ui-warning",
      minimum: 4.5,
      name: "dark warning badge",
      theme: dark,
    },
  ] as const;

  for (const check of checks) {
    const ratio = contrastRatio(
      oklchProperty(check.theme, check.foreground),
      oklchProperty(check.theme, check.background),
    );
    expect(ratio, check.name).toBeGreaterThanOrEqual(check.minimum);
  }
});
