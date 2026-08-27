import assert from "node:assert/strict";
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
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Icon,
  PressableCard,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  StatusDot,
  Tag,
  ThemedSurface,
  Toolbar,
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
assert.match(stylexCss, /background-color:\s*var\(--ui-muted\)/u);
assert.match(stylexCss, /border-radius:\s*var\(--radius-round\)/u);
assert.match(stylexCss, /height:\s*3\.5rem/u);
assert.match(stylexCss, /object-fit:\s*cover/u);
assert.match(stylexCss, /width:\s*3\.5rem/u);
assert.match(stylexCss, /border-color:\s*var\(--hraness-tag-accent,\s*var\(--ui-border\)\)/u);
assert.match(stylexCss, /border-color:\s*canvastext/u);
assert.match(stylexCss, /forced-color-adjust:\s*auto/u);
assert.match(stylexCss, /height:\s*\.625rem/u);
assert.match(stylexCss, /min-height:\s*1\.5rem/u);
assert.match(stylexCss, /width:\s*\.625rem/u);
assert.match(stylexCss, /width:\s*fit-content/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-accent\)/u);
assert.match(stylexCss, /border-color:\s*color-mix\(in oklch,var\(--ui-primary\) 35%,var\(--ui-border\)\)/u);
assert.match(stylexCss, /box-shadow:\s*var\(--elevation-low\)/u);
assert.match(stylexCss, /color:\s*var\(--hraness-card-description\)/u);
assert.doesNotMatch(stylexCss, /--hraness-card-description\s*:/u);
assert.doesNotMatch(stylexCss, /--_hraness-card-description/u);
assert.match(stylexCss, /gap:\s*var\(--space-6\)/u);
assert.match(stylexCss, /outline-color:\s*var\(--ui-ring\)/u);
assert.match(stylexCss, /transform:\s*translateY\(1px\)/u);
assert.match(stylexCss, /:hover\s*\{/u);
assert.match(stylexCss, /:active\s*\{/u);
assert.match(stylexCss, /:focus-visible\s*\{/u);
assert.match(stylexCss, /outline-offset:\s*2px/u);
assert.match(stylexCss, /padding-block:\s*var\(--space-1\)/u);
assert.match(stylexCss, /padding-inline:\s*var\(--space-1\)/u);
const viewportHeightFallbacks = ["height: 100vh;", "height: 100svh;", "height: 100dvh;"];
const viewportHeightPositions = viewportHeightFallbacks.map((fallback) => stylexCss.indexOf(fallback));
assert.ok(viewportHeightPositions.every((position) => position >= 0));
assert.ok(
  viewportHeightPositions[0] < viewportHeightPositions[1]
  && viewportHeightPositions[1] < viewportHeightPositions[2],
  "the packed StyleX CSS must preserve the vh, svh, then dvh fallback order",
);
assert.equal(
  stylexCss.match(/(?:^|[\s{;])width:\s*100%/gu)?.length,
  1,
  "the packed CSS must contain exactly one shared physical 100% width declaration for Avatar children and PressableCard",
);
assert.equal(
  stylexCss.match(/(?:^|[\s{;])min-width:\s*0/gu)?.length,
  1,
  "the packed CSS must contain exactly one shared physical zero min-width declaration for the Tag label, PressableCard, and Toolbar",
);

const componentsCssUrl = import.meta.resolve("@hraness/ui/components.css");
const componentsCss = await readFile(new URL(componentsCssUrl), "utf8");
assert.doesNotMatch(componentsCss, /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-themed-surface(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-avatar(?:__image|__fallback)?(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-(?:badge(?:--[A-Za-z0-9_-]+)?|status-dot|tag(?:__(?:icon|label))?)(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(
  componentsCss.replace(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    "",
  ),
  /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(componentsCss, /\.hraness-toolbar(?![A-Za-z0-9_-])/u);
assert.equal(
  componentsCss.match(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
  )?.length,
  1,
  "components.css must contain the single Card description compatibility bridge",
);

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

const avatarMarkup = renderToStaticMarkup(React.createElement(Avatar, {
  alt: "Ada Lovelace avatar",
  className: "consumer-avatar",
  name: "Ada Lovelace",
  size: "large",
  style: { height: "4rem", width: "4rem" },
}));
assert.match(avatarMarkup, /^<span/u);
assert.match(avatarMarkup, /aria-label="Ada Lovelace avatar"/u);
assert.match(avatarMarkup, /class="hraness-avatar [^"]+ consumer-avatar"/u);
assert.match(avatarMarkup, /data-size="large"/u);
assert.match(avatarMarkup, /data-slot="avatar"/u);
assert.match(avatarMarkup, /role="img"/u);
assert.match(avatarMarkup, /style="height:4rem;width:4rem"/u);
assert.match(avatarMarkup, /title="Ada Lovelace"/u);
assert.match(avatarMarkup, /class="hraness-avatar__fallback [^"]+"/u);
assert.match(avatarMarkup, /data-slot="avatar-fallback"/u);
assert.match(avatarMarkup, />AL<\/span>/u);

const avatarImageMarkup = renderToStaticMarkup(React.createElement(Avatar, {
  "aria-label": "Grace profile",
  alt: "Grace Hopper",
  name: "Grace Hopper",
  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
}));
assert.match(avatarImageMarkup, /aria-label="Grace profile"/u);
assert.doesNotMatch(avatarImageMarkup, /role="img"/u);
assert.match(avatarImageMarkup, /class="hraness-avatar__image [^"]+"/u);
assert.match(avatarImageMarkup, /data-slot="avatar-image"/u);
assert.match(avatarImageMarkup, /alt="Grace Hopper"/u);
assert.match(avatarImageMarkup, /src="data:image\/svg\+xml/u);

const badgeMarkup = renderToStaticMarkup(React.createElement(Badge, {
  className: "consumer-badge",
  isLive: true,
  style: { minHeight: "2rem" },
  tone: "success",
}, "Ready"));
assert.match(badgeMarkup, /^<span/u);
assert.match(badgeMarkup, /aria-live="polite"/u);
assert.match(badgeMarkup, /class="hraness-badge hraness-badge--success [^"]+ consumer-badge"/u);
assert.match(badgeMarkup, /data-slot="badge"/u);
assert.match(badgeMarkup, /data-tone="success"/u);
assert.match(badgeMarkup, /role="status"/u);
assert.match(badgeMarkup, /style="min-height:2rem"/u);
assert.match(badgeMarkup, />Ready<\/span>/u);

const tagMarkup = renderToStaticMarkup(React.createElement(Tag, {
  accentColor: "#D97706",
  className: "consumer-tag",
  icon: "◆",
  style: { marginInlineStart: "1rem" },
  variant: "outline",
}, "Project"));
assert.match(tagMarkup, /^<span/u);
assert.match(tagMarkup, /class="hraness-tag [^"]+ consumer-tag"/u);
assert.match(tagMarkup, /data-slot="tag"/u);
assert.match(tagMarkup, /data-variant="outline"/u);
assert.match(tagMarkup, /--hraness-tag-accent:#D97706/u);
assert.match(tagMarkup, /margin-inline-start:1rem/u);
assert.match(tagMarkup, /class="hraness-tag__icon [^"]+"/u);
assert.match(tagMarkup, /data-slot="tag-icon"/u);
assert.match(tagMarkup, /class="hraness-tag__label [^"]+"/u);
assert.match(tagMarkup, /data-slot="tag-label"/u);

const dotMarkup = renderToStaticMarkup(React.createElement(StatusDot, {
  className: "consumer-dot",
  style: { height: "1rem", width: "1rem" },
  tone: "danger",
}));
assert.match(dotMarkup, /^<span/u);
assert.match(dotMarkup, /aria-hidden="true"/u);
assert.match(dotMarkup, /class="hraness-status-dot [^"]+ consumer-dot"/u);
assert.match(dotMarkup, /data-slot="status-dot"/u);
assert.match(dotMarkup, /data-tone="danger"/u);
assert.match(dotMarkup, /style="height:1rem;width:1rem"/u);

const cardMarkup = renderToStaticMarkup(React.createElement(Card, {
  "aria-label": "Package card",
  className: "consumer-card",
  id: "package-card",
  shape: "rectangular",
  style: { borderRadius: "5px" },
  tone: "accent",
}, React.createElement(CardHeader, null,
  React.createElement(CardTitle, null, "Project"),
  React.createElement(CardDescription, null, "Compiled card"),
), React.createElement(CardContent, null, "Ready"),
React.createElement(CardFooter, null, "Footer")));
assert.match(cardMarkup, /^<div/u);
assert.match(cardMarkup, /aria-label="Package card"/u);
assert.match(cardMarkup, /class="hraness-card [^"]+ consumer-card"/u);
assert.match(cardMarkup, /data-shape="rectangular"/u);
assert.match(cardMarkup, /data-slot="card"/u);
assert.match(cardMarkup, /data-tone="accent"/u);
assert.match(cardMarkup, /id="package-card"/u);
assert.match(cardMarkup, /--_hraness-card-description:/u);
assert.doesNotMatch(cardMarkup, /--hraness-card-description:/u);
assert.match(cardMarkup, /border-radius:5px/u);
for (const slot of [
  "card-header",
  "card-title",
  "card-description",
  "card-content",
  "card-footer",
]) assert.match(cardMarkup, new RegExp('data-slot="' + slot + '"', "u"));

const pressableMarkup = renderToStaticMarkup(React.createElement(PressableCard, {
  "aria-label": "Open project",
  className: "consumer-pressable",
  isPending: true,
  shape: "rounded",
  style: (state) => ({
    opacity: state.isPending ? 0.75 : 1,
    width: "8rem",
  }),
  tone: "inverse",
}, "Open"));
assert.match(pressableMarkup, /^<button/u);
assert.match(pressableMarkup, /aria-label="Open project"/u);
assert.match(pressableMarkup, /aria-disabled="true"/u);
assert.match(pressableMarkup, /class="hraness-pressable-card [^"]+ consumer-pressable"/u);
assert.match(pressableMarkup, /data-pending="true"/u);
assert.match(pressableMarkup, /data-slot="pressable-card"/u);
assert.match(pressableMarkup, /--_hraness-card-description:/u);
assert.doesNotMatch(pressableMarkup, /--hraness-card-description:/u);
assert.match(pressableMarkup, /opacity:0\.75/u);
assert.match(pressableMarkup, /width:8rem/u);

const toolbarMarkup = renderToStaticMarkup(React.createElement(Toolbar, {
  "aria-label": "Package editor actions",
  className: "consumer-toolbar",
  orientation: "vertical",
  style: (state) => ({
    backgroundColor: state.orientation === "vertical" ? "rgb(1, 2, 3)" : undefined,
    width: "8rem",
  }),
}, React.createElement("button", { type: "button" }, "Save")));
assert.match(toolbarMarkup, /^<div/u);
assert.match(toolbarMarkup, /role="toolbar"/u);
assert.match(toolbarMarkup, /aria-label="Package editor actions"/u);
assert.match(toolbarMarkup, /aria-orientation="vertical"/u);
assert.match(toolbarMarkup, /class="hraness-toolbar [^"]+ consumer-toolbar"/u);
assert.match(toolbarMarkup, /data-orientation="vertical"/u);
assert.match(toolbarMarkup, /data-slot="toolbar"/u);
assert.match(toolbarMarkup, /background-color:rgb\(1, 2, 3\)/u);
assert.match(toolbarMarkup, /width:8rem/u);

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
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Icon,
  PressableCard,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  StatusDot,
  Tag,
  ThemedSurface,
  Toolbar,
  ViewportFrame,
  WrappingRow,
} from "@hraness/ui";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const styles = stylex.create({
  avatar: {
    backgroundColor: "var(--ui-accent)",
    borderRadius: "var(--radius-sm)",
    height: "3rem",
    width: "3rem",
  },
  avatarDynamic: (size: string) => ({ height: size, width: size }),
  card: {
    backgroundColor: "var(--ui-primary)",
    borderColor: "var(--ui-destructive)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-primary-foreground)",
  },
  cardPart: {
    paddingInline: "var(--space-2)",
  },
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
  statusDot: {
    backgroundColor: "var(--ui-primary)",
    height: "1rem",
    width: "1rem",
  },
  statusPill: {
    backgroundColor: "var(--ui-accent)",
    borderColor: "var(--ui-primary)",
    minHeight: "2rem",
  },
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
  toolbar: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineOffset: "7px",
      outlineStyle: "dashed",
      outlineWidth: "4px",
    },
  },
  toolbarDynamic: (width: string) => ({ width }),
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
const avatarRef = createRef<HTMLSpanElement>();
const avatarMarkup: string = renderToStaticMarkup(createElement(Avatar, {
  alt: "Ada Lovelace avatar",
  className: "consumer-avatar",
  name: "Ada Lovelace",
  ref: avatarRef,
  size: "large",
  style: { height: "4rem", width: "4rem" },
  xstyle: [styles.avatar, styles.avatarDynamic("3.25rem")],
}));
const badgeRef = createRef<HTMLSpanElement>();
const badgeMarkup: string = renderToStaticMarkup(createElement(Badge, {
  children: "Ready",
  className: "consumer-badge",
  isLive: true,
  ref: badgeRef,
  style: { minHeight: "2.5rem" },
  tone: "success",
  xstyle: styles.statusPill,
}));
const tagRef = createRef<HTMLSpanElement>();
const tagMarkup: string = renderToStaticMarkup(createElement(Tag, {
  accentColor: "#D97706",
  children: "Project",
  className: "consumer-tag",
  icon: "◆",
  ref: tagRef,
  style: { minHeight: "2.5rem" },
  variant: "outline",
  xstyle: styles.statusPill,
}));
const dotRef = createRef<HTMLSpanElement>();
const dotMarkup: string = renderToStaticMarkup(createElement(StatusDot, {
  className: "consumer-dot",
  ref: dotRef,
  style: { height: "1.25rem", width: "1.25rem" },
  tone: "danger",
  xstyle: styles.statusDot,
}));
const cardRef = createRef<HTMLDivElement>();
const cardMarkup: string = renderToStaticMarkup(createElement(Card, {
  children: createElement(CardHeader, {
    children: [
      createElement(CardTitle, {
        children: "Project",
        key: "title",
        xstyle: styles.cardPart,
      }),
      createElement(CardDescription, {
        children: "Compiled card",
        key: "description",
        xstyle: styles.cardPart,
      }),
      createElement(CardContent, {
        children: "Ready",
        key: "content",
        xstyle: styles.cardPart,
      }),
      createElement(CardFooter, {
        children: "Footer",
        key: "footer",
        xstyle: styles.cardPart,
      }),
    ],
    xstyle: styles.cardPart,
  }),
  className: "consumer-card",
  ref: cardRef,
  shape: "rectangular",
  style: { borderRadius: "5px" },
  tone: "accent",
  xstyle: styles.card,
}));
const pressableRef = createRef<HTMLButtonElement>();
const pressableMarkup: string = renderToStaticMarkup(createElement(PressableCard, {
  buttonRef: pressableRef,
  children: ({ isPending }) => isPending ? "Pending" : "Open",
  className: "consumer-pressable",
  isPending: true,
  onPress: () => undefined,
  shape: "rounded",
  style: ({ isFocusVisible }) => ({
    outlineColor: isFocusVisible ? "red" : undefined,
    width: "8rem",
  }),
  tone: "inverse",
  xstyle: styles.card,
}));
const toolbarRef = createRef<HTMLDivElement>();
const toolbarMarkup: string = renderToStaticMarkup(createElement(Toolbar, {
  "aria-label": "Package editor actions",
  children: createElement("button", { type: "button" }, "Save"),
  className: "consumer-toolbar",
  orientation: "vertical",
  ref: toolbarRef,
  style: ({ orientation }) => ({ width: orientation === "vertical" ? "15rem" : "13rem" }),
  xstyle: [styles.toolbar, styles.toolbarDynamic("14rem")],
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
// @ts-expect-error Avatar keeps its size set finite.
const invalidAvatarSizeMarkup = renderToStaticMarkup(createElement(Avatar, { name: "Ada", size: "medium" }));
// @ts-expect-error Badge keeps its tone set finite.
const invalidBadgeToneMarkup = renderToStaticMarkup(createElement(Badge, { children: "Badge", tone: "primary" }));
// @ts-expect-error StatusDot keeps its tone set finite.
const invalidDotToneMarkup = renderToStaticMarkup(createElement(StatusDot, { tone: "primary" }));
// @ts-expect-error Tag keeps its variant set finite.
const invalidTagVariantMarkup = renderToStaticMarkup(createElement(Tag, { children: "Tag", variant: "primary" }));
// @ts-expect-error accentColor is available only for outline Tags.
const invalidTagAccentMarkup = renderToStaticMarkup(createElement(Tag, { accentColor: "red", children: "Tag", variant: "muted" }));
// @ts-expect-error Card keeps its tone set finite.
const invalidCardToneMarkup = renderToStaticMarkup(createElement(Card, { tone: "popover" }));
// @ts-expect-error Card keeps its shape set finite.
const invalidCardShapeMarkup = renderToStaticMarkup(createElement(Card, { shape: "pill" }));
// @ts-expect-error PressableCard keeps className static for stable semantic composition.
const invalidPressableClassMarkup = renderToStaticMarkup(createElement(PressableCard, { children: "Open", className: () => "dynamic" }));
// @ts-expect-error Toolbar requires exactly one accessible naming method.
const unnamedToolbarMarkup = renderToStaticMarkup(createElement(Toolbar, { children: "Commands" }));
// @ts-expect-error Toolbar rejects competing accessible naming methods.
const multiplyNamedToolbarMarkup = renderToStaticMarkup(createElement(Toolbar, { "aria-label": "Commands", "aria-labelledby": "commands", children: "Commands" }));
// @ts-expect-error Toolbar keeps className static for stable semantic composition.
const invalidToolbarClassMarkup = renderToStaticMarkup(createElement(Toolbar, { "aria-label": "Commands", className: () => "dynamic" }));

void markup;
void socialMarkup;
void appearanceMarkup;
void avatarMarkup;
void badgeMarkup;
void tagMarkup;
void dotMarkup;
void cardMarkup;
void pressableMarkup;
void toolbarMarkup;
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
void invalidAvatarSizeMarkup;
void invalidBadgeToneMarkup;
void invalidDotToneMarkup;
void invalidTagVariantMarkup;
void invalidTagAccentMarkup;
void invalidCardToneMarkup;
void invalidCardShapeMarkup;
void invalidPressableClassMarkup;
void unnamedToolbarMarkup;
void multiplyNamedToolbarMarkup;
void invalidToolbarClassMarkup;
`;

const viteClient = `import "@hraness/ui/styles.css";
import { Card, CardDescription, PressableCard, Toolbar } from "@hraness/ui";
import * as React from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) throw new Error("Vite package smoke root is missing");
createRoot(root).render(React.createElement(React.Fragment, null,
  React.createElement(Card, { tone: "accent" },
    React.createElement(CardDescription, null, "Vite card"),
  ),
  React.createElement(PressableCard, {
    onPress: () => undefined,
    tone: "inverse",
  }, "Vite pressable card"),
  React.createElement(Toolbar, {
    "aria-label": "Vite editor actions",
    orientation: "vertical",
  }, React.createElement("button", { type: "button" }, "Save")),
));
`;

const viteHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Vite package smoke</title></head>
  <body><div id="root"></div><script type="module" src="/vite-client.ts"></script></body>
</html>
`;

const viteConfig = `import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "vite-dist",
  },
});
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
    "vite@^7.0.0",
    "--ignore-scripts",
  ], consumer);
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "quiet-site.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "avatar.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "card.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "status.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "surfaces.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "toolbar.stylex.ts"),
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

  await Promise.all([
    writeFile(join(consumer, "index.html"), viteHtml),
    writeFile(join(consumer, "vite-client.ts"), viteClient),
    writeFile(join(consumer, "vite.config.ts"), viteConfig),
  ]);
  await run([
    process.execPath,
    "x",
    "vite",
    "build",
    "--config",
    "./vite.config.ts",
  ], consumer);
  const viteAssets = await readdir(join(consumer, "vite-dist", "assets"));
  const viteJavaScriptPath = viteAssets.find((file) => file.endsWith(".js"));
  const viteCssPath = viteAssets.find((file) => file.endsWith(".css"));
  assert.ok(viteJavaScriptPath !== undefined, "Vite must emit package JavaScript");
  assert.ok(viteCssPath !== undefined, "Vite must emit the package stylesheet");
  const [viteJavaScript, viteCss] = await Promise.all([
    readFile(join(consumer, "vite-dist", "assets", viteJavaScriptPath), "utf8"),
    readFile(join(consumer, "vite-dist", "assets", viteCssPath), "utf8"),
  ]);
  assert.match(viteJavaScript, /hraness-pressable-card/u);
  assert.match(viteJavaScript, /hraness-toolbar/u);
  assert.match(viteJavaScript, /--_hraness-card-description/u);
  assert.match(viteCss, /color:var\(--hraness-card-description\)/u);
  assert.match(viteCss, /:hover\{/u);
  assert.match(viteCss, /outline-offset:2px/u);
  const viteCssWithoutCardBridge = viteCss.replace(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    "",
  );
  assert.equal(
    viteCss.match(
      /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    )?.length,
    1,
    "Vite must preserve the single Card description compatibility bridge",
  );
  assert.doesNotMatch(
    viteCssWithoutCardBridge,
    /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
  );
  assert.doesNotMatch(viteCss, /\.hraness-toolbar(?![A-Za-z0-9_-])/u);
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
