import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";

// Match the pinned Playwright 1.62.0 default exactly, so replacing it preserves
// its feature guards without passing a second --disable-features switch.
const playwrightDisabledFeatures = "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion";
const versionedChromeForTesting = /\/chrome-for-testing\/(\d+\.\d+\.\d+\.\d+)\/(?:chrome-mac-(?:arm64|x64)\/Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing|chrome-linux64\/chrome|chrome-win(?:32|64)\/chrome\.exe)$/u;

export function browserExecutableCandidates(): readonly string[] {
  return process.env.CHROMIUM_EXECUTABLE_PATH === undefined
    ? [chromium.executablePath()]
    : [process.env.CHROMIUM_EXECUTABLE_PATH];
}

export function browserLaunchOptions(args: readonly string[] = []): {
  args: string[];
  ignoreDefaultArgs: string[];
} {
  const disabled = new Set(playwrightDisabledFeatures.slice("--disable-features=".length).split(","));
  disabled.add("PaintHolding");
  disabled.add("MacAppCodeSignClone");
  for (const arg of args) {
    if (arg.startsWith("--disable-features=")) {
      for (const feature of arg.slice("--disable-features=".length).split(",").filter(Boolean)) disabled.add(feature);
    }
  }
  return {
    args: [
      ...args.filter((arg) => !arg.startsWith("--disable-features=") && arg !== "--mute-audio" && arg !== "--enable-automation"),
      "--enable-automation",
      "--mute-audio",
      `--disable-features=${[...disabled].join(",")}`,
    ],
    ignoreDefaultArgs: [playwrightDisabledFeatures],
  };
}

export async function resolveFirstBrowserExecutable(
  paths: readonly string[],
  missingMessage: string,
): Promise<string> {
  for (const path of paths) {
    try {
      if ((await lstat(path)).isSymbolicLink()) continue;
      const target = await realpath(path);
      if (resolve(path) !== target) continue;
      if (!versionedChromeForTesting.test(target) && target !== chromium.executablePath()) continue;
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await access(target, constants.X_OK);
      return target;
    } catch {
      // Missing provisioned browsers never fall back to an updating system app.
    }
  }
  throw new Error(missingMessage);
}

export async function verifyBrowserLaunch(browser: Browser, executablePath: string): Promise<void> {
  const declaredVersion = versionedChromeForTesting.exec(executablePath)?.[1];
  if (declaredVersion !== undefined && browser.version() !== declaredVersion) {
    throw new Error(`Chrome for Testing version ${browser.version()} does not match ${executablePath}`);
  }
  const session = await browser.newBrowserCDPSession();
  try {
    const { arguments: args } = await session.send("Browser.getBrowserCommandLine");
    const switches = args.filter((arg: string) => arg.startsWith("--disable-features="));
    if (switches.length !== 1 || !args.includes("--mute-audio")) {
      throw new Error(`Owned browser launch must mute audio and merge one disabled-features switch: ${JSON.stringify(args)}`);
    }
    const disabled = new Set(switches[0]!.slice("--disable-features=".length).split(","));
    if (!["PaintHolding", "MacAppCodeSignClone", "DestroyProfileOnBrowserClose"].every((feature) => disabled.has(feature))) {
      throw new Error("Owned browser launch lost required Chromium feature guards");
    }
  } finally {
    await session.detach();
  }
  console.log(JSON.stringify({ browserExecutable: executablePath, browserVersion: browser.version() }));
}
