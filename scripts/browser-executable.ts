import { accessSync, constants, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";

const require = createRequire(import.meta.url);
const requiredDisabledFeatures = ["PaintHolding", "MacAppCodeSignClone"];
let definition: Readonly<{ defaultArgs: readonly string[]; expectedVersion: string }> | undefined;

export function pinnedChromiumDefinition(): Readonly<{ defaultArgs: readonly string[]; expectedVersion: string }> {
  if (definition !== undefined) return definition;
  const coreRoot = dirname(require.resolve("playwright-core/package.json"));
  const installed = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")).version;
  const pinned = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).devDependencies["playwright-core"];
  if (installed !== pinned) throw new Error("Install the repository's pinned Playwright version before browser verification");
  const browser = JSON.parse(readFileSync(join(coreRoot, "browsers.json"), "utf8")).browsers.find((entry: { name: string }) => entry.name === "chromium");
  // The pinned server formatter supplies its actual defaults without launching a
  // browser. A Playwright upgrade must requalify this binding; do not guess flags.
  const { server } = require(join(coreRoot, "lib/coreBundle.js"));
  const formatter = server?.createPlaywright?.({ sdkLanguage: "javascript" }).chromium;
  if (typeof formatter?._innerDefaultArgs !== "function" || typeof browser?.browserVersion !== "string") {
    throw new Error("Cannot reconcile pinned Playwright's Chromium definition");
  }
  const defaultArgs: unknown = formatter._innerDefaultArgs({ headless: true });
  if (!Array.isArray(defaultArgs) || !defaultArgs.every((arg) => typeof arg === "string")) {
    throw new Error("Cannot reconcile pinned Playwright's Chromium switches");
  }
  definition = Object.freeze({ defaultArgs: Object.freeze(defaultArgs), expectedVersion: browser.browserVersion });
  return definition;
}

function rejectInstalledChrome(path: string): void {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (/\/google chrome(?: beta| dev| canary)?\.app\//u.test(normalized) ||
      /\/opt\/google\/chrome(?:-beta|-unstable)?\//u.test(normalized) ||
      /\/google\/chrome(?: beta| dev| sxs)?\/application\//u.test(normalized)) {
    throw new Error("Installed Google Chrome is not permitted for owned browser verification");
  }
}

export function validatePinnedBrowserExecutable(candidate: string, pinned: string): string {
  rejectInstalledChrome(candidate);
  let executable: string;
  let expected: string;
  try {
    executable = realpathSync(candidate);
    rejectInstalledChrome(executable);
    expected = realpathSync(pinned);
    rejectInstalledChrome(expected);
    if (!statSync(executable).isFile()) throw new Error("Chromium executable is not a regular file");
    accessSync(executable, constants.X_OK);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Installed Google Chrome")) throw error;
    throw new Error("Provision pinned Chromium first: bunx --no-install playwright-core install chromium", { cause: error });
  }
  if (executable !== expected || !executable.split(/[\\/]/u).some((part) => /^chromium-\d+$/u.test(part))) {
    throw new Error("Browser verification requires the Chromium provisioned for pinned Playwright");
  }
  return executable;
}

export async function resolveFirstBrowserExecutable(paths: readonly string[], _missingMessage: string): Promise<string> {
  if (paths.length > 1) throw new Error("Browser executable fallbacks are not permitted; provision pinned Playwright Chromium");
  const pinned = chromium.executablePath();
  return validatePinnedBrowserExecutable(paths[0] ?? pinned, pinned);
}

export function ownedBrowserArguments(defaultArgs: readonly string[], args: readonly string[] = []): Pick<LaunchOptions, "args" | "ignoreDefaultArgs"> {
  const defaults = defaultArgs.filter((arg) => arg.startsWith("--disable-features="));
  if (defaults.length !== 1) throw new Error("Cannot reconcile pinned Playwright's disable-features switch");
  if (args.includes("--disable-features")) throw new Error("Use --disable-features=value for Chromium features");
  const supplied = args.filter((arg) => arg.startsWith("--disable-features="));
  const features = [...new Set([...defaults, ...supplied].flatMap((arg) => arg.slice("--disable-features=".length).split(",")).map((feature) => feature.trim()).filter(Boolean).concat(requiredDisabledFeatures))];
  const mergedFeatures = `--disable-features=${features.join(",")}`;
  const useDefaultFeatures = mergedFeatures === defaults[0];
  // Browser.getBrowserCommandLine requires --enable-automation, which newer
  // Playwright defaults omit. Retain either flag from defaults or supply it once.
  const ownedFlags = ["--mute-audio", "--enable-automation"];
  return {
    // Playwright filters the complete command line, including supplied args.
    ignoreDefaultArgs: useDefaultFeatures ? [] : defaults,
    args: [...args.filter((arg) => !arg.startsWith("--disable-features=") && !ownedFlags.includes(arg)), ...ownedFlags.filter((flag) => !defaultArgs.includes(flag)), ...(useDefaultFeatures ? [] : [mergedFeatures])],
  };
}

export function ownedChromiumLaunchOptions(executablePath: string, args: readonly string[] = []): LaunchOptions & { executablePath: string } {
  return {
    executablePath: validatePinnedBrowserExecutable(executablePath, chromium.executablePath()),
    headless: true,
    ...ownedBrowserArguments(pinnedChromiumDefinition().defaultArgs, args),
  };
}

export async function verifyOwnedChromium(browser: Browser, executablePath: string): Promise<{ executable: string; browserVersion: string }> {
  const expectedVersion = pinnedChromiumDefinition().expectedVersion;
  const browserVersion = browser.version();
  if (browserVersion !== expectedVersion) throw new Error(`Provisioned Chromium version mismatch: expected ${expectedVersion}, got ${browserVersion}`);
  const session = await browser.newBrowserCDPSession();
  try {
    const { arguments: args } = await session.send("Browser.getBrowserCommandLine");
    if (realpathSync(args[0]!) !== executablePath) throw new Error("Chromium did not launch the resolved provisioned executable");
    const disabled = args.filter((arg) => arg.startsWith("--disable-features="));
    if (disabled.length !== 1 || !requiredDisabledFeatures.every((feature) => disabled[0]!.slice("--disable-features=".length).split(",").includes(feature))) {
      throw new Error("Owned Chromium must merge the required disabled features into one switch");
    }
    if (!args.includes("--mute-audio")) throw new Error("Owned Chromium must mute audio");
  } finally { await session.detach(); }
  return { executable: executablePath, browserVersion };
}

export async function launchOwnedChromium(executablePath: string, args: readonly string[] = []): Promise<Browser> {
  const options = ownedChromiumLaunchOptions(executablePath, args);
  const browser = await chromium.launch(options);
  try {
    console.log("owned_browser", JSON.stringify(await verifyOwnedChromium(browser, options.executablePath)));
    return browser;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
