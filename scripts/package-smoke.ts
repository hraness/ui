import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

type ReactRelease = Readonly<{
  label: string;
  reactTypes: string;
  reactDomTypes: string;
  version: string;
}>;

const reactReleases: readonly ReactRelease[] = [
  {
    label: "react-18",
    reactTypes: "^18.3.0",
    reactDomTypes: "^18.3.0",
    version: "18.3.1",
  },
  {
    label: "react-19",
    reactTypes: "^19.2.0",
    reactDomTypes: "^19.2.0",
    version: "19.2.3",
  },
];

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

function resolveGenuineNodeExecutable(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const identityProbe = [
    "if (typeof Bun !== 'undefined'",
    "|| process.versions.bun !== undefined",
    "|| !process.versions.node?.startsWith('24.')) process.exit(1)",
  ].join(" ");
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "-e",
        identityProbe,
      ], {
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent, inaccessible, or incompatible PATH candidates.
    }
  }
  throw new Error("package smoke requires a genuine Node 24 executable on PATH");
}

function ssrProbe(release: ReactRelease): string {
  return String.raw`import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  AppearanceIcon,
  Icon,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  ThemedSurface,
  ViewportFrame,
  WrappingRow,
} from "@hraness/ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

assert.equal(React.version, ${JSON.stringify(release.version)});

const reactDomPackageUrl = import.meta.resolve("react-dom/package.json");
const reactDomPackage = JSON.parse(await readFile(new URL(reactDomPackageUrl), "utf8"));
assert.equal(reactDomPackage.version, ${JSON.stringify(release.version)});

const stylexCssUrl = import.meta.resolve("@hraness/ui/stylex.css");
assert.equal(new URL(stylexCssUrl).protocol, "file:");
const stylexCss = await readFile(new URL(stylexCssUrl), "utf8");
assert.ok(stylexCss.trim().length > 0, "@hraness/ui/stylex.css must not be empty");
assert.match(stylexCss, /@layer components\.hraness-ui\.priority3/u);
assert.match(stylexCss, /max-inline-size:\s*var\(--hraness-quiet-site-measure,\s*34rem\)/u);
assert.doesNotMatch(stylexCss, /max-width:\s*var\(--hraness-quiet-site-measure,\s*34rem\)/u);
assert.match(stylexCss, /gap:\s*var\(--space-3\)/u);
assert.match(stylexCss, /inline-size:\s*100%/u);
assert.match(stylexCss, /min-inline-size:\s*0/u);
assert.match(stylexCss, /overflow:\s*hidden/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-card\)/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-popover\)/u);
assert.match(stylexCss, /border-radius:\s*var\(--radius-sharp\)/u);
assert.match(stylexCss, /box-shadow:\s*var\(--elevation-raised\)/u);
assert.match(stylexCss, /padding-block:\s*var\(--space-6\)/u);
assert.match(stylexCss, /padding-inline:\s*var\(--space-6\)/u);
const viewportHeightFallbacks = ["height: 100vh;", "height: 100svh;", "height: 100dvh;"];
const viewportHeightPositions = viewportHeightFallbacks.map((fallback) => stylexCss.indexOf(fallback));
assert.ok(viewportHeightPositions.every((position) => position >= 0));
assert.ok(
  viewportHeightPositions[0] < viewportHeightPositions[1]
  && viewportHeightPositions[1] < viewportHeightPositions[2],
  "the packed StyleX CSS must preserve the vh, svh, then dvh fallback order",
);
assert.doesNotMatch(stylexCss, /(?:^|[\s{;])width:\s*100%/u);
assert.doesNotMatch(stylexCss, /(?:^|[\s{;])min-width:\s*0/u);

const componentsCssUrl = import.meta.resolve("@hraness/ui/components.css");
const componentsCss = await readFile(new URL(componentsCssUrl), "utf8");
assert.doesNotMatch(componentsCss, /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-themed-surface(?![A-Za-z0-9_-])/u);

const stylesCssUrl = import.meta.resolve("@hraness/ui/styles.css");
const stylesCss = await readFile(new URL(stylesCssUrl), "utf8");
assert.equal(
  stylesCss.match(/@import "\.\.\/dist\/stylex\.css";/gu)?.length,
  1,
  "the complete stylesheet must deliver generated StyleX CSS exactly once",
);
assert.match(
  stylesCss,
  /@layer components\.hraness-ui\.legacy, components\.hraness-ui\.priority1, components\.hraness-ui\.priority2, components\.hraness-ui\.priority3;/u,
);

const markup = renderToStaticMarkup(React.createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
}));
assert.match(markup, /<svg/u);
assert.match(markup, /aria-hidden="true"/u);
assert.match(markup, /class="[^"]*hraness-icon[^"]*consumer-icon[^"]*"/u);
assert.match(markup, /data-slot="icon"/u);

const socialMarkup = renderToStaticMarkup(React.createElement(SocialIcon, {
  className: "consumer-social-icon",
  name: "github",
}));
assert.match(socialMarkup, /<span/u);
assert.match(socialMarkup, /aria-hidden="true"/u);
assert.match(socialMarkup, /class="hraness-social-icon [^"]+ consumer-social-icon"/u);
assert.match(socialMarkup, /data-slot="social-icon"/u);
assert.match(socialMarkup, /data-social-icon="github"/u);
assert.match(socialMarkup, /width="16"/u);

const substackMarkup = renderToStaticMarkup(React.createElement(SocialIcon, {
  name: "substack",
  size: 21,
}));
assert.match(substackMarkup, /fill="currentColor"/u);
assert.match(substackMarkup, /height="21"/u);
assert.match(substackMarkup, /M22\.539 8\.242H1\.46V5\.406/u);

const appearanceMarkup = renderToStaticMarkup(React.createElement(AppearanceIcon, {
  className: "consumer-appearance-icon",
  name: "system",
}));
assert.match(appearanceMarkup, /<span/u);
assert.match(appearanceMarkup, /aria-hidden="true"/u);
assert.match(appearanceMarkup, /class="hraness-appearance-icon [^"]+ consumer-appearance-icon"/u);
assert.match(appearanceMarkup, /data-appearance-icon="system"/u);
assert.match(appearanceMarkup, /data-slot="appearance-icon"/u);
assert.match(appearanceMarkup, /width="18"/u);

const pageMarkup = renderToStaticMarkup(React.createElement(QuietSitePage, {
  "aria-label": "Package page",
  className: "consumer-page",
  id: "package-page",
  style: { backgroundColor: "rgb(1, 2, 3)" },
}, "Page"));
assert.match(pageMarkup, /^<main/u);
assert.match(pageMarkup, /aria-label="Package page"/u);
assert.match(pageMarkup, /class="hraness-quiet-site-page [^"]+ consumer-page"/u);
assert.match(pageMarkup, /data-slot="quiet-site-page"/u);
assert.match(pageMarkup, /id="package-page"/u);
assert.match(pageMarkup, /style="background-color:rgb\(1, 2, 3\)"/u);

const footerMarkup = renderToStaticMarkup(React.createElement(QuietSiteFooter, {
  "aria-label": "Package footer",
  className: "consumer-footer",
  id: "package-footer",
  style: { paddingTop: "3rem" },
}, "Footer"));
assert.match(footerMarkup, /^<footer/u);
assert.match(footerMarkup, /aria-label="Package footer"/u);
assert.match(footerMarkup, /class="hraness-quiet-site-footer [^"]+ consumer-footer"/u);
assert.match(footerMarkup, /data-slot="quiet-site-footer"/u);
assert.match(footerMarkup, /id="package-footer"/u);
assert.match(footerMarkup, /style="padding-top:3rem"/u);

const frameMarkup = renderToStaticMarkup(React.createElement(ViewportFrame, {
  "aria-label": "Package viewport",
  as: "main",
  className: "consumer-frame",
  id: "package-frame",
  style: { backgroundColor: "rgb(4, 5, 6)" },
}, React.createElement("p", null, "Frame")));
assert.match(frameMarkup, /^<main/u);
assert.match(frameMarkup, /aria-label="Package viewport"/u);
assert.match(frameMarkup, /class="hraness-viewport-frame [^"]+ consumer-frame"/u);
assert.match(frameMarkup, /data-slot="viewport-frame"/u);
assert.match(frameMarkup, /id="package-frame"/u);
assert.match(frameMarkup, /style="background-color:rgb\(4, 5, 6\)"/u);
assert.match(frameMarkup, />Frame</u);

const rowMarkup = renderToStaticMarkup(React.createElement(WrappingRow, {
  "aria-label": "Package actions",
  as: "nav",
  className: "consumer-row",
  id: "package-row",
  style: { color: "rgb(7, 8, 9)" },
}, React.createElement("span", null, "Row")));
assert.match(rowMarkup, /^<nav/u);
assert.match(rowMarkup, /aria-label="Package actions"/u);
assert.match(rowMarkup, /class="hraness-wrapping-row [^"]+ consumer-row"/u);
assert.match(rowMarkup, /data-slot="wrapping-row"/u);
assert.match(rowMarkup, /id="package-row"/u);
assert.match(rowMarkup, /style="color:rgb\(7, 8, 9\)"/u);
assert.match(rowMarkup, />Row</u);

const surfaceMarkup = renderToStaticMarkup(React.createElement(ThemedSurface, {
  "aria-label": "Package preview",
  as: "article",
  className: "consumer-surface",
  id: "package-surface",
  shape: "rectangular",
  style: { backgroundPosition: "2px 3px" },
  tone: "inverse",
}, "Surface"));
assert.match(surfaceMarkup, /^<article/u);
assert.match(surfaceMarkup, /aria-label="Package preview"/u);
assert.match(surfaceMarkup, /class="hraness-themed-surface [^"]+ consumer-surface"/u);
assert.match(surfaceMarkup, /data-shape="rectangular"/u);
assert.match(surfaceMarkup, /data-slot="themed-surface"/u);
assert.match(surfaceMarkup, /data-tone="inverse"/u);
assert.match(surfaceMarkup, /id="package-surface"/u);
assert.match(surfaceMarkup, /style="background-position:2px 3px"/u);
assert.match(surfaceMarkup, />Surface</u);
`;
}

const typeScriptProbe = `import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import {
  AppearanceIcon,
  Icon,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  ThemedSurface,
  ViewportFrame,
  WrappingRow,
} from "@hraness/ui";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const styles = stylex.create({
  camelInlineSize: { inlineSize: "100%" },
  camelMaxInlineSize: { maxInlineSize: "40rem" },
  camelMinInlineSize: { minInlineSize: 0 },
  icon: { display: "block" },
  dynamicPage: (inlineSize: string) => ({ "inline-size": inlineSize }),
  logicalPage: {
    "inline-size": "100%",
    "max-inline-size": "40rem",
    "min-inline-size": 0,
  },
  physicalPage: { maxWidth: "40rem", minWidth: 0, width: "100%" },
  surfaceTexture: {
    backgroundColor: "var(--ui-secondary)",
    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)",
    backgroundPosition: "0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "4px 4px",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-secondary-foreground)",
    paddingInline: "var(--space-2)",
  },
  wrapper: { display: "grid" },
});
const markup: string = renderToStaticMarkup(createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
  size: 24,
  strokeWidth: 2,
  xstyle: styles.icon,
}));
const socialMarkup: string = renderToStaticMarkup(createElement(SocialIcon, {
  className: "consumer-social-icon",
  name: "github",
  size: 24,
  xstyle: styles.wrapper,
}));
const appearanceMarkup: string = renderToStaticMarkup(createElement(AppearanceIcon, {
  className: "consumer-appearance-icon",
  name: "system",
  size: 26,
  xstyle: styles.wrapper,
}));
const pageRef = createRef<HTMLElement>();
const pageMarkup: string = renderToStaticMarkup(createElement(QuietSitePage, {
  "aria-label": "Package page",
  className: "consumer-page",
  children: "Page",
  id: "package-page",
  ref: pageRef,
  style: { inlineSize: "38rem" },
  xstyle: [styles.logicalPage, styles.dynamicPage("40rem")],
}));
const footerRef = createRef<HTMLElement>();
const footerMarkup: string = renderToStaticMarkup(createElement(QuietSiteFooter, {
  "aria-label": "Package footer",
  className: "consumer-footer",
  children: "Footer",
  id: "package-footer",
  ref: footerRef,
  style: { display: "block" },
  xstyle: [styles.wrapper, styles.physicalPage],
}));
const frameRef = createRef<HTMLElement>();
const frameMarkup: string = renderToStaticMarkup(createElement(ViewportFrame, {
  "aria-label": "Package viewport",
  as: "section",
  children: "Frame",
  className: "consumer-frame",
  ref: frameRef,
  style: { inlineSize: "38rem" },
  xstyle: [styles.logicalPage, styles.dynamicPage("40rem")],
}));
const rowRef = createRef<HTMLElement>();
const rowMarkup: string = renderToStaticMarkup(createElement(WrappingRow, {
  "aria-label": "Package actions",
  as: "nav",
  children: "Row",
  className: "consumer-row",
  ref: rowRef,
  style: { display: "block" },
  xstyle: [styles.wrapper, styles.physicalPage],
}));
const surfaceRef = createRef<HTMLElement>();
const surfaceMarkup: string = renderToStaticMarkup(createElement(ThemedSurface, {
  "aria-label": "Package preview",
  as: "article",
  children: "Surface",
  className: "consumer-surface",
  ref: surfaceRef,
  shape: "rectangular",
  style: { backgroundPosition: "2px 3px" },
  tone: "accent",
  xstyle: [styles.logicalPage, styles.surfaceTexture],
}));

// @ts-expect-error QuietSite rejects StyleX 0.19's physical inlineSize alias.
const camelInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelInlineSize }));
// @ts-expect-error QuietSite rejects StyleX 0.19's physical maxInlineSize alias.
const camelMaxInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelMaxInlineSize }));
// @ts-expect-error QuietSite rejects StyleX 0.19's physical minInlineSize alias.
const camelMinInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelMinInlineSize }));
// @ts-expect-error ViewportFrame rejects StyleX 0.19's physical inlineSize alias.
const frameCamelInlineSizeMarkup = renderToStaticMarkup(createElement(ViewportFrame, { xstyle: styles.camelInlineSize }));
// @ts-expect-error WrappingRow rejects StyleX 0.19's physical maxInlineSize alias.
const rowCamelMaxInlineSizeMarkup = renderToStaticMarkup(createElement(WrappingRow, { xstyle: styles.camelMaxInlineSize }));
// @ts-expect-error WrappingRow rejects StyleX 0.19's physical minInlineSize alias.
const rowCamelMinInlineSizeMarkup = renderToStaticMarkup(createElement(WrappingRow, { xstyle: styles.camelMinInlineSize }));
// @ts-expect-error ThemedSurface rejects StyleX 0.19's physical inlineSize alias.
const surfaceCamelInlineSizeMarkup = renderToStaticMarkup(createElement(ThemedSurface, { xstyle: styles.camelInlineSize }));
// @ts-expect-error ViewportFrame keeps its polymorphic elements finite.
const invalidFrameElementMarkup = renderToStaticMarkup(createElement(ViewportFrame, { as: "article" }));
// @ts-expect-error WrappingRow keeps its polymorphic elements finite.
const invalidRowElementMarkup = renderToStaticMarkup(createElement(WrappingRow, { as: "article" }));
// @ts-expect-error ThemedSurface keeps its polymorphic elements finite.
const invalidSurfaceElementMarkup = renderToStaticMarkup(createElement(ThemedSurface, { as: "main" }));
// @ts-expect-error ThemedSurface keeps its tone set finite.
const invalidSurfaceToneMarkup = renderToStaticMarkup(createElement(ThemedSurface, { tone: "warning" }));
// @ts-expect-error ThemedSurface keeps its shape set finite.
const invalidSurfaceShapeMarkup = renderToStaticMarkup(createElement(ThemedSurface, { shape: "pill" }));

void markup;
void socialMarkup;
void appearanceMarkup;
void pageMarkup;
void footerMarkup;
void frameMarkup;
void rowMarkup;
void surfaceMarkup;
void camelInlineSizeMarkup;
void camelMaxInlineSizeMarkup;
void camelMinInlineSizeMarkup;
void frameCamelInlineSizeMarkup;
void rowCamelMaxInlineSizeMarkup;
void rowCamelMinInlineSizeMarkup;
void surfaceCamelInlineSizeMarkup;
void invalidFrameElementMarkup;
void invalidRowElementMarkup;
void invalidSurfaceElementMarkup;
void invalidSurfaceToneMarkup;
void invalidSurfaceShapeMarkup;
`;

function typeScriptConfig(moduleResolution: "Bundler" | "NodeNext") {
  return {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      module: moduleResolution === "Bundler" ? "Preserve" : "NodeNext",
      moduleResolution,
    },
    include: ["index.ts"],
  };
}

async function verifyConsumer(
  archive: string,
  consumer: string,
  nodeExecutable: string,
  release: ReactRelease,
): Promise<void> {
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    name: `hraness-package-smoke-${release.label}`,
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await run([
    process.execPath,
    "add",
    archive,
    "@hugeicons/core-free-icons@^4.2.2",
    "@stylexjs/stylex@0.19.0",
    `@types/react@${release.reactTypes}`,
    `@types/react-dom@${release.reactDomTypes}`,
    `react@${release.version}`,
    `react-dom@${release.version}`,
    "typescript@^6.0.3",
    "--ignore-scripts",
  ], consumer);
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "quiet-site.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "surfaces.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "lib", "stylex.ts"),
  );

  // A restored package-manager cache can retain this valid duplicate topology.
  // Public source types must remain portable when React Aria resolves through it.
  const nestedReactAriaModules = join(
    consumer,
    "node_modules",
    "react-aria",
    "node_modules",
  );
  await mkdir(nestedReactAriaModules, { recursive: true });
  await cp(
    join(consumer, "node_modules", "react-stately"),
    join(nestedReactAriaModules, "react-stately"),
    { recursive: true },
  );

  await writeFile(join(consumer, "ssr.mjs"), ssrProbe(release));
  await run([nodeExecutable, "./ssr.mjs"], consumer);

  await writeFile(join(consumer, "index.ts"), typeScriptProbe);
  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    const configName = `tsconfig.${moduleResolution.toLowerCase()}.json`;
    await writeFile(
      join(consumer, configName),
      `${JSON.stringify(typeScriptConfig(moduleResolution), null, 2)}\n`,
    );
    await run([process.execPath, "x", "tsc", "-p", `./${configName}`], consumer);
  }
}

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-package-smoke-"));
const temporary = join(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  TMPDIR: temporary,
};
try {
  const archive = join(work, "package.tgz");
  await mkdir(temporary, { mode: 0o700 });
  const nodeExecutable = resolveGenuineNodeExecutable();
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);

  for (const release of reactReleases) {
    await verifyConsumer(
      archive,
      join(work, release.label),
      nodeExecutable,
      release,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
