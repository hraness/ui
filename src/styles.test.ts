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
    ".hraness-button__control",
    ".hraness-field__control",
    ".hraness-select-field__popover",
    ".hraness-dialog-overlay",
    ".hraness-toast-region",
    ".hraness-tag",
    '[data-tone="success"]',
    "@media (pointer: coarse)",
    "@media (prefers-reduced-motion: reduce)",
    "@media (forced-colors: active)",
  ]) expect(components).toContain(contract);

  expect(reset.trimStart().startsWith("@layer base {")).toBe(true);
  expect(declarationBlock(reset, ":where(h1, h2, h3, h4, h5, h6) {")).toContain(
    "font-family: var(--ui-font-heading);",
  );
  expect(components.trimStart().startsWith("@layer components {")).toBe(true);
  expect(components).not.toContain('[data-slot="');
  expect(
    declarationBlock(components, ".hraness-select-field__trigger {"),
  ).toContain("background: var(--hraness-field-surface);");
  expect(components).toContain('.hraness-radio-group[data-orientation="horizontal"]');
  expect(components).toContain('.hraness-list-box[data-orientation="horizontal"]');
  expect(components).toContain(":dir(rtl)[data-selected]");
  expect(components).toContain(
    ".hraness-pressable-card {\n    --hraness-card-description: var(--ui-muted-foreground);",
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

test("segmented controls center icon labels without inline baseline drift", async () => {
  const components = await stylesheet("./components.css");
  const label = declarationBlock(
    components,
    ".hraness-segmented-control__label {",
  );

  expect(label).toContain("display: inline-grid;");
  expect(label).toContain("place-items: center;");
  expect(components).toContain(
    ':root[data-verification-pointer="coarse"] .hraness-segmented-control__item {\n  min-width: var(--interactive-target-min);',
  );
});

test("inline icon links keep typographic scale without losing interaction states", async () => {
  const components = await stylesheet("./components.css");
  const control = declarationBlock(
    components,
    ".hraness-inline-icon-link__control {",
  );
  const content = declarationBlock(
    components,
    ".hraness-inline-icon-link__content {",
  );
  const hover = declarationBlock(
    components,
    ".hraness-inline-icon-link__control:where([data-hovered], :hover) {",
  );
  const focus = declarationBlock(
    components,
    ".hraness-inline-icon-link__control:where([data-focus-visible], :focus-visible) {",
  );

  expect(control).toContain("width: 1.5rem;");
  expect(control).toContain("height: 1.5rem;");
  expect(control).toContain("min-height: 1.5rem;");
  expect(control).toContain("border: 0;");
  expect(control).toContain("background: transparent;");
  expect(control).toContain("color: var(--ui-primary);");
  expect(hover).toContain("background: var(--ui-accent);");
  expect(focus).toContain("outline: 2px solid var(--ui-ring);");
  expect(content).toContain("width: 100%;");
  expect(content).toContain("height: 100%;");
  expect(content).toContain("place-items: center;");
  expect(content).toContain("line-height: 0;");
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

test("knob densities keep a 48px gesture target and distinct dial sizes", async () => {
  const components = await stylesheet("./components.css");
  const control = declarationBlock(components, ".hraness-knob__control {");
  const dial = declarationBlock(components, ".hraness-knob__dial {");
  const compactDial = declarationBlock(
    components,
    '.hraness-knob[data-density="compact"] .hraness-knob__dial {',
  );
  const horizontalTouchPan = declarationBlock(
    components,
    '.hraness-knob[data-touch-pan="horizontal"] .hraness-knob__control,',
  );
  const disabledControl = declarationBlock(
    components,
    ".hraness-knob[data-disabled] .hraness-knob__control {",
  );

  expect(control).toContain("width: 3rem;");
  expect(control).toContain("min-width: 3rem;");
  expect(control).toContain("height: 3rem;");
  expect(control).toContain("min-height: 3rem;");
  expect(control).toContain("touch-action: none;");
  expect(dial).toContain("width: 2.5rem;");
  expect(compactDial).toContain("width: 2rem;");
  expect(horizontalTouchPan).toContain("touch-action: pan-x;");
  expect(disabledControl).toContain("opacity: 0.5;");
  expect(components).not.toContain(".hraness-knob[data-disabled] {\n    opacity:");
  expect(components).not.toContain(".hraness-knob__gesture:hover");
});

test("tags keep one border geometry across their visual variants", async () => {
  const components = await stylesheet("./components.css");
  const base = declarationBlock(components, ":where(.hraness-badge, .hraness-tag) {");
  const defaultTag = declarationBlock(components, ".hraness-tag {");
  const outlineTag = declarationBlock(
    components,
    '.hraness-tag[data-variant="outline"] {',
  );
  const mutedTag = declarationBlock(
    components,
    '.hraness-tag[data-variant="muted"] {',
  );
  const forcedColors = components.slice(components.indexOf("@media (forced-colors: active)"));

  expect(base).toContain("border: 1px solid var(--ui-border);");
  expect(base).toContain("border-radius: var(--radius-round);");
  expect(defaultTag).toContain("border-color: transparent;");
  expect(outlineTag).toContain(
    "border-color: var(--hraness-tag-accent, var(--ui-border));",
  );
  expect(outlineTag).toContain("background: transparent;");
  expect(mutedTag).toContain("background: var(--ui-muted);");
  expect(mutedTag).toContain("color: var(--ui-muted-foreground);");
  expect(forcedColors).toContain(".hraness-tag,");
  expect(forcedColors).toContain("border-color: CanvasText;");
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
