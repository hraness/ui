import assert from "node:assert/strict";
import stylex from "@stylexjs/unplugin/esbuild";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

import {
  chromium,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";

import { stylexCompilerOptions } from "./stylex-config.js";

const BUN_VERSION = "1.3.14";
const CARD_DESCRIPTION_BRIDGE_PATTERN =
  /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu;
const HUGEICONS_VERSION = "4.2.2";
const PACKAGE_LAYER_PRELUDE =
  /@layer\s+components\.hraness-ui\.legacy\s*,\s*components\.hraness-ui\.priority1\s*,\s*components\.hraness-ui\.priority2\s*,\s*components\.hraness-ui\.priority3/u;
const STYLED_GALLERY_LAYER_PRELUDES =
  /@layer\s+base\s*,\s*components\s*;\s*@layer\s+components\.hraness-ui\.legacy\s*,\s*components\.hraness-ui\.priority1\s*,\s*components\.hraness-ui\.priority2\s*,\s*components\.hraness-ui\.priority3\s*;/u;
const REACT_VERSION = "19.2.3";

interface BrowserEvidence {
  readonly appearanceAlignItems: string;
  readonly appearanceAriaHidden: string;
  readonly appearanceCallerClassLast: boolean;
  readonly appearanceChildSlot: string;
  readonly appearanceClassIsSemantic: boolean;
  readonly appearanceDisplay: string;
  readonly appearanceFlex: string;
  readonly appearanceHasGeneratedClass: boolean;
  readonly appearanceIconHeight: number;
  readonly appearanceIconWidth: number;
  readonly appearanceJustifyContent: string;
  readonly avatarClassContracts: boolean;
  readonly avatarDefaultBackground: string;
  readonly avatarDiagnostics: string;
  readonly avatarFallbackContracts: boolean;
  readonly avatarImageContract: boolean;
  readonly avatarLayerSentinels: boolean;
  readonly avatarOverrideContract: boolean;
  readonly avatarTokenContracts: boolean;
  readonly bodyBackground: string;
  readonly buttonBackground: string;
  readonly buttonMinHeight: number;
  readonly cardBorderStyle: string;
  readonly cardFamilyBoundaryContracts: boolean;
  readonly cardFamilyClassContracts: boolean;
  readonly cardFamilyDefaultBackground: string;
  readonly cardFamilyDiagnostics: string;
  readonly cardFamilyLayerSentinels: boolean;
  readonly cardFamilyNestedResetContract: boolean;
  readonly cardFamilyOverrideContracts: boolean;
  readonly cardFamilyToneShapeContracts: boolean;
  readonly checkboxBoundaryContracts: boolean;
  readonly checkboxClassContracts: boolean;
  readonly checkboxDefaultBackground: string;
  readonly checkboxDiagnostics: string;
  readonly checkboxLayerSentinels: boolean;
  readonly checkboxOverrideContract: boolean;
  readonly checkboxStateContracts: boolean;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly colorScheme: string;
  readonly colorEquivalenceContract: boolean;
  readonly colorEquivalenceDiagnostics: string;
  readonly documentScrollWidth: number;
  readonly footerAlignItems: string;
  readonly footerBorderTopStyle: string;
  readonly footerBorderTopWidth: number;
  readonly footerBoxSizing: string;
  readonly footerCallerClassLast: boolean;
  readonly footerClassIsSemantic: boolean;
  readonly footerDisplay: string;
  readonly footerFlex: string;
  readonly footerFlexWrap: string;
  readonly footerGap: number;
  readonly footerHasGeneratedClass: boolean;
  readonly footerJustifyContent: string;
  readonly footerMarginInlineEnd: number;
  readonly footerMarginInlineStart: number;
  readonly footerMaxInlineSize: number;
  readonly footerMinInlineSize: number;
  readonly footerOverflow: string;
  readonly footerPaddingBottom: number;
  readonly footerPaddingLeft: number;
  readonly footerPaddingRight: number;
  readonly footerPaddingTop: number;
  readonly footerPresent: boolean;
  readonly footerWidth: number;
  readonly heading: string;
  readonly hydrationStarted: boolean;
  readonly iconAriaHidden: string;
  readonly iconClassIsSemantic: boolean;
  readonly iconInheritsCanaryColor: boolean;
  readonly iconLegacyLayerSentinel: string;
  readonly iconDisplay: string;
  readonly iconFlex: string;
  readonly iconHeight: number;
  readonly iconWidth: number;
  readonly keyHintBoundaryContracts: boolean;
  readonly keyHintClassContracts: boolean;
  readonly keyHintDefaultBackground: string;
  readonly keyHintDefaultDisplay: string;
  readonly keyHintDiagnostics: string;
  readonly keyHintLayerSentinels: boolean;
  readonly keyHintOverrideContract: boolean;
  readonly mainPresent: boolean;
  readonly pageBoxSizing: string;
  readonly pageCallerClassLast: boolean;
  readonly pageClassIsSemantic: boolean;
  readonly pageFlex: string;
  readonly pageHasGeneratedClass: boolean;
  readonly pageMarginBlockEnd: number;
  readonly pageMarginBlockStart: number;
  readonly pageMarginInlineEnd: number;
  readonly pageMarginInlineStart: number;
  readonly pageLegacyLayerSentinel: string;
  readonly pageMaxInlineSize: number;
  readonly pagePaddingLeft: number;
  readonly pagePaddingRight: number;
  readonly pageWidth: number;
  readonly recoverableErrors: readonly string[];
  readonly rootHydrated: boolean;
  readonly skeletonAnimationName: string;
  readonly socialAlignItems: string;
  readonly socialAriaHidden: string;
  readonly socialCallerClassLast: boolean;
  readonly socialChildSlot: string;
  readonly socialClassIsSemantic: boolean;
  readonly socialDisplay: string;
  readonly socialFlex: string;
  readonly socialHasGeneratedClass: boolean;
  readonly socialIconHeight: number;
  readonly socialIconWidth: number;
  readonly socialJustifyContent: string;
  readonly spinnerAnimationName: string;
  readonly statusFamilyClassContracts: boolean;
  readonly statusFamilyDefaultBackground: string;
  readonly statusFamilyDiagnostics: string;
  readonly statusFamilyGeometryContracts: boolean;
  readonly statusFamilyLayerSentinels: boolean;
  readonly statusFamilyOverrideContracts: boolean;
  readonly statusFamilyToneContracts: boolean;
  readonly statusFamilyVariableContract: boolean;
  readonly stylexRuntimeStyleCount: number;
  readonly stylesheetCount: number;
  readonly stylesheetMarked: boolean;
  readonly substackAriaHidden: string;
  readonly substackFill: string;
  readonly substackHasPath: boolean;
  readonly substackIconHeight: number;
  readonly substackIconWidth: number;
  readonly theme: string;
  readonly themedSurfaceBoundaryContracts: boolean;
  readonly themedSurfaceClassContracts: boolean;
  readonly themedSurfaceDiagnostics: string;
  readonly themedSurfaceLayerSentinels: boolean;
  readonly themedSurfacePopoverElevation: boolean;
  readonly themedSurfaceShapeContracts: boolean;
  readonly themedSurfaceTextureContract: boolean;
  readonly themedSurfaceToneContracts: boolean;
  readonly toolbarBoundaryContracts: boolean;
  readonly toolbarClassContracts: boolean;
  readonly toolbarDefaultBackground: string;
  readonly toolbarDiagnostics: string;
  readonly toolbarLayerSentinels: boolean;
  readonly toolbarOrientationContracts: boolean;
  readonly toolbarOverrideContract: boolean;
  readonly transitionDuration: string;
  readonly quietSitePriority3LayerSentinel: string;
  readonly viewportFrameCallerClassLast: boolean;
  readonly viewportFrameClassIsSemantic: boolean;
  readonly viewportFrameHasGeneratedClass: boolean;
  readonly viewportFrameHeight: number;
  readonly viewportFrameInlineSize: number;
  readonly viewportFrameLayerSentinel: string;
  readonly viewportFrameMinInlineSize: number;
  readonly viewportFrameOverflow: string;
  readonly viewportFramePosition: string;
  readonly viewportFramePresent: boolean;
  readonly viewportFrameWidth: number;
  readonly wrappingRowAlignItems: string;
  readonly wrappingRowCallerClassLast: boolean;
  readonly wrappingRowClassIsSemantic: boolean;
  readonly wrappingRowDisplay: string;
  readonly wrappingRowFirstItemTop: number;
  readonly wrappingRowFlexWrap: string;
  readonly wrappingRowGap: number;
  readonly wrappingRowHasGeneratedClass: boolean;
  readonly wrappingRowInlineSize: number;
  readonly wrappingRowLayerSentinel: string;
  readonly wrappingRowMinInlineSize: number;
  readonly wrappingRowSecondItemTop: number;
  readonly wrappingRowWidth: number;
}

interface SegmentedControlEvidence {
  readonly borderWidths: readonly (readonly number[])[];
  readonly classContract: boolean;
  readonly cursors: readonly string[];
  readonly groupBackground: string;
  readonly groupBorderRadius: number;
  readonly groupGap: number;
  readonly groupHeight: number;
  readonly groupOverflowX: string;
  readonly groupPaddingTop: number;
  readonly inactiveBackgrounds: readonly string[];
  readonly itemHeights: readonly number[];
  readonly itemRadii: readonly number[];
  readonly labels: readonly string[];
  readonly selectedBackground: string;
  readonly selectedBlockInset: number;
  readonly selectedCount: number;
  readonly selectedLabel: string;
  readonly size: string;
  readonly slot: string;
  readonly transitionProperties: readonly string[];
}

interface SelectFieldIndicatorEvidence {
  readonly ariaHidden: string;
  readonly display: string;
  readonly flex: string;
  readonly height: number;
  readonly pathCenterDeltaX: number;
  readonly pathCenterDeltaY: number;
  readonly pathCount: number;
  readonly slot: string;
  readonly tagName: string;
  readonly text: string;
  readonly triggerHeight: number;
  readonly verticalCenterDelta: number;
  readonly viewBox: string;
  readonly width: number;
}

interface VerticalWritingEvidence {
  readonly footerInlineSize: number;
  readonly footerMaxInlineSize: number;
  readonly footerMaxWidth: string;
  readonly footerWritingMode: string;
  readonly pageInlineSize: number;
  readonly pageMaxInlineSize: number;
  readonly pageMaxWidth: string;
  readonly pageWritingMode: string;
  readonly viewportFrameHeight: number;
  readonly viewportFrameInlineSize: number;
  readonly viewportFrameMinInlineSize: number;
  readonly viewportFrameWidth: number;
  readonly viewportFrameWritingMode: string;
  readonly wrappingRowHeight: number;
  readonly wrappingRowInlineSize: number;
  readonly wrappingRowMinInlineSize: number;
  readonly wrappingRowWidth: number;
  readonly wrappingRowWritingMode: string;
}

interface ForcedColorsEvidence {
  readonly buttonBackground: string;
  readonly buttonFace: string;
  readonly buttonText: string;
  readonly buttonTextColor: string;
  readonly canvasText: string;
  readonly cardBorderColor: string;
  readonly cardForcedColorAdjust: string;
  readonly cardFamilyContracts: boolean;
  readonly cardFamilyDiagnostics: string;
  readonly checkboxContracts: boolean;
  readonly checkboxDiagnostics: string;
  readonly forcedColorsActive: boolean;
  readonly keyHintContracts: boolean;
  readonly keyHintDiagnostics: string;
  readonly selectedTabBackground: string;
  readonly selectedTabColor: string;
  readonly selectedSegmentBackground: string;
  readonly selectedSegmentColor: string;
  readonly spinnerAnimationName: string;
  readonly statusFamilyContracts: boolean;
  readonly statusFamilyDiagnostics: string;
}

interface ArtifactSet {
  readonly css: string;
  readonly cssPath: string;
  readonly javaScript: string;
  readonly javaScriptPath: string;
}

interface CheckboxFocusRuleEvidence {
  readonly className: string;
  readonly declaration: string;
  readonly layer: "components.hraness-ui.priority2";
  readonly selector: string;
}

interface CheckboxFocusContract {
  readonly classNames: readonly string[];
  readonly rules: readonly CheckboxFocusRuleEvidence[];
}

const layouts = [
  {
    context: {
      colorScheme: "light",
      reducedMotion: "reduce",
      viewport: { height: 844, width: 390 },
    },
    id: "compact-reduced-motion",
  },
  {
    context: {
      colorScheme: "light",
      reducedMotion: "no-preference",
      viewport: { height: 360, width: 960 },
    },
    id: "wide-short",
  },
] as const satisfies readonly {
  readonly context: BrowserContextOptions;
  readonly id: string;
}[];

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function firstExecutable(paths: readonly string[]): Promise<string> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue through the supported Chromium and Chrome installations.
    }
  }
  throw new Error(
    "No Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH to run the primitive gallery browser test.",
  );
}

async function run(
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined>,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
  }
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function requireExactlyOne(
  files: readonly string[],
  extension: string,
  description: string,
): string {
  const matches = files.filter((file) => file.endsWith(extension));
  assert.equal(
    matches.length,
    1,
    `${description} must emit exactly one ${extension} artifact; got ${matches.map((file) => relative(process.cwd(), file)).join(", ")}`,
  );
  const match = matches[0];
  assert.ok(match !== undefined);
  return match;
}

async function buildBrowserEntry(
  consumer: string,
  entrypoint: string,
  outdir: string,
): Promise<ArtifactSet> {
  const result = await Bun.build({
    conditions: ["production", "browser", "module"],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    entrypoints: [resolve(consumer, entrypoint)],
    format: "esm",
    minify: true,
    outdir,
    plugins: [stylex(stylexCompilerOptions(consumer))],
    root: consumer,
    splitting: false,
    target: "browser",
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"));
  }

  const files = await filesBelow(outdir);
  const javaScriptPath = requireExactlyOne(files, ".js", entrypoint);
  const cssPaths = files.filter((file) => file.endsWith(".css"));
  const entryCssName = `${basename(entrypoint).replace(/\.[^.]+$/u, "")}.css`;
  const cssPath = cssPaths.find((file) => basename(file) === entryCssName);
  assert.ok(
    cssPath !== undefined,
    `${entrypoint} must emit its imported ${entryCssName} artifact; got ${cssPaths.map((file) => relative(process.cwd(), file)).join(", ")}`,
  );
  const extractedCssPaths = cssPaths
    .filter((file) => file !== cssPath)
    .sort((left, right) => left.localeCompare(right));
  const [javaScript, importedCss, extractedCss] = await Promise.all([
    readFile(javaScriptPath, "utf8"),
    readFile(cssPath, "utf8"),
    Promise.all(extractedCssPaths.map((file) => readFile(file, "utf8"))),
  ]);
  const css = [importedCss, ...extractedCss].join("\n");
  await writeFile(cssPath, css);
  await Promise.all(
    extractedCssPaths.map((file) => rm(file, { force: true })),
  );
  return { css, cssPath, javaScript, javaScriptPath };
}

async function buildServerRenderer(
  consumer: string,
  outdir: string,
): Promise<string> {
  const result = await Bun.build({
    conditions: ["production", "module"],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    entrypoints: [resolve(consumer, "gallery/render.tsx")],
    format: "esm",
    minify: true,
    outdir,
    packages: "external",
    plugins: [stylex(stylexCompilerOptions(consumer))],
    root: consumer,
    splitting: false,
    target: "bun",
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"));
  }

  return requireExactlyOne(
    await filesBelow(outdir),
    ".js",
    "gallery server renderer",
  );
}

const CHECKBOX_STYLE_KEYS = [
  "control",
  "disabled",
  "focusVisible",
  "indicator",
  "invalidIndicator",
  "label",
  "root",
  "selectedIndicator",
] as const;

function balancedBlock(source: string, open: number, description: string): string {
  let depth = 0;
  let escaped = false;
  let quote: "\"" | "'" | "`" | undefined;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const end = source.indexOf("*/", index + 2);
      assert.notEqual(end, -1, `${description} contains an unterminated comment`);
      index = end + 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${description} contains an unterminated block`);
}

function packedCheckboxStyleMap(javaScript: string): string {
  const candidates: string[] = [];
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*control\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedBlock(javaScript, open, "packed CheckboxField JavaScript");
    if (CHECKBOX_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  assert.equal(
    candidates.length,
    1,
    "the packed JavaScript must contain exactly one compiled checkboxFieldStyles class map",
  );
  const candidate = candidates[0];
  assert.ok(candidate !== undefined);
  return candidate;
}

function packedCheckboxStyleClassNames(
  javaScript: string,
  key: typeof CHECKBOX_STYLE_KEYS[number],
): readonly string[] {
  const styleMap = packedCheckboxStyleMap(javaScript);
  const matches = [...styleMap.matchAll(
    new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
  )];
  assert.equal(
    matches.length,
    1,
    `the packed checkboxFieldStyles map must contain exactly one ${key} entry`,
  );
  const match = matches[0];
  assert.ok(match !== undefined);
  const open = (match.index ?? 0) + match[0].lastIndexOf("{");
  const nestedMap = balancedBlock(
    styleMap,
    open,
    `packed CheckboxField ${key} JavaScript`,
  );
  const classNames: string[] = [];
  for (const classMatch of nestedMap.slice(1, -1).matchAll(
    /(?:^|,)\s*[A-Za-z_$][\w$]*\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    classNames.push(...classMatch[1]!.split(/\s+/u));
  }
  assert.notEqual(
    classNames.length,
    0,
    `the packed checkboxFieldStyles ${key} entry has no generated classes`,
  );
  assert.equal(
    new Set(classNames).size,
    classNames.length,
    `the packed checkboxFieldStyles ${key} entry contains duplicate generated classes`,
  );
  return classNames;
}

function packedCheckboxClassNames(javaScript: string): ReadonlySet<string> {
  const styleMap = packedCheckboxStyleMap(javaScript);
  const classNames = new Set<string>();
  for (const match of styleMap.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    for (const className of match[1]!.split(/\s+/u)) classNames.add(className);
  }
  assert.notEqual(classNames.size, 0, "the packed checkboxFieldStyles map is empty");
  return classNames;
}

function checkboxRuleBodies(
  css: string,
  classNames: ReadonlySet<string>,
): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((match) => [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(match[1]!)
    ))
    .map((match) => match[2]!);
}

function exactLayerCss(css: string, layer: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/@layer\s+[A-Za-z0-9_.-]+\s*\{/gu)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const header = css.slice(match.index, open).replace(/\s+/gu, "");
    if (header === `@layer${layer}`) {
      const block = balancedBlock(css, open, `packed ${layer} CSS`);
      bodies.push(block.slice(1, -1));
    }
  }
  assert.notEqual(
    bodies.length,
    0,
    `the packed CSS must contain an exact ${layer} block`,
  );
  return bodies.join("\n");
}

function requireFinalBundleLayerOrder(css: string): void {
  const preludes = css.match(STYLED_GALLERY_LAYER_PRELUDES);
  assert.ok(
    preludes !== null,
    "the final styled gallery bundle must contain the adjacent canonical base and package layer preludes",
  );
  const preludeStart = preludes.index ?? -1;
  assert.ok(
    preludeStart >= 0,
    "the final styled gallery bundle must expose the canonical prelude position",
  );
  const preludeEnd = preludeStart + preludes[0].length;
  const firstNamedLayerBlock = css.search(
    /@layer\s+(?:base|components\.hraness-ui\.(?:legacy(?:\.[A-Za-z0-9_-]+)*|priority1|priority2|priority3))\s*\{/u,
  );
  assert.notEqual(
    firstNamedLayerBlock,
    -1,
    "the final styled gallery bundle must contain a named base or package layer block",
  );
  assert.ok(
    preludeEnd <= firstNamedLayerBlock,
    "the canonical base and package layer preludes must precede every named base and package layer block",
  );

  const firstBlockPositions = new Map<
    "legacy" | "priority1" | "priority2" | "priority3",
    number
  >();
  const packageLayerBlocks = [...css.matchAll(
    /@layer\s+components\.hraness-ui\.(legacy(?:\.[A-Za-z0-9_-]+)*|priority1|priority2|priority3)\s*\{/gu,
  )];
  assert.notEqual(
    packageLayerBlocks.length,
    0,
    "the final styled gallery bundle must contain package named-layer blocks",
  );
  for (const match of packageLayerBlocks) {
    const position = match.index ?? -1;
    assert.ok(
      position >= preludeEnd,
      "the canonical package layer prelude must precede every package named-layer block",
    );
    const matchedLayer = match[1];
    assert.ok(matchedLayer !== undefined);
    const layer = matchedLayer === "legacy" || matchedLayer.startsWith("legacy.")
      ? "legacy"
      : matchedLayer;
    assert.ok(
      layer === "legacy"
      || layer === "priority1"
      || layer === "priority2"
      || layer === "priority3",
      `the final styled gallery bundle contains an unknown package layer: ${layer}`,
    );
    if (!firstBlockPositions.has(layer)) firstBlockPositions.set(layer, position);
  }

  const orderedLayers = ["legacy", "priority1", "priority2", "priority3"] as const;
  const positions = orderedLayers.map((layer) => {
    const position = firstBlockPositions.get(layer);
    assert.ok(
      position !== undefined,
      `the final styled gallery bundle must contain a ${layer} package layer block`,
    );
    return position;
  });
  assert.ok(
    positions.every((position, index) => index === 0 || positions[index - 1]! < position),
    "the first package named-layer blocks must be ordered legacy, priority1, priority2, then priority3",
  );
}

function requirePackedCheckboxConflictLayer(css: string): void {
  const selectors = [...css.matchAll(
    /html\s+body\s+\[data-gallery-checkbox-field-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"checkbox-control"|checkbox-control)\]\s*\{/gu,
  )];
  assert.equal(
    selectors.length,
    1,
    "the final styled gallery bundle must contain exactly one CheckboxField control conflict selector",
  );
  const selector = selectors[0];
  assert.ok(selector?.index !== undefined);
  const selectorPosition = selector.index;
  const enclosingLayers: string[] = [];
  for (const match of css.matchAll(/@layer\s+([A-Za-z0-9_.-]+)\s*\{/gu)) {
    const start = match.index ?? -1;
    const open = start + match[0].lastIndexOf("{");
    const block = balancedBlock(css, open, `final ${String(match[1])} CSS`);
    if (selectorPosition >= open && selectorPosition < open + block.length) {
      enclosingLayers.push(match[1]!);
    }
  }
  assert.deepEqual(
    enclosingLayers,
    ["components.hraness-ui.legacy"],
    "the unique CheckboxField control conflict selector must exist only inside components.hraness-ui.legacy",
  );
}

function exactAtomicClassRules(
  css: string,
  className: string,
): readonly Omit<CheckboxFocusRuleEvidence, "className" | "layer">[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .map((match) => ({
      declaration: match[2]!.replace(/\s+/gu, "").replace(/;$/u, ""),
      selector: match[1]!.trim(),
    }))
    .filter((rule) => rule.selector === `.${className}`);
}

function requirePackedCheckboxFocusContract(
  javaScript: string,
  css: string,
): CheckboxFocusContract {
  const layer = "components.hraness-ui.priority2" as const;
  const classNames = packedCheckboxStyleClassNames(javaScript, "focusVisible");
  const expectedDeclarations = [
    "outline-color:var(--ui-ring)",
    "outline-offset:3px",
    "outline-style:solid",
    "outline-width:2px",
  ] as const;
  assert.equal(
    classNames.length,
    expectedDeclarations.length,
    "the packed CheckboxField focus recipe must contain one class per declaration",
  );
  const layerCss = exactLayerCss(css, layer);
  const rules = classNames.map((className) => {
    const finalRules = exactAtomicClassRules(css, className);
    const layerRules = exactAtomicClassRules(layerCss, className);
    assert.equal(
      finalRules.length,
      1,
      `the final bundle must contain exactly one .${className} rule`,
    );
    assert.equal(
      layerRules.length,
      1,
      `the final bundle must place .${className} in ${layer}`,
    );
    const finalRule = finalRules[0];
    const layerRule = layerRules[0];
    assert.ok(finalRule !== undefined && layerRule !== undefined);
    assert.deepEqual(
      finalRule,
      layerRule,
      `the ${layer} .${className} rule must be the unique final bundled rule`,
    );
    return { className, layer, ...finalRule };
  });
  for (const declaration of expectedDeclarations) {
    assert.equal(
      rules.filter((rule) => rule.declaration === declaration).length,
      1,
      `the final CheckboxField focus recipe must bind exactly one class to ${declaration}`,
    );
  }
  const expectedDeclarationSet: ReadonlySet<string> = new Set(
    expectedDeclarations,
  );
  assert.equal(
    rules.every((rule) => expectedDeclarationSet.has(rule.declaration)),
    true,
    "the final CheckboxField focus recipe contains an unexpected declaration",
  );
  return { classNames, rules };
}

function exactConditionalCss(css: string, condition: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/@media\s*\([^{}]+\)\s*\{/gu)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const header = css.slice(match.index, open).replace(/\s+/gu, "")
      .toLowerCase();
    if (header === condition) {
      const block = balancedBlock(css, open, `packed ${condition} CSS`);
      bodies.push(block.slice(1, -1));
    }
  }
  assert.notEqual(bodies.length, 0, `the packed CSS must contain an exact ${condition} block`);
  return bodies.join("\n");
}

function requirePackedCheckboxStyles(javaScript: string, css: string): void {
  const classNames = packedCheckboxClassNames(javaScript);
  const familyCss = checkboxRuleBodies(css, classNames).join("\n");
  assert.match(
    familyCss,
    /min-height:\s*var\(--interactive-target-compact\)/u,
    "checkboxFieldStyles must own the packed CheckboxField default target",
  );
  assert.match(
    familyCss,
    /transition-property:\s*background-color,\s*border-color/u,
    "checkboxFieldStyles must own the packed CheckboxField transitions",
  );
  const coarseCss = checkboxRuleBodies(
    exactConditionalCss(css, "@media(pointer:coarse)"),
    classNames,
  ).join("\n");
  assert.match(
    coarseCss,
    /min-height:\s*var\(--interactive-target-min\)/u,
    "checkboxFieldStyles must own the coarse target inside the exact conditional block",
  );
  const forcedColorsCss = checkboxRuleBodies(
    exactConditionalCss(css, "@media(forced-colors:active)"),
    classNames,
  ).join("\n");
  assert.match(
    forcedColorsCss,
    /border-color:\s*canvastext/u,
    "checkboxFieldStyles must own the forced-color border inside the exact conditional block",
  );
  assert.match(
    forcedColorsCss,
    /forced-color-adjust:\s*auto/u,
    "checkboxFieldStyles must own the forced-color adjustment inside the exact conditional block",
  );
}

function requirePackedDefaultStylesheet(css: string, javaScript: string): void {
  assert.match(
    css,
    /@layer components\.hraness-ui\.priority[12]/u,
    "the packed default stylesheet must include the package StyleX layer",
  );
  assert.match(
    css,
    /@layer\s+base\s*,\s*components/u,
    "the packed default stylesheet must keep reset styles below components",
  );
  assert.match(
    css,
    PACKAGE_LAYER_PRELUDE,
    "the packed default stylesheet must freeze the package layer order",
  );
  requireFinalBundleLayerOrder(css);
  requirePackedCheckboxConflictLayer(css);
  assert.match(
    css,
    /\.hraness-button(?:__control)?(?=[\s,{:.])/u,
    "the packed default stylesheet must include legacy action recipes",
  );
  assert.match(
    css,
    /max-inline-size:\s*var\(--hraness-quiet-site-measure,\s*34rem\)/u,
    "the packed default stylesheet must include the compiled quiet-site measure",
  );
  assert.match(
    css,
    /max-inline-size:\s*35rem/u,
    "the harness bundle must include its canonical logical xstyle override",
  );
  assert.match(
    css,
    /padding-bottom:\s*max\(var\(--space-5,\s*1\.25rem\),\s*env\(safe-area-inset-bottom\)\)/u,
    "the packed default stylesheet must include the compiled safe-area footer padding",
  );
  assert.match(
    css,
    /gap:\s*var\(--space-3\)/u,
    "the packed default stylesheet must include the compiled wrapping-row gap",
  );
  assert.match(
    css,
    /overflow:\s*hidden/u,
    "the packed default stylesheet must include the compiled viewport overflow",
  );
  assert.match(
    css,
    /background-color:\s*var\(--ui-popover\)/u,
    "the packed default stylesheet must include the compiled popover surface tone",
  );
  assert.match(
    css,
    /border-radius:\s*var\(--radius-sharp\)/u,
    "the packed default stylesheet must include the compiled rectangular surface shape",
  );
  assert.match(
    css,
    /padding-block:\s*var\(--space-6\)/u,
    "the packed default stylesheet must include the compiled themed-surface block padding",
  );
  assert.match(
    css,
    /background-color:\s*var\(--ui-muted\)/u,
    "the packed default stylesheet must include the compiled avatar background token",
  );
  assert.match(
    css,
    /border-radius:\s*var\(--radius-round\)/u,
    "the packed default stylesheet must include circular Avatar clipping",
  );
  assert.match(
    css,
    /display:\s*inline-grid/u,
    "the packed default stylesheet must include the Avatar root display",
  );
  assert.match(
    css,
    /height:\s*3\.5rem/u,
    "the packed default stylesheet must include the Avatar large height",
  );
  assert.match(
    css,
    /object-fit:\s*cover/u,
    "the packed default stylesheet must include Avatar image cropping",
  );
  assert.match(
    css,
    /width:\s*3\.5rem/u,
    "the packed default stylesheet must include the Avatar large width",
  );
  assert.match(
    css,
    /border-color:\s*var\(--hraness-tag-accent,\s*var\(--ui-border\)\)/u,
    "the packed default stylesheet must preserve the public Tag accent variable",
  );
  assert.match(
    css,
    /min-height:\s*1\.5rem/u,
    "the packed default stylesheet must include the status-pill finite geometry",
  );
  assert.match(
    css,
    /height:\s*\.625rem/u,
    "the packed default stylesheet must include the StatusDot height",
  );
  assert.match(
    css,
    /width:\s*\.625rem/u,
    "the packed default stylesheet must include the StatusDot width",
  );
  assert.match(
    css,
    /@media\s*\(forced-colors:\s*active\)[^{]*\{[^}]*border-color:\s*canvastext/isu,
    "the packed default stylesheet must include the status-family forced-color border",
  );
  assert.match(
    css,
    /color:\s*var\(--hraness-card-description\)/u,
    "the packed default stylesheet must include the public Card description consumer",
  );
  assert.match(
    css,
    /border-color:\s*color-mix\(in oklch,var\(--ui-primary\)\s*35%,var\(--ui-border\)\)/u,
    "the packed default stylesheet must include the PressableCard hover border",
  );
  assert.match(
    css,
    /transform:\s*translateY\(1px\)/u,
    "the packed default stylesheet must include the PressableCard pressed transform",
  );
  assert.match(
    css,
    /outline-color:\s*var\(--ui-ring\)/u,
    "the packed default stylesheet must include the PressableCard focus ring",
  );
  assert.match(
    css,
    /outline-offset:\s*2px/u,
    "the packed default stylesheet must include the native Toolbar focus offset",
  );
  assert.match(
    css,
    /padding-block:\s*var\(--space-1\)/u,
    "the packed default stylesheet must include the Toolbar block padding",
  );
  assert.match(
    css,
    /padding-inline:\s*var\(--space-1\)/u,
    "the packed default stylesheet must include the Toolbar inline padding",
  );
  assert.match(
    css,
    /border-block-end-width:\s*2px/u,
    "the packed default stylesheet must include the KeyHint block-end depth",
  );
  assert.match(
    css,
    /font-family:\s*var\(--ui-font-mono\)/u,
    "the packed default stylesheet must include the KeyHint font",
  );
  assert.match(
    css,
    /min-block-size:\s*1\.5rem/u,
    "the packed default stylesheet must include the KeyHint minimum block size",
  );
  assert.match(
    css,
    /min-inline-size:\s*1\.5rem/u,
    "the packed default stylesheet must include the KeyHint minimum inline size",
  );
  requirePackedCheckboxStyles(javaScript, css);
  assert.match(
    css,
    /background-image:\s*repeating-linear-gradient\(/u,
    "the harness bundle must include the downstream texture xstyle seam",
  );
  const viewportHeightPositions = ["100vh", "100svh", "100dvh"].map(
    (height) => css.search(new RegExp(`height:\\s*${height}(?:[;}])`, "u")),
  );
  assert.ok(
    viewportHeightPositions.every((position) => position >= 0)
    && viewportHeightPositions[0]! < viewportHeightPositions[1]!
    && viewportHeightPositions[1]! < viewportHeightPositions[2]!,
    "the packed default stylesheet must preserve the vh, svh, then dvh viewport fallback order",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain legacy quiet-site selectors",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain legacy structural-surface selectors",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-themed-surface(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain a legacy themed-surface selector",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-avatar(?:__image|__fallback)?(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain legacy Avatar selectors",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-(?:badge(?:--(?:info|success|warning|danger|accent|positive|caution|critical))?|tag(?:__icon|__label)?|status-dot(?:--(?:info|success|warning|danger))?)(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain legacy status-family selectors",
  );
  assert.doesNotMatch(
    css.replace(CARD_DESCRIPTION_BRIDGE_PATTERN, ""),
    /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain Card-family selectors beyond the compatibility bridge",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-toolbar(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain a legacy Toolbar selector",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-key-hint(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain a legacy KeyHint selector",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-checkbox-field(?:__(?:control|indicator|label))?(?![A-Za-z0-9_-])/u,
    "the packed default stylesheet must not retain legacy CheckboxField selectors",
  );
  assert.equal(
    css.match(CARD_DESCRIPTION_BRIDGE_PATTERN)?.length,
    1,
    "the packed default stylesheet must contain the single Card description compatibility bridge",
  );
  assert.match(
    css,
    /--ui-background:/u,
    "the packed default stylesheet must include public theme tokens",
  );
  assert.match(
    css,
    /data-gallery-stylex-layer-conflict/u,
    "the harness bundle must include its gallery-only legacy conflict",
  );
  assert.match(
    css,
    /data-gallery-checkbox-field-layer-conflict/u,
    "the harness bundle must include its CheckboxField legacy conflict",
  );
  assert.match(
    css,
    /\[data-gallery-stylex-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"icon"|icon)\]\{(?=[^}]*--gallery-stylex-layer-conflict:\s*legacy)(?=[^}]*display:\s*block)(?=[^}]*flex:\s*(?:auto|1\s+1\s+auto))[^}]*\}/u,
    "the gallery conflict must independently carry its sentinel, display, and flex declarations",
  );
  assert.match(
    css,
    /\[data-gallery-quiet-site-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"quiet-site-page"|quiet-site-page)\]\{(?=[^}]*--gallery-quiet-site-layer-conflict:\s*legacy)(?=[^}]*max-inline-size:\s*12rem)[^}]*\}/u,
    "the gallery quiet-site measure conflict must carry its sentinel and max-inline-size declaration",
  );
  assert.match(
    css,
    /\[data-gallery-quiet-site-priority3-conflict=(?:"true"|true)\]\[data-slot=(?:"quiet-site-footer"|quiet-site-footer)\]\{(?=[^}]*--gallery-quiet-site-priority3-conflict:\s*legacy)(?=[^}]*padding-top:\s*9rem)[^}]*\}/u,
    "the gallery quiet-site priority3 conflict must carry its sentinel and padding declaration",
  );
  assert.match(
    css,
    /\[data-gallery-wrapping-row-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"wrapping-row"|wrapping-row)\]\{(?=[^}]*--gallery-wrapping-row-layer-conflict:\s*legacy)(?=[^}]*display:\s*grid)(?=[^}]*min-inline-size:\s*8rem)(?=[^}]*flex-wrap:\s*nowrap)(?=[^}]*align-items:\s*stretch)(?=[^}]*gap:\s*5rem)[^}]*\}/u,
    "the gallery wrapping-row conflict must independently carry its sentinel and structural declarations",
  );
  assert.match(
    css,
    /\[data-gallery-viewport-frame-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"viewport-frame"|viewport-frame)\]\{(?=[^}]*--gallery-viewport-frame-layer-conflict:\s*legacy)(?=[^}]*inline-size:\s*12rem)(?=[^}]*min-inline-size:\s*8rem)(?=[^}]*height:\s*5rem)(?=[^}]*overflow:\s*visible)[^}]*\}/u,
    "the gallery viewport-frame conflict must independently carry its sentinel and viewport declarations",
  );
  const themedSurfaceConflict = css.match(
    /\[data-gallery-themed-surface-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"themed-surface"|themed-surface)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    themedSurfaceConflict !== undefined,
    "the packed stylesheet must include the gallery themed-surface conflict",
  );
  const themedSurfaceConflictDeclarations = [
    /--gallery-themed-surface-layer-conflict:\s*legacy/u,
    /min-inline-size:\s*9rem/u,
    /padding-block-start:\s*5rem/u,
    /padding-block-end:\s*5rem/u,
    /padding-inline-start:\s*5rem/u,
    /padding-inline-end:\s*5rem/u,
    /border:\s*7px dashed/u,
    /border-radius:\s*99px/u,
    /background-color:/u,
    /background-image:\s*none/u,
    /background-position:\s*99px 99px/u,
    /background-repeat:\s*no-repeat/u,
    /background-size:\s*99px 99px/u,
    /color:/u,
    /box-shadow:\s*none/u,
  ] as const;
  for (const declaration of themedSurfaceConflictDeclarations) {
    assert.match(
      themedSurfaceConflict,
      declaration,
      "the gallery themed-surface conflict must independently carry every boundary declaration",
    );
  }
  const avatarConflict = css.match(
    /\[data-gallery-avatar-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"avatar"|avatar)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    avatarConflict !== undefined,
    "the packed stylesheet must include the gallery Avatar root conflict",
  );
  const avatarConflictDeclarations = [
    /--gallery-avatar-layer-conflict:\s*legacy/u,
    /width:\s*13rem/u,
    /height:\s*17rem/u,
    /overflow:\s*visible/u,
    /border-radius:\s*0/u,
    /background-color:/u,
    /color:/u,
    /display:\s*block/u,
    /flex:\s*(?:auto|1\s+1\s+auto)/u,
    /font-weight:\s*100/u,
  ] as const;
  for (const declaration of avatarConflictDeclarations) {
    assert.match(
      avatarConflict,
      declaration,
      "the gallery Avatar root conflict must independently carry every recipe declaration",
    );
  }
  assert.ok(
    /place-items:\s*stretch/u.test(avatarConflict)
    || (
      /align-items:\s*stretch/u.test(avatarConflict)
      && /justify-items:\s*stretch/u.test(avatarConflict)
    ),
    "the gallery Avatar root conflict must independently carry both alignment declarations",
  );
  assert.match(
    css,
    /\[data-gallery-avatar-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"avatar"|avatar)\]\[data-size=(?:"small"|small)\][^{]*\{[^}]*font-size:\s*6rem[^}]*\}/u,
    "the gallery Avatar finite-size conflict must carry the small and large font declaration",
  );
  assert.match(
    css,
    /\[data-gallery-avatar-layer-conflict=(?:"true"|true)\]\s+:where\([^}]+\)\{(?=[^}]*width:\s*20%)(?=[^}]*height:\s*30%)[^}]*\}/u,
    "the gallery Avatar child conflict must carry both fill declarations",
  );
  assert.match(
    css,
    /\[data-gallery-avatar-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"avatar-image"|avatar-image)\]\{[^}]*object-fit:\s*contain[^}]*\}/u,
    "the gallery Avatar image conflict must carry the crop declaration",
  );
  const avatarFallbackConflict = css.match(
    /\[data-gallery-avatar-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"avatar-fallback"|avatar-fallback)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    avatarFallbackConflict !== undefined
    && /display:\s*block/u.test(avatarFallbackConflict)
    && (
      /place-items:\s*start/u.test(avatarFallbackConflict)
      || (
        /align-items:\s*start/u.test(avatarFallbackConflict)
        && /justify-items:\s*start/u.test(avatarFallbackConflict)
      )
    ),
    "the gallery Avatar fallback conflict must carry every centering declaration",
  );
  const statusPillConflict = css.match(
    /\[data-gallery-status-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"badge"|badge)\][^{]*\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    statusPillConflict !== undefined,
    "the packed stylesheet must include the gallery status-pill conflict",
  );
  const statusPillConflictDeclarations = [
    /--gallery-status-family-layer-conflict:\s*legacy/u,
    /width:\s*17rem/u,
    /min-height:\s*7rem/u,
    /align-items:\s*stretch/u,
    /justify-content:\s*flex-start/u,
    /gap:\s*5rem/u,
    /padding-inline-start:\s*4rem/u,
    /padding-inline-end:\s*4rem/u,
    /border:\s*7px dashed/u,
    /border-radius:\s*0/u,
    /background-color:/u,
    /color:/u,
    /display:\s*block/u,
    /font-size:\s*3rem/u,
    /font-weight:\s*100/u,
    /line-height:\s*3/u,
    /white-space:\s*normal/u,
  ] as const;
  for (const declaration of statusPillConflictDeclarations) {
    assert.match(
      statusPillConflict,
      declaration,
      "the gallery status-pill conflict must carry every root declaration",
    );
  }
  assert.match(
    css,
    /\[data-gallery-status-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"tag"|tag)\]\{[^}]*--hraness-tag-accent:\s*(?:#010203|rgb\(1 2 3\))[^}]*\}/u,
    "the gallery Tag conflict must carry the public custom-property counterexample",
  );
  assert.match(
    css,
    /\[data-gallery-status-family-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"tag-icon"|tag-icon)\]\{(?=[^}]*display:\s*block)(?=[^}]*flex:\s*(?:auto|1\s+1\s+auto))[^}]*\}/u,
    "the gallery Tag icon conflict must carry child layout counterexamples",
  );
  assert.match(
    css,
    /\[data-gallery-status-family-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"tag-label"|tag-label)\]\{[^}]*min-width:\s*9rem[^}]*\}/u,
    "the gallery Tag label conflict must carry its shrink counterexample",
  );
  const statusDotConflict = css.match(
    /\[data-gallery-status-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"status-dot"|status-dot)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    statusDotConflict !== undefined
    && /--gallery-status-family-layer-conflict:\s*legacy/u.test(statusDotConflict)
    && /width:\s*3rem/u.test(statusDotConflict)
    && /height:\s*4rem/u.test(statusDotConflict)
    && /border:\s*7px dashed/u.test(statusDotConflict)
    && /background-color:/u.test(statusDotConflict)
    && /display:\s*block/u.test(statusDotConflict)
    && /flex:\s*(?:auto|1\s+1\s+auto)/u.test(statusDotConflict),
    "the gallery StatusDot conflict must carry every finite-geometry counterexample",
  );
  const cardConflict = css.match(
    /\[data-gallery-card-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"card"|card)\][^{]*\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    cardConflict !== undefined
    && /--gallery-card-family-layer-conflict:\s*legacy/u.test(cardConflict)
    && !/--hraness-card-description:/u.test(cardConflict)
    && /border:\s*7px dashed/u.test(cardConflict)
    && /background-color:/u.test(cardConflict)
    && /box-shadow:\s*none/u.test(cardConflict),
    "the gallery Card conflict must carry its base counterexamples",
  );
  assert.match(
    css,
    /\.gallery-card--class-variable\s*\{\s*--hraness-card-description:/u,
    "the gallery must keep an unlayered public Card variable override",
  );
  const pressableConflict = [
    ...css.matchAll(
      /\[data-gallery-card-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"pressable-card"|pressable-card)\][^{]*\{[^}]*\}/gu,
    ),
  ]
    .map((match) => match[0])
    .find((block) => /width:\s*19rem/u.test(block));
  assert.ok(
    pressableConflict !== undefined
    && /width:\s*19rem/u.test(pressableConflict)
    && /min-width:\s*18rem/u.test(pressableConflict)
    && /transition[^;{}]*opacity/u.test(pressableConflict),
    "the gallery PressableCard conflict must carry geometry and transition counterexamples",
  );
  const pressableHoverConflict = css.match(
    /\[data-gallery-card-family-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"pressable-card"|pressable-card)\]:where\([^)]*:hover[^)]*\)\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    pressableHoverConflict !== undefined
    && /border(?:-color)?:/u.test(pressableHoverConflict)
    && /box-shadow:/u.test(pressableHoverConflict),
    "the gallery PressableCard conflict must carry the native and data hover counterexample",
  );
  assert.match(
    css,
    /@media\s*\(forced-colors:\s*active\)[\s\S]*\[data-gallery-card-family-layer-conflict=(?:"true"|true)\][^}]*\{[^}]*forced-color-adjust:\s*none/u,
    "the gallery Card conflict must carry its forced-colors counterexample",
  );
  const checkboxRootConflict = css.match(
    /\[data-gallery-checkbox-field-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"checkbox-field"|checkbox-field)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    checkboxRootConflict !== undefined
    && /--gallery-checkbox-field-layer-conflict:\s*legacy/u.test(checkboxRootConflict)
    && /display:\s*block/u.test(checkboxRootConflict)
    && /gap:\s*9rem/u.test(checkboxRootConflict)
    && /grid-template-columns:\s*7rem 8rem/u.test(checkboxRootConflict)
    && /min-width:\s*11rem/u.test(checkboxRootConflict),
    `the gallery CheckboxField root conflict is incomplete: ${String(checkboxRootConflict)}`,
  );
  const checkboxControlConflict = css.match(
    /\[data-gallery-checkbox-field-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"checkbox-control"|checkbox-control)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    checkboxControlConflict !== undefined
    && /align-items:\s*stretch/u.test(checkboxControlConflict)
    && (
      /border:\s*7px solid/u.test(checkboxControlConflict)
      || (
        /border-style:\s*solid/u.test(checkboxControlConflict)
        && /border-width:\s*7px/u.test(checkboxControlConflict)
      )
    )
    && /border-radius:\s*99px/u.test(checkboxControlConflict)
    && /display:\s*flex/u.test(checkboxControlConflict)
    && /gap:\s*8rem/u.test(checkboxControlConflict)
    && /grid-template-columns:\s*9rem 10rem/u.test(checkboxControlConflict)
    && /min-height:\s*9rem/u.test(checkboxControlConflict)
    && (
      /outline:\s*8px dashed/u.test(checkboxControlConflict)
      || (
        /outline-style:\s*dashed/u.test(checkboxControlConflict)
        && /outline-width:\s*8px/u.test(checkboxControlConflict)
      )
    )
    && /outline-offset:\s*19px/u.test(checkboxControlConflict)
    && /width:\s*18rem/u.test(checkboxControlConflict),
    `the gallery CheckboxField control conflict is incomplete: ${String(checkboxControlConflict)}`,
  );
  const checkboxIndicatorConflict = css.match(
    /\[data-gallery-checkbox-field-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"checkbox-indicator"|checkbox-indicator)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    checkboxIndicatorConflict !== undefined
    && (
      /border:\s*7px dashed/u.test(checkboxIndicatorConflict)
      || (
        /border-style:\s*dashed/u.test(checkboxIndicatorConflict)
        && /border-width:\s*7px/u.test(checkboxIndicatorConflict)
      )
    )
    && /border-radius:\s*99px/u.test(checkboxIndicatorConflict)
    && /display:\s*block/u.test(checkboxIndicatorConflict)
    && /flex:\s*(?:auto|1\s+1\s+auto)/u.test(checkboxIndicatorConflict)
    && /height:\s*8rem/u.test(checkboxIndicatorConflict)
    && /width:\s*9rem/u.test(checkboxIndicatorConflict),
    `the gallery CheckboxField indicator conflict is incomplete: ${String(checkboxIndicatorConflict)}`,
  );
  assert.match(
    css,
    /\[data-gallery-checkbox-field-layer-conflict=(?:"true"|true)\]\s+\[data-slot=(?:"checkbox-label"|checkbox-label)\]\{(?=[^}]*font-size:\s*4rem)(?=[^}]*font-weight:\s*100)(?=[^}]*line-height:\s*4)(?=[^}]*width:\s*18rem)[^}]*\}/u,
    "the gallery CheckboxField label conflict must carry every typography counterexample",
  );
  const toolbarConflict = css.match(
    /\[data-gallery-toolbar-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"toolbar"|toolbar)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    toolbarConflict !== undefined
    && /--gallery-toolbar-layer-conflict:\s*legacy/u.test(toolbarConflict)
    && /min-width:\s*18rem/u.test(toolbarConflict)
    && /align-items:\s*stretch/u.test(toolbarConflict)
    && /display:\s*grid/u.test(toolbarConflict)
    && /flex-wrap:\s*nowrap/u.test(toolbarConflict)
    && /gap:\s*5rem/u.test(toolbarConflict)
    && (
      /padding-block:\s*5rem/u.test(toolbarConflict)
      || (
        /padding-block-start:\s*5rem/u.test(toolbarConflict)
        && /padding-block-end:\s*5rem/u.test(toolbarConflict)
      )
    )
    && (
      /padding-inline:\s*5rem/u.test(toolbarConflict)
      || (
        /padding-inline-start:\s*5rem/u.test(toolbarConflict)
        && /padding-inline-end:\s*5rem/u.test(toolbarConflict)
      )
    )
    && /border:\s*7px dashed/u.test(toolbarConflict)
    && /border-radius:\s*0/u.test(toolbarConflict)
    && /background-color:/u.test(toolbarConflict),
    `the gallery Toolbar conflict must carry every root counterexample: ${String(toolbarConflict)}`,
  );
  const verticalToolbarConflict = css.match(
    /\[data-gallery-toolbar-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"toolbar"|toolbar)\]\[data-orientation=(?:"vertical"|vertical)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    verticalToolbarConflict !== undefined
    && /width:\s*19rem/u.test(verticalToolbarConflict)
    && /align-items:\s*center/u.test(verticalToolbarConflict)
    && (
      /flex-flow:\s*wrap/u.test(verticalToolbarConflict)
      || (
        /flex-direction:\s*row/u.test(verticalToolbarConflict)
        && /flex-wrap:\s*wrap/u.test(verticalToolbarConflict)
      )
    ),
    `the gallery vertical Toolbar conflict must carry every orientation counterexample: ${String(verticalToolbarConflict)}`,
  );
  const toolbarFocusConflict = css.match(
    /\[data-gallery-toolbar-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"toolbar"|toolbar)\]:focus-visible\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    toolbarFocusConflict !== undefined
    && /outline-color:/u.test(toolbarFocusConflict)
    && /outline-offset:\s*11px/u.test(toolbarFocusConflict)
    && /outline-style:\s*solid/u.test(toolbarFocusConflict)
    && /outline-width:\s*7px/u.test(toolbarFocusConflict),
    "the gallery Toolbar conflict must carry every focus counterexample",
  );
  const keyHintConflict = css.match(
    /\[data-gallery-key-hint-layer-conflict=(?:"true"|true)\]\[data-slot=(?:"key-hint"|key-hint)\]\{[^}]*\}/u,
  )?.[0];
  assert.ok(
    keyHintConflict !== undefined
    && /--gallery-key-hint-layer-conflict:\s*legacy/u.test(keyHintConflict)
    && /align-items:\s*stretch/u.test(keyHintConflict)
    && /min-width:\s*5rem/u.test(keyHintConflict)
    && /min-height:\s*4rem/u.test(keyHintConflict)
    && /justify-content:\s*flex-start/u.test(keyHintConflict)
    && (
      /padding-inline:\s*5rem/u.test(keyHintConflict)
      || (
        /padding-inline-start:\s*5rem/u.test(keyHintConflict)
        && /padding-inline-end:\s*5rem/u.test(keyHintConflict)
      )
    )
    && /border:\s*7px dashed/u.test(keyHintConflict)
    && /border-block-end-width:\s*9px/u.test(keyHintConflict)
    && /border-radius:\s*0/u.test(keyHintConflict)
    && /background-color:/u.test(keyHintConflict)
    && /color:/u.test(keyHintConflict)
    && /display:\s*block/u.test(keyHintConflict)
    && /font-family:\s*serif/u.test(keyHintConflict)
    && /font-size:\s*3rem/u.test(keyHintConflict),
    `the gallery KeyHint conflict must carry every recipe counterexample: ${String(keyHintConflict)}`,
  );
}

function placePriority3BeforeLegacy(css: string): string {
  const prelude = css.match(PACKAGE_LAYER_PRELUDE)?.[0];
  assert.ok(prelude !== undefined, "the packed stylesheet layer prelude is missing");
  const counterfactualPrelude = [
    "@layer components.hraness-ui.priority3",
    "components.hraness-ui.legacy",
    "components.hraness-ui.priority1",
    "components.hraness-ui.priority2",
  ].join(", ");
  const counterfactual = [
    "@layer base, components;",
    `${counterfactualPrelude};`,
    css,
  ].join("\n");
  assert.notEqual(counterfactual, css);
  assert.equal(
    counterfactual.match(PACKAGE_LAYER_PRELUDE)?.[0],
    prelude,
    "the browser counterfactual must retain the valid package layer statement",
  );
  assert.match(
    counterfactual,
    /@layer\s+components\.hraness-ui\.priority3\s*,\s*components\.hraness-ui\.legacy/u,
    "the browser counterfactual must create legacy after priority3",
  );
  return counterfactual;
}

function attachDiagnostics(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${String(response.status())} ${response.url()}`);
    }
  });
  return failures;
}

async function waitForHydration(
  page: Page,
  failures: readonly string[],
  requestedPaths: ReadonlySet<string>,
  description: string,
): Promise<void> {
  try {
    await page.locator('[data-gallery-hydration-root][data-hydrated="true"]').waitFor({
      timeout: 10_000,
    });
  } catch (error: unknown) {
    const state = await page.evaluate(() => ({
      body: document.body.innerText.slice(0, 400),
      readyState: document.readyState,
      rootExists: document.querySelector('[data-gallery-hydration-root="true"]') !== null,
      scripts: Array.from(document.scripts, (script) => script.src),
      started: window.__HRANESS_UI_GALLERY_HYDRATION_STARTED__ ?? false,
      stylesheets: Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        (link) => link.href,
      ),
    }));
    throw new Error(
      `${description}: hydration did not settle; diagnostics=${JSON.stringify(failures)}; requests=${JSON.stringify([...requestedPaths])}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
}

async function browserEvidence(page: Page): Promise<BrowserEvidence> {
  return page.evaluate(() => {
    const icon = document.querySelector('[data-gallery-icon-canary="true"] [data-slot="icon"]');
    const iconCanary = document.querySelector('[data-gallery-icon-canary="true"]');
    const social = document.querySelector('[data-gallery-icon-wrapper-canary="true"] [data-social-icon="github"]');
    const socialIcon = social?.querySelector(':scope > [data-slot="icon"]');
    const substack = document.querySelector('[data-gallery-icon-wrapper-canary="true"] [data-social-icon="substack"]');
    const substackIcon = substack?.querySelector(":scope > svg");
    const appearance = document.querySelector('[data-gallery-icon-wrapper-canary="true"] [data-appearance-icon="system"]');
    const appearanceIcon = appearance?.querySelector(':scope > [data-slot="icon"]');
    const button = document.querySelector('[data-gallery-primary-action="true"][data-slot="button-control"]');
    const card = document.querySelector('[data-gallery-icon-card="true"]');
    const spinner = document.querySelector('[data-slot="spinner"]');
    const skeleton = document.querySelector('[data-slot="skeleton"]');
    const root = document.querySelector('[data-gallery-hydration-root="true"]');
    const heading = document.querySelector("h1");
    const footer = document.querySelector('[data-slot="quiet-site-footer"]');
    const main = document.querySelector('[data-slot="quiet-site-page"]');
    const viewportFrame = document.querySelector('[data-gallery-viewport-frame="true"]');
    const wrappingRow = document.querySelector('[data-gallery-wrapping-row="true"]');
    const wrappingRowFirstItem = document.querySelector('[data-gallery-wrapping-row-item="one"]');
    const wrappingRowSecondItem = document.querySelector('[data-gallery-wrapping-row-item="two"]');
    const themedSurfaces = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-themed-surface-tone]'),
    ];
    const themedSurfaceTexture = document.querySelector(
      '[data-gallery-themed-surface-texture="true"]',
    );
    const avatarFallbacks = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-avatar-size]'),
    ];
    const avatarImage = document.querySelector('[data-gallery-avatar-image="true"]');
    const avatarOverride = document.querySelector('[data-gallery-avatar-override="true"]');
    const statusBadges = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-badge-tone]'),
    ];
    const statusTags = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-tag-variant]'),
    ];
    const statusDots = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-status-dot-tone]'),
    ];
    const statusBadgeOverride = document.querySelector(
      '[data-gallery-status-family-override="badge"]',
    );
    const statusTagOverride = document.querySelector(
      '[data-gallery-status-family-override="tag"]',
    );
    const statusDotOverride = document.querySelector(
      '[data-gallery-status-family-override="dot"]',
    );
    const cards = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-card-tone]'),
    ];
    const pressableCards = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-gallery-pressable-card-tone]',
      ),
    ];
    const cardClassVariableOverride = document.querySelector(
      '[data-gallery-card-class-variable="true"]',
    );
    const cardOverride = document.querySelector(
      '[data-gallery-card-family-override="card"]',
    );
    const pressableCardOverride = document.querySelector(
      '[data-gallery-card-family-override="pressable"]',
    );
    const cardVariableOverride = document.querySelector(
      '[data-gallery-card-variable-override="true"]',
    );
    const cardNestedOuter = document.querySelector(
      '[data-gallery-card-nested-outer="true"]',
    );
    const cardNestedOuterDescription = document.querySelector(
      '[data-gallery-card-nested-outer-description="true"]',
    );
    const cardNestedInner = document.querySelector(
      '[data-gallery-card-nested-inner="true"]',
    );
    const cardNestedInnerDescription = document.querySelector(
      '[data-gallery-card-nested-inner-description="true"]',
    );
    const toolbars = [
      ...document.querySelectorAll<HTMLDivElement>(
        '[data-gallery-toolbar-layer-conflict="true"]',
      ),
    ];
    const toolbarOverride = document.querySelector(
      '[data-gallery-toolbar-override="true"]',
    );
    const keyHints = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-key-hint]'),
    ];
    const keyHintOverride = document.querySelector(
      '[data-gallery-key-hint="override"]',
    );
    const checkboxFields = [
      ...document.querySelectorAll<HTMLElement>('[data-gallery-checkbox]'),
    ];
    const defaultCheckbox = document.querySelector(
      '[data-gallery-checkbox="default"]',
    );
    const overrideCheckbox = document.querySelector(
      '[data-gallery-checkbox="override"]',
    );
    if (
      !(icon instanceof SVGElement)
      || !(iconCanary instanceof HTMLElement)
      || !(social instanceof HTMLSpanElement)
      || !(socialIcon instanceof SVGElement)
      || !(substack instanceof HTMLSpanElement)
      || !(substackIcon instanceof SVGElement)
      || !(appearance instanceof HTMLSpanElement)
      || !(appearanceIcon instanceof SVGElement)
      || !(button instanceof HTMLElement)
      || !(card instanceof HTMLElement)
      || !(spinner instanceof HTMLElement)
      || !(skeleton instanceof HTMLElement)
      || !(root instanceof HTMLElement)
      || !(heading instanceof HTMLElement)
      || !(footer instanceof HTMLElement)
      || !(main instanceof HTMLElement)
      || !(viewportFrame instanceof HTMLElement)
      || !(wrappingRow instanceof HTMLElement)
      || !(wrappingRowFirstItem instanceof HTMLElement)
      || !(wrappingRowSecondItem instanceof HTMLElement)
      || themedSurfaces.length !== 5
      || !(themedSurfaceTexture instanceof HTMLElement)
      || avatarFallbacks.length !== 3
      || !(avatarImage instanceof HTMLSpanElement)
      || !(avatarOverride instanceof HTMLSpanElement)
      || statusBadges.length !== 5
      || statusTags.length !== 3
      || statusDots.length !== 5
      || !(statusBadgeOverride instanceof HTMLSpanElement)
      || !(statusTagOverride instanceof HTMLSpanElement)
      || !(statusDotOverride instanceof HTMLSpanElement)
      || cards.length !== 4
      || pressableCards.length !== 4
      || !(cardClassVariableOverride instanceof HTMLDivElement)
      || !(cardOverride instanceof HTMLDivElement)
      || !(pressableCardOverride instanceof HTMLButtonElement)
      || !(cardVariableOverride instanceof HTMLSpanElement)
      || !(cardNestedOuter instanceof HTMLDivElement)
      || !(cardNestedOuterDescription instanceof HTMLParagraphElement)
      || !(cardNestedInner instanceof HTMLDivElement)
      || !(cardNestedInnerDescription instanceof HTMLParagraphElement)
      || toolbars.length !== 3
      || !(toolbarOverride instanceof HTMLDivElement)
      || keyHints.length !== 2
      || !(keyHintOverride instanceof HTMLElement)
      || checkboxFields.length !== 2
      || !(defaultCheckbox instanceof HTMLDivElement)
      || !(overrideCheckbox instanceof HTMLDivElement)
    ) {
      throw new Error("The primitive gallery structure is incomplete.");
    }
    icon.setAttribute("data-gallery-stylex-layer-conflict", "true");
    const iconStyle = getComputedStyle(icon);
    const socialStyle = getComputedStyle(social);
    const socialBox = socialIcon.getBoundingClientRect();
    const socialClasses = [...social.classList];
    const substackBox = substackIcon.getBoundingClientRect();
    const appearanceStyle = getComputedStyle(appearance);
    const appearanceBox = appearanceIcon.getBoundingClientRect();
    const appearanceClasses = [...appearance.classList];
    const buttonStyle = getComputedStyle(button);
    const footerBox = footer.getBoundingClientRect();
    const footerClasses = [...footer.classList];
    const footerStyle = getComputedStyle(footer);
    const iconBox = icon.getBoundingClientRect();
    const pageBox = main.getBoundingClientRect();
    const pageClasses = [...main.classList];
    const pageStyle = getComputedStyle(main);
    const viewportFrameBox = viewportFrame.getBoundingClientRect();
    const viewportFrameClasses = [...viewportFrame.classList];
    const viewportFrameStyle = getComputedStyle(viewportFrame);
    const wrappingRowBox = wrappingRow.getBoundingClientRect();
    const wrappingRowClasses = [...wrappingRow.classList];
    const wrappingRowFirstItemBox = wrappingRowFirstItem.getBoundingClientRect();
    const wrappingRowSecondItemBox = wrappingRowSecondItem.getBoundingClientRect();
    const wrappingRowStyle = getComputedStyle(wrappingRow);
    const resolveStyle = (property: string, value: string): string => {
      const probe = document.createElement("div");
      probe.style.setProperty(property, value);
      document.body.append(probe);
      const resolved = getComputedStyle(probe).getPropertyValue(property).trim();
      probe.remove();
      return resolved;
    };
    const equivalentColor = (actual: string, expected: string): boolean => {
      const normalize = (value: string): readonly number[] => (
        resolveStyle(
          "color",
          `color-mix(in srgb, ${value} 100%, transparent)`,
        ).match(/-?\d+(?:\.\d+)?/gu) ?? []
      ).map(Number);
      const actualChannels = normalize(actual);
      const expectedChannels = normalize(expected);
      return actualChannels.length > 0
        && actualChannels.length === expectedChannels.length
        && actualChannels.every(
          (channel, index) =>
            Math.abs(channel - (expectedChannels[index] ?? Number.NaN)) < 0.000_01,
        );
    };
    const resolvedTokens = {
      accentBackground: resolveStyle("background-color", "var(--ui-accent)"),
      accentForeground: resolveStyle("color", "var(--ui-accent-foreground)"),
      accentCardBorder: resolveStyle(
        "border-color",
        "color-mix(in oklch, var(--ui-primary) 28%, var(--ui-border))",
      ),
      border: resolveStyle("border-color", "var(--ui-border)"),
      cardBackground: resolveStyle("background-color", "var(--ui-card)"),
      cardForeground: resolveStyle("color", "var(--ui-card-foreground)"),
      cardDescription: resolveStyle("color", "var(--ui-muted-foreground)"),
      cardHeadingSize: Number.parseFloat(
        resolveStyle("font-size", "var(--text-heading)"),
      ),
      cardLabelSize: Number.parseFloat(
        resolveStyle("font-size", "var(--text-label)"),
      ),
      cardLowShadow: resolveStyle("box-shadow", "var(--elevation-low)"),
      cardBoldWeight: resolveStyle("font-weight", "var(--font-weight-bold)"),
      cardAccentDescription: resolveStyle(
        "color",
        "color-mix(in oklch, var(--ui-accent-foreground) 78%, var(--ui-accent))",
      ),
      cardInverseDescription: resolveStyle(
        "color",
        "color-mix(in oklch, var(--ui-background) 80%, var(--ui-foreground))",
      ),
      inverseBackground: resolveStyle("background-color", "var(--ui-foreground)"),
      inverseForeground: resolveStyle("color", "var(--ui-background)"),
      headingFontFamily: resolveStyle("font-family", "var(--ui-font-heading)"),
      bodySize: Number.parseFloat(resolveStyle("font-size", "var(--text-body)")),
      neutralBackground: resolveStyle("background-color", "var(--ui-background)"),
      neutralForeground: resolveStyle("color", "var(--ui-foreground)"),
      largeRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-lg)")),
      monoFontFamily: resolveStyle("font-family", "var(--ui-font-mono)"),
      popoverBackground: resolveStyle("background-color", "var(--ui-popover)"),
      popoverForeground: resolveStyle("color", "var(--ui-popover-foreground)"),
      primary: resolveStyle("border-color", "var(--ui-primary)"),
      inputBorder: resolveStyle("border-color", "var(--ui-input)"),
      destructiveBorder: resolveStyle("border-color", "var(--ui-destructive)"),
      raisedShadow: resolveStyle("box-shadow", "var(--elevation-raised)"),
      secondaryBackground: resolveStyle("background-color", "var(--ui-secondary)"),
      secondaryForeground: resolveStyle("color", "var(--ui-secondary-foreground)"),
      sharpRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-sharp)")),
      smallRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-sm)")),
      space2: Number.parseFloat(resolveStyle("padding-left", "var(--space-2)")),
      space3: Number.parseFloat(resolveStyle("padding-left", "var(--space-3)")),
      space4: Number.parseFloat(resolveStyle("padding-left", "var(--space-4)")),
      space5: Number.parseFloat(resolveStyle("padding-left", "var(--space-5)")),
      space6: Number.parseFloat(resolveStyle("padding-left", "var(--space-6)")),
      avatarAccentBackground: resolveStyle("background-color", "var(--ui-accent)"),
      avatarBodySize: Number.parseFloat(resolveStyle("font-size", "var(--text-body)")),
      avatarCaptionSize: Number.parseFloat(resolveStyle("font-size", "var(--text-caption)")),
      avatarMediumWeight: resolveStyle("font-weight", "var(--font-weight-medium)"),
      avatarMutedBackground: resolveStyle("background-color", "var(--ui-muted)"),
      avatarMutedForeground: resolveStyle("color", "var(--ui-muted-foreground)"),
      avatarRoundRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-round)")),
      badgeDangerBackground: resolveStyle(
        "background-color",
        "color-mix(in oklch, var(--ui-destructive) 12%, var(--ui-card))",
      ),
      badgeDangerBorder: resolveStyle(
        "border-color",
        "color-mix(in oklch, var(--ui-destructive) 45%, var(--ui-border))",
      ),
      badgeInfoBorder: resolveStyle(
        "border-color",
        "color-mix(in oklch, var(--ui-info) 45%, var(--ui-border))",
      ),
      badgeSuccessBorder: resolveStyle(
        "border-color",
        "color-mix(in oklch, var(--ui-success) 45%, var(--ui-border))",
      ),
      badgeWarningBorder: resolveStyle(
        "border-color",
        "color-mix(in oklch, var(--ui-warning) 45%, var(--ui-border))",
      ),
      captionSize: Number.parseFloat(resolveStyle("font-size", "var(--text-caption)")),
      destructive: resolveStyle("background-color", "var(--ui-destructive)"),
      destructiveForeground: resolveStyle("color", "var(--ui-destructive)"),
      info: resolveStyle("background-color", "var(--ui-info)"),
      infoForeground: resolveStyle("color", "var(--ui-info)"),
      infoSoft: resolveStyle("background-color", "var(--ui-info-soft)"),
      mediumWeight: resolveStyle("font-weight", "var(--font-weight-medium)"),
      mutedBackground: resolveStyle("background-color", "var(--ui-muted)"),
      mutedForeground: resolveStyle("color", "var(--ui-muted-foreground)"),
      outlineAccent: resolveStyle("border-color", "#D97706"),
      roundRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-round)")),
      space1: Number.parseFloat(resolveStyle("padding-left", "var(--space-1)")),
      success: resolveStyle("background-color", "var(--ui-success)"),
      successForeground: resolveStyle("color", "var(--ui-success)"),
      successSoft: resolveStyle("background-color", "var(--ui-success-soft)"),
      transparent: resolveStyle("background-color", "transparent"),
      warning: resolveStyle("background-color", "var(--ui-warning)"),
      warningForeground: resolveStyle("color", "var(--ui-warning)"),
      warningSoft: resolveStyle("background-color", "var(--ui-warning-soft)"),
    };
    const colorEquivalenceEvidence = {
      distinct: resolveStyle("color", "rgb(0 0 0)"),
      oklab: resolveStyle(
        "color",
        "color-mix(in oklab, oklch(0.68 0.19 25) 100%, transparent)",
      ),
      oklch: resolveStyle("color", "oklch(0.68 0.19 25)"),
    };
    const expectedTones = {
      accent: [resolvedTokens.accentBackground, resolvedTokens.accentForeground],
      card: [resolvedTokens.cardBackground, resolvedTokens.cardForeground],
      inverse: [resolvedTokens.inverseBackground, resolvedTokens.inverseForeground],
      popover: [resolvedTokens.popoverBackground, resolvedTokens.popoverForeground],
      secondary: [resolvedTokens.secondaryBackground, resolvedTokens.secondaryForeground],
    } as const;
    const themedSurfaceEvidence = themedSurfaces.map((surface) => {
      const tone = surface.dataset.galleryThemedSurfaceTone;
      if (tone === undefined || !(tone in expectedTones)) {
        throw new Error(`Unexpected themed-surface tone: ${String(tone)}`);
      }
      const expected = expectedTones[tone as keyof typeof expectedTones];
      const style = getComputedStyle(surface);
      const classes = [...surface.classList];
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        boxShadow: style.boxShadow,
        classContract:
          classes[0] === "hraness-themed-surface"
          && classes.at(-1) === `gallery-themed-surface--${tone}`
          && classes.some(
            (name) =>
              name !== "hraness-themed-surface"
              && name !== "gallery-themed-surface"
              && name !== `gallery-themed-surface--${tone}`,
          ),
        color: style.color,
        colorEquivalent: equivalentColor(style.color, expected[1]),
        expectedBackground: expected[0],
        expectedColor: expected[1],
        layerSentinel: style
          .getPropertyValue("--gallery-themed-surface-layer-conflict")
          .trim(),
        minInlineSize: Number.parseFloat(style.minInlineSize),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingTop: Number.parseFloat(style.paddingTop),
        shape: surface.dataset.shape ?? "",
        tone,
      };
    });
    const textureStyle = getComputedStyle(themedSurfaceTexture);
    const textureClasses = [...themedSurfaceTexture.classList];
    const textureEvidence = {
      backgroundColor: textureStyle.backgroundColor,
      backgroundImage: textureStyle.backgroundImage,
      backgroundPosition: textureStyle.backgroundPosition,
      backgroundRepeat: textureStyle.backgroundRepeat,
      backgroundSize: textureStyle.backgroundSize,
      borderColor: textureStyle.borderColor,
      borderRadius: Number.parseFloat(textureStyle.borderRadius),
      borderStyle: textureStyle.borderStyle,
      borderWidth: Number.parseFloat(textureStyle.borderWidth),
      classContract:
        textureClasses[0] === "hraness-themed-surface"
        && textureClasses.at(-1) === "gallery-themed-surface-texture"
        && textureClasses.some(
          (name) =>
            name !== "hraness-themed-surface"
            && name !== "gallery-themed-surface-texture",
        ),
      color: textureStyle.color,
      colorEquivalent: equivalentColor(
        textureStyle.color,
        resolvedTokens.secondaryForeground,
      ),
      layerSentinel: textureStyle
        .getPropertyValue("--gallery-themed-surface-layer-conflict")
        .trim(),
      minInlineSize: Number.parseFloat(textureStyle.minInlineSize),
      paddingBottom: Number.parseFloat(textureStyle.paddingBottom),
      paddingLeft: Number.parseFloat(textureStyle.paddingLeft),
      paddingRight: Number.parseFloat(textureStyle.paddingRight),
      paddingTop: Number.parseFloat(textureStyle.paddingTop),
      shape: themedSurfaceTexture.dataset.shape ?? "",
      tone: themedSurfaceTexture.dataset.tone ?? "",
    };
    const expectedAvatarSizes = {
      default: 40,
      large: 56,
      small: 32,
    } as const;
    const expectedAvatarInitials = {
      default: "GH",
      large: "KJ",
      small: "AL",
    } as const;
    const avatarFallbackEvidence = avatarFallbacks.map((avatar) => {
      const size = avatar.dataset.galleryAvatarSize;
      const fallback = avatar.querySelector(':scope > [data-slot="avatar-fallback"]');
      if (
        size === undefined
        || !(size in expectedAvatarSizes)
        || !(fallback instanceof HTMLSpanElement)
      ) {
        throw new Error(`Unexpected Avatar fallback fixture: ${String(size)}`);
      }
      const finiteSize = size as keyof typeof expectedAvatarSizes;
      const style = getComputedStyle(avatar);
      const fallbackStyle = getComputedStyle(fallback);
      const box = avatar.getBoundingClientRect();
      const fallbackBox = fallback.getBoundingClientRect();
      const classes = [...avatar.classList];
      return {
        accessible:
          avatar.getAttribute("role") === "img"
          && (avatar.getAttribute("aria-label")?.length ?? 0) > 0
          && fallback.getAttribute("aria-hidden") === "true",
        alignItems: style.alignItems,
        backgroundColor: style.backgroundColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        childAlignItems: fallbackStyle.alignItems,
        childDisplay: fallbackStyle.display,
        childHeight: fallbackBox.height,
        childJustifyItems: fallbackStyle.justifyItems,
        childWidth: fallbackBox.width,
        classContract:
          classes[0] === "hraness-avatar"
          && classes.at(-1) === `gallery-avatar--${size}`
          && classes.some(
            (name) =>
              name !== "hraness-avatar"
              && name !== "gallery-avatar"
              && name !== `gallery-avatar--${size}`,
          ),
        color: style.color,
        display: style.display,
        flex: style.flex,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        height: box.height,
        initials: fallback.textContent?.trim() ?? "",
        justifyItems: style.justifyItems,
        layerSentinel: style
          .getPropertyValue("--gallery-avatar-layer-conflict")
          .trim(),
        overflow: style.overflow,
        size: finiteSize,
        slot: avatar.dataset.slot ?? "",
        title: avatar.title,
        width: box.width,
      };
    });
    const avatarImageChild = avatarImage.querySelector(':scope > [data-slot="avatar-image"]');
    const avatarOverrideChild = avatarOverride.querySelector(
      ':scope > [data-slot="avatar-fallback"]',
    );
    if (
      !(avatarImageChild instanceof HTMLImageElement)
      || !(avatarOverrideChild instanceof HTMLSpanElement)
    ) {
      throw new Error("The Avatar image or override child is missing.");
    }
    const avatarImageStyle = getComputedStyle(avatarImage);
    const avatarImageChildStyle = getComputedStyle(avatarImageChild);
    const avatarImageBox = avatarImage.getBoundingClientRect();
    const avatarImageChildBox = avatarImageChild.getBoundingClientRect();
    const avatarImageClasses = [...avatarImage.classList];
    const avatarImageEvidence = {
      alt: avatarImageChild.alt,
      backgroundColor: avatarImageStyle.backgroundColor,
      borderRadius: Number.parseFloat(avatarImageStyle.borderRadius),
      childHeight: avatarImageChildBox.height,
      childWidth: avatarImageChildBox.width,
      classContract:
        avatarImageClasses[0] === "hraness-avatar"
        && avatarImageClasses.at(-1) === "gallery-avatar--image"
        && avatarImageClasses.some(
          (name) =>
            name !== "hraness-avatar"
            && name !== "gallery-avatar"
            && name !== "gallery-avatar--image",
        ),
      complete: avatarImageChild.complete,
      height: avatarImageBox.height,
      layerSentinel: avatarImageStyle
        .getPropertyValue("--gallery-avatar-layer-conflict")
        .trim(),
      naturalHeight: avatarImageChild.naturalHeight,
      naturalWidth: avatarImageChild.naturalWidth,
      objectFit: avatarImageChildStyle.objectFit,
      overflow: avatarImageStyle.overflow,
      role: avatarImage.getAttribute("role") ?? "",
      source: avatarImageChild.currentSrc || avatarImageChild.src,
      width: avatarImageBox.width,
    };
    const avatarOverrideStyle = getComputedStyle(avatarOverride);
    const avatarOverrideChildStyle = getComputedStyle(avatarOverrideChild);
    const avatarOverrideBox = avatarOverride.getBoundingClientRect();
    const avatarOverrideChildBox = avatarOverrideChild.getBoundingClientRect();
    const avatarOverrideClasses = [...avatarOverride.classList];
    const avatarOverrideEvidence = {
      backgroundColor: avatarOverrideStyle.backgroundColor,
      borderRadius: Number.parseFloat(avatarOverrideStyle.borderRadius),
      childAlignItems: avatarOverrideChildStyle.alignItems,
      childDisplay: avatarOverrideChildStyle.display,
      childHeight: avatarOverrideChildBox.height,
      childJustifyItems: avatarOverrideChildStyle.justifyItems,
      childWidth: avatarOverrideChildBox.width,
      classContract:
        avatarOverrideClasses[0] === "hraness-avatar"
        && avatarOverrideClasses.at(-1) === "gallery-avatar--override"
        && avatarOverrideClasses.some(
          (name) =>
            name !== "hraness-avatar"
            && name !== "gallery-avatar"
            && name !== "gallery-avatar--override",
        ),
      height: avatarOverrideBox.height,
      inlineHeight: avatarOverride.style.height,
      inlineWidth: avatarOverride.style.width,
      layerSentinel: avatarOverrideStyle
        .getPropertyValue("--gallery-avatar-layer-conflict")
        .trim(),
      overflow: avatarOverrideStyle.overflow,
      width: avatarOverrideBox.width,
    };
    const expectedBadgeTones = {
      danger: [
        resolvedTokens.badgeDangerBackground,
        resolvedTokens.badgeDangerBorder,
        resolvedTokens.destructiveForeground,
      ],
      info: [
        resolvedTokens.infoSoft,
        resolvedTokens.badgeInfoBorder,
        resolvedTokens.infoForeground,
      ],
      neutral: [
        resolvedTokens.secondaryBackground,
        resolvedTokens.border,
        resolvedTokens.secondaryForeground,
      ],
      success: [
        resolvedTokens.successSoft,
        resolvedTokens.badgeSuccessBorder,
        resolvedTokens.successForeground,
      ],
      warning: [
        resolvedTokens.warningSoft,
        resolvedTokens.badgeWarningBorder,
        resolvedTokens.warningForeground,
      ],
    } as const;
    const badgeEvidence = statusBadges.map((badge) => {
      const tone = badge.dataset.galleryBadgeTone;
      if (tone === undefined || !(tone in expectedBadgeTones)) {
        throw new Error(`Unexpected Badge tone fixture: ${String(tone)}`);
      }
      const finiteTone = tone as keyof typeof expectedBadgeTones;
      const style = getComputedStyle(badge);
      const classes = [...badge.classList];
      const expected = expectedBadgeTones[finiteTone];
      return {
        alignItems: style.alignItems,
        ariaLive: badge.getAttribute("aria-live") ?? "",
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        classContract:
          classes[0] === "hraness-badge"
          && classes[1] === `hraness-badge--${tone}`
          && classes.at(-1) === `gallery-badge--${tone}`
          && classes.some(
            (name) =>
              name !== "hraness-badge"
              && name !== `hraness-badge--${tone}`
              && name !== "gallery-badge"
              && name !== `gallery-badge--${tone}`,
          ),
        color: style.color,
        display: style.display,
        expectedBackground: expected[0],
        expectedBorder: expected[1],
        expectedColor: expected[2],
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        forcedColorAdjust: style.forcedColorAdjust,
        gap: Number.parseFloat(style.gap),
        justifyContent: style.justifyContent,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        lineHeight: Number.parseFloat(style.lineHeight),
        minHeight: Number.parseFloat(style.minHeight),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        role: badge.getAttribute("role") ?? "",
        slot: badge.dataset.slot ?? "",
        tone: finiteTone,
        whiteSpace: style.whiteSpace,
      };
    });
    const expectedTagVariants = {
      default: [
        resolvedTokens.secondaryBackground,
        resolvedTokens.transparent,
        resolvedTokens.secondaryForeground,
      ],
      muted: [
        resolvedTokens.mutedBackground,
        resolvedTokens.transparent,
        resolvedTokens.mutedForeground,
      ],
      outline: [
        resolvedTokens.transparent,
        resolvedTokens.outlineAccent,
        resolvedTokens.inverseBackground,
      ],
    } as const;
    const tagEvidence = statusTags.map((tag) => {
      const variant = tag.dataset.galleryTagVariant;
      const label = tag.querySelector(':scope > [data-slot="tag-label"]');
      const iconElement = tag.querySelector(':scope > [data-slot="tag-icon"]');
      if (
        variant === undefined
        || !(variant in expectedTagVariants)
        || !(label instanceof HTMLSpanElement)
        || (variant === "default" && !(iconElement instanceof HTMLSpanElement))
      ) {
        throw new Error(`Unexpected Tag variant fixture: ${String(variant)}`);
      }
      const finiteVariant = variant as keyof typeof expectedTagVariants;
      const style = getComputedStyle(tag);
      const labelStyle = getComputedStyle(label);
      const classes = [...tag.classList];
      const expected = expectedTagVariants[finiteVariant];
      const iconStyle = iconElement instanceof HTMLSpanElement
        ? getComputedStyle(iconElement)
        : null;
      return {
        alignItems: style.alignItems,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        classContract:
          classes[0] === "hraness-tag"
          && classes.at(-1) === `gallery-tag--${variant}`
          && classes.some(
            (name) =>
              name !== "hraness-tag"
              && name !== "gallery-tag"
              && name !== `gallery-tag--${variant}`,
          ),
        color: style.color,
        display: style.display,
        expectedBackground: expected[0],
        expectedBorder: expected[1],
        expectedColor: expected[2],
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: style.fontWeight,
        forcedColorAdjust: style.forcedColorAdjust,
        gap: Number.parseFloat(style.gap),
        iconContract: iconStyle === null
          ? finiteVariant !== "default"
          : iconElement instanceof HTMLSpanElement
            && iconElement.getAttribute("aria-hidden") === "true"
            && iconElement.dataset.slot === "tag-icon"
            && iconElement.classList.contains("hraness-tag__icon")
            && iconStyle.alignItems === "center"
            && iconStyle.display === "flex"
            && iconStyle.flex === "0 0 auto"
            && iconStyle.justifyContent === "center"
            && Number.parseFloat(iconStyle.lineHeight) === resolvedTokens.captionSize,
        iconDiagnostics: iconStyle === null
          ? null
          : {
              alignItems: iconStyle.alignItems,
              ariaHidden: iconElement?.getAttribute("aria-hidden") ?? "",
              classes: iconElement === null ? [] : [...iconElement.classList],
              display: iconStyle.display,
              flex: iconStyle.flex,
              justifyContent: iconStyle.justifyContent,
              lineHeight: iconStyle.lineHeight,
              slot: iconElement instanceof HTMLElement
                ? iconElement.dataset.slot ?? ""
                : "",
            },
        justifyContent: style.justifyContent,
        labelContract:
          label.dataset.slot === "tag-label"
          && label.classList.contains("hraness-tag__label")
          && Number.parseFloat(labelStyle.minWidth) === 0,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        lineHeight: Number.parseFloat(style.lineHeight),
        minHeight: Number.parseFloat(style.minHeight),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        publicAccent: style.getPropertyValue("--hraness-tag-accent").trim(),
        role: tag.getAttribute("role") ?? "",
        slot: tag.dataset.slot ?? "",
        variant: finiteVariant,
        whiteSpace: style.whiteSpace,
      };
    });
    const expectedDotTones = {
      danger: resolvedTokens.destructive,
      info: resolvedTokens.info,
      neutral: resolvedTokens.mutedForeground,
      success: resolvedTokens.success,
      warning: resolvedTokens.warning,
    } as const;
    const dotEvidence = statusDots.map((dot) => {
      const tone = dot.dataset.galleryStatusDotTone;
      if (tone === undefined || !(tone in expectedDotTones)) {
        throw new Error(`Unexpected StatusDot tone fixture: ${String(tone)}`);
      }
      const finiteTone = tone as keyof typeof expectedDotTones;
      const style = getComputedStyle(dot);
      const box = dot.getBoundingClientRect();
      const classes = [...dot.classList];
      return {
        ariaHidden: dot.getAttribute("aria-hidden") ?? "",
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderColorEquivalent: equivalentColor(
          style.borderColor,
          resolveStyle(
            "border-color",
            `color-mix(in oklch, ${style.color} 35%, transparent)`,
          ),
        ),
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        classContract:
          classes[0] === "hraness-status-dot"
          && classes.at(-1) === `gallery-dot--${tone}`
          && classes.some(
            (name) =>
              name !== "hraness-status-dot"
              && name !== "gallery-dot"
              && name !== `gallery-dot--${tone}`,
          ),
        display: style.display,
        expectedBackground: expectedDotTones[finiteTone],
        flex: style.flex,
        height: box.height,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        slot: dot.dataset.slot ?? "",
        tone: finiteTone,
        width: box.width,
      };
    });
    const statusOverrides = [
      statusBadgeOverride,
      statusTagOverride,
      statusDotOverride,
    ].map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const kind = element.dataset.galleryStatusFamilyOverride ?? "";
      const classes = [...element.classList];
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        classContract:
          classes.at(-1) === `gallery-${kind === "dot" ? "dot" : kind}--override`
          && classes.some((name) => name.startsWith("x")),
        color: style.color,
        height: box.height,
        inlineHeight: element.style.height,
        inlineMinHeight: element.style.minHeight,
        inlineWidth: element.style.width,
        kind,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        minHeight: Number.parseFloat(style.minHeight),
        width: box.width,
      };
    });
    const expectedCardTones = {
      accent: [
        resolvedTokens.accentBackground,
        resolvedTokens.accentForeground,
        resolvedTokens.accentCardBorder,
        resolvedTokens.cardAccentDescription,
      ],
      card: [
        resolvedTokens.cardBackground,
        resolvedTokens.cardForeground,
        resolvedTokens.border,
        resolvedTokens.cardDescription,
      ],
      inverse: [
        resolvedTokens.inverseBackground,
        resolvedTokens.inverseForeground,
        resolvedTokens.inverseBackground,
        resolvedTokens.cardInverseDescription,
      ],
      neutral: [
        resolvedTokens.neutralBackground,
        resolvedTokens.neutralForeground,
        resolvedTokens.border,
        resolvedTokens.cardDescription,
      ],
    } as const;
    const cardEvidence = cards.map((cardElement) => {
      const tone = cardElement.dataset.galleryCardTone;
      const header = cardElement.querySelector(':scope > [data-slot="card-header"]');
      const title = cardElement.querySelector('[data-slot="card-title"]');
      const description = cardElement.querySelector('[data-slot="card-description"]');
      const content = cardElement.querySelector(':scope > [data-slot="card-content"]');
      const footerElement = cardElement.querySelector(':scope > [data-slot="card-footer"]');
      if (
        tone === undefined
        || !(tone in expectedCardTones)
        || !(header instanceof HTMLDivElement)
        || !(title instanceof HTMLHeadingElement)
        || !(description instanceof HTMLParagraphElement)
      ) {
        throw new Error(`Unexpected Card tone fixture: ${String(tone)}`);
      }
      const finiteTone = tone as keyof typeof expectedCardTones;
      const expected = expectedCardTones[finiteTone];
      const style = getComputedStyle(cardElement);
      const headerStyle = getComputedStyle(header);
      const titleStyle = getComputedStyle(title);
      const descriptionStyle = getComputedStyle(description);
      const contentStyle = content instanceof HTMLElement
        ? getComputedStyle(content)
        : null;
      const footerStyle = footerElement instanceof HTMLElement
        ? getComputedStyle(footerElement)
        : null;
      const classes = [...cardElement.classList];
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        boxShadow: style.boxShadow,
        classContract:
          classes[0] === "hraness-card"
          && classes.at(-1) === `gallery-card--${tone}`
          && classes.some(
            (name) =>
              name !== "hraness-card"
              && name !== "gallery-card"
              && name !== `gallery-card--${tone}`,
          ),
        color: style.color,
        contentPaddingLeft: contentStyle === null
          ? null
          : Number.parseFloat(contentStyle.paddingLeft),
        contentPaddingRight: contentStyle === null
          ? null
          : Number.parseFloat(contentStyle.paddingRight),
        descriptionColor: descriptionStyle.color,
        descriptionEquivalent: equivalentColor(descriptionStyle.color, expected[3]),
        descriptionFontSize: Number.parseFloat(descriptionStyle.fontSize),
        descriptionLineHeight: Number.parseFloat(descriptionStyle.lineHeight),
        display: style.display,
        expectedBackground: expected[0],
        expectedBorder: expected[2],
        expectedColor: expected[1],
        flexDirection: style.flexDirection,
        footerContract: footerStyle === null
          ? finiteTone !== "card"
          : footerElement instanceof HTMLElement
            && footerElement.dataset.slot === "card-footer"
            && footerStyle.alignItems === "center"
            && footerStyle.display === "flex"
            && footerStyle.flexWrap === "wrap"
            && Number.parseFloat(footerStyle.gap) === resolvedTokens.space2
            && Number.parseFloat(footerStyle.paddingLeft) === resolvedTokens.space6
            && Number.parseFloat(footerStyle.paddingRight) === resolvedTokens.space6,
        gap: Number.parseFloat(style.gap),
        headerContract:
          header.dataset.slot === "card-header"
          && headerStyle.display === "grid"
          && Number.parseFloat(headerStyle.gap) === resolvedTokens.space2
          && Number.parseFloat(headerStyle.paddingLeft) === resolvedTokens.space6
          && Number.parseFloat(headerStyle.paddingRight) === resolvedTokens.space6,
        layerSentinel: style
          .getPropertyValue("--gallery-card-family-layer-conflict")
          .trim(),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingTop: Number.parseFloat(style.paddingTop),
        publicDescription: style
          .getPropertyValue("--hraness-card-description")
          .trim(),
        shape: cardElement.dataset.shape ?? "",
        slot: cardElement.dataset.slot ?? "",
        subpartContract:
          title.dataset.slot === "card-title"
          && equivalentColor(titleStyle.color, style.color)
          && Number.parseFloat(titleStyle.fontSize) === resolvedTokens.cardHeadingSize
          && titleStyle.fontWeight === resolvedTokens.cardBoldWeight
          && Math.abs(
            Number.parseFloat(titleStyle.lineHeight)
              / Number.parseFloat(titleStyle.fontSize) - 1.2,
          ) < 0.000_01
          && description.dataset.slot === "card-description"
          && Number.parseFloat(descriptionStyle.fontSize) === resolvedTokens.cardLabelSize
          && Math.abs(
            Number.parseFloat(descriptionStyle.lineHeight)
              / Number.parseFloat(descriptionStyle.fontSize) - 1.5,
          ) < 0.000_01
          && (contentStyle === null
            ? finiteTone !== "card"
            : content instanceof HTMLElement
              && content.dataset.slot === "card-content"
              && Number.parseFloat(contentStyle.paddingLeft) === resolvedTokens.space6
              && Number.parseFloat(contentStyle.paddingRight) === resolvedTokens.space6),
        titleColor: titleStyle.color,
        titleFontSize: Number.parseFloat(titleStyle.fontSize),
        titleFontWeight: titleStyle.fontWeight,
        titleLineHeight: Number.parseFloat(titleStyle.lineHeight),
        tone: finiteTone,
      };
    });
    const pressableEvidence = pressableCards.map((pressable) => {
      const tone = pressable.dataset.galleryPressableCardTone;
      if (tone === undefined || !(tone in expectedCardTones)) {
        throw new Error(`Unexpected PressableCard tone fixture: ${String(tone)}`);
      }
      const finiteTone = tone as keyof typeof expectedCardTones;
      const expected = expectedCardTones[finiteTone];
      const style = getComputedStyle(pressable);
      const classes = [...pressable.classList];
      const state = pressable.dataset.galleryPressableCardState ?? "neutral";
      return {
        ariaDisabled: pressable.getAttribute("aria-disabled") ?? "",
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        boxShadow: style.boxShadow,
        classContract:
          classes[0] === "hraness-pressable-card"
          && classes.at(-1)?.startsWith("gallery-pressable-card--") === true
          && classes.some(
            (name) =>
              name !== "hraness-pressable-card"
              && name !== "gallery-pressable-card"
              && !name.startsWith("gallery-pressable-card--"),
          ),
        color: style.color,
        dataDisabled: pressable.dataset.disabled ?? "",
        dataPending: pressable.dataset.pending ?? "",
        disabled: pressable.disabled,
        display: style.display,
        expectedBackground: expected[0],
        expectedBorder: expected[2],
        expectedColor: expected[1],
        gap: Number.parseFloat(style.gap),
        layerSentinel: style
          .getPropertyValue("--gallery-card-family-layer-conflict")
          .trim(),
        minWidth: Number.parseFloat(style.minWidth),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingTop: Number.parseFloat(style.paddingTop),
        publicDescription: style
          .getPropertyValue("--hraness-card-description")
          .trim(),
        shape: pressable.dataset.shape ?? "",
        slot: pressable.dataset.slot ?? "",
        state,
        textAlign: style.textAlign,
        tone: finiteTone,
        transitionProperty: style.transitionProperty,
        type: pressable.type,
      };
    });
    const cardOverrideStyle = getComputedStyle(cardOverride);
    const cardClassVariableOverrideStyle = getComputedStyle(
      cardClassVariableOverride,
    );
    const pressableOverrideStyle = getComputedStyle(pressableCardOverride);
    const cardOverrideClasses = [...cardOverride.classList];
    const pressableOverrideClasses = [...pressableCardOverride.classList];
    const cardOverrideEvidence = {
      backgroundColor: cardOverrideStyle.backgroundColor,
      borderColor: cardOverrideStyle.borderColor,
      borderRadius: Number.parseFloat(cardOverrideStyle.borderRadius),
      classContract:
        cardOverrideClasses[0] === "hraness-card"
        && cardOverrideClasses.at(-1) === "gallery-card--override"
        && cardOverrideClasses.some((name) => name.startsWith("x")),
      descriptionColor: getComputedStyle(
        cardOverride.querySelector('[data-slot="card-description"]')!,
      ).color,
      dynamicInlineValue: /--[^:]+:\s*14rem/u.test(cardOverride.style.cssText),
      gap: Number.parseFloat(cardOverrideStyle.gap),
      inheritedVariableColor: getComputedStyle(cardVariableOverride).color,
      inlinePublicDescription: cardOverride.style
        .getPropertyValue("--hraness-card-description")
        .trim(),
      inlineWidth: cardOverride.style.width,
      layerSentinel: cardOverrideStyle
        .getPropertyValue("--gallery-card-family-layer-conflict")
        .trim(),
      paddingLeft: Number.parseFloat(cardOverrideStyle.paddingLeft),
      paddingRight: Number.parseFloat(cardOverrideStyle.paddingRight),
      width: cardOverride.getBoundingClientRect().width,
    };
    const cardClassVariableOverrideEvidence = {
      descriptionColor: getComputedStyle(
        cardClassVariableOverride.querySelector(
          '[data-slot="card-description"]',
        )!,
      ).color,
      publicDescription: cardClassVariableOverrideStyle
        .getPropertyValue("--hraness-card-description")
        .trim(),
    };
    const pressableOverrideEvidence = {
      backgroundColor: pressableOverrideStyle.backgroundColor,
      borderColor: pressableOverrideStyle.borderColor,
      borderRadius: Number.parseFloat(pressableOverrideStyle.borderRadius),
      classContract:
        pressableOverrideClasses[0] === "hraness-pressable-card"
        && pressableOverrideClasses.at(-1) === "gallery-pressable-card--override"
        && pressableOverrideClasses.some((name) => name.startsWith("x")),
      dynamicInlineValue:
        /--[^:]+:\s*14rem/u.test(pressableCardOverride.style.cssText),
      gap: Number.parseFloat(pressableOverrideStyle.gap),
      inlineWidth: pressableCardOverride.style.width,
      layerSentinel: pressableOverrideStyle
        .getPropertyValue("--gallery-card-family-layer-conflict")
        .trim(),
      paddingLeft: Number.parseFloat(pressableOverrideStyle.paddingLeft),
      paddingRight: Number.parseFloat(pressableOverrideStyle.paddingRight),
      width: pressableCardOverride.getBoundingClientRect().width,
    };
    const cardNestedOuterStyle = getComputedStyle(cardNestedOuter);
    const cardNestedInnerStyle = getComputedStyle(cardNestedInner);
    const cardNestedEvidence = {
      innerDescriptionColor: getComputedStyle(cardNestedInnerDescription).color,
      innerPublicDescription: cardNestedInnerStyle
        .getPropertyValue("--hraness-card-description")
        .trim(),
      innerTone: cardNestedInner.dataset.tone ?? "",
      outerDescriptionColor: getComputedStyle(cardNestedOuterDescription).color,
      outerPublicDescription: cardNestedOuterStyle
        .getPropertyValue("--hraness-card-description")
        .trim(),
    };
    const checkboxEvidence = checkboxFields.map((field) => {
      const kind = field.dataset.galleryCheckbox;
      const control = field.querySelector(':scope > [data-slot="checkbox-control"]');
      const input = control?.querySelector('input[type="checkbox"]');
      const indicator = control?.querySelector(
        ':scope > [data-slot="checkbox-indicator"]',
      );
      const label = control?.querySelector(':scope > [data-slot="checkbox-label"]');
      const description = field.querySelector(
        ':scope > [data-slot="field-description"]',
      );
      if (
        (kind !== "default" && kind !== "override")
        || !(control instanceof HTMLLabelElement)
        || !(input instanceof HTMLInputElement)
        || !(indicator instanceof HTMLSpanElement)
        || !(label instanceof HTMLSpanElement)
        || !(description instanceof HTMLElement)
      ) {
        throw new Error(`Unexpected CheckboxField fixture: ${String(kind)}`);
      }
      const isOverride = kind === "override";
      const fieldStyle = getComputedStyle(field);
      const controlStyle = getComputedStyle(control);
      const indicatorStyle = getComputedStyle(indicator);
      const labelStyle = getComputedStyle(label);
      const fieldClasses = [...field.classList];
      const controlClasses = [...control.classList];
      const indicatorClasses = [...indicator.classList];
      const labelClasses = [...label.classList];
      const indicatorBox = indicator.getBoundingClientRect();
      return {
        ariaDescribedBy: input.getAttribute("aria-describedby") ?? "",
        backgroundColor: indicatorStyle.backgroundColor,
        borderColor: indicatorStyle.borderColor,
        borderRadius: Number.parseFloat(indicatorStyle.borderRadius),
        borderStyle: indicatorStyle.borderStyle,
        borderWidth: Number.parseFloat(indicatorStyle.borderWidth),
        checked: input.checked,
        classContract:
          fieldClasses[0] === "hraness-checkbox-field"
          && fieldClasses.at(-1) === `gallery-checkbox--${kind}`
          && fieldClasses.some((name) => name.startsWith("x"))
          && controlClasses[0] === "hraness-checkbox-field__control"
          && controlClasses.at(-1) === `gallery-checkbox-control--${kind}`
          && controlClasses.some((name) => name.startsWith("x"))
          && indicatorClasses[0] === "hraness-checkbox-field__indicator"
          && indicatorClasses.some((name) => name.startsWith("x"))
          && labelClasses[0] === "hraness-checkbox-field__label"
          && labelClasses.some((name) => name.startsWith("x")),
        color: fieldStyle.color,
        controlBackground: controlStyle.backgroundColor,
        controlBorderWidth: Number.parseFloat(controlStyle.borderWidth),
        controlDisplay: controlStyle.display,
        controlGap: Number.parseFloat(controlStyle.gap),
        controlGridColumns: controlStyle.gridTemplateColumns,
        controlMinHeight: Number.parseFloat(controlStyle.minHeight),
        controlStyleValue: control.style.cssText,
        dataDisabled: field.dataset.disabled ?? "",
        dataInvalid: field.dataset.invalid ?? "",
        dataSelected: field.dataset.selected ?? "",
        descriptionConnected:
          description.id.length > 0
          && (input.getAttribute("aria-describedby") ?? "")
            .split(" ")
            .includes(description.id),
        disabled: input.disabled,
        fieldDisplay: fieldStyle.display,
        fieldGap: Number.parseFloat(fieldStyle.gap),
        fieldMinWidth: Number.parseFloat(fieldStyle.minWidth),
        fieldRefAttached: field.dataset.galleryCheckboxFieldRef === "true",
        fieldStyleValue: field.style.cssText,
        fieldWidth: field.getBoundingClientRect().width,
        forcedColorAdjust: indicatorStyle.forcedColorAdjust,
        indicatorDisplay: indicatorStyle.display,
        indicatorFlex: indicatorStyle.flex,
        indicatorHeight: indicatorBox.height,
        indicatorWidth: indicatorBox.width,
        inputName: input.name,
        inputType: input.type,
        isOverride,
        kind,
        labelFontSize: Number.parseFloat(labelStyle.fontSize),
        labelFontWeight: labelStyle.fontWeight,
        labelHidden: labelClasses.includes("hraness-visually-hidden"),
        labelText: label.textContent?.trim() ?? "",
        layerSentinel: fieldStyle
          .getPropertyValue("--gallery-checkbox-field-layer-conflict")
          .trim(),
        slot: field.dataset.slot ?? "",
        transitionProperty: indicatorStyle.transitionProperty,
      };
    });
    const defaultCheckboxEvidence = checkboxEvidence.find(
      (checkbox) => !checkbox.isOverride,
    );
    const overrideCheckboxEvidence = checkboxEvidence.find(
      (checkbox) => checkbox.isOverride,
    );
    const toolbarEvidence = toolbars.map((toolbar) => {
      const isOverride = toolbar.dataset.galleryToolbarOverride === "true";
      const orientation = toolbar.dataset.orientation;
      if (orientation !== "horizontal" && orientation !== "vertical") {
        throw new Error(`Unexpected Toolbar orientation: ${String(orientation)}`);
      }
      const kind = isOverride ? "override" : orientation;
      const style = getComputedStyle(toolbar);
      const classes = [...toolbar.classList];
      return {
        alignItems: style.alignItems,
        ariaLabel: toolbar.getAttribute("aria-label") ?? "",
        ariaLabelledBy: toolbar.getAttribute("aria-labelledby") ?? "",
        ariaOrientation: toolbar.getAttribute("aria-orientation") ?? "",
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: Number.parseFloat(style.borderRadius),
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        classContract:
          classes[0] === "hraness-toolbar"
          && classes.at(-1) === `gallery-toolbar--${kind}`
          && classes.some(
            (name) =>
              name !== "hraness-toolbar"
              && name !== "gallery-toolbar"
              && name !== `gallery-toolbar--${kind}`,
          ),
        display: style.display,
        dynamicInlineValue: /--[^:]+:\s*14rem/u.test(toolbar.style.cssText),
        flexDirection: style.flexDirection,
        flexWrap: style.flexWrap,
        gap: Number.parseFloat(style.gap),
        inlineWidth: toolbar.style.width,
        isOverride,
        layerSentinel: style
          .getPropertyValue("--gallery-toolbar-layer-conflict")
          .trim(),
        minWidth: Number.parseFloat(style.minWidth),
        orientation,
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingTop: Number.parseFloat(style.paddingTop),
        refConnected: toolbar.dataset.galleryToolbarRef === "true",
        role: toolbar.getAttribute("role") ?? "",
        slot: toolbar.dataset.slot ?? "",
        width: toolbar.getBoundingClientRect().width,
      };
    });
    const keyHintEvidence = keyHints.map((keyHint) => {
      const kind = keyHint.dataset.galleryKeyHint;
      if (kind !== "default" && kind !== "override") {
        throw new Error(`Unexpected KeyHint kind: ${String(kind)}`);
      }
      const isOverride = kind === "override";
      const style = getComputedStyle(keyHint);
      const classes = [...keyHint.classList];
      const expectedColor = isOverride
        ? resolvedTokens.secondaryForeground
        : resolvedTokens.mutedForeground;
      return {
        alignItems: style.alignItems,
        ariaLabel: keyHint.getAttribute("aria-label") ?? "",
        backgroundColor: style.backgroundColor,
        borderBlockEndWidth: Number.parseFloat(style.borderBlockEndWidth),
        borderBottomStyle: style.borderBottomStyle,
        borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
        borderColor: style.borderTopColor,
        borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
        borderRadius: Number.parseFloat(style.borderRadius),
        borderRightWidth: Number.parseFloat(style.borderRightWidth),
        borderTopWidth: Number.parseFloat(style.borderTopWidth),
        classContract:
          classes[0] === "hraness-key-hint"
          && classes.at(-1) === `gallery-key-hint--${kind}`
          && classes.some(
            (name) =>
              name !== "hraness-key-hint"
              && name !== "gallery-key-hint"
              && name !== `gallery-key-hint--${kind}`,
          ),
        colorEquivalent: equivalentColor(style.color, expectedColor),
        display: style.display,
        dynamicInlineValue: /--[^:]+:\s*2\.5rem/u.test(keyHint.style.cssText),
        fontFamily: style.fontFamily,
        fontSize: Number.parseFloat(style.fontSize),
        inlineWidth: keyHint.style.width,
        isOverride,
        justifyContent: style.justifyContent,
        kind,
        layerSentinel: style
          .getPropertyValue("--gallery-key-hint-layer-conflict")
          .trim(),
        minHeight: Number.parseFloat(style.minHeight),
        minWidth: Number.parseFloat(style.minWidth),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        slot: keyHint.dataset.slot ?? "",
        tagName: keyHint.tagName,
        text: keyHint.textContent?.trim() ?? "",
        title: keyHint.title,
        width: keyHint.getBoundingClientRect().width,
      };
    });
    const defaultKeyHintEvidence = keyHintEvidence.find(
      (keyHint) => !keyHint.isOverride,
    );
    const overrideKeyHintEvidence = keyHintEvidence.find(
      (keyHint) => keyHint.isOverride,
    );

    return {
      appearanceAlignItems: appearanceStyle.alignItems,
      appearanceAriaHidden: appearance.getAttribute("aria-hidden") ?? "",
      appearanceCallerClassLast:
        appearanceClasses.at(-1) === "gallery-appearance-icon",
      appearanceChildSlot: appearanceIcon.getAttribute("data-slot") ?? "",
      appearanceClassIsSemantic:
        appearanceClasses[0] === "hraness-appearance-icon",
      appearanceDisplay: appearanceStyle.display,
      appearanceFlex: appearanceStyle.flex,
      appearanceHasGeneratedClass: appearanceClasses.some(
        (name) =>
          name !== "hraness-appearance-icon"
          && name !== "gallery-appearance-icon",
      ),
      appearanceIconHeight: appearanceBox.height,
      appearanceIconWidth: appearanceBox.width,
      appearanceJustifyContent: appearanceStyle.justifyContent,
      avatarClassContracts:
        avatarFallbackEvidence.every((avatar) => avatar.classContract)
        && avatarImageEvidence.classContract
        && avatarOverrideEvidence.classContract,
      avatarDefaultBackground:
        avatarFallbackEvidence.find((avatar) => avatar.size === "default")
          ?.backgroundColor ?? "",
      avatarDiagnostics: JSON.stringify({
        fallbacks: avatarFallbackEvidence,
        image: avatarImageEvidence,
        override: avatarOverrideEvidence,
        tokens: resolvedTokens,
      }),
      avatarFallbackContracts: avatarFallbackEvidence.every((avatar) => {
        const expectedSize = expectedAvatarSizes[avatar.size];
        return avatar.accessible
          && avatar.alignItems === "center"
          && avatar.childAlignItems === "center"
          && avatar.childDisplay === "grid"
          && avatar.childHeight === expectedSize
          && avatar.childJustifyItems === "center"
          && avatar.childWidth === expectedSize
          && avatar.display === "inline-grid"
          && avatar.flex === "0 0 auto"
          && avatar.height === expectedSize
          && avatar.initials === expectedAvatarInitials[avatar.size]
          && avatar.justifyItems === "center"
          && avatar.overflow === "hidden"
          && avatar.slot === "avatar"
          && avatar.title.length > 0
          && avatar.width === expectedSize;
      }),
      avatarImageContract:
        avatarImageEvidence.alt === "Geometric profile"
        && avatarImageEvidence.childHeight === 40
        && avatarImageEvidence.childWidth === 40
        && avatarImageEvidence.complete
        && avatarImageEvidence.height === 40
        && avatarImageEvidence.naturalHeight === 16
        && avatarImageEvidence.naturalWidth === 16
        && avatarImageEvidence.objectFit === "cover"
        && avatarImageEvidence.overflow === "hidden"
        && avatarImageEvidence.role === ""
        && avatarImageEvidence.source.startsWith("data:image/svg+xml")
        && avatarImageEvidence.width === 40,
      avatarLayerSentinels:
        avatarFallbackEvidence.every((avatar) => avatar.layerSentinel === "legacy")
        && avatarImageEvidence.layerSentinel === "legacy"
        && avatarOverrideEvidence.layerSentinel === "legacy",
      avatarOverrideContract:
        avatarOverrideEvidence.backgroundColor === resolvedTokens.avatarAccentBackground
        && avatarOverrideEvidence.borderRadius === resolvedTokens.smallRadius
        && avatarOverrideEvidence.childAlignItems === "center"
        && avatarOverrideEvidence.childDisplay === "grid"
        && avatarOverrideEvidence.childHeight === 64
        && avatarOverrideEvidence.childJustifyItems === "center"
        && avatarOverrideEvidence.childWidth === 64
        && avatarOverrideEvidence.height === 64
        && avatarOverrideEvidence.inlineHeight === "4rem"
        && avatarOverrideEvidence.inlineWidth === "4rem"
        && avatarOverrideEvidence.overflow === "hidden"
        && avatarOverrideEvidence.width === 64,
      avatarTokenContracts: avatarFallbackEvidence.every((avatar) =>
        avatar.backgroundColor === resolvedTokens.avatarMutedBackground
        && avatar.borderRadius === resolvedTokens.avatarRoundRadius
        && equivalentColor(avatar.color, resolvedTokens.avatarMutedForeground)
        && avatar.fontWeight === resolvedTokens.avatarMediumWeight
        && (avatar.size !== "small"
          || avatar.fontSize === resolvedTokens.avatarCaptionSize)
        && (avatar.size !== "large"
          || avatar.fontSize === resolvedTokens.avatarBodySize))
        && avatarImageEvidence.backgroundColor === resolvedTokens.avatarMutedBackground
        && avatarImageEvidence.borderRadius === resolvedTokens.avatarRoundRadius,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      buttonBackground: buttonStyle.backgroundColor,
      buttonMinHeight: Number.parseFloat(buttonStyle.minHeight),
      cardBorderStyle: getComputedStyle(card).borderStyle,
      cardFamilyBoundaryContracts:
        cardEvidence.every(
          (item) =>
            item.borderStyle === "solid"
            && item.borderWidth === 1
            && item.boxShadow === resolvedTokens.cardLowShadow
            && item.display === "flex"
            && item.flexDirection === "column"
            && item.footerContract
            && item.gap === resolvedTokens.space6
            && item.headerContract
            && item.paddingBottom === resolvedTokens.space6
            && item.paddingTop === resolvedTokens.space6
            && item.slot === "card"
            && item.subpartContract,
        )
        && pressableEvidence.every(
          (item) =>
            item.borderStyle === "solid"
            && item.borderWidth === 1
            && item.boxShadow === resolvedTokens.cardLowShadow
            && item.display === "grid"
            && item.gap === resolvedTokens.space4
            && item.minWidth === 0
            && item.paddingBottom === resolvedTokens.space6
            && item.paddingLeft === resolvedTokens.space6
            && item.paddingRight === resolvedTokens.space6
            && item.paddingTop === resolvedTokens.space6
            && item.slot === "pressable-card"
            && item.textAlign === "start"
            && item.transitionProperty === "border-color, box-shadow, transform"
            && item.type === "button",
        ),
      cardFamilyClassContracts:
        cardEvidence.every((item) => item.classContract)
        && pressableEvidence.every((item) => item.classContract)
        && cardOverrideEvidence.classContract
        && pressableOverrideEvidence.classContract,
      cardFamilyDefaultBackground:
        cardEvidence.find((item) => item.tone === "card")?.backgroundColor ?? "",
      cardFamilyDiagnostics: JSON.stringify({
        cards: cardEvidence,
        cardClassVariableOverride: cardClassVariableOverrideEvidence,
        nested: cardNestedEvidence,
        cardOverride: cardOverrideEvidence,
        pressableOverride: pressableOverrideEvidence,
        pressables: pressableEvidence,
        tokens: resolvedTokens,
      }),
      cardFamilyLayerSentinels:
        cardEvidence.every((item) => item.layerSentinel === "legacy")
        && pressableEvidence.every((item) => item.layerSentinel === "legacy")
        && cardOverrideEvidence.layerSentinel === "legacy"
        && pressableOverrideEvidence.layerSentinel === "legacy",
      cardFamilyNestedResetContract:
        equivalentColor(
          cardNestedEvidence.outerDescriptionColor,
          "rgb(41 42 43)",
        )
        && equivalentColor(
          cardNestedEvidence.outerPublicDescription,
          "rgb(41 42 43)",
        )
        && cardNestedEvidence.innerTone === "inverse"
        && equivalentColor(
          cardNestedEvidence.innerDescriptionColor,
          expectedCardTones.inverse[3],
        )
        && equivalentColor(
          cardNestedEvidence.innerPublicDescription,
          expectedCardTones.inverse[3],
        )
        && !equivalentColor(
          cardNestedEvidence.innerPublicDescription,
          cardNestedEvidence.outerPublicDescription,
        ),
      cardFamilyOverrideContracts:
        equivalentColor(
          cardClassVariableOverrideEvidence.descriptionColor,
          "rgb(31 32 33)",
        )
        && equivalentColor(
          cardClassVariableOverrideEvidence.publicDescription,
          "rgb(31 32 33)",
        )
        && equivalentColor(cardOverrideEvidence.backgroundColor, "rgb(7 8 9)")
        && equivalentColor(cardOverrideEvidence.borderColor, resolvedTokens.primary)
        && cardOverrideEvidence.borderRadius === 13
        && cardOverrideEvidence.descriptionColor === "rgb(14, 15, 16)"
        && cardOverrideEvidence.dynamicInlineValue
        && cardOverrideEvidence.gap === resolvedTokens.space2
        && equivalentColor(
          cardOverrideEvidence.inheritedVariableColor,
          "rgb(11 12 13)",
        )
        && cardOverrideEvidence.inlinePublicDescription.length > 0
        && cardOverrideEvidence.inlineWidth === "15rem"
        && cardOverrideEvidence.paddingLeft === resolvedTokens.space2
        && cardOverrideEvidence.paddingRight === resolvedTokens.space2
        && cardOverrideEvidence.width === 240
        && equivalentColor(
          pressableOverrideEvidence.backgroundColor,
          "rgb(17 18 19)",
        )
        && equivalentColor(
          pressableOverrideEvidence.borderColor,
          resolvedTokens.primary,
        )
        && pressableOverrideEvidence.borderRadius === 13
        && pressableOverrideEvidence.dynamicInlineValue
        && pressableOverrideEvidence.gap === resolvedTokens.space2
        && pressableOverrideEvidence.inlineWidth === "15rem"
        && pressableOverrideEvidence.paddingLeft === resolvedTokens.space2
        && pressableOverrideEvidence.paddingRight === resolvedTokens.space2
        && pressableOverrideEvidence.width === 240,
      cardFamilyToneShapeContracts:
        cardEvidence.every(
          (item) =>
            equivalentColor(item.backgroundColor, item.expectedBackground)
            && equivalentColor(item.borderColor, item.expectedBorder)
            && equivalentColor(item.color, item.expectedColor)
            && item.descriptionEquivalent
            && item.publicDescription.length > 0
            && item.publicDescription !== "rgb(251 0 251)"
            && item.borderRadius === (
              item.shape === "rectangular"
                ? resolvedTokens.sharpRadius
                : resolvedTokens.largeRadius
            ),
        )
        && pressableEvidence.every(
          (item) =>
            equivalentColor(item.backgroundColor, item.expectedBackground)
            && equivalentColor(item.borderColor, item.expectedBorder)
            && equivalentColor(item.color, item.expectedColor)
            && item.publicDescription.length > 0
            && item.publicDescription !== "rgb(251 0 251)"
            && item.borderRadius === (
              item.shape === "rectangular"
                ? resolvedTokens.sharpRadius
                : resolvedTokens.largeRadius
            )
            && (item.state === "disabled"
              ? item.disabled && item.dataDisabled === "true"
              : item.state === "pending"
                ? !item.disabled
                  && item.ariaDisabled === "true"
                  && item.dataPending === "true"
                : !item.disabled),
        ),
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      checkboxBoundaryContracts:
        checkboxEvidence.every(
          (checkbox) =>
            checkbox.ariaDescribedBy.length > 0
            && checkbox.borderRadius === resolvedTokens.smallRadius
            && checkbox.borderStyle === "solid"
            && checkbox.borderWidth === 1
            && checkbox.controlBorderWidth === 0
            && checkbox.descriptionConnected
            && (checkbox.isOverride || checkbox.fieldRefAttached)
            // The artifact oracle proves `inline-grid`; this direct grid child
            // is blockified to `grid` in the browser's computed style.
            && checkbox.indicatorDisplay === "grid"
            && checkbox.indicatorFlex === "0 0 auto"
            && checkbox.indicatorHeight === 20
            && checkbox.indicatorWidth === 20
            && checkbox.inputName === `gallery-${checkbox.kind}-checkbox`
            && checkbox.inputType === "checkbox"
            && checkbox.labelFontSize === resolvedTokens.cardLabelSize
            && checkbox.labelFontWeight === resolvedTokens.mediumWeight
            && checkbox.labelText.length > 0
            && checkbox.slot === "checkbox-field"
            && checkbox.transitionProperty === "background-color, border-color",
        ),
      checkboxClassContracts: checkboxEvidence.every(
        (checkbox) => checkbox.classContract,
      ),
      checkboxDefaultBackground: defaultCheckboxEvidence?.backgroundColor ?? "",
      checkboxDiagnostics: JSON.stringify({
        checkboxes: checkboxEvidence,
        tokens: resolvedTokens,
      }),
      checkboxLayerSentinels: checkboxEvidence.every(
        (checkbox) => checkbox.layerSentinel === "legacy",
      ),
      checkboxOverrideContract:
        overrideCheckboxEvidence !== undefined
        && equivalentColor(
          overrideCheckboxEvidence.color,
          resolvedTokens.primary,
        )
        && overrideCheckboxEvidence.controlBackground
          === resolvedTokens.secondaryBackground
        && overrideCheckboxEvidence.controlGap === resolvedTokens.space4
        && overrideCheckboxEvidence.controlGridColumns !== "none"
        && overrideCheckboxEvidence.controlMinHeight === 52
        && /--[^:]+:\s*3\.25rem/u.test(
          overrideCheckboxEvidence.controlStyleValue,
        )
        && overrideCheckboxEvidence.fieldDisplay === "flex"
        && overrideCheckboxEvidence.fieldGap === resolvedTokens.space5
        && overrideCheckboxEvidence.fieldMinWidth === 0
        && /--[^:]+:\s*14rem/u.test(overrideCheckboxEvidence.fieldStyleValue)
        && overrideCheckboxEvidence.fieldStyleValue.includes("width: 15rem")
        && overrideCheckboxEvidence.fieldWidth === 240
        && overrideCheckboxEvidence.labelHidden,
      checkboxStateContracts:
        defaultCheckboxEvidence !== undefined
        && defaultCheckboxEvidence.backgroundColor
          === resolvedTokens.neutralBackground
        && defaultCheckboxEvidence.borderColor === resolvedTokens.inputBorder
        && !defaultCheckboxEvidence.checked
        && defaultCheckboxEvidence.controlBackground === resolvedTokens.transparent
        && defaultCheckboxEvidence.controlDisplay === "grid"
        && defaultCheckboxEvidence.controlGap === resolvedTokens.space3
        && defaultCheckboxEvidence.controlMinHeight === 40
        && defaultCheckboxEvidence.dataDisabled === ""
        && defaultCheckboxEvidence.dataInvalid === ""
        && defaultCheckboxEvidence.dataSelected === ""
        && defaultCheckboxEvidence.fieldDisplay === "grid"
        && defaultCheckboxEvidence.fieldGap === resolvedTokens.space2
        && defaultCheckboxEvidence.fieldMinWidth === 0
        && !defaultCheckboxEvidence.labelHidden
        && overrideCheckboxEvidence !== undefined
        && overrideCheckboxEvidence.backgroundColor === resolvedTokens.primary
        && overrideCheckboxEvidence.borderColor === resolvedTokens.destructiveBorder
        && overrideCheckboxEvidence.checked
        && overrideCheckboxEvidence.dataDisabled === "true"
        && overrideCheckboxEvidence.dataInvalid === "true"
        && overrideCheckboxEvidence.dataSelected === "true"
        && overrideCheckboxEvidence.disabled,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      colorEquivalenceContract:
        equivalentColor(
          colorEquivalenceEvidence.oklch,
          colorEquivalenceEvidence.oklab,
        )
        && !equivalentColor(
          colorEquivalenceEvidence.oklch,
          colorEquivalenceEvidence.distinct,
        ),
      colorEquivalenceDiagnostics: JSON.stringify(colorEquivalenceEvidence),
      documentScrollWidth: document.documentElement.scrollWidth,
      footerAlignItems: footerStyle.alignItems,
      footerBorderTopStyle: footerStyle.borderTopStyle,
      footerBorderTopWidth: Number.parseFloat(footerStyle.borderTopWidth),
      footerBoxSizing: footerStyle.boxSizing,
      footerCallerClassLast:
        footerClasses.at(-1) === "gallery-quiet-site-footer",
      footerClassIsSemantic:
        footerClasses[0] === "hraness-quiet-site-footer",
      footerDisplay: footerStyle.display,
      footerFlex: footerStyle.flex,
      footerFlexWrap: footerStyle.flexWrap,
      footerGap: Number.parseFloat(footerStyle.gap),
      footerHasGeneratedClass: footerClasses.some(
        (name) =>
          name !== "hraness-quiet-site-footer"
          && name !== "gallery-quiet-site-footer",
      ),
      footerJustifyContent: footerStyle.justifyContent,
      footerMarginInlineEnd: Number.parseFloat(footerStyle.marginInlineEnd),
      footerMarginInlineStart: Number.parseFloat(footerStyle.marginInlineStart),
      footerMaxInlineSize: Number.parseFloat(footerStyle.maxInlineSize),
      footerMinInlineSize: Number.parseFloat(footerStyle.minInlineSize),
      footerOverflow: footerStyle.overflow,
      footerPaddingBottom: Number.parseFloat(footerStyle.paddingBottom),
      footerPaddingLeft: Number.parseFloat(footerStyle.paddingLeft),
      footerPaddingRight: Number.parseFloat(footerStyle.paddingRight),
      footerPaddingTop: Number.parseFloat(footerStyle.paddingTop),
      footerPresent: footer.tagName === "FOOTER",
      footerWidth: footerBox.width,
      heading: heading.textContent?.trim() ?? "",
      hydrationStarted: window.__HRANESS_UI_GALLERY_HYDRATION_STARTED__ === true,
      iconAriaHidden: icon.getAttribute("aria-hidden") ?? "",
      iconClassIsSemantic: icon.classList.contains("hraness-icon"),
      iconDisplay: iconStyle.display,
      iconFlex: iconStyle.flex,
      iconHeight: iconBox.height,
      iconInheritsCanaryColor: iconStyle.color === getComputedStyle(iconCanary).color,
      iconLegacyLayerSentinel: iconStyle
        .getPropertyValue("--gallery-stylex-layer-conflict")
        .trim(),
      iconWidth: iconBox.width,
      keyHintBoundaryContracts:
        keyHintEvidence.every(
          (keyHint) =>
            keyHint.borderBlockEndWidth === 2
            && keyHint.borderBottomStyle === "solid"
            && keyHint.borderBottomWidth === 2
            && keyHint.borderLeftWidth === 1
            && keyHint.borderRightWidth === 1
            && keyHint.borderTopWidth === 1
            && keyHint.display === "inline-flex"
            && keyHint.minHeight >= 24
            && keyHint.minWidth >= 24
            && keyHint.slot === "key-hint"
            && keyHint.tagName === "KBD"
            && keyHint.text.length > 0,
        )
        && defaultKeyHintEvidence !== undefined
        && defaultKeyHintEvidence.alignItems === "center"
        && defaultKeyHintEvidence.ariaLabel === ""
        && defaultKeyHintEvidence.backgroundColor === resolvedTokens.mutedBackground
        && defaultKeyHintEvidence.borderColor === resolvedTokens.border
        && defaultKeyHintEvidence.borderRadius === resolvedTokens.smallRadius
        && defaultKeyHintEvidence.colorEquivalent
        && defaultKeyHintEvidence.fontFamily === resolvedTokens.monoFontFamily
        && defaultKeyHintEvidence.fontSize === resolvedTokens.captionSize
        && defaultKeyHintEvidence.justifyContent === "center"
        && defaultKeyHintEvidence.minHeight === 24
        && defaultKeyHintEvidence.minWidth === 24
        && defaultKeyHintEvidence.paddingLeft === resolvedTokens.space1
        && defaultKeyHintEvidence.paddingRight === resolvedTokens.space1
        && defaultKeyHintEvidence.title === "Command K",
      keyHintClassContracts: keyHintEvidence.every(
        (keyHint) => keyHint.classContract,
      ),
      keyHintDefaultBackground: defaultKeyHintEvidence?.backgroundColor ?? "",
      keyHintDefaultDisplay: defaultKeyHintEvidence?.display ?? "",
      keyHintDiagnostics: JSON.stringify({
        keyHints: keyHintEvidence,
        tokens: resolvedTokens,
      }),
      keyHintLayerSentinels: keyHintEvidence.every(
        (keyHint) => keyHint.layerSentinel === "legacy",
      ),
      keyHintOverrideContract:
        overrideKeyHintEvidence !== undefined
        && overrideKeyHintEvidence.alignItems === "stretch"
        && overrideKeyHintEvidence.ariaLabel === "Escape"
        && overrideKeyHintEvidence.backgroundColor
          === resolvedTokens.secondaryBackground
        && overrideKeyHintEvidence.borderColor === resolvedTokens.primary
        && overrideKeyHintEvidence.borderRadius === resolvedTokens.largeRadius
        && overrideKeyHintEvidence.colorEquivalent
        && overrideKeyHintEvidence.dynamicInlineValue
        && overrideKeyHintEvidence.fontFamily === resolvedTokens.headingFontFamily
        && overrideKeyHintEvidence.fontSize === resolvedTokens.bodySize
        && overrideKeyHintEvidence.inlineWidth === "3rem"
        && overrideKeyHintEvidence.justifyContent === "flex-start"
        && overrideKeyHintEvidence.minHeight === 32
        && overrideKeyHintEvidence.minWidth === 32
        && overrideKeyHintEvidence.paddingLeft === resolvedTokens.space2
        && overrideKeyHintEvidence.paddingRight === resolvedTokens.space2
        && overrideKeyHintEvidence.title === ""
        && overrideKeyHintEvidence.width === 48,
      mainPresent: main.tagName === "MAIN",
      pageBoxSizing: pageStyle.boxSizing,
      pageCallerClassLast:
        pageClasses.at(-1) === "gallery-quiet-site-page",
      pageClassIsSemantic: pageClasses[0] === "hraness-quiet-site-page",
      pageFlex: pageStyle.flex,
      pageHasGeneratedClass: pageClasses.some(
        (name) =>
          name !== "hraness-quiet-site-page"
          && name !== "gallery-quiet-site-page",
      ),
      pageMarginBlockEnd: Number.parseFloat(pageStyle.marginBlockEnd),
      pageMarginBlockStart: Number.parseFloat(pageStyle.marginBlockStart),
      pageMarginInlineEnd: Number.parseFloat(pageStyle.marginInlineEnd),
      pageMarginInlineStart: Number.parseFloat(pageStyle.marginInlineStart),
      pageLegacyLayerSentinel: pageStyle
        .getPropertyValue("--gallery-quiet-site-layer-conflict")
        .trim(),
      pageMaxInlineSize: Number.parseFloat(pageStyle.maxInlineSize),
      pagePaddingLeft: Number.parseFloat(pageStyle.paddingLeft),
      pagePaddingRight: Number.parseFloat(pageStyle.paddingRight),
      pageWidth: pageBox.width,
      recoverableErrors: window.__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__ ?? [],
      rootHydrated: root.dataset.hydrated === "true",
      skeletonAnimationName: getComputedStyle(skeleton).animationName,
      socialAlignItems: socialStyle.alignItems,
      socialAriaHidden: social.getAttribute("aria-hidden") ?? "",
      socialCallerClassLast: socialClasses.at(-1) === "gallery-social-icon",
      socialChildSlot: socialIcon.getAttribute("data-slot") ?? "",
      socialClassIsSemantic: socialClasses[0] === "hraness-social-icon",
      socialDisplay: socialStyle.display,
      socialFlex: socialStyle.flex,
      socialHasGeneratedClass: socialClasses.some(
        (name) => name !== "hraness-social-icon" && name !== "gallery-social-icon",
      ),
      socialIconHeight: socialBox.height,
      socialIconWidth: socialBox.width,
      socialJustifyContent: socialStyle.justifyContent,
      spinnerAnimationName: getComputedStyle(spinner).animationName,
      statusFamilyClassContracts:
        badgeEvidence.every((badge) => badge.classContract)
        && tagEvidence.every(
          (tag) => tag.classContract && tag.iconContract && tag.labelContract,
        )
        && dotEvidence.every((dot) => dot.classContract)
        && statusOverrides.every((item) => item.classContract),
      statusFamilyDefaultBackground:
        badgeEvidence.find((badge) => badge.tone === "neutral")
          ?.backgroundColor ?? "",
      statusFamilyDiagnostics: JSON.stringify({
        badges: badgeEvidence,
        dots: dotEvidence,
        overrides: statusOverrides,
        tags: tagEvidence,
        tokens: resolvedTokens,
      }),
      statusFamilyGeometryContracts:
        [...badgeEvidence, ...tagEvidence].every(
          (pill) =>
            pill.alignItems === "center"
            && pill.borderRadius === resolvedTokens.roundRadius
            && pill.borderStyle === "solid"
            && pill.borderWidth === 1
            && pill.display === "inline-flex"
            && pill.fontSize === resolvedTokens.captionSize
            && pill.fontWeight === resolvedTokens.mediumWeight
            && pill.forcedColorAdjust === "auto"
            && pill.gap === resolvedTokens.space1
            && pill.justifyContent === "center"
            && pill.lineHeight === resolvedTokens.captionSize
            && pill.minHeight === 24
            && pill.paddingLeft === resolvedTokens.space2
            && pill.paddingRight === resolvedTokens.space2
            && pill.slot.length > 0
            && pill.whiteSpace === "nowrap",
        )
        && dotEvidence.every(
          (dot) =>
            dot.ariaHidden === "true"
            && dot.borderColorEquivalent
            && dot.borderRadius === resolvedTokens.roundRadius
            && dot.borderStyle === "solid"
            && dot.borderWidth === 1
            && dot.display === "inline-block"
            && dot.flex === "0 0 auto"
            && dot.height === 10
            && dot.slot === "status-dot"
            && dot.width === 10,
        ),
      statusFamilyLayerSentinels:
        badgeEvidence.every((badge) => badge.layerSentinel === "legacy")
        && tagEvidence.every((tag) => tag.layerSentinel === "legacy")
        && dotEvidence.every((dot) => dot.layerSentinel === "legacy")
        && statusOverrides.every((item) => item.layerSentinel === "legacy"),
      statusFamilyOverrideContracts:
        statusOverrides.every((item) => {
          if (item.kind === "dot") {
            return equivalentColor(item.backgroundColor, resolvedTokens.primary)
              && item.borderRadius === resolvedTokens.roundRadius
              && item.height === 20
              && item.inlineHeight === "1.25rem"
              && item.inlineWidth === "1.25rem"
              && item.width === 20;
          }
          return equivalentColor(
            item.backgroundColor,
            resolvedTokens.accentBackground,
          )
            && equivalentColor(item.borderColor, resolvedTokens.primary)
            && item.borderRadius === resolvedTokens.smallRadius
            && equivalentColor(item.color, resolvedTokens.accentForeground)
            && item.inlineMinHeight === "2.5rem"
            && item.inlineWidth === "9rem"
            && item.minHeight === 40
            && item.width === 144;
        }),
      statusFamilyToneContracts:
        badgeEvidence.every(
          (badge) =>
            equivalentColor(badge.backgroundColor, badge.expectedBackground)
            && equivalentColor(badge.borderColor, badge.expectedBorder)
            && equivalentColor(badge.color, badge.expectedColor)
            && badge.slot === "badge"
            && (badge.tone === "success"
              ? badge.ariaLive === "polite" && badge.role === "status"
              : badge.ariaLive === "" && badge.role === ""),
        )
        && tagEvidence.every(
          (tag) =>
            equivalentColor(tag.backgroundColor, tag.expectedBackground)
            && equivalentColor(tag.borderColor, tag.expectedBorder)
            && equivalentColor(tag.color, tag.expectedColor)
            && tag.role === ""
            && tag.slot === "tag",
        )
        && dotEvidence.every(
          (dot) => equivalentColor(dot.backgroundColor, dot.expectedBackground),
        ),
      statusFamilyVariableContract:
        tagEvidence.some(
          (tag) =>
            tag.variant === "outline"
            && tag.publicAccent.toLowerCase() === "#d97706"
            && equivalentColor(tag.borderColor, resolvedTokens.outlineAccent),
        ),
      stylexRuntimeStyleCount: document.querySelectorAll("style[data-stylex]").length,
      stylesheetCount: document.querySelectorAll('link[rel="stylesheet"]').length,
      stylesheetMarked:
        document.querySelector('link[data-gallery-default-stylesheet="true"]')
        instanceof HTMLLinkElement,
      substackAriaHidden: substackIcon.getAttribute("aria-hidden") ?? "",
      substackFill: substackIcon.getAttribute("fill") ?? "",
      substackHasPath:
        substackIcon.querySelector('path[d^="M22.539 8.242H1.46V5.406"]') !== null,
      substackIconHeight: substackBox.height,
      substackIconWidth: substackBox.width,
      theme: document.documentElement.dataset.theme ?? "",
      themedSurfaceBoundaryContracts: themedSurfaceEvidence.every(
        (surface) =>
          surface.borderStyle === "solid"
          && surface.borderWidth === 1
          && surface.minInlineSize === 0
          && surface.paddingBottom === resolvedTokens.space6
          && surface.paddingLeft === resolvedTokens.space6
          && surface.paddingRight === resolvedTokens.space6
          && surface.paddingTop === resolvedTokens.space6,
      ),
      themedSurfaceClassContracts:
        themedSurfaceEvidence.every((surface) => surface.classContract)
        && textureEvidence.classContract,
      themedSurfaceDiagnostics: JSON.stringify({
        resolvedTokens,
        surfaces: themedSurfaceEvidence,
        texture: textureEvidence,
      }),
      themedSurfaceLayerSentinels:
        themedSurfaceEvidence.every((surface) => surface.layerSentinel === "legacy")
        && textureEvidence.layerSentinel === "legacy",
      themedSurfacePopoverElevation:
        themedSurfaceEvidence.some(
          (surface) =>
            surface.tone === "popover"
            && surface.boxShadow === resolvedTokens.raisedShadow
            && surface.boxShadow !== "none",
        ),
      themedSurfaceShapeContracts:
        themedSurfaceEvidence.some(
          (surface) =>
            surface.shape === "rounded"
            && surface.borderRadius === resolvedTokens.largeRadius,
        )
        && themedSurfaceEvidence.some(
          (surface) =>
            surface.shape === "rectangular"
            && surface.borderRadius === resolvedTokens.sharpRadius,
        ),
      themedSurfaceTextureContract:
        textureEvidence.backgroundColor === resolvedTokens.secondaryBackground
        && textureEvidence.backgroundImage !== "none"
        && textureEvidence.backgroundPosition === "2px 3px"
        && textureEvidence.backgroundRepeat === "repeat"
        && textureEvidence.backgroundSize === "4px 4px"
        && textureEvidence.borderColor === resolvedTokens.primary
        && textureEvidence.borderRadius === resolvedTokens.smallRadius
        && textureEvidence.borderStyle === "solid"
        && textureEvidence.borderWidth === 1
        && textureEvidence.colorEquivalent
        && textureEvidence.minInlineSize === 0
        && textureEvidence.paddingBottom === resolvedTokens.space6
        && textureEvidence.paddingLeft === resolvedTokens.space2
        && textureEvidence.paddingRight === resolvedTokens.space2
        && textureEvidence.paddingTop === resolvedTokens.space6
        && textureEvidence.shape === "rounded"
        && textureEvidence.tone === "accent",
      themedSurfaceToneContracts: themedSurfaceEvidence.every(
        (surface) =>
          surface.backgroundColor === surface.expectedBackground
          && surface.colorEquivalent
          && surface.borderColor === (
            surface.tone === "inverse"
              ? resolvedTokens.inverseBackground
              : resolvedTokens.border
          ),
      ),
      toolbarBoundaryContracts: toolbarEvidence.every(
        (toolbar) =>
          toolbar.borderStyle === "solid"
          && toolbar.borderWidth === 1
          && toolbar.display === "flex"
          && toolbar.minWidth === 0
          && (!toolbar.isOverride || toolbar.refConnected)
          && toolbar.role === "toolbar"
          && toolbar.slot === "toolbar"
          && toolbar.ariaOrientation === toolbar.orientation
          && (toolbar.ariaLabel.length > 0) !== (toolbar.ariaLabelledBy.length > 0),
      ),
      toolbarClassContracts: toolbarEvidence.every(
        (toolbar) => toolbar.classContract,
      ),
      toolbarDefaultBackground:
        toolbarEvidence.find(
          (toolbar) => toolbar.orientation === "horizontal" && !toolbar.isOverride,
        )?.backgroundColor ?? "",
      toolbarDiagnostics: JSON.stringify({
        toolbars: toolbarEvidence,
        tokens: resolvedTokens,
      }),
      toolbarLayerSentinels: toolbarEvidence.every(
        (toolbar) => toolbar.layerSentinel === "legacy",
      ),
      toolbarOrientationContracts: toolbarEvidence.every((toolbar) => {
        if (toolbar.isOverride) {
          return toolbar.orientation === "vertical"
            && toolbar.alignItems === "end"
            && toolbar.flexDirection === "row"
            && toolbar.flexWrap === "wrap";
        }
        return toolbar.orientation === "vertical"
          ? toolbar.alignItems === "stretch"
            && toolbar.flexDirection === "column"
            && toolbar.flexWrap === "nowrap"
            && toolbar.width < 19 * 16
          : toolbar.alignItems === "center"
            && toolbar.backgroundColor === resolvedTokens.cardBackground
            && toolbar.borderColor === resolvedTokens.border
            && toolbar.borderRadius === resolvedTokens.largeRadius
            && toolbar.flexDirection === "row"
            && toolbar.flexWrap === "wrap"
            && toolbar.gap === resolvedTokens.space1
            && toolbar.paddingBottom === resolvedTokens.space1
            && toolbar.paddingLeft === resolvedTokens.space1
            && toolbar.paddingRight === resolvedTokens.space1
            && toolbar.paddingTop === resolvedTokens.space1;
      }),
      toolbarOverrideContract: toolbarEvidence.some(
        (toolbar) =>
          toolbar.isOverride
          && toolbar.alignItems === "end"
          && toolbar.backgroundColor === resolvedTokens.secondaryBackground
          && toolbar.borderColor === resolvedTokens.primary
          && toolbar.borderRadius === resolvedTokens.smallRadius
          && toolbar.dynamicInlineValue
          && toolbar.flexDirection === "row"
          && toolbar.flexWrap === "wrap"
          && toolbar.gap === resolvedTokens.space2
          && toolbar.inlineWidth === "13rem"
          && toolbar.paddingBottom === resolvedTokens.space2
          && toolbar.paddingLeft === resolvedTokens.space2
          && toolbar.paddingRight === resolvedTokens.space2
          && toolbar.paddingTop === resolvedTokens.space2
          && toolbar.width === 208,
      ),
      transitionDuration: buttonStyle.transitionDuration,
      quietSitePriority3LayerSentinel: footerStyle
        .getPropertyValue("--gallery-quiet-site-priority3-conflict")
        .trim(),
      viewportFrameCallerClassLast:
        viewportFrameClasses.at(-1) === "gallery-viewport-frame",
      viewportFrameClassIsSemantic:
        viewportFrameClasses[0] === "hraness-viewport-frame",
      viewportFrameHasGeneratedClass: viewportFrameClasses.some(
        (name) =>
          name !== "hraness-viewport-frame"
          && name !== "gallery-viewport-frame",
      ),
      viewportFrameHeight: viewportFrameBox.height,
      viewportFrameInlineSize: Number.parseFloat(viewportFrameStyle.inlineSize),
      viewportFrameLayerSentinel: viewportFrameStyle
        .getPropertyValue("--gallery-viewport-frame-layer-conflict")
        .trim(),
      viewportFrameMinInlineSize: Number.parseFloat(
        viewportFrameStyle.minInlineSize,
      ),
      viewportFrameOverflow: viewportFrameStyle.overflow,
      viewportFramePosition: viewportFrameStyle.position,
      viewportFramePresent: viewportFrame.tagName === "SECTION",
      viewportFrameWidth: viewportFrameBox.width,
      wrappingRowAlignItems: wrappingRowStyle.alignItems,
      wrappingRowCallerClassLast:
        wrappingRowClasses.at(-1) === "gallery-wrapping-row",
      wrappingRowClassIsSemantic:
        wrappingRowClasses[0] === "hraness-wrapping-row",
      wrappingRowDisplay: wrappingRowStyle.display,
      wrappingRowFirstItemTop: wrappingRowFirstItemBox.top,
      wrappingRowFlexWrap: wrappingRowStyle.flexWrap,
      wrappingRowGap: Number.parseFloat(wrappingRowStyle.gap),
      wrappingRowHasGeneratedClass: wrappingRowClasses.some(
        (name) =>
          name !== "hraness-wrapping-row"
          && name !== "gallery-wrapping-row",
      ),
      wrappingRowInlineSize: Number.parseFloat(wrappingRowStyle.inlineSize),
      wrappingRowLayerSentinel: wrappingRowStyle
        .getPropertyValue("--gallery-wrapping-row-layer-conflict")
        .trim(),
      wrappingRowMinInlineSize: Number.parseFloat(wrappingRowStyle.minInlineSize),
      wrappingRowSecondItemTop: wrappingRowSecondItemBox.top,
      wrappingRowWidth: wrappingRowBox.width,
    };
  });
}

async function segmentedControlEvidence(page: Page): Promise<SegmentedControlEvidence> {
  return page.evaluate(() => {
    const control = document.querySelector(".gallery-segmented-control");
    const items = [
      ...document.querySelectorAll<HTMLElement>(
        ".gallery-segmented-control .hraness-segmented-control__item",
      ),
    ];
    const selected = items.find((item) => item.hasAttribute("data-selected"));
    if (
      !(control instanceof HTMLElement)
      || items.length !== 4
      || selected === undefined
    ) {
      throw new Error("The segmented-control gallery structure is incomplete.");
    }

    const controlBox = control.getBoundingClientRect();
    const controlStyle = getComputedStyle(control);
    const selectedBox = selected.getBoundingClientRect();
    const itemEvidence = items.map((item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return {
        background: style.backgroundColor,
        borderWidths: [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ].map(Number.parseFloat),
        cursor: style.cursor,
        height: box.height,
        radius: Number.parseFloat(style.borderRadius),
        transitionProperty: style.transitionProperty,
      };
    });

    return {
      borderWidths: itemEvidence.map(({ borderWidths }) => borderWidths),
      classContract:
        control.classList.item(0) === "hraness-segmented-control"
        && control.classList.item(control.classList.length - 1)
          === "gallery-segmented-control",
      cursors: itemEvidence.map(({ cursor }) => cursor),
      groupBackground: controlStyle.backgroundColor,
      groupBorderRadius: Number.parseFloat(controlStyle.borderRadius),
      groupGap: Number.parseFloat(controlStyle.columnGap),
      groupHeight: controlBox.height,
      groupOverflowX: controlStyle.overflowX,
      groupPaddingTop: Number.parseFloat(controlStyle.paddingTop),
      inactiveBackgrounds: itemEvidence
        .filter((_, index) => items[index] !== selected)
        .map(({ background }) => background),
      itemHeights: itemEvidence.map(({ height }) => height),
      itemRadii: itemEvidence.map(({ radius }) => radius),
      labels: items.map((item) => item.textContent?.trim() ?? ""),
      selectedBackground: getComputedStyle(selected).backgroundColor,
      selectedBlockInset: Math.min(
        selectedBox.top - controlBox.top,
        controlBox.bottom - selectedBox.bottom,
      ),
      selectedCount: items.filter((item) => item.hasAttribute("data-selected")).length,
      selectedLabel: selected.textContent?.trim() ?? "",
      size: control.dataset.size ?? "",
      slot: control.dataset.slot ?? "",
      transitionProperties: itemEvidence.map(({ transitionProperty }) => transitionProperty),
    };
  });
}

async function selectFieldIndicatorEvidence(
  page: Page,
): Promise<SelectFieldIndicatorEvidence> {
  return page.evaluate(() => {
    const select = document.querySelector('[data-gallery-select="true"]');
    const trigger = select?.querySelector(".hraness-select-field__trigger");
    const indicator = select?.querySelector(".hraness-select-field__indicator");
    const path = indicator?.querySelector("path");
    if (
      !(select instanceof HTMLElement)
      || !(trigger instanceof HTMLButtonElement)
      || !(indicator instanceof SVGSVGElement)
      || !(path instanceof SVGGraphicsElement)
      || path.tagName.toLowerCase() !== "path"
    ) {
      throw new Error("The select-field indicator gallery structure is incomplete.");
    }

    const triggerBox = trigger.getBoundingClientRect();
    const indicatorBox = indicator.getBoundingClientRect();
    const pathBox = path.getBBox();
    const viewBox = indicator.viewBox.baseVal;
    return {
      ariaHidden: indicator.getAttribute("aria-hidden") ?? "",
      display: getComputedStyle(indicator).display,
      flex: getComputedStyle(indicator).flex,
      height: indicatorBox.height,
      pathCenterDeltaX: Math.abs(
        pathBox.x + pathBox.width / 2 - (viewBox.x + viewBox.width / 2),
      ),
      pathCenterDeltaY: Math.abs(
        pathBox.y + pathBox.height / 2 - (viewBox.y + viewBox.height / 2),
      ),
      pathCount: indicator.querySelectorAll(":scope > path").length,
      slot: indicator.dataset.slot ?? "",
      tagName: indicator.tagName.toLowerCase(),
      text: indicator.textContent?.trim() ?? "",
      triggerHeight: triggerBox.height,
      verticalCenterDelta: Math.abs(
        indicatorBox.top + indicatorBox.height / 2
          - (triggerBox.top + triggerBox.height / 2),
      ),
      viewBox: indicator.getAttribute("viewBox") ?? "",
      width: indicatorBox.width,
    };
  });
}

function verifySelectFieldIndicator(
  evidence: SelectFieldIndicatorEvidence,
  id: string,
): void {
  invariant(
    evidence.tagName === "svg"
    && evidence.ariaHidden === "true"
    && evidence.slot === "select-field-indicator"
    && evidence.text === ""
    && evidence.pathCount === 1
    && evidence.viewBox === "0 0 12 12",
    `${id}: select-field indicator semantics changed: ${JSON.stringify(evidence)}`,
  );
  invariant(
    evidence.display === "block"
    && evidence.flex === "0 0 auto"
    && nearlyEqual(evidence.width, 10)
    && nearlyEqual(evidence.height, 10)
    && nearlyEqual(evidence.triggerHeight, 22),
    `${id}: compact select-field indicator geometry changed: ${JSON.stringify(evidence)}`,
  );
  invariant(
    evidence.verticalCenterDelta <= 0.01
    && evidence.pathCenterDeltaX <= 0.001
    && evidence.pathCenterDeltaY <= 0.001,
    `${id}: select-field caret is not geometrically centered: ${JSON.stringify(evidence)}`,
  );
}

function verifySegmentedControlRecipe(
  evidence: SegmentedControlEvidence,
  id: string,
): void {
  invariant(
    evidence.classContract
    && evidence.slot === "segmented-control"
    && evidence.size === "compact",
    `${id}: segmented-control semantics or class ordering changed`,
  );
  invariant(
    evidence.labels.join("|") === "all|projects|shared|dependencies"
    && evidence.selectedCount === 1,
    `${id}: segmented-control labels or selection changed: ${JSON.stringify(evidence)}`,
  );
  invariant(
    nearlyEqual(evidence.groupGap, 2)
    && nearlyEqual(evidence.groupPaddingTop, 2)
    && nearlyEqual(evidence.groupBorderRadius, 8)
    && nearlyEqual(evidence.groupHeight, 38)
    && evidence.groupOverflowX === "auto",
    `${id}: segmented-control frame is ${JSON.stringify(evidence)}`,
  );
  invariant(
    evidence.borderWidths.every((widths) => widths.every((width) => nearlyEqual(width, 0)))
    && evidence.cursors.every((cursor) => cursor === "pointer")
    && evidence.itemHeights.every((height) => nearlyEqual(height, 32))
    && evidence.itemRadii.every((radius) => nearlyEqual(radius, 4))
    && evidence.transitionProperties.every((properties) =>
      properties.includes("background-color")
      && properties.includes("box-shadow")
      && properties.includes("color")),
    `${id}: segmented-control item geometry is ${JSON.stringify(evidence)}`,
  );
  invariant(
    evidence.selectedBackground !== evidence.groupBackground
    && nearlyEqual(evidence.selectedBlockInset, 3)
    && evidence.inactiveBackgrounds.every((background) => background === "rgba(0, 0, 0, 0)"),
    `${id}: segmented-control selection surface is ${JSON.stringify(evidence)}`,
  );
}

async function verifySegmentedControlInteraction(page: Page, id: string): Promise<void> {
  const projects = page.getByRole("radio", { name: "projects" });
  const projectsItem = page
    .locator(".gallery-segmented-control .hraness-segmented-control__item")
    .filter({ hasText: "projects" });
  const shared = page.getByRole("radio", { name: "shared" });
  const dependenciesItem = page
    .locator(".gallery-segmented-control .hraness-segmented-control__item")
    .filter({ hasText: "dependencies" });

  await dependenciesItem.hover();
  const hoveredBackground = await dependenciesItem.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  invariant(
    hoveredBackground !== "rgba(0, 0, 0, 0)",
    `${id}: segmented-control hover surface stayed transparent`,
  );

  await projectsItem.click();
  invariant(await projects.isChecked(), `${id}: pointer input did not select projects`);
  await projects.focus();
  await page.keyboard.press("ArrowRight");
  invariant(
    await shared.isChecked(),
    `${id}: ArrowRight did not move segmented-control selection to shared`,
  );
  await page.mouse.move(0, 0);
  await page.locator(".gallery-segmented-control").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map(async (animation) => {
        try {
          await animation.finished;
        } catch {
          // A superseded interaction may cancel its transition before settlement.
        }
      }),
    );
  });
}

async function verticalWritingEvidence(
  page: Page,
): Promise<VerticalWritingEvidence> {
  return page.evaluate(() => {
    const footer = document.querySelector('[data-gallery-quiet-site-footer="true"]');
    const main = document.querySelector('[data-gallery-quiet-site-page="true"]');
    const viewportFrame = document.querySelector('[data-gallery-viewport-frame="true"]');
    const wrappingRow = document.querySelector('[data-gallery-wrapping-row="true"]');
    if (
      !(footer instanceof HTMLElement)
      || !(main instanceof HTMLElement)
      || !(viewportFrame instanceof HTMLElement)
      || !(wrappingRow instanceof HTMLElement)
    ) {
      throw new Error("The logical-size writing-mode canaries are missing.");
    }

    const previousFooterWritingMode = footer.style.writingMode;
    const previousPageWritingMode = main.style.writingMode;
    const previousViewportFrameWritingMode = viewportFrame.style.writingMode;
    const previousWrappingRowWritingMode = wrappingRow.style.writingMode;
    footer.style.writingMode = "vertical-rl";
    main.style.writingMode = "vertical-rl";
    viewportFrame.style.writingMode = "vertical-rl";
    wrappingRow.style.writingMode = "vertical-rl";
    const footerStyle = getComputedStyle(footer);
    const pageStyle = getComputedStyle(main);
    const viewportFrameBox = viewportFrame.getBoundingClientRect();
    const viewportFrameStyle = getComputedStyle(viewportFrame);
    const wrappingRowBox = wrappingRow.getBoundingClientRect();
    const wrappingRowStyle = getComputedStyle(wrappingRow);
    const evidence = {
      footerInlineSize: Number.parseFloat(footerStyle.inlineSize),
      footerMaxInlineSize: Number.parseFloat(footerStyle.maxInlineSize),
      footerMaxWidth: footerStyle.maxWidth,
      footerWritingMode: footerStyle.writingMode,
      pageInlineSize: Number.parseFloat(pageStyle.inlineSize),
      pageMaxInlineSize: Number.parseFloat(pageStyle.maxInlineSize),
      pageMaxWidth: pageStyle.maxWidth,
      pageWritingMode: pageStyle.writingMode,
      viewportFrameHeight: viewportFrameBox.height,
      viewportFrameInlineSize: Number.parseFloat(viewportFrameStyle.inlineSize),
      viewportFrameMinInlineSize: Number.parseFloat(
        viewportFrameStyle.minInlineSize,
      ),
      viewportFrameWidth: viewportFrameBox.width,
      viewportFrameWritingMode: viewportFrameStyle.writingMode,
      wrappingRowHeight: wrappingRowBox.height,
      wrappingRowInlineSize: Number.parseFloat(wrappingRowStyle.inlineSize),
      wrappingRowMinInlineSize: Number.parseFloat(wrappingRowStyle.minInlineSize),
      wrappingRowWidth: wrappingRowBox.width,
      wrappingRowWritingMode: wrappingRowStyle.writingMode,
    };
    footer.style.writingMode = previousFooterWritingMode;
    main.style.writingMode = previousPageWritingMode;
    viewportFrame.style.writingMode = previousViewportFrameWritingMode;
    wrappingRow.style.writingMode = previousWrappingRowWritingMode;
    return evidence;
  });
}

function seconds(durationList: string): readonly number[] {
  return durationList.split(",").map((duration) => {
    const value = duration.trim();
    if (value.endsWith("ms")) return Number.parseFloat(value) / 1_000;
    if (value.endsWith("s")) return Number.parseFloat(value);
    return Number.NaN;
  });
}

function nearlyEqual(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.5;
}

async function settleCardFamilyTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const cardFamily = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-gallery-pressable-card-tone], [data-gallery-card-family-override="pressable"]',
      ),
    ];
    const transitions = cardFamily.flatMap((element) =>
      element.getAnimations());
    await Promise.allSettled(
      transitions.map(async (transition) => transition.finished),
    );
    await new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolveFrame());
      });
    });
  });
}

async function verifyCheckboxFocusCascadeIsolation(
  page: Page,
  id: string,
  checkboxFocusContract: CheckboxFocusContract,
): Promise<void> {
  const evidence = await page.evaluate((focusContract) => {
    const activeAnimations = (element: Element) => element
      .getAnimations({ subtree: true })
      .filter((animation) =>
        animation.playState !== "finished" && animation.playState !== "idle"
      )
      .map((animation) => ({
        currentTime: typeof animation.currentTime === "number"
          ? animation.currentTime
          : String(animation.currentTime),
        id: animation.id,
        playState: animation.playState,
        playbackRate: animation.playbackRate,
        startTime: typeof animation.startTime === "number"
          ? animation.startTime
          : String(animation.startTime),
        type: animation.constructor.name,
      }));
    const root = document.createElement("div");
    root.dataset.galleryCheckboxFieldLayerConflict = "true";
    root.setAttribute("aria-hidden", "true");
    const control = document.createElement("div");
    control.dataset.slot = "checkbox-control";
    control.classList.add(...focusContract.classNames);
    root.append(control);
    document.body.append(root);
    try {
      const style = getComputedStyle(control);
      const colorProbe = document.createElement("div");
      colorProbe.style.setProperty("outline-color", "var(--ui-ring)");
      document.body.append(colorProbe);
      const expectedOutlineColor = getComputedStyle(colorProbe).outlineColor;
      colorProbe.remove();
      const controlClassNames = [...control.classList];
      return {
        activeAnimations: activeAnimations(control),
        controlClassNames,
        expectedOutlineColor,
        missingFocusClassNames: focusContract.classNames.filter(
          (className) => !controlClassNames.includes(className),
        ),
        outlineColor: style.outlineColor,
        outlineOffset: Number.parseFloat(style.outlineOffset),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    } finally {
      root.remove();
    }
  }, checkboxFocusContract);
  const diagnostics = JSON.stringify({
    ...evidence,
    expectedFocusRules: checkboxFocusContract.rules,
  });
  invariant(
    evidence.missingFocusClassNames.length === 0,
    `${id}: the non-React CheckboxField cascade canary is missing focus classes: ${diagnostics}`,
  );
  invariant(
    evidence.outlineColor === evidence.expectedOutlineColor
    && evidence.outlineOffset === 3
    && evidence.outlineStyle === "solid"
    && evidence.outlineWidth === 2,
    `${id}: the non-React CheckboxField focus classes do not win the final cascade: ${diagnostics}`,
  );
}

async function verifyKeyboardPath(
  page: Page,
  id: string,
  checkboxFocusContract: CheckboxFocusContract,
): Promise<void> {
  await page.keyboard.press("Tab");
  const skipLink = page.locator('[data-slot="skip-link"]');
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-slot="skip-link"]');
    if (!(element instanceof HTMLElement)) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return document.activeElement === element
      && element.matches(":focus-visible")
      && box.bottom > 0
      && box.right > 0
      && box.left < document.documentElement.clientWidth
      && box.top < document.documentElement.clientHeight
      && Number.parseFloat(style.opacity) > 0
      && style.visibility === "visible";
  }, undefined, { timeout: 1_000 }).catch(() => undefined);
  const skipLinkFocus = await skipLink.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const activeElement = document.activeElement;
    return {
      activeElement:
        activeElement instanceof Element
          ? `${activeElement.tagName.toLowerCase()}#${activeElement.id}[data-slot=${activeElement.getAttribute("data-slot") ?? ""}]`
          : "none",
      box: {
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        top: box.top,
      },
      documentHasFocus: document.hasFocus(),
      focusVisible:
        document.activeElement === element && element.matches(":focus-visible"),
      intersectsViewport:
        box.bottom > 0
        && box.right > 0
        && box.left < document.documentElement.clientWidth
        && box.top < document.documentElement.clientHeight,
      opacity: Number.parseFloat(style.opacity),
      transform: style.transform,
      transitionDuration: style.transitionDuration,
      transitionProperty: style.transitionProperty,
      visibility: style.visibility,
    };
  });
  invariant(
    skipLinkFocus.focusVisible
    && skipLinkFocus.intersectsViewport
    && skipLinkFocus.opacity > 0
    && skipLinkFocus.visibility === "visible",
    `${id}: the first keyboard stop is not the visible skip link: ${JSON.stringify(skipLinkFocus)}`,
  );
  await page.keyboard.press("Enter");
  invariant(
    await page.locator("#primitive-gallery-main").evaluate((element) =>
      document.activeElement === element),
    `${id}: the skip link did not focus the main landmark`,
  );

  await page.keyboard.press("Tab");
  const themeButton = page.getByRole("button", { name: "Use dark theme" });
  invariant(
    await themeButton.evaluate((element) =>
      document.activeElement === element
      && element.matches(":focus-visible")
      && element.hasAttribute("data-focus-visible")),
    `${id}: the theme action did not receive keyboard focus visibility`,
  );
  const focusOutline = await themeButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  invariant(
    focusOutline.style !== "none" && focusOutline.width >= 2,
    `${id}: the focused action has no visible outline`,
  );
  await page.keyboard.press("Enter");
  await page.locator('html[data-theme="dark"]').waitFor();
  invariant(
    await page.getByRole("button", { name: "Use light theme" }).count() === 1,
    `${id}: the keyboard theme action did not update its accessible name`,
  );

  await page.keyboard.press("Tab");
  const primaryAction = page.getByRole("button", { name: "Run primitive check" });
  invariant(
    await primaryAction.evaluate((element) => document.activeElement === element),
    `${id}: the primary action is not next in keyboard order`,
  );
  await page.keyboard.press("Enter");
  await page.getByText("Runs: 1", { exact: true }).waitFor();

  await page.keyboard.press("Tab");
  const checkbox = page.getByRole("checkbox", { name: "Preserve accessible interaction" });
  invariant(
    await checkbox.evaluate((element) => document.activeElement === element),
    `${id}: the checkbox is not reachable after the action`,
  );
  const checkboxFocus = await checkbox.evaluate((element, focusClassNames) => {
    const control = element.closest('[data-slot="checkbox-control"]');
    if (!(control instanceof HTMLLabelElement)) {
      throw new Error("The focused checkbox control label is missing");
    }
    const style = getComputedStyle(control);
    const controlClassNames = [...control.classList];
    const colorProbe = document.createElement("div");
    colorProbe.style.setProperty("outline-color", "var(--ui-ring)");
    document.body.append(colorProbe);
    const expectedOutlineColor = getComputedStyle(colorProbe).outlineColor;
    colorProbe.remove();
    return {
      activeAnimations: control.getAnimations({ subtree: true })
        .filter((animation) =>
          animation.playState !== "finished" && animation.playState !== "idle"
        )
        .map((animation) => ({
          currentTime: typeof animation.currentTime === "number"
            ? animation.currentTime
            : String(animation.currentTime),
          id: animation.id,
          playState: animation.playState,
          playbackRate: animation.playbackRate,
          startTime: typeof animation.startTime === "number"
            ? animation.startTime
            : String(animation.startTime),
          type: animation.constructor.name,
        })),
      controlClassNames,
      dataFocusVisible: control.dataset.focusVisible ?? "",
      expectedOutlineColor,
      missingFocusClassNames: focusClassNames.filter(
        (className) => !controlClassNames.includes(className),
      ),
      nativeFocusVisible: element.matches(":focus-visible"),
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  }, checkboxFocusContract.classNames);
  const checkboxFocusDiagnostics = JSON.stringify({
    ...checkboxFocus,
    expectedFocusRules: checkboxFocusContract.rules,
  });
  invariant(
    checkboxFocus.missingFocusClassNames.length === 0,
    `${id}: CheckboxField focus classes are missing from the rendered control: ${checkboxFocusDiagnostics}`,
  );
  invariant(
    checkboxFocus.dataFocusVisible === "true"
    && checkboxFocus.nativeFocusVisible
    && checkboxFocus.outlineColor === checkboxFocus.expectedOutlineColor
    && checkboxFocus.outlineOffset === 3
    && checkboxFocus.outlineStyle === "solid"
    && checkboxFocus.outlineWidth === 2,
    `${id}: CheckboxField focus classes do not win the final cascade: ${checkboxFocusDiagnostics}`,
  );
  await page.keyboard.press("Space");
  invariant(await checkbox.isChecked(), `${id}: Space did not select the native checkbox`);
  await page.keyboard.press("Space");
  invariant(!await checkbox.isChecked(), `${id}: Space did not restore the native checkbox`);

  await page.keyboard.press("Tab");
  const selectTrigger = page.locator(
    '[data-gallery-select="true"] .hraness-select-field__trigger',
  );
  invariant(
    await selectTrigger.evaluate((element) => document.activeElement === element),
    `${id}: the compact select is not reachable after the checkbox`,
  );

  await page.keyboard.press("Tab");
  const semanticsTab = page.getByRole("tab", { name: "Semantics" });
  invariant(
    await semanticsTab.evaluate((element) => document.activeElement === element),
    `${id}: the selected tab is not in the keyboard path`,
  );
  await page.keyboard.press("ArrowRight");
  const statesTab = page.getByRole("tab", { name: "States" });
  invariant(
    await statesTab.getAttribute("aria-selected") === "true",
    `${id}: ArrowRight did not select States`,
  );
  invariant(
    await statesTab.evaluate((element) =>
      document.activeElement === element
      && element.matches(":focus-visible")
      && element.hasAttribute("data-focus-visible")),
    `${id}: ArrowRight did not move visible keyboard focus to States`,
  );
  invariant(
    await page.getByText(
      "Stable data attributes expose interaction state without generated selectors.",
      { exact: true },
    ).isVisible(),
    `${id}: the selected tab panel is not visible`,
  );
}

async function verifyPressableCardCallerStatePrecedence(
  page: Page,
  id: string,
): Promise<void> {
  const selector = '[data-gallery-card-family-override="pressable"]';
  const pressableCard = page.locator(selector);
  let reachedThroughKeyboard = false;

  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    reachedThroughKeyboard = await pressableCard.evaluate(
      (element) => document.activeElement === element,
    );
    if (reachedThroughKeyboard) break;
  }

  invariant(
    reachedThroughKeyboard,
    `${id}: the caller-override PressableCard was not reachable by keyboard`,
  );
  await page.waitForFunction((targetSelector) => {
    const element = document.querySelector(targetSelector);
    return element instanceof HTMLButtonElement
      && document.activeElement === element
      && element.matches(":focus-visible")
      && element.hasAttribute("data-focus-visible");
  }, selector);

  const focused = await pressableCard.evaluate((element) => {
    const resolveColor = (value: string): string => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(element);
    return {
      dataFocusVisible: element.hasAttribute("data-focus-visible"),
      expectedWarning: resolveColor("var(--ui-warning)"),
      focusVisible: element.matches(":focus-visible"),
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  invariant(
    focused.dataFocusVisible
    && focused.focusVisible
    && focused.outlineColor === focused.expectedWarning
    && focused.outlineOffset === 7
    && focused.outlineStyle === "solid"
    && focused.outlineWidth === 4,
    `${id}: caller StyleX lost to the PressableCard focus-visible recipe: ${JSON.stringify(focused)}`,
  );

  await pressableCard.hover();
  await page.waitForFunction((targetSelector) => {
    const element = document.querySelector(targetSelector);
    return element instanceof HTMLButtonElement
      && element.matches(":hover")
      && element.hasAttribute("data-hovered");
  }, selector);
  const hovered = await pressableCard.evaluate((element) => {
    const resolveColor = (value: string): string => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      dataHovered: element.hasAttribute("data-hovered"),
      expectedPrimary: resolveColor("var(--ui-primary)"),
      hovered: element.matches(":hover"),
      transform: style.transform,
    };
  });
  invariant(
    hovered.dataHovered
    && hovered.hovered
    && hovered.borderColor === hovered.expectedPrimary
    && hovered.boxShadow === "none"
    && hovered.transform === "none",
    `${id}: caller StyleX lost to the PressableCard hover recipe: ${JSON.stringify(hovered)}`,
  );

  let pressed: Readonly<{
    active: boolean;
    dataPressed: boolean;
    transform: string;
  }>;
  await page.mouse.down();
  try {
    await page.waitForFunction((targetSelector) => {
      const element = document.querySelector(targetSelector);
      return element instanceof HTMLButtonElement
        && element.matches(":active")
        && element.hasAttribute("data-pressed");
    }, selector);
    pressed = await pressableCard.evaluate((element) => ({
      active: element.matches(":active"),
      dataPressed: element.hasAttribute("data-pressed"),
      transform: getComputedStyle(element).transform,
    }));
  } finally {
    await page.mouse.up();
  }
  invariant(
    pressed.active && pressed.dataPressed && pressed.transform === "none",
    `${id}: caller StyleX lost to the PressableCard active recipe: ${JSON.stringify(pressed)}`,
  );

  await pressableCard.evaluate((element) => element.blur());
  await page.mouse.move(0, 0);
  await page.waitForFunction((targetSelector) => {
    const element = document.querySelector(targetSelector);
    return element instanceof HTMLButtonElement
      && document.activeElement !== element
      && !element.hasAttribute("data-focus-visible")
      && !element.hasAttribute("data-hovered")
      && !element.hasAttribute("data-pressed");
  }, selector);
}

async function verifyToolbarKeyboardFocusPrecedence(
  page: Page,
  id: string,
): Promise<void> {
  const nativeSelector = '[data-gallery-toolbar-native-focus="true"]';
  const overrideSelector = '[data-gallery-toolbar-override="true"]';
  const nativeToolbar = page.locator(nativeSelector);
  const overrideToolbar = page.locator(overrideSelector);

  await Promise.all([
    nativeToolbar.evaluate((element) => {
      element.tabIndex = 0;
    }),
    overrideToolbar.evaluate((element) => {
      element.tabIndex = 0;
    }),
  ]);

  async function reachByKeyboard(
    toolbar: ReturnType<Page["locator"]>,
    selector: string,
    description: string,
  ): Promise<void> {
    let reached = false;
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      reached = await toolbar.evaluate(
        (element) => document.activeElement === element,
      );
      if (reached) break;
    }
    invariant(reached, `${id}: ${description} was not reachable by keyboard`);
    await page.waitForFunction((selector) => {
      const element = document.querySelector(selector);
      return element instanceof HTMLDivElement
        && document.activeElement === element
        && element.matches(":focus-visible");
    }, selector);
  }

  async function settleFocusPresentation(
    selector: string,
    expectedColor: string,
    expectedOffset: number,
    expectedStyle: string,
    expectedWidth: number,
  ): Promise<void> {
    await page.waitForFunction(
      (contract) => {
        const element = document.querySelector(contract.selector);
        if (!(element instanceof HTMLDivElement)) return false;
        const probe = document.createElement("span");
        probe.style.color = contract.expectedColor;
        document.body.append(probe);
        const resolvedColor = getComputedStyle(probe).color;
        probe.remove();
        const style = getComputedStyle(element);
        return document.activeElement === element
          && element.matches(":focus-visible")
          && style.outlineColor === resolvedColor
          && Number.parseFloat(style.outlineOffset) === contract.expectedOffset
          && style.outlineStyle === contract.expectedStyle
          && Number.parseFloat(style.outlineWidth) === contract.expectedWidth;
      },
      {
        expectedColor,
        expectedOffset,
        expectedStyle,
        expectedWidth,
        selector,
      },
      { polling: "raf", timeout: 2_000 },
    ).catch(() => undefined);
  }

  await reachByKeyboard(
    nativeToolbar,
    nativeSelector,
    "the native-focus Toolbar",
  );
  await settleFocusPresentation(
    nativeSelector,
    "var(--ui-ring)",
    2,
    "solid",
    2,
  );
  const nativeFocused = await nativeToolbar.evaluate((element) => {
    const matchedFocusRules: string[] = [];
    const visitRules = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes(":focus-visible")) {
            try {
              if (element.matches(rule.selectorText)) {
                matchedFocusRules.push(
                  `${rule.selectorText} { ${rule.style.cssText} }`,
                );
              }
            } catch {
              // Ignore selectors the browser cannot evaluate in isolation.
            }
          }
          continue;
        }
        if ("cssRules" in rule) {
          visitRules((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const stylesheet of document.styleSheets) {
      try {
        visitRules(stylesheet.cssRules);
      } catch {
        // All gallery stylesheets are same-origin; retain diagnostics if that changes.
      }
    }
    const resolveColor = (value: string): string => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(element);
    return {
      className: element.className,
      expectedRing: resolveColor("var(--ui-ring)"),
      focusVisible: element.matches(":focus-visible"),
      matchedFocusRules,
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  invariant(
    nativeFocused.focusVisible
    && nativeFocused.outlineColor === nativeFocused.expectedRing
    && nativeFocused.outlineOffset === 2
    && nativeFocused.outlineStyle === "solid"
    && nativeFocused.outlineWidth === 2,
    `${id}: the native Toolbar focus fallback changed: ${JSON.stringify(nativeFocused)}`,
  );

  await reachByKeyboard(
    overrideToolbar,
    overrideSelector,
    "the caller-override Toolbar",
  );
  await settleFocusPresentation(
    overrideSelector,
    "var(--ui-warning)",
    7,
    "dashed",
    4,
  );
  const overrideFocused = await overrideToolbar.evaluate((element) => {
    const resolveColor = (value: string): string => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const style = getComputedStyle(element);
    return {
      expectedWarning: resolveColor("var(--ui-warning)"),
      focusVisible: element.matches(":focus-visible"),
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  invariant(
    overrideFocused.focusVisible
    && overrideFocused.outlineColor === overrideFocused.expectedWarning
    && overrideFocused.outlineOffset === 7
    && overrideFocused.outlineStyle === "dashed"
    && overrideFocused.outlineWidth === 4,
    `${id}: caller StyleX lost Toolbar keyboard-focus precedence: ${JSON.stringify(overrideFocused)}`,
  );

  await overrideToolbar.evaluate((element) => {
    element.blur();
    element.removeAttribute("tabindex");
  });
  await nativeToolbar.evaluate((element) => element.removeAttribute("tabindex"));
}

async function forcedColorsEvidence(page: Page): Promise<ForcedColorsEvidence> {
  return page.evaluate(() => {
    const button = document.querySelector('[data-gallery-primary-action="true"][data-slot="button-control"]');
    const card = document.querySelector('[data-gallery-icon-card="true"]');
    const selectedTab = document.querySelector('[data-slot="tab"][data-selected]');
    const selectedSegment = document.querySelector(
      '.gallery-segmented-control .hraness-segmented-control__item[data-selected]',
    );
    const spinner = document.querySelector('[data-slot="spinner"]');
    const keyHint = document.querySelector('[data-gallery-key-hint="default"]');
    const statusPills = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-gallery-badge-tone], [data-gallery-tag-variant], [data-gallery-status-family-override="badge"], [data-gallery-status-family-override="tag"]',
      ),
    ];
    const statusDots = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-gallery-status-dot-tone], [data-gallery-status-family-override="dot"]',
      ),
    ];
    const cardFamily = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-gallery-card-tone], [data-gallery-pressable-card-tone], [data-gallery-card-family-override], [data-gallery-card-class-variable]',
      ),
    ];
    const checkboxIndicators = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-gallery-checkbox] [data-slot="checkbox-indicator"]',
      ),
    ];
    if (
      !(button instanceof HTMLElement)
      || !(card instanceof HTMLElement)
      || !(selectedTab instanceof HTMLElement)
      || !(selectedSegment instanceof HTMLElement)
      || !(spinner instanceof HTMLElement)
      || !(keyHint instanceof HTMLElement)
      || statusPills.length !== 10
      || statusDots.length !== 6
      || cardFamily.length !== 11
      || checkboxIndicators.length !== 2
    ) {
      throw new Error("The forced-colors gallery structure is incomplete.");
    }

    const normalize = (property: "backgroundColor" | "color", value: string): string => {
      const probe = document.createElement("span");
      probe.style[property] = value;
      document.body.append(probe);
      const normalized = getComputedStyle(probe)[property];
      probe.remove();
      return normalized;
    };
    const buttonStyle = getComputedStyle(button);
    const cardStyle = getComputedStyle(card);
    const tabStyle = getComputedStyle(selectedTab);
    const segmentStyle = getComputedStyle(selectedSegment);
    const keyHintStyle = getComputedStyle(keyHint);
    const canvas = normalize("backgroundColor", "Canvas");
    const canvasText = normalize("color", "CanvasText");
    const statusPillEvidence = statusPills.map((pill) => {
      const style = getComputedStyle(pill);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        forcedColorAdjust: style.forcedColorAdjust,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        slot: pill.dataset.slot ?? "",
      };
    });
    const statusDotEvidence = statusDots.map((dot) => {
      const style = getComputedStyle(dot);
      const box = dot.getBoundingClientRect();
      return {
        ariaHidden: dot.getAttribute("aria-hidden") ?? "",
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        height: box.height,
        layerSentinel: style
          .getPropertyValue("--gallery-status-family-layer-conflict")
          .trim(),
        width: box.width,
      };
    });
    const cardFamilyEvidence = cardFamily.map((element) => {
      const style = getComputedStyle(element);
      return {
        borderColor: style.borderColor,
        forcedColorAdjust: style.forcedColorAdjust,
        layerSentinel: style
          .getPropertyValue("--gallery-card-family-layer-conflict")
          .trim(),
        publicDescription: style
          .getPropertyValue("--hraness-card-description")
          .trim(),
        slot: element.dataset.slot ?? "",
      };
    });
    const checkboxEvidence = checkboxIndicators.map((indicator) => {
      const field = indicator.closest('[data-gallery-checkbox]');
      const style = getComputedStyle(indicator);
      const box = indicator.getBoundingClientRect();
      if (!(field instanceof HTMLDivElement)) {
        throw new Error("The forced-colors CheckboxField root is missing");
      }
      return {
        borderColor: style.borderColor,
        borderStyle: style.borderStyle,
        borderWidth: Number.parseFloat(style.borderWidth),
        forcedColorAdjust: style.forcedColorAdjust,
        height: box.height,
        kind: field.dataset.galleryCheckbox ?? "",
        layerSentinel: getComputedStyle(field)
          .getPropertyValue("--gallery-checkbox-field-layer-conflict")
          .trim(),
        width: box.width,
      };
    });
    return {
      buttonBackground: buttonStyle.backgroundColor,
      buttonFace: normalize("backgroundColor", "ButtonFace"),
      buttonText: normalize("color", "ButtonText"),
      buttonTextColor: buttonStyle.color,
      canvasText,
      cardBorderColor: cardStyle.borderColor,
      cardForcedColorAdjust: cardStyle.forcedColorAdjust,
      cardFamilyContracts: cardFamilyEvidence.every(
        (item) =>
          item.borderColor === canvasText
          && item.forcedColorAdjust === "auto"
          && item.layerSentinel === "legacy"
          && item.publicDescription.length > 0
          && (item.slot === "card" || item.slot === "pressable-card"),
      ),
      cardFamilyDiagnostics: JSON.stringify({
        canvasText,
        items: cardFamilyEvidence,
      }),
      checkboxContracts: checkboxEvidence.every(
        (checkbox) =>
          checkbox.borderColor === canvasText
          && checkbox.borderStyle === "solid"
          && checkbox.borderWidth === 1
          && checkbox.forcedColorAdjust === "auto"
          && checkbox.height === 20
          && (checkbox.kind === "default" || checkbox.kind === "override")
          && checkbox.layerSentinel === "legacy"
          && checkbox.width === 20,
      ),
      checkboxDiagnostics: JSON.stringify({
        canvasText,
        checkboxes: checkboxEvidence,
      }),
      forcedColorsActive: matchMedia("(forced-colors: active)").matches,
      keyHintContracts:
        keyHint.tagName === "KBD"
        && keyHint.dataset.slot === "key-hint"
        && keyHintStyle.borderBlockEndWidth === "2px"
        && keyHintStyle.borderBottomStyle === "solid"
        && keyHintStyle.borderBottomColor === canvasText
        && keyHintStyle.color === canvasText
        && keyHintStyle.display === "inline-flex"
        && keyHintStyle.forcedColorAdjust === "auto"
        && keyHintStyle
          .getPropertyValue("--gallery-key-hint-layer-conflict")
          .trim() === "legacy",
      keyHintDiagnostics: JSON.stringify({
        borderBlockEndWidth: keyHintStyle.borderBlockEndWidth,
        borderBottomColor: keyHintStyle.borderBottomColor,
        borderBottomStyle: keyHintStyle.borderBottomStyle,
        color: keyHintStyle.color,
        display: keyHintStyle.display,
        forcedColorAdjust: keyHintStyle.forcedColorAdjust,
      }),
      selectedTabBackground: tabStyle.backgroundColor,
      selectedTabColor: tabStyle.color,
      selectedSegmentBackground: segmentStyle.backgroundColor,
      selectedSegmentColor: segmentStyle.color,
      spinnerAnimationName: getComputedStyle(spinner).animationName,
      statusFamilyContracts:
        statusPillEvidence.every(
          (pill) =>
            pill.borderColor === canvasText
            && pill.forcedColorAdjust === "auto"
            && pill.layerSentinel === "legacy"
            && (pill.slot === "badge" || pill.slot === "tag"),
        )
        && statusDotEvidence.every(
          (dot) =>
            dot.ariaHidden === "true"
            && dot.backgroundColor === canvas
            && dot.borderColor === canvasText
            && dot.height >= 10
            && dot.layerSentinel === "legacy"
            && dot.width >= 10,
        ),
      statusFamilyDiagnostics: JSON.stringify({
        canvas,
        canvasText,
        dots: statusDotEvidence,
        pills: statusPillEvidence,
      }),
    };
  });
}

async function checkboxCoarsePointerEvidence(page: Page) {
  return page.evaluate(() => {
    const field = document.querySelector('[data-gallery-checkbox="default"]');
    const control = field?.querySelector('[data-slot="checkbox-control"]');
    const indicator = field?.querySelector('[data-slot="checkbox-indicator"]');
    if (
      !(field instanceof HTMLDivElement)
      || !(control instanceof HTMLLabelElement)
      || !(indicator instanceof HTMLSpanElement)
    ) {
      throw new Error("The coarse-pointer CheckboxField fixture is incomplete");
    }
    const controlStyle = getComputedStyle(control);
    const indicatorBox = indicator.getBoundingClientRect();
    return {
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      controlMinHeight: Number.parseFloat(controlStyle.minHeight),
      indicatorHeight: indicatorBox.height,
      indicatorWidth: indicatorBox.width,
      verificationOverride:
        document.documentElement.dataset.verificationPointer ?? "",
    };
  });
}

function startGalleryServer(directory: string, requestedPaths: Set<string>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      requestedPaths.add(pathname);
      if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
      const name = pathname === "/" ? "index.html" : basename(pathname);
      if (pathname !== "/" && pathname !== `/${name}`) {
        return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(join(directory, name));
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      const type = name.endsWith(".css")
        ? "text/css"
        : name.endsWith(".js")
          ? "text/javascript"
          : "text/html";
      return new Response(file, { headers: { "content-type": `${type}; charset=utf-8` } });
    },
  });
}

assert.equal(
  Bun.version,
  BUN_VERSION,
  `primitive gallery browser test requires Bun ${BUN_VERSION}`,
);

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-ui-primitive-gallery-"));
const temporary = resolve(work, "tmp");
const consumer = resolve(work, "consumer");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  NODE_ENV: "production",
  TMPDIR: temporary,
};

try {
  await Promise.all([
    mkdir(temporary, { mode: 0o700 }),
    mkdir(consumer),
  ]);
  const archive = resolve(work, "hraness-ui.tgz");
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository, environment);

  await writeFile(resolve(consumer, "package.json"), `${JSON.stringify({
    name: "hraness-ui-primitive-gallery-consumer",
    private: true,
    type: "module",
    dependencies: {
      "@hugeicons/core-free-icons": HUGEICONS_VERSION,
      "@hraness/ui": `file:${archive}`,
      react: REACT_VERSION,
      "react-dom": REACT_VERSION,
    },
  }, null, 2)}\n`);
  await run([process.execPath, "install", "--ignore-scripts"], consumer, environment);
  await cp(resolve(repository, "gallery"), resolve(consumer, "gallery"), {
    recursive: true,
  });

  const installedRoot = resolve(consumer, "node_modules/@hraness/ui");
  const repositoryManifest = JSON.parse(
    await readFile(resolve(repository, "package.json"), "utf8"),
  ) as { version?: unknown };
  invariant(
    typeof repositoryManifest.version === "string" && repositoryManifest.version.length > 0,
    "the repository package version is missing",
  );
  const installedManifest = JSON.parse(
    await readFile(resolve(installedRoot, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
    name?: unknown;
    version?: unknown;
  };
  assert.equal(installedManifest.name, "@hraness/ui");
  assert.equal(installedManifest.version, repositoryManifest.version);
  assert.equal(installedManifest.exports?.["./styles.css"], "./src/styles.css");
  assert.equal(installedManifest.exports?.["./stylex.css"], "./dist/stylex.css");
  const installedHugeiconsManifest = JSON.parse(
    await readFile(
      resolve(consumer, "node_modules/@hugeicons/core-free-icons/package.json"),
      "utf8",
    ),
  ) as { version?: unknown };
  assert.equal(installedHugeiconsManifest.version, HUGEICONS_VERSION);
  await Promise.all([
    access(resolve(installedRoot, "src/styles.css")),
    access(resolve(installedRoot, "dist/stylex.css")),
    access(resolve(installedRoot, "src/checkbox-field.stylex.ts")),
  ]);
  await assert.rejects(
    access(resolve(installedRoot, "gallery/styles.css")),
    /ENOENT/u,
    "the gallery conflict sentinel must stay outside the packed package",
  );
  const installedPackageCss = (
    await Promise.all([
      readFile(resolve(installedRoot, "src/components.css"), "utf8"),
      readFile(resolve(installedRoot, "src/styles.css"), "utf8"),
      readFile(resolve(installedRoot, "dist/stylex.css"), "utf8"),
    ])
  ).join("\n");
  assert.doesNotMatch(
    installedPackageCss,
    /data-gallery-(?:stylex-layer-conflict|quiet-site-(?:layer|priority3)-conflict|(?:avatar|card-family|checkbox-field|key-hint|status-family|themed-surface|toolbar|viewport-frame|wrapping-row)-layer-conflict)/u,
    "gallery conflict sentinels must not enter package CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate quiet-site declarations in legacy CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate structural-surface declarations in legacy CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-avatar(?:__image|__fallback)?(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate Avatar declarations in legacy CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-(?:badge(?:--(?:info|success|warning|danger|accent|positive|caution|critical))?|tag(?:__icon|__label)?|status-dot(?:--(?:info|success|warning|danger))?)(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate status-family declarations in legacy CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-key-hint(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate KeyHint declarations in legacy CSS",
  );
  assert.doesNotMatch(
    installedPackageCss,
    /\.hraness-checkbox-field(?:__(?:control|indicator|label))?(?![A-Za-z0-9_-])/u,
    "the packed package must not duplicate CheckboxField declarations in legacy CSS",
  );

  const productionDirectory = resolve(consumer, "dist/browser");
  const negativeDirectory = resolve(consumer, "dist/unstyled-negative-control");
  const serverRendererDirectory = resolve(consumer, "dist/server-renderer");
  const [production, negativeControl, serverRenderer] = await Promise.all([
    buildBrowserEntry(consumer, "gallery/client.tsx", productionDirectory),
    buildBrowserEntry(consumer, "gallery/unstyled-client.tsx", negativeDirectory),
    buildServerRenderer(consumer, serverRendererDirectory),
  ]);
  requirePackedDefaultStylesheet(production.css, production.javaScript);
  const checkboxFocusContract = requirePackedCheckboxFocusContract(
    production.javaScript,
    production.css,
  );
  assert.throws(
    () => requirePackedDefaultStylesheet(
      negativeControl.css,
      negativeControl.javaScript,
    ),
    /must keep reset styles below components/u,
    "the stylesheet delivery oracle must reject the unstyled negative-control consumer",
  );
  assert.match(production.javaScript, /__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__/u);
  assert.match(production.javaScript, /hydrateRoot/u);
  assert.doesNotMatch(
    negativeControl.css,
    /(?:height|width):\s*(?:100%|2\.5rem|3\.5rem)/u,
    "the unstyled negative control must not accidentally receive package Avatar priority3 CSS",
  );
  await rm(negativeDirectory, { force: true, recursive: true });
  assert.equal(await Bun.file(negativeControl.cssPath).exists(), false);
  assert.equal(await Bun.file(negativeControl.javaScriptPath).exists(), false);

  const clientName = basename(production.javaScriptPath);
  const stylesheetName = basename(production.cssPath);
  const servedClientPath = resolve(productionDirectory, clientName);
  const servedStylesheetPath = resolve(productionDirectory, stylesheetName);
  await Promise.all([
    production.javaScriptPath === servedClientPath
      ? Promise.resolve()
      : cp(production.javaScriptPath, servedClientPath),
    production.cssPath === servedStylesheetPath
      ? Promise.resolve()
      : cp(production.cssPath, servedStylesheetPath),
  ]);
  await run([
    process.execPath,
    serverRenderer,
    stylesheetName,
    clientName,
  ], consumer, environment);
  const htmlPath = resolve(consumer, "dist/index.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /data-gallery-hydration-root="true"/u);
  assert.match(html, /data-gallery-icon-canary="true"/u);
  assert.match(html, /data-gallery-icon-wrapper-canary="true"/u);
  assert.match(html, /data-slot="icon"/u);
  assert.match(html, /data-social-icon="github"/u);
  assert.match(html, /data-social-icon="substack"/u);
  assert.match(html, /data-appearance-icon="system"/u);
  assert.match(html, /data-gallery-quiet-site-layer-conflict="true"/u);
  assert.match(html, /data-gallery-quiet-site-page="true"/u);
  assert.match(html, /data-gallery-quiet-site-priority3-conflict="true"/u);
  assert.match(html, /data-gallery-quiet-site-footer="true"/u);
  assert.match(html, /data-slot="quiet-site-page"/u);
  assert.match(html, /data-slot="quiet-site-footer"/u);
  assert.match(html, /data-gallery-wrapping-row-layer-conflict="true"/u);
  assert.match(html, /data-gallery-wrapping-row="true"/u);
  assert.match(html, /data-slot="wrapping-row"/u);
  assert.match(html, /data-gallery-viewport-frame-layer-conflict="true"/u);
  assert.match(html, /data-gallery-viewport-frame="true"/u);
  assert.match(html, /data-slot="viewport-frame"/u);
  assert.match(html, /data-gallery-select="true"/u);
  assert.match(html, /data-slot="select-field-indicator"/u);
  assert.match(html, /data-gallery-themed-surface-tone="card"/u);
  assert.match(html, /data-gallery-themed-surface-tone="accent"/u);
  assert.match(html, /data-gallery-themed-surface-tone="secondary"/u);
  assert.match(html, /data-gallery-themed-surface-tone="popover"/u);
  assert.match(html, /data-gallery-themed-surface-tone="inverse"/u);
  assert.match(html, /data-gallery-themed-surface-texture="true"/u);
  assert.match(html, /data-gallery-themed-surface-layer-conflict="true"/u);
  assert.match(html, /data-slot="themed-surface"/u);
  assert.match(html, /data-gallery-avatar-size="small"/u);
  assert.match(html, /data-gallery-avatar-size="default"/u);
  assert.match(html, /data-gallery-avatar-size="large"/u);
  assert.match(html, /data-gallery-avatar-image="true"/u);
  assert.match(html, /data-gallery-avatar-override="true"/u);
  assert.match(html, /data-gallery-avatar-layer-conflict="true"/u);
  assert.match(html, /data-slot="avatar"/u);
  assert.match(html, /data-slot="avatar-fallback"/u);
  assert.match(html, /data-slot="avatar-image"/u);
  assert.match(html, /src="data:image\/svg\+xml/u);
  assert.match(html, /data-gallery-badge-tone="neutral"/u);
  assert.match(html, /data-gallery-badge-tone="danger"/u);
  assert.match(html, /class="hraness-badge hraness-badge--success [^"]+gallery-badge gallery-badge--success"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /role="status"/u);
  assert.match(html, /data-gallery-tag-variant="default"/u);
  assert.match(html, /data-gallery-tag-variant="muted"/u);
  assert.match(html, /data-gallery-tag-variant="outline"/u);
  assert.match(html, /--hraness-tag-accent:#D97706/u);
  assert.match(html, /data-slot="tag-icon"/u);
  assert.match(html, /data-slot="tag-label"/u);
  assert.match(html, /data-gallery-status-dot-tone="neutral"/u);
  assert.match(html, /data-gallery-status-dot-tone="danger"/u);
  assert.match(html, /data-slot="status-dot"/u);
  assert.match(html, /data-gallery-status-family-layer-conflict="true"/u);
  assert.match(html, /data-gallery-status-family-override="badge"/u);
  assert.match(html, /data-gallery-status-family-override="tag"/u);
  assert.match(html, /data-gallery-status-family-override="dot"/u);
  assert.match(html, /data-gallery-toolbar-layer-conflict="true"/u);
  assert.match(html, /data-gallery-toolbar-orientation="horizontal"/u);
  assert.match(html, /data-gallery-toolbar-orientation="vertical"/u);
  assert.match(html, /data-gallery-toolbar-native-focus="true"/u);
  assert.match(html, /data-gallery-toolbar-override="true"/u);
  assert.match(html, /data-slot="toolbar"/u);
  assert.match(html, /role="toolbar"/u);
  assert.match(html, /aria-label="Horizontal editor actions"/u);
  assert.match(html, /aria-labelledby="gallery-vertical-toolbar-name"/u);
  assert.match(html, /data-gallery-key-hint="default"/u);
  assert.match(html, /data-gallery-key-hint="override"/u);
  assert.match(html, /data-gallery-key-hint-layer-conflict="true"/u);
  assert.match(html, /data-slot="key-hint"/u);
  assert.match(html, /class="hraness-key-hint [^"]+gallery-key-hint gallery-key-hint--default"/u);
  assert.match(html, /aria-label="Escape"/u);
  assert.match(html, />⌘K<\/kbd>/u);
  assert.match(html, new RegExp(`href="/${stylesheetName.replace(".", "\\.")}"`, "u"));
  assert.match(html, new RegExp(`src="/${clientName.replace(".", "\\.")}"`, "u"));
  await cp(htmlPath, resolve(productionDirectory, "index.html"));

  const counterfactualDocumentName = "priority3-before-legacy.html";
  const counterfactualStylesheetName = "priority3-before-legacy.css";
  const counterfactualDocumentPath = resolve(
    productionDirectory,
    counterfactualDocumentName,
  );
  const counterfactualStylesheetPath = resolve(
    productionDirectory,
    counterfactualStylesheetName,
  );
  const counterfactualHtml = html.replace(
    `href="/${stylesheetName}"`,
    `href="/${counterfactualStylesheetName}"`,
  );
  assert.notEqual(counterfactualHtml, html);
  await Promise.all([
    writeFile(counterfactualDocumentPath, counterfactualHtml),
    writeFile(
      counterfactualStylesheetPath,
      placePriority3BeforeLegacy(production.css),
    ),
  ]);

  const requestedPaths = new Set<string>();
  const server = startGalleryServer(productionDirectory, requestedPaths);
  let browserClosed = false;
  try {
    const executablePath = await firstExecutable([
      ...(process.env.CHROMIUM_EXECUTABLE_PATH === undefined
        ? []
        : [process.env.CHROMIUM_EXECUTABLE_PATH]),
      chromium.executablePath(),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ]);
    const browser = await chromium.launch({
      args: ["--no-sandbox"],
      executablePath,
      headless: true,
    });
    try {
      const origin = `http://${server.hostname}:${String(server.port)}`;
      let productionPriority3PaddingTop: number | undefined;
      for (const layout of layouts) {
        const context = await browser.newContext(layout.context);
        try {
          const page = await context.newPage();
          const failures = attachDiagnostics(page);
          await page.goto(origin, { waitUntil: "networkidle" });
          await waitForHydration(page, failures, requestedPaths, layout.id);

          const light = await browserEvidence(page);
          const lightSelect = await selectFieldIndicatorEvidence(page);
          verifySelectFieldIndicator(lightSelect, layout.id);
          const lightSegmented = await segmentedControlEvidence(page);
          verifySegmentedControlRecipe(lightSegmented, layout.id);
          invariant(light.heading === "Portable component behavior and presentation", `${layout.id}: heading changed`);
          invariant(light.hydrationStarted && light.rootHydrated, `${layout.id}: hydration did not settle`);
          invariant(light.recoverableErrors.length === 0, `${layout.id}: hydration recovered from ${light.recoverableErrors.join("; ")}`);
          invariant(light.mainPresent && light.footerPresent, `${layout.id}: landmark structure changed`);
          invariant(
            light.pageClassIsSemantic
            && light.pageHasGeneratedClass
            && light.pageCallerClassLast
            && light.footerClassIsSemantic
            && light.footerHasGeneratedClass
            && light.footerCallerClassLast,
            `${layout.id}: quiet-site semantic or generated class ordering changed`,
          );
          const expectedPageWidth = Math.min(light.clientWidth, 36 * 16);
          const expectedFooterWidth = Math.min(light.clientWidth, 35 * 16);
          const expectedPageInlineMargin = (light.clientWidth - expectedPageWidth) / 2;
          const expectedFooterInlineMargin = (light.clientWidth - expectedFooterWidth) / 2;
          const viewportHeight = layout.context.viewport.height;
          const expectedPageMarginStart = Math.min(
            4 * 16,
            Math.max(2 * 16, viewportHeight * 0.06),
          );
          const expectedPageMarginEnd = Math.min(
            6 * 16,
            Math.max(3.5 * 16, viewportHeight * 0.1),
          );
          invariant(
            nearlyEqual(light.pageWidth, expectedPageWidth)
            && nearlyEqual(light.footerWidth, expectedFooterWidth)
            && nearlyEqual(light.pageMaxInlineSize, 36 * 16)
            && nearlyEqual(light.footerMaxInlineSize, 35 * 16),
            `${layout.id}: quiet-site measure is page ${String(light.pageWidth)}/${String(light.pageMaxInlineSize)}, footer ${String(light.footerWidth)}/${String(light.footerMaxInlineSize)}`,
          );
          invariant(
            nearlyEqual(light.pageMarginInlineStart, expectedPageInlineMargin)
            && nearlyEqual(light.pageMarginInlineEnd, expectedPageInlineMargin)
            && nearlyEqual(light.footerMarginInlineStart, expectedFooterInlineMargin)
            && nearlyEqual(light.footerMarginInlineEnd, expectedFooterInlineMargin),
            `${layout.id}: quiet-site centering is page ${String(light.pageMarginInlineStart)}/${String(light.pageMarginInlineEnd)}, footer ${String(light.footerMarginInlineStart)}/${String(light.footerMarginInlineEnd)}`,
          );
          invariant(
            nearlyEqual(light.pageMarginBlockStart, expectedPageMarginStart)
            && nearlyEqual(light.pageMarginBlockEnd, expectedPageMarginEnd),
            `${layout.id}: quiet-site page margins are ${String(light.pageMarginBlockStart)}/${String(light.pageMarginBlockEnd)}`,
          );
          invariant(
            light.pageBoxSizing === "border-box"
            && light.pageFlex === "1 0 auto"
            && nearlyEqual(light.pagePaddingLeft, 1.5 * 16)
            && nearlyEqual(light.pagePaddingRight, 1.5 * 16),
            `${layout.id}: quiet-site page recipe is ${light.pageBoxSizing}; ${light.pageFlex}; ${String(light.pagePaddingLeft)}/${String(light.pagePaddingRight)}`,
          );
          invariant(
            light.footerBoxSizing === "border-box"
            && light.footerDisplay === "flex"
            && light.footerFlex === "0 0 auto"
            && light.footerFlexWrap === "wrap"
            && light.footerAlignItems === "center"
            && light.footerJustifyContent === "space-between"
            && nearlyEqual(light.footerGap, 16),
            `${layout.id}: quiet-site footer flex recipe is ${light.footerBoxSizing}; ${light.footerDisplay}; ${light.footerFlex}; ${light.footerFlexWrap}; ${light.footerAlignItems}; ${light.footerJustifyContent}; ${String(light.footerGap)}`,
          );
          invariant(
            light.footerOverflow === "clip"
            && nearlyEqual(light.footerMinInlineSize, 0)
            && light.footerBorderTopStyle === "solid"
            && nearlyEqual(light.footerBorderTopWidth, 1)
            && nearlyEqual(light.footerPaddingTop, 1.25 * 16)
            && light.footerPaddingBottom >= 1.25 * 16
            && nearlyEqual(light.footerPaddingLeft, 1.5 * 16)
            && nearlyEqual(light.footerPaddingRight, 1.5 * 16),
            `${layout.id}: quiet-site footer boundary recipe is ${light.footerOverflow}; ${String(light.footerMinInlineSize)}; ${light.footerBorderTopStyle} ${String(light.footerBorderTopWidth)}; padding ${String(light.footerPaddingTop)}/${String(light.footerPaddingRight)}/${String(light.footerPaddingBottom)}/${String(light.footerPaddingLeft)}`,
          );
          invariant(
            light.pageLegacyLayerSentinel === "legacy"
            && nearlyEqual(light.pageMaxInlineSize, 36 * 16),
            `${layout.id}: the matched quiet-site measure conflict resolved to ${String(light.pageMaxInlineSize)}`,
          );
          invariant(
            light.quietSitePriority3LayerSentinel === "legacy"
            && nearlyEqual(light.footerPaddingTop, 1.25 * 16),
            `${layout.id}: the matched quiet-site priority3 conflict resolved to ${String(light.footerPaddingTop)}`,
          );
          invariant(
            light.wrappingRowClassIsSemantic
            && light.wrappingRowHasGeneratedClass
            && light.wrappingRowCallerClassLast,
            `${layout.id}: wrapping-row semantic or generated class ordering changed`,
          );
          invariant(
            light.wrappingRowDisplay === "flex"
            && light.wrappingRowFlexWrap === "wrap"
            && light.wrappingRowAlignItems === "center"
            && nearlyEqual(light.wrappingRowGap, 0.75 * 16)
            && nearlyEqual(light.wrappingRowMinInlineSize, 0),
            `${layout.id}: wrapping-row recipe is ${light.wrappingRowDisplay}; ${light.wrappingRowFlexWrap}; ${light.wrappingRowAlignItems}; gap ${String(light.wrappingRowGap)}; min-inline ${String(light.wrappingRowMinInlineSize)}`,
          );
          invariant(
            nearlyEqual(light.wrappingRowInlineSize, 11 * 16)
            && nearlyEqual(light.wrappingRowWidth, 11 * 16)
            && light.wrappingRowSecondItemTop > light.wrappingRowFirstItemTop + 1,
            `${layout.id}: constrained wrapping row is ${String(light.wrappingRowInlineSize)}/${String(light.wrappingRowWidth)} with item tops ${String(light.wrappingRowFirstItemTop)}/${String(light.wrappingRowSecondItemTop)}`,
          );
          invariant(
            light.wrappingRowLayerSentinel === "legacy",
            `${layout.id}: the matched wrapping-row legacy conflict did not reach the canary`,
          );
          invariant(
            light.viewportFramePresent
            && light.viewportFrameClassIsSemantic
            && light.viewportFrameHasGeneratedClass
            && light.viewportFrameCallerClassLast,
            `${layout.id}: viewport-frame semantics or class ordering changed`,
          );
          invariant(
            light.viewportFramePosition === "fixed"
            && light.viewportFrameOverflow === "hidden"
            && nearlyEqual(light.viewportFrameMinInlineSize, 0)
            && nearlyEqual(light.viewportFrameInlineSize, light.clientWidth)
            && nearlyEqual(light.viewportFrameWidth, light.clientWidth)
            && nearlyEqual(light.viewportFrameHeight, light.clientHeight),
            `${layout.id}: viewport-frame recipe is ${light.viewportFramePosition}; ${light.viewportFrameOverflow}; min-inline ${String(light.viewportFrameMinInlineSize)}; size ${String(light.viewportFrameWidth)}×${String(light.viewportFrameHeight)} for ${String(light.clientWidth)}×${String(light.clientHeight)}`,
          );
          invariant(
            light.viewportFrameLayerSentinel === "legacy",
            `${layout.id}: the matched viewport-frame legacy conflict did not reach the canary`,
          );
          invariant(
            light.themedSurfaceBoundaryContracts
            && light.themedSurfaceClassContracts
            && light.themedSurfaceLayerSentinels
            && light.themedSurfacePopoverElevation
            && light.themedSurfaceShapeContracts
            && light.themedSurfaceTextureContract
            && light.themedSurfaceToneContracts,
            `${layout.id}: themed-surface parity failed: ${light.themedSurfaceDiagnostics}`,
          );
          invariant(
            light.avatarClassContracts
            && light.avatarFallbackContracts
            && light.avatarImageContract
            && light.avatarLayerSentinels
            && light.avatarOverrideContract
            && light.avatarTokenContracts,
            `${layout.id}: Avatar parity failed: ${light.avatarDiagnostics}`,
          );
          invariant(
            light.colorEquivalenceContract,
            `${layout.id}: color equivalence rejected alternate serialization or accepted a distinct color: ${light.colorEquivalenceDiagnostics}`,
          );
          invariant(
            light.keyHintBoundaryContracts
            && light.keyHintClassContracts
            && light.keyHintLayerSentinels
            && light.keyHintOverrideContract
            && light.keyHintDefaultDisplay === "inline-flex",
            `${layout.id}: KeyHint parity failed: ${light.keyHintDiagnostics}`,
          );
          invariant(
            light.statusFamilyClassContracts
            && light.statusFamilyGeometryContracts
            && light.statusFamilyLayerSentinels
            && light.statusFamilyOverrideContracts
            && light.statusFamilyToneContracts
            && light.statusFamilyVariableContract,
            `${layout.id}: status-family parity failed: ${light.statusFamilyDiagnostics}`,
          );
          invariant(
            light.cardFamilyBoundaryContracts
            && light.cardFamilyClassContracts
            && light.cardFamilyLayerSentinels
            && light.cardFamilyNestedResetContract
            && light.cardFamilyOverrideContracts
            && light.cardFamilyToneShapeContracts,
            `${layout.id}: Card-family parity failed: ${light.cardFamilyDiagnostics}`,
          );
          invariant(
            light.toolbarBoundaryContracts
            && light.toolbarClassContracts
            && light.toolbarLayerSentinels
            && light.toolbarOrientationContracts
            && light.toolbarOverrideContract,
            `${layout.id}: Toolbar parity failed: ${light.toolbarDiagnostics}`,
          );
          if (productionPriority3PaddingTop === undefined) {
            productionPriority3PaddingTop = light.footerPaddingTop;
          } else {
            invariant(
              nearlyEqual(light.footerPaddingTop, productionPriority3PaddingTop),
              `${layout.id}: production priority3 padding changed across layouts`,
            );
          }
          const vertical = await verticalWritingEvidence(page);
          invariant(
            vertical.pageWritingMode === "vertical-rl"
            && nearlyEqual(vertical.pageMaxInlineSize, 36 * 16)
            && vertical.pageMaxWidth === "none"
            && Number.isFinite(vertical.pageInlineSize)
            && vertical.pageInlineSize <= 36 * 16 + 0.5,
            `${layout.id}: vertical base logical sizing is ${vertical.pageWritingMode}; inline ${String(vertical.pageInlineSize)}/${String(vertical.pageMaxInlineSize)}; max-width ${vertical.pageMaxWidth}`,
          );
          invariant(
            vertical.footerWritingMode === "vertical-rl"
            && nearlyEqual(vertical.footerMaxInlineSize, 35 * 16)
            && vertical.footerMaxWidth === "none"
            && Number.isFinite(vertical.footerInlineSize)
            && vertical.footerInlineSize <= 35 * 16 + 0.5,
            `${layout.id}: vertical canonical xstyle sizing is ${vertical.footerWritingMode}; inline ${String(vertical.footerInlineSize)}/${String(vertical.footerMaxInlineSize)}; max-width ${vertical.footerMaxWidth}`,
          );
          invariant(
            vertical.wrappingRowWritingMode === "vertical-rl"
            && nearlyEqual(vertical.wrappingRowInlineSize, 11 * 16)
            && nearlyEqual(vertical.wrappingRowHeight, 11 * 16)
            && nearlyEqual(vertical.wrappingRowMinInlineSize, 0)
            && Number.isFinite(vertical.wrappingRowWidth),
            `${layout.id}: vertical wrapping-row logical sizing is ${vertical.wrappingRowWritingMode}; inline/height ${String(vertical.wrappingRowInlineSize)}/${String(vertical.wrappingRowHeight)}; width ${String(vertical.wrappingRowWidth)}; min-inline ${String(vertical.wrappingRowMinInlineSize)}`,
          );
          invariant(
            vertical.viewportFrameWritingMode === "vertical-rl"
            && nearlyEqual(vertical.viewportFrameInlineSize, light.clientHeight)
            && nearlyEqual(vertical.viewportFrameHeight, light.clientHeight)
            && nearlyEqual(vertical.viewportFrameMinInlineSize, 0)
            && Number.isFinite(vertical.viewportFrameWidth)
            && vertical.viewportFrameWidth < light.clientWidth,
            `${layout.id}: vertical viewport-frame logical sizing is ${vertical.viewportFrameWritingMode}; inline/height ${String(vertical.viewportFrameInlineSize)}/${String(vertical.viewportFrameHeight)}; width ${String(vertical.viewportFrameWidth)}; min-inline ${String(vertical.viewportFrameMinInlineSize)}`,
          );
          invariant(light.theme === "light" && light.colorScheme === "light", `${layout.id}: initial light theme did not apply`);
          invariant(light.documentScrollWidth <= light.clientWidth + 1, `${layout.id}: gallery overflows horizontally`);
          invariant(light.stylesheetCount === 1 && light.stylesheetMarked, `${layout.id}: default stylesheet delivery is ambiguous`);
          invariant(light.stylexRuntimeStyleCount === 0, `${layout.id}: StyleX runtime injection returned`);
          invariant(light.iconAriaHidden === "true" && light.iconClassIsSemantic, `${layout.id}: icon semantics changed`);
          invariant(
            light.iconLegacyLayerSentinel === "legacy",
            `${layout.id}: the gallery legacy conflict did not match the StyleX icon canary`,
          );
          invariant(light.iconDisplay === "inline-block", `${layout.id}: StyleX icon display is ${light.iconDisplay}`);
          invariant(light.iconFlex === "0 0 auto", `${layout.id}: StyleX icon flex is ${light.iconFlex}`);
          invariant(light.iconWidth === 28 && light.iconHeight === 28, `${layout.id}: icon box is ${String(light.iconWidth)}×${String(light.iconHeight)}`);
          invariant(light.iconInheritsCanaryColor, `${layout.id}: icon current color did not inherit`);
          invariant(
            light.socialAriaHidden === "true"
            && light.socialClassIsSemantic
            && light.socialHasGeneratedClass
            && light.socialCallerClassLast,
            `${layout.id}: social wrapper semantics or class ordering changed`,
          );
          invariant(
            light.socialDisplay === "inline-flex"
            && light.socialFlex === "0 0 auto"
            && light.socialAlignItems === "center"
            && light.socialJustifyContent === "center",
            `${layout.id}: social wrapper recipe is ${light.socialDisplay}; ${light.socialFlex}; ${light.socialAlignItems}; ${light.socialJustifyContent}`,
          );
          invariant(
            light.socialChildSlot === "icon"
            && light.socialIconWidth === 16
            && light.socialIconHeight === 16,
            `${layout.id}: social glyph nesting or default size changed`,
          );
          invariant(
            light.appearanceAriaHidden === "true"
            && light.appearanceClassIsSemantic
            && light.appearanceHasGeneratedClass
            && light.appearanceCallerClassLast,
            `${layout.id}: appearance wrapper semantics or class ordering changed`,
          );
          invariant(
            light.appearanceDisplay === "inline-flex"
            && light.appearanceFlex === "0 0 auto"
            && light.appearanceAlignItems === "center"
            && light.appearanceJustifyContent === "center",
            `${layout.id}: appearance wrapper recipe is ${light.appearanceDisplay}; ${light.appearanceFlex}; ${light.appearanceAlignItems}; ${light.appearanceJustifyContent}`,
          );
          invariant(
            light.appearanceChildSlot === "icon"
            && light.appearanceIconWidth === 18
            && light.appearanceIconHeight === 18,
            `${layout.id}: appearance glyph nesting or default size changed`,
          );
          invariant(
            light.substackAriaHidden === "true"
            && light.substackFill === "currentColor"
            && light.substackHasPath
            && light.substackIconWidth === 16
            && light.substackIconHeight === 16,
            `${layout.id}: Substack fallback contract changed`,
          );
          invariant(light.buttonMinHeight >= 40, `${layout.id}: action target is only ${String(light.buttonMinHeight)}px high`);
          invariant(light.cardBorderStyle !== "none", `${layout.id}: card recipe did not load`);
          invariant(
            light.checkboxBoundaryContracts
            && light.checkboxClassContracts
            && light.checkboxLayerSentinels
            && light.checkboxOverrideContract
            && light.checkboxStateContracts,
            `${layout.id}: CheckboxField parity failed: ${light.checkboxDiagnostics}`,
          );

          if (layout.context.reducedMotion === "reduce") {
            invariant(
              await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
              `${layout.id}: reduced-motion emulation is inactive`,
            );
            invariant(light.spinnerAnimationName === "none", `${layout.id}: spinner still animates`);
            invariant(light.skeletonAnimationName === "none", `${layout.id}: skeleton still animates`);
            invariant(
              seconds(light.transitionDuration).every((duration) => duration <= 0.000_01),
              `${layout.id}: action transitions remain ${light.transitionDuration}`,
            );
          }

          await verifyCheckboxFocusCascadeIsolation(
            page,
            layout.id,
            checkboxFocusContract,
          );
          await verifyKeyboardPath(page, layout.id, checkboxFocusContract);
          await verifySegmentedControlInteraction(page, layout.id);
          await settleCardFamilyTransitions(page);
          const dark = await browserEvidence(page);
          const darkSegmented = await segmentedControlEvidence(page);
          verifySegmentedControlRecipe(darkSegmented, `${layout.id} dark`);
          invariant(
            darkSegmented.selectedLabel === "shared"
            && darkSegmented.groupBackground !== lightSegmented.groupBackground
            && darkSegmented.selectedBackground !== lightSegmented.selectedBackground,
            `${layout.id}: segmented-control theme or interaction did not settle`,
          );
          invariant(dark.theme === "dark" && dark.colorScheme === "dark", `${layout.id}: explicit dark theme did not apply`);
          invariant(dark.bodyBackground !== light.bodyBackground, `${layout.id}: theme did not change the page background`);
          invariant(dark.buttonBackground !== light.buttonBackground, `${layout.id}: theme did not change the action recipe`);
          invariant(
            dark.themedSurfaceBoundaryContracts
            && dark.themedSurfaceClassContracts
            && dark.themedSurfaceLayerSentinels
            && dark.themedSurfacePopoverElevation
            && dark.themedSurfaceShapeContracts
            && dark.themedSurfaceTextureContract
            && dark.themedSurfaceToneContracts,
            `${layout.id}: dark themed-surface parity failed: ${dark.themedSurfaceDiagnostics}`,
          );
          invariant(
            dark.avatarClassContracts
            && dark.avatarFallbackContracts
            && dark.avatarImageContract
            && dark.avatarLayerSentinels
            && dark.avatarOverrideContract
            && dark.avatarTokenContracts
            && dark.avatarDefaultBackground !== light.avatarDefaultBackground,
            `${layout.id}: dark Avatar parity failed: ${dark.avatarDiagnostics}`,
          );
          invariant(
            dark.colorEquivalenceContract,
            `${layout.id}: dark color equivalence rejected alternate serialization or accepted a distinct color: ${dark.colorEquivalenceDiagnostics}`,
          );
          invariant(
            dark.keyHintBoundaryContracts
            && dark.keyHintClassContracts
            && dark.keyHintLayerSentinels
            && dark.keyHintOverrideContract
            && dark.keyHintDefaultBackground !== light.keyHintDefaultBackground,
            `${layout.id}: dark KeyHint parity failed: ${dark.keyHintDiagnostics}`,
          );
          invariant(
            dark.checkboxBoundaryContracts
            && dark.checkboxClassContracts
            && dark.checkboxLayerSentinels
            && dark.checkboxOverrideContract
            && dark.checkboxStateContracts
            && dark.checkboxDefaultBackground !== light.checkboxDefaultBackground,
            `${layout.id}: dark CheckboxField parity failed: ${dark.checkboxDiagnostics}`,
          );
          invariant(
            dark.statusFamilyClassContracts
            && dark.statusFamilyGeometryContracts
            && dark.statusFamilyLayerSentinels
            && dark.statusFamilyOverrideContracts
            && dark.statusFamilyToneContracts
            && dark.statusFamilyVariableContract
            && dark.statusFamilyDefaultBackground
              !== light.statusFamilyDefaultBackground,
            `${layout.id}: dark status-family parity failed: ${dark.statusFamilyDiagnostics}`,
          );
          invariant(
            dark.cardFamilyBoundaryContracts
            && dark.cardFamilyClassContracts
            && dark.cardFamilyLayerSentinels
            && dark.cardFamilyNestedResetContract
            && dark.cardFamilyOverrideContracts
            && dark.cardFamilyToneShapeContracts
            && dark.cardFamilyDefaultBackground
              !== light.cardFamilyDefaultBackground,
            `${layout.id}: dark Card-family parity failed: ${dark.cardFamilyDiagnostics}`,
          );
          invariant(
            dark.toolbarBoundaryContracts
            && dark.toolbarClassContracts
            && dark.toolbarLayerSentinels
            && dark.toolbarOrientationContracts
            && dark.toolbarOverrideContract
            && dark.toolbarDefaultBackground
              !== light.toolbarDefaultBackground,
            `${layout.id}: dark Toolbar parity failed: ${dark.toolbarDiagnostics}`,
          );
          await verifyPressableCardCallerStatePrecedence(page, layout.id);
          await verifyToolbarKeyboardFocusPrecedence(page, layout.id);
          invariant(dark.recoverableErrors.length === 0, `${layout.id}: interaction introduced hydration recovery`);
          invariant(failures.length === 0, `${layout.id}: ${failures.join("; ")}`);
        } finally {
          await context.close();
        }
      }

      const coarsePointerContext = await browser.newContext({
        colorScheme: "light",
        hasTouch: true,
        isMobile: true,
        reducedMotion: "no-preference",
        viewport: { height: 844, width: 390 },
      });
      try {
        const page = await coarsePointerContext.newPage();
        const failures = attachDiagnostics(page);
        await page.goto(`http://${server.hostname}:${String(server.port)}/`, {
          waitUntil: "networkidle",
        });
        await waitForHydration(
          page,
          failures,
          requestedPaths,
          "coarse-pointer CheckboxField",
        );
        const coarse = await checkboxCoarsePointerEvidence(page);
        invariant(
          coarse.coarsePointer
          && coarse.controlMinHeight === 48
          && coarse.indicatorHeight === 20
          && coarse.indicatorWidth === 20
          && coarse.verificationOverride === "",
          `coarse-pointer CheckboxField geometry changed: ${JSON.stringify(coarse)}`,
        );
        invariant(
          failures.length === 0,
          `coarse-pointer CheckboxField: ${failures.join("; ")}`,
        );
      } finally {
        await coarsePointerContext.close();
      }

      const counterfactualContext = await browser.newContext({
        colorScheme: "light",
        reducedMotion: "no-preference",
        viewport: { height: 360, width: 960 },
      });
      try {
        const page = await counterfactualContext.newPage();
        const failures = attachDiagnostics(page);
        await page.goto(`${origin}/${counterfactualDocumentName}`, {
          waitUntil: "networkidle",
        });
        await waitForHydration(
          page,
          failures,
          requestedPaths,
          "priority3-before-legacy counterfactual",
        );
        const counterfactual = await browserEvidence(page);
        invariant(
          counterfactual.hydrationStarted
          && counterfactual.rootHydrated
          && counterfactual.recoverableErrors.length === 0,
          "priority3-before-legacy counterfactual: hydration did not settle cleanly",
        );
        invariant(
          productionPriority3PaddingTop !== undefined
          && nearlyEqual(productionPriority3PaddingTop, 1.25 * 16)
          && counterfactual.quietSitePriority3LayerSentinel === "legacy"
          && nearlyEqual(counterfactual.footerPaddingTop, 9 * 16),
          `priority3-before-legacy counterfactual: production ${String(productionPriority3PaddingTop)}, counterfactual ${String(counterfactual.footerPaddingTop)}, sentinel ${counterfactual.quietSitePriority3LayerSentinel}`,
        );
        invariant(
          counterfactual.stylesheetCount === 1
          && counterfactual.stylesheetMarked
          && counterfactual.stylexRuntimeStyleCount === 0,
          "priority3-before-legacy counterfactual: stylesheet delivery is ambiguous",
        );
        invariant(
          failures.length === 0,
          `priority3-before-legacy counterfactual: ${failures.join("; ")}`,
        );
      } finally {
        await Promise.all([
          counterfactualContext.close(),
          rm(counterfactualDocumentPath, { force: true }),
          rm(counterfactualStylesheetPath, { force: true }),
        ]);
      }
      assert.equal(await Bun.file(counterfactualDocumentPath).exists(), false);
      assert.equal(await Bun.file(counterfactualStylesheetPath).exists(), false);

      const forcedContext = await browser.newContext({
        colorScheme: "light",
        forcedColors: "active",
        reducedMotion: "reduce",
        viewport: { height: 720, width: 900 },
      });
      try {
        const page = await forcedContext.newPage();
        const failures = attachDiagnostics(page);
        await page.goto(`http://${server.hostname}:${String(server.port)}/`, {
          waitUntil: "networkidle",
        });
        await waitForHydration(page, failures, requestedPaths, "forced colors");
        const forced = await forcedColorsEvidence(page);
        invariant(forced.forcedColorsActive, "forced colors: browser emulation is inactive");
        invariant(forced.cardForcedColorAdjust === "auto", `forced colors: card adjustment is ${forced.cardForcedColorAdjust}`);
        invariant(forced.cardBorderColor === forced.canvasText, `forced colors: card border is ${forced.cardBorderColor}, expected ${forced.canvasText}`);
        invariant(forced.buttonBackground === forced.buttonFace, `forced colors: action background is ${forced.buttonBackground}, expected ${forced.buttonFace}`);
        invariant(forced.buttonTextColor === forced.buttonText, `forced colors: action text is ${forced.buttonTextColor}, expected ${forced.buttonText}`);
        invariant(forced.selectedTabBackground === forced.buttonFace, "forced colors: selected tab does not use ButtonFace");
        invariant(forced.selectedTabColor === forced.buttonText, "forced colors: selected tab does not use ButtonText");
        invariant(forced.selectedSegmentBackground === forced.buttonFace, "forced colors: selected segment does not use ButtonFace");
        invariant(forced.selectedSegmentColor === forced.buttonText, "forced colors: selected segment does not use ButtonText");
        invariant(forced.spinnerAnimationName === "none", "forced colors: reduced-motion spinner still animates");
        invariant(
          forced.statusFamilyContracts,
          `forced colors: status-family parity failed: ${forced.statusFamilyDiagnostics}`,
        );
        invariant(
          forced.cardFamilyContracts,
          `forced colors: Card-family parity failed: ${forced.cardFamilyDiagnostics}`,
        );
        invariant(
          forced.keyHintContracts,
          `forced colors: KeyHint parity failed: ${forced.keyHintDiagnostics}`,
        );
        invariant(
          forced.checkboxContracts,
          `forced colors: CheckboxField parity failed: ${forced.checkboxDiagnostics}`,
        );

        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        const focusedThemeButton = page.getByRole("button", { name: "Use dark theme" });
        const forcedOutline = await focusedThemeButton.evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.color = "Highlight";
          document.body.append(probe);
          const highlight = getComputedStyle(probe).color;
          probe.remove();
          return {
            actual: getComputedStyle(element).outlineColor,
            highlight,
            style: getComputedStyle(element).outlineStyle,
            width: Number.parseFloat(getComputedStyle(element).outlineWidth),
          };
        });
        invariant(
          forcedOutline.actual === forcedOutline.highlight
          && forcedOutline.style !== "none"
          && forcedOutline.width >= 2,
          `forced colors: focus outline is ${forcedOutline.width}px ${forcedOutline.style} ${forcedOutline.actual}, expected a visible ${forcedOutline.highlight} outline`,
        );
        invariant(failures.length === 0, `forced colors: ${failures.join("; ")}`);

        await page.evaluate(() => {
          const unmount = window.__HRANESS_UI_GALLERY_UNMOUNT__;
          if (unmount === undefined) throw new Error("The hydration cleanup handle is missing.");
          unmount();
        });
        invariant(
          await page.locator('[data-gallery-hydration-root="true"]').evaluate((element) =>
            element.childElementCount === 0
            && !element.hasAttribute("data-hydrated")
            && window.__HRANESS_UI_GALLERY_HYDRATION_STARTED__ === undefined
            && window.__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__ === undefined
            && window.__HRANESS_UI_GALLERY_UNMOUNT__ === undefined),
          "hydration cleanup did not remove the gallery, readiness marker, and global handles",
        );
      } finally {
        await forcedContext.close();
      }

      assert.equal(browser.contexts().length, 0, "all primitive gallery contexts must close");
      invariant(requestedPaths.has("/"), "the browser never requested the gallery document");
      invariant(requestedPaths.has(`/${clientName}`), "the browser never requested the packed client");
      invariant(requestedPaths.has(`/${stylesheetName}`), "the browser never requested the packed default stylesheet");
      invariant(
        requestedPaths.has(`/${counterfactualDocumentName}`),
        "the browser never requested the priority3 counterfactual document",
      );
      invariant(
        requestedPaths.has(`/${counterfactualStylesheetName}`),
        "the browser never requested the priority3 counterfactual stylesheet",
      );
    } finally {
      await browser.close();
      browserClosed = true;
    }
  } finally {
    await server.stop(true);
  }
  invariant(browserClosed, "the primitive gallery browser did not close cleanly");
  console.log(
    "Primitive gallery browser passed: packed default CSS and priority3 layer order, matched gallery-only conflicts losing to StyleX in production, a served priority3-before-legacy counterfactual flipping footer padding to the legacy value, SSR/hydration, semantic StyleX glyph, wrapper, quiet-site landmarks, horizontal and vertical structural-surface layout behavior, viewport height fallbacks, centered compact SelectField indicator geometry, every themed-surface tone and shape, caller-last texture composition, SegmentedControl compact geometry and interaction, Avatar fallback sizes, data-URI image cropping, Badge, Tag, StatusDot, KeyHint, CheckboxField, Card, PressableCard, and Toolbar finite recipes, public Tag accent, public Card description overrides and nested tone resets, caller and native interaction precedence, CheckboxField native form, keyboard focus, hidden-label, and coarse-pointer contracts, Toolbar native and caller keyboard focus, compact/short layouts, light/dark, reduced motion, forced colors, network/console diagnostics, and cleanup.",
  );
} finally {
  await rm(work, { force: true, recursive: true });
  assert.equal(await Bun.file(work).exists(), false, "the primitive gallery temporary directory must be removed");
}
