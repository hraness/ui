import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COMPONENTS_IMPORT = '@import "./components.css";';
const GALLERY_LAYER_CONFLICT_SENTINEL = "data-gallery-stylex-layer-conflict";
const LEGACY_LAYER = "components.hraness-ui.legacy";
const LEGACY_LAYERS = [
  "components.hraness-ui.legacy.base",
  LEGACY_LAYER,
] as const;
const LAYER_PRELUDE =
  "@layer components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2;";
const STYLEX_IMPORT = '@import "../dist/stylex.css";';
const STYLEX_LAYERS = [
  "components.hraness-ui.priority1",
  "components.hraness-ui.priority2",
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
      "src/styles.css must contain the exact base < components and legacy < priority1 < priority2 preludes and ordered public imports",
    );
  }
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
forbid(
  legacyComponents,
  /\.hraness-(?:appearance|social)-icon(?![A-Za-z0-9_-])/u,
  "a legacy social- or appearance-icon recipe",
);
requirePublicLayerContract(legacyComponents, orderedStylesheet, compiledCss);
forbid(
  `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}`,
  new RegExp(GALLERY_LAYER_CONFLICT_SENTINEL, "u"),
  "the gallery-only layer-conflict sentinel in package output",
);

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
        "@layer components.hraness-ui.priority2, components.hraness-ui.priority1, components.hraness-ui.legacy;",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 preludes/u,
  "the layer guard must reject a priority inversion",
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
  /exact base < components and legacy < priority1 < priority2 preludes/u,
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

console.log("StyleX package artifacts match the compiler contract");
