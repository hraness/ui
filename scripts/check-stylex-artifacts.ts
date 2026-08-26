import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COMPONENTS_IMPORT = '@import "./components.css";';
const GALLERY_LAYER_CONFLICT_SENTINELS = [
  "data-gallery-stylex-layer-conflict",
  "data-gallery-quiet-site-layer-conflict",
  "data-gallery-quiet-site-priority3-conflict",
  "data-gallery-viewport-frame-layer-conflict",
  "data-gallery-wrapping-row-layer-conflict",
] as const;
const LEGACY_LAYER = "components.hraness-ui.legacy";
const LEGACY_LAYERS = [
  "components.hraness-ui.legacy.base",
  LEGACY_LAYER,
] as const;
const LAYER_PRELUDE =
  "@layer components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2, components.hraness-ui.priority3;";
const STYLEX_IMPORT = '@import "../dist/stylex.css";';
const STYLEX_LAYERS = [
  "components.hraness-ui.priority1",
  "components.hraness-ui.priority2",
  "components.hraness-ui.priority3",
] as const;
const TOP_LEVEL_LAYER_PRELUDE = "@layer base, components;";

function requireMatch(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(source)) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
}

function forbid(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (pattern.test(source)) {
    throw new Error(`StyleX artifact unexpectedly contains ${description}`);
  }
}

function topLevelStatements(source: string, description: string): string[] {
  const statements: string[] = [];
  let blockDepth = 0;
  let escaped = false;
  let start = -1;
  let stringQuote: '"' | "'" | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === undefined) continue;

    if (stringQuote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd < 0) {
        throw new Error(`${description} contains an unterminated comment`);
      }
      index = commentEnd + 1;
      continue;
    }

    if (start < 0) {
      if (/\s/u.test(character)) continue;
      start = index;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      continue;
    }

    if (character === "{") {
      blockDepth += 1;
      continue;
    }
    if (character === "}") {
      blockDepth -= 1;
      if (blockDepth < 0) {
        throw new Error(`${description} contains an unmatched closing brace`);
      }
      if (blockDepth === 0 && start >= 0) {
        statements.push(source.slice(start, index + 1).trim());
        start = -1;
      }
      continue;
    }
    if (character === ";" && blockDepth === 0 && start >= 0) {
      statements.push(source.slice(start, index + 1).trim());
      start = -1;
    }
  }

  if (stringQuote !== undefined || blockDepth !== 0) {
    throw new Error(`${description} contains an unterminated CSS construct`);
  }
  if (start >= 0 && source.slice(start).trim().length > 0) {
    throw new Error(`${description} contains an unterminated top-level statement`);
  }
  return statements;
}

function requireOnlyLayerBlocks(
  source: string,
  allowedLayers: ReadonlySet<string>,
  description: string,
): string[] {
  const statements = topLevelStatements(source, description);
  if (statements.length === 0) {
    throw new Error(`${description} must contain a named layer block`);
  }

  return statements.map((statement) => {
    const layer = statement.match(
      /^@layer\s+([A-Za-z0-9_.-]+)\s*\{/u,
    )?.[1];
    if (layer === undefined || !allowedLayers.has(layer)) {
      throw new Error(
        `${description} contains top-level content outside its allowed named layers`,
      );
    }
    return layer;
  });
}

function requirePublicLayerContract(
  legacyComponents: string,
  orderedStylesheet: string,
  compiledCss: string,
): void {
  const bareComponentsLayer = /@layer\s+components(?=\s*[,;{])/u;
  forbid(
    legacyComponents,
    bareComponentsLayer,
    "a bare direct components layer",
  );
  forbid(
    compiledCss,
    bareComponentsLayer,
    "a generated bare direct components layer",
  );

  const legacyLayers = requireOnlyLayerBlocks(
    legacyComponents,
    new Set(LEGACY_LAYERS),
    "src/components.css",
  );
  for (const expectedLayer of LEGACY_LAYERS) {
    if (!legacyLayers.includes(expectedLayer)) {
      throw new Error(`src/components.css must declare ${expectedLayer}`);
    }
  }
  const generatedLayers = requireOnlyLayerBlocks(
    compiledCss,
    new Set(STYLEX_LAYERS),
    "dist/stylex.css",
  );
  if (
    generatedLayers.length !== STYLEX_LAYERS.length
    || generatedLayers.some(
      (layer, index) => layer !== STYLEX_LAYERS[index],
    )
  ) {
    throw new Error(
      "dist/stylex.css must contain the exact priority1 < priority2 < priority3 layer sequence",
    );
  }
  for (const expectedLayer of STYLEX_LAYERS) {
    if (!generatedLayers.includes(expectedLayer)) {
      throw new Error(`dist/stylex.css must declare ${expectedLayer}`);
    }
  }

  const lines = orderedStylesheet
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const expectedLines = [
    TOP_LEVEL_LAYER_PRELUDE,
    LAYER_PRELUDE,
    '@import "./tokens.css";',
    '@import "./reset.css";',
    COMPONENTS_IMPORT,
    STYLEX_IMPORT,
    '@import "./tailwind.css";',
  ];
  if (
    lines.length !== expectedLines.length
    || lines.some((line, index) => line !== expectedLines[index])
  ) {
    throw new Error(
      "src/styles.css must contain the exact base < components and legacy < priority1 < priority2 < priority3 preludes and ordered public imports",
    );
  }
}

function requireViewportHeightFallbacks(compiledCss: string): void {
  const fallbacks = [
    /height:\s*100vh;/gu,
    /height:\s*100svh;/gu,
    /height:\s*100dvh;/gu,
  ] as const;
  const positions = fallbacks.map((pattern) => {
    const matches = [...compiledCss.matchAll(pattern)];
    if (matches.length !== 1 || matches[0]?.index === undefined) {
      throw new Error(
        "dist/stylex.css must contain exactly one 100vh, 100svh, and 100dvh viewport height fallback",
      );
    }
    return matches[0].index;
  });
  if (!(positions[0]! < positions[1]! && positions[1]! < positions[2]!)) {
    throw new Error(
      "dist/stylex.css must preserve the 100vh < 100svh < 100dvh viewport height fallback order",
    );
  }
  requireMatch(
    compiledCss,
    /@supports\s*\(height:\s*100svh\)\s*\{[\s\S]*height:\s*100svh;[\s\S]*@supports\s*\(height:\s*100dvh\)\s*\{[\s\S]*height:\s*100dvh;/u,
    "the nested svh then dvh viewport height capability fallbacks",
  );
}

const repository = process.cwd();
const [compiledJavaScript, compiledCss, legacyComponents, orderedStylesheet] =
  await Promise.all([
    readFile(resolve(repository, "dist/index.js"), "utf8"),
    readFile(resolve(repository, "dist/stylex.css"), "utf8"),
    readFile(resolve(repository, "src/components.css"), "utf8"),
    readFile(resolve(repository, "src/styles.css"), "utf8"),
  ]);

if (compiledCss.trim().length === 0) {
  throw new Error("dist/stylex.css is empty");
}

requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority1\s*\{/u,
  "the package-owned priority1 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority2\s*\{/u,
  "the package-owned priority2 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority3\s*\{/u,
  "the package-owned priority3 layer",
);
requireMatch(compiledCss, /flex:\s*none;/u, "the icon flex declaration");
requireMatch(
  compiledCss,
  /display:\s*inline-block;/u,
  "the icon display declaration",
);
requireMatch(
  compiledCss,
  /align-items:\s*center;/u,
  "the icon-wrapper alignment declaration",
);
requireMatch(
  compiledCss,
  /display:\s*inline-flex;/u,
  "the icon-wrapper display declaration",
);
requireMatch(
  compiledCss,
  /justify-content:\s*center;/u,
  "the icon-wrapper justification declaration",
);
const quietSiteDeclarations = [
  [/align-items:\s*center;/u, "quiet-site footer alignment"],
  [/border-top-color:\s*var\(--ui-border\);/u, "quiet-site footer border color"],
  [/border-top-style:\s*solid;/u, "quiet-site footer border style"],
  [/border-top-width:\s*1px;/u, "quiet-site footer border width"],
  [/box-sizing:\s*border-box;/u, "quiet-site border-box sizing"],
  [/color:\s*var\(--ui-muted-foreground\);/u, "quiet-site footer color"],
  [/display:\s*flex;/u, "quiet-site footer display"],
  [/flex:\s*1 0 auto;/u, "quiet-site page flex"],
  [/flex-wrap:\s*wrap;/u, "quiet-site footer wrapping"],
  [/gap:\s*var\(--space-4,\s*1rem\);/u, "quiet-site footer gap"],
  [/justify-content:\s*space-between;/u, "quiet-site footer distribution"],
  [/margin-block:\s*clamp\(2rem,\s*6vh,\s*4rem\) clamp\(3\.5rem,\s*10vh,\s*6rem\);/u, "quiet-site page block margins"],
  [/margin-inline:\s*auto;/u, "quiet-site inline centering"],
  [/max-inline-size:\s*var\(--hraness-quiet-site-measure,\s*34rem\);/u, "quiet-site shared logical measure"],
  [/min-inline-size:\s*0;/u, "quiet-site footer minimum logical size"],
  [/overflow:\s*clip;/u, "quiet-site footer clipping"],
  [/padding-bottom:\s*max\(var\(--space-5,\s*1\.25rem\),\s*env\(safe-area-inset-bottom\)\);/u, "quiet-site footer safe-area bottom padding"],
  [/padding-inline:\s*var\(--hraness-quiet-site-gutter,\s*1\.25rem\);/u, "quiet-site page gutter"],
  [/padding-left:\s*max\(var\(--hraness-quiet-site-gutter,\s*1\.25rem\),\s*env\(safe-area-inset-left\)\);/u, "quiet-site footer safe-area left padding"],
  [/padding-right:\s*max\(var\(--hraness-quiet-site-gutter,\s*1\.25rem\),\s*env\(safe-area-inset-right\)\);/u, "quiet-site footer safe-area right padding"],
  [/padding-top:\s*var\(--space-5,\s*1\.25rem\);/u, "quiet-site footer top padding"],
  [/inline-size:\s*100%;/u, "quiet-site full logical inline size"],
] as const;
for (const [pattern, description] of quietSiteDeclarations) {
  requireMatch(compiledCss, pattern, description);
}
const structuralSurfaceDeclarations = [
  [/align-items:\s*center;/u, "wrapping-row alignment"],
  [/display:\s*flex;/u, "wrapping-row display"],
  [/flex-wrap:\s*wrap;/u, "wrapping-row wrapping"],
  [/gap:\s*var\(--space-3\);/u, "wrapping-row gap"],
  [/inline-size:\s*100%;/u, "viewport-frame logical inline size"],
  [/min-inline-size:\s*0;/u, "structural-surface logical minimum"],
  [/overflow:\s*hidden;/u, "viewport-frame overflow"],
] as const;
for (const [pattern, description] of structuralSurfaceDeclarations) {
  requireMatch(compiledCss, pattern, description);
}
requireViewportHeightFallbacks(compiledCss);
forbid(
  legacyComponents,
  /\.hraness-(?:appearance|social)-icon(?![A-Za-z0-9_-])/u,
  "a legacy social- or appearance-icon recipe",
);
forbid(
  legacyComponents,
  /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u,
  "a legacy quiet-site landmark recipe",
);
forbid(
  legacyComponents,
  /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u,
  "a legacy structural-surface recipe",
);
requirePublicLayerContract(legacyComponents, orderedStylesheet, compiledCss);
forbid(
  compiledCss,
  /max-width:\s*var\(--hraness-quiet-site-measure,\s*34rem\);/u,
  "a physical quiet-site measure produced from its logical source contract",
);
forbid(
  compiledCss,
  /(?:^|[\s{;])width:\s*100%;/u,
  "a physical 100% viewport-frame width produced from its logical source contract",
);
forbid(
  compiledCss,
  /(?:^|[\s{;])min-width:\s*0;/u,
  "a physical structural-surface minimum produced from its logical source contract",
);
for (const sentinel of GALLERY_LAYER_CONFLICT_SENTINELS) {
  forbid(
    `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}`,
    new RegExp(sentinel, "u"),
    `the gallery-only ${sentinel} sentinel in package output`,
  );
}

requireMatch(
  compiledJavaScript,
  /from["']react\/jsx-runtime["']/u,
  "the production React JSX runtime",
);
requireMatch(
  compiledJavaScript,
  /from["']@stylexjs\/stylex["']/u,
  "the typed xstyle merge runtime",
);
requireMatch(
  compiledJavaScript,
  /hraness-quiet-site-page/u,
  "the quiet-site page semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-quiet-site-footer/u,
  "the quiet-site footer semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-viewport-frame/u,
  "the viewport-frame semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-wrapping-row/u,
  "the wrapping-row semantic hook",
);
forbid(
  compiledJavaScript,
  /react\/jsx-dev-runtime/u,
  "the development React JSX runtime",
);
forbid(
  compiledJavaScript,
  /stylex\.create|stylexCreate|Unexpected ['"]stylex\.create/u,
  "an uncompiled StyleX authoring call",
);
forbid(
  compiledJavaScript,
  /stylex-inject|stylexInject|data-stylex|createElement\(["']style["']\)/u,
  "runtime CSS injection",
);

assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents.replace(
        `@layer ${LEGACY_LAYER} {`,
        "@layer components {",
      ),
      orderedStylesheet,
      compiledCss,
    ),
  /bare direct components layer/u,
  "the layer guard must reject a legacy recipe restored to the direct parent",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        LAYER_PRELUDE,
        "@layer components.hraness-ui.priority3, components.hraness-ui.priority2, components.hraness-ui.priority1, components.hraness-ui.legacy;",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 preludes/u,
  "the layer guard must reject a priority inversion",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        ", components.hraness-ui.priority3",
        "",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 preludes/u,
  "the layer guard must reject an omitted generated priority3 declaration",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet,
      compiledCss.replace(
        "components.hraness-ui.priority3",
        "components.hraness-ui.priority4",
      ),
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an undeclared generated priority layer",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        TOP_LEVEL_LAYER_PRELUDE,
        "@layer components, base;",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 preludes/u,
  "the layer guard must reject a top-level reset/component priority inversion",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      `${legacyComponents}\n.hraness-unlayered-negative-control { display: block; }`,
      orderedStylesheet,
      compiledCss,
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an unlayered legacy recipe",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet,
      `${compiledCss}\n.x-unlayered-negative-control { display: block; }`,
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an unlayered generated recipe",
);
assert.throws(
  () =>
    requireViewportHeightFallbacks(
      compiledCss
        .replace("height: 100vh;", "height: __viewport-vh__;")
        .replace("height: 100dvh;", "height: 100vh;")
        .replace("height: __viewport-vh__;", "height: 100dvh;"),
    ),
  /100vh < 100svh < 100dvh viewport height fallback order/u,
  "the viewport fallback guard must reject a reversed dynamic-height preference",
);
assert.throws(
  () =>
    requireViewportHeightFallbacks(
      compiledCss.replace("height: 100svh;", "height: 100vh;"),
    ),
  /exactly one 100vh, 100svh, and 100dvh/u,
  "the viewport fallback guard must reject a missing small-viewport fallback",
);

console.log("StyleX package artifacts match the compiler contract");
