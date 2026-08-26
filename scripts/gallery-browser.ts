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
const HUGEICONS_VERSION = "4.2.2";
const PACKAGE_LAYER_PRELUDE =
  /@layer\s+components\.hraness-ui\.legacy\s*,\s*components\.hraness-ui\.priority1\s*,\s*components\.hraness-ui\.priority2\s*,\s*components\.hraness-ui\.priority3/u;
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
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly colorScheme: string;
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
  readonly forcedColorsActive: boolean;
  readonly selectedTabBackground: string;
  readonly selectedTabColor: string;
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

function requirePackedDefaultStylesheet(css: string): void {
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
      return actualChannels.length === expectedChannels.length
        && actualChannels.every(
          (channel, index) =>
            Math.abs(channel - (expectedChannels[index] ?? Number.NaN)) < 0.000_01,
        );
    };
    const resolvedTokens = {
      accentBackground: resolveStyle("background-color", "var(--ui-accent)"),
      accentForeground: resolveStyle("color", "var(--ui-accent-foreground)"),
      border: resolveStyle("border-color", "var(--ui-border)"),
      cardBackground: resolveStyle("background-color", "var(--ui-card)"),
      cardForeground: resolveStyle("color", "var(--ui-card-foreground)"),
      inverseBackground: resolveStyle("background-color", "var(--ui-foreground)"),
      inverseForeground: resolveStyle("color", "var(--ui-background)"),
      largeRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-lg)")),
      popoverBackground: resolveStyle("background-color", "var(--ui-popover)"),
      popoverForeground: resolveStyle("color", "var(--ui-popover-foreground)"),
      primary: resolveStyle("border-color", "var(--ui-primary)"),
      raisedShadow: resolveStyle("box-shadow", "var(--elevation-raised)"),
      secondaryBackground: resolveStyle("background-color", "var(--ui-secondary)"),
      secondaryForeground: resolveStyle("color", "var(--ui-secondary-foreground)"),
      sharpRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-sharp)")),
      smallRadius: Number.parseFloat(resolveStyle("border-radius", "var(--radius-sm)")),
      space2: Number.parseFloat(resolveStyle("padding-left", "var(--space-2)")),
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
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
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
            return item.backgroundColor === resolvedTokens.primary
              && item.borderRadius === resolvedTokens.roundRadius
              && item.height === 20
              && item.inlineHeight === "1.25rem"
              && item.inlineWidth === "1.25rem"
              && item.width === 20;
          }
          return item.backgroundColor === resolvedTokens.accentBackground
            && item.borderColor === resolvedTokens.primary
            && item.borderRadius === resolvedTokens.smallRadius
            && item.color === resolvedTokens.accentForeground
            && item.inlineMinHeight === "2.5rem"
            && item.inlineWidth === "9rem"
            && item.minHeight === 40
            && item.width === 144;
        }),
      statusFamilyToneContracts:
        badgeEvidence.every(
          (badge) =>
            badge.backgroundColor === badge.expectedBackground
            && badge.borderColor === badge.expectedBorder
            && badge.color === badge.expectedColor
            && badge.slot === "badge"
            && (badge.tone === "success"
              ? badge.ariaLive === "polite" && badge.role === "status"
              : badge.ariaLive === "" && badge.role === ""),
        )
        && tagEvidence.every(
          (tag) =>
            tag.backgroundColor === tag.expectedBackground
            && tag.borderColor === tag.expectedBorder
            && tag.color === tag.expectedColor
            && tag.role === ""
            && tag.slot === "tag",
        )
        && dotEvidence.every(
          (dot) => dot.backgroundColor === dot.expectedBackground,
        ),
      statusFamilyVariableContract:
        tagEvidence.some(
          (tag) =>
            tag.variant === "outline"
            && tag.publicAccent.toLowerCase() === "#d97706"
            && tag.borderColor === resolvedTokens.outlineAccent,
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

async function verifyKeyboardPath(page: Page, id: string): Promise<void> {
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
  await page.keyboard.press("Space");
  invariant(await checkbox.isChecked(), `${id}: Space did not select the native checkbox`);

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

async function forcedColorsEvidence(page: Page): Promise<ForcedColorsEvidence> {
  return page.evaluate(() => {
    const button = document.querySelector('[data-gallery-primary-action="true"][data-slot="button-control"]');
    const card = document.querySelector('[data-gallery-icon-card="true"]');
    const selectedTab = document.querySelector('[data-slot="tab"][data-selected]');
    const spinner = document.querySelector('[data-slot="spinner"]');
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
    if (
      !(button instanceof HTMLElement)
      || !(card instanceof HTMLElement)
      || !(selectedTab instanceof HTMLElement)
      || !(spinner instanceof HTMLElement)
      || statusPills.length !== 10
      || statusDots.length !== 6
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
    return {
      buttonBackground: buttonStyle.backgroundColor,
      buttonFace: normalize("backgroundColor", "ButtonFace"),
      buttonText: normalize("color", "ButtonText"),
      buttonTextColor: buttonStyle.color,
      canvasText,
      cardBorderColor: cardStyle.borderColor,
      cardForcedColorAdjust: cardStyle.forcedColorAdjust,
      forcedColorsActive: matchMedia("(forced-colors: active)").matches,
      selectedTabBackground: tabStyle.backgroundColor,
      selectedTabColor: tabStyle.color,
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
    /data-gallery-(?:stylex-layer-conflict|quiet-site-(?:layer|priority3)-conflict|(?:avatar|status-family|themed-surface|viewport-frame|wrapping-row)-layer-conflict)/u,
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

  const productionDirectory = resolve(consumer, "dist/browser");
  const negativeDirectory = resolve(consumer, "dist/unstyled-negative-control");
  const serverRendererDirectory = resolve(consumer, "dist/server-renderer");
  const [production, negativeControl, serverRenderer] = await Promise.all([
    buildBrowserEntry(consumer, "gallery/client.tsx", productionDirectory),
    buildBrowserEntry(consumer, "gallery/unstyled-client.tsx", negativeDirectory),
    buildServerRenderer(consumer, serverRendererDirectory),
  ]);
  requirePackedDefaultStylesheet(production.css);
  assert.throws(
    () => requirePackedDefaultStylesheet(negativeControl.css),
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
            light.statusFamilyClassContracts
            && light.statusFamilyGeometryContracts
            && light.statusFamilyLayerSentinels
            && light.statusFamilyOverrideContracts
            && light.statusFamilyToneContracts
            && light.statusFamilyVariableContract,
            `${layout.id}: status-family parity failed: ${light.statusFamilyDiagnostics}`,
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

          await verifyKeyboardPath(page, layout.id);
          const dark = await browserEvidence(page);
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
          invariant(dark.recoverableErrors.length === 0, `${layout.id}: interaction introduced hydration recovery`);
          invariant(failures.length === 0, `${layout.id}: ${failures.join("; ")}`);
        } finally {
          await context.close();
        }
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
        invariant(forced.spinnerAnimationName === "none", "forced colors: reduced-motion spinner still animates");
        invariant(
          forced.statusFamilyContracts,
          `forced colors: status-family parity failed: ${forced.statusFamilyDiagnostics}`,
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
    "Primitive gallery browser passed: packed default CSS and priority3 layer order, matched gallery-only conflicts losing to StyleX in production, a served priority3-before-legacy counterfactual flipping footer padding to the legacy value, SSR/hydration, semantic StyleX glyph, wrapper, quiet-site landmarks, horizontal and vertical structural-surface layout behavior, viewport height fallbacks, every themed-surface tone and shape, caller-last texture composition, Avatar fallback sizes, data-URI image cropping, Badge, Tag, and StatusDot finite recipes, public Tag accent, caller and native precedence, compact/short layouts, keyboard focus, light/dark, reduced motion, forced colors, network/console diagnostics, and cleanup.",
  );
} finally {
  await rm(work, { force: true, recursive: true });
  assert.equal(await Bun.file(work).exists(), false, "the primitive gallery temporary directory must be removed");
}
