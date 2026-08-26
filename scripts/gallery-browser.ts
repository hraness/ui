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
import { basename, join, relative, resolve } from "node:path";

import {
  chromium,
  type BrowserContextOptions,
  type Page,
} from "playwright-core";

const BUN_VERSION = "1.3.14";
const HUGEICONS_VERSION = "4.2.2";
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
  readonly bodyBackground: string;
  readonly buttonBackground: string;
  readonly buttonMinHeight: number;
  readonly cardBorderStyle: string;
  readonly clientWidth: number;
  readonly colorScheme: string;
  readonly documentScrollWidth: number;
  readonly footerPresent: boolean;
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
  readonly stylexRuntimeStyleCount: number;
  readonly stylesheetCount: number;
  readonly stylesheetMarked: boolean;
  readonly substackAriaHidden: string;
  readonly substackFill: string;
  readonly substackHasPath: boolean;
  readonly substackIconHeight: number;
  readonly substackIconWidth: number;
  readonly theme: string;
  readonly transitionDuration: string;
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
    root: consumer,
    splitting: false,
    target: "browser",
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n"));
  }

  const files = await filesBelow(outdir);
  const javaScriptPath = requireExactlyOne(files, ".js", entrypoint);
  const cssPath = requireExactlyOne(files, ".css", entrypoint);
  const [javaScript, css] = await Promise.all([
    readFile(javaScriptPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);
  return { css, cssPath, javaScript, javaScriptPath };
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
    /@layer\s+components\.hraness-ui\.legacy\s*,\s*components\.hraness-ui\.priority1\s*,\s*components\.hraness-ui\.priority2/u,
    "the packed default stylesheet must freeze the package layer order",
  );
  assert.match(
    css,
    /\.hraness-button(?:__control)?(?=[\s,{:.])/u,
    "the packed default stylesheet must include legacy action recipes",
  );
  assert.match(
    css,
    /\.hraness-quiet-site-page(?=[\s,{:.])/u,
    "the packed default stylesheet must include quiet-site recipes",
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
    const iconBox = icon.getBoundingClientRect();

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
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      buttonBackground: buttonStyle.backgroundColor,
      buttonMinHeight: Number.parseFloat(buttonStyle.minHeight),
      cardBorderStyle: getComputedStyle(card).borderStyle,
      clientWidth: document.documentElement.clientWidth,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      documentScrollWidth: document.documentElement.scrollWidth,
      footerPresent: footer instanceof HTMLElement,
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
      mainPresent: main instanceof HTMLElement && main.tagName === "MAIN",
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
      transitionDuration: buttonStyle.transitionDuration,
    };
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

async function verifyKeyboardPath(page: Page, id: string): Promise<void> {
  await page.keyboard.press("Tab");
  const skipLink = page.locator('[data-slot="skip-link"]');
  const skipLinkFocus = await skipLink.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      focusVisible:
        document.activeElement === element && element.matches(":focus-visible"),
      intersectsViewport:
        box.bottom > 0
        && box.right > 0
        && box.left < document.documentElement.clientWidth
        && box.top < document.documentElement.clientHeight,
      opacity: Number.parseFloat(style.opacity),
      visibility: style.visibility,
    };
  });
  invariant(
    skipLinkFocus.focusVisible
    && skipLinkFocus.intersectsViewport
    && skipLinkFocus.opacity > 0
    && skipLinkFocus.visibility === "visible",
    `${id}: the first keyboard stop is not the visible skip link`,
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
    if (
      !(button instanceof HTMLElement)
      || !(card instanceof HTMLElement)
      || !(selectedTab instanceof HTMLElement)
      || !(spinner instanceof HTMLElement)
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
    return {
      buttonBackground: buttonStyle.backgroundColor,
      buttonFace: normalize("backgroundColor", "ButtonFace"),
      buttonText: normalize("color", "ButtonText"),
      buttonTextColor: buttonStyle.color,
      canvasText: normalize("color", "CanvasText"),
      cardBorderColor: cardStyle.borderColor,
      cardForcedColorAdjust: cardStyle.forcedColorAdjust,
      forcedColorsActive: matchMedia("(forced-colors: active)").matches,
      selectedTabBackground: tabStyle.backgroundColor,
      selectedTabColor: tabStyle.color,
      spinnerAnimationName: getComputedStyle(spinner).animationName,
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
    /data-gallery-stylex-layer-conflict/u,
    "the gallery conflict sentinel must not enter package CSS",
  );

  const productionDirectory = resolve(consumer, "dist/browser");
  const negativeDirectory = resolve(consumer, "dist/unstyled-negative-control");
  const [production, negativeControl] = await Promise.all([
    buildBrowserEntry(consumer, "gallery/client.tsx", productionDirectory),
    buildBrowserEntry(consumer, "gallery/unstyled-client.tsx", negativeDirectory),
  ]);
  requirePackedDefaultStylesheet(production.css);
  assert.throws(
    () => requirePackedDefaultStylesheet(negativeControl.css),
    /must include the package StyleX layer/u,
    "the stylesheet delivery oracle must reject the unstyled negative-control consumer",
  );
  assert.match(production.javaScript, /__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__/u);
  assert.match(production.javaScript, /hydrateRoot/u);
  assert.doesNotMatch(
    negativeControl.css,
    /@layer components\.hraness-ui\.priority[12]/u,
    "the unstyled negative control must not accidentally receive package StyleX CSS",
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
    "./gallery/render.tsx",
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
  assert.match(html, /data-slot="quiet-site-page"/u);
  assert.match(html, new RegExp(`href="/${stylesheetName.replace(".", "\\.")}"`, "u"));
  assert.match(html, new RegExp(`src="/${clientName.replace(".", "\\.")}"`, "u"));
  await cp(htmlPath, resolve(productionDirectory, "index.html"));

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
          invariant(dark.recoverableErrors.length === 0, `${layout.id}: interaction introduced hydration recovery`);
          invariant(failures.length === 0, `${layout.id}: ${failures.join("; ")}`);
        } finally {
          await context.close();
        }
      }

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
    } finally {
      await browser.close();
      browserClosed = true;
    }
  } finally {
    await server.stop(true);
  }
  invariant(browserClosed, "the primitive gallery browser did not close cleanly");
  console.log(
    "Primitive gallery browser passed: packed default CSS and layer order, a matched gallery-only legacy conflict losing to StyleX, SSR/hydration, semantic StyleX glyph and wrapper behavior, compact/short layouts, keyboard focus, light/dark, reduced motion, forced colors, network/console diagnostics, and cleanup.",
  );
} finally {
  await rm(work, { force: true, recursive: true });
  assert.equal(await Bun.file(work).exists(), false, "the primitive gallery temporary directory must be removed");
}
