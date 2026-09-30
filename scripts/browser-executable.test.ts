import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import type { Browser } from "playwright-core";

import { ownedBrowserArguments, pinnedChromiumDefinition, resolveFirstBrowserExecutable, validatePinnedBrowserExecutable, verifyOwnedChromium } from "./browser-executable.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("resolveFirstBrowserExecutable", () => {
  test("rejects an explicit installed Chrome executable and a symlink to it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-installed-browser-regression-"));
    temporaryDirectories.push(directory);
    const installed = join(directory, "Google Chrome.app", "Contents", "MacOS", "Google Chrome");
    await mkdir(join(directory, "Google Chrome.app", "Contents", "MacOS"), { recursive: true });
    await writeFile(installed, "fixture; never executed", { mode: 0o700 });
    const link = join(directory, "chrome-link");
    await symlink(installed, link);
    await expect(resolveFirstBrowserExecutable([installed], "missing browser")).rejects.toThrow("Installed Google Chrome");
    await expect(resolveFirstBrowserExecutable([link], "missing browser")).rejects.toThrow("Installed Google Chrome");
  });
  test("resolves a symlink only to the pinned provisioned executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-browser-executable-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "chromium-1234", "chrome");
    const launcher = join(directory, "provisioned-chromium");
    await mkdir(dirname(target));
    await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await symlink(target, launcher);

    expect(validatePinnedBrowserExecutable(launcher, target)).toBe(await realpath(target));
    const other = join(dirname(target), "other-browser");
    await writeFile(other, "fixture; never executed", { mode: 0o700 });
    expect(() => validatePinnedBrowserExecutable(other, target)).toThrow("provisioned for pinned Playwright");
  });

  test("missing and non-executable browsers fail without fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-browser-executable-"));
    temporaryDirectories.push(directory);
    const broken = join(directory, "broken-chrome");
    const nonExecutable = join(directory, "non-executable-chrome");
    const executable = join(directory, "chromium-1234", "chrome");
    await mkdir(dirname(executable));
    await symlink(join(directory, "missing-target"), broken);
    await writeFile(nonExecutable, "not executable\n", { mode: 0o600 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    expect(() => validatePinnedBrowserExecutable(broken, executable)).toThrow("Provision pinned Chromium first");
    expect(() => validatePinnedBrowserExecutable(nonExecutable, executable)).toThrow("Provision pinned Chromium first");
    await expect(resolveFirstBrowserExecutable([broken, nonExecutable, executable], "missing browser")).rejects.toThrow("fallbacks are not permitted");
    await chmod(executable, 0o600);
    expect(() => validatePinnedBrowserExecutable(executable, executable)).toThrow("Provision pinned Chromium first");
  });

  test("merges framework and caller features into one switch and mutes audio", () => {
    const { defaultArgs, expectedVersion } = pinnedChromiumDefinition();
    expect(expectedVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
    const options = ownedBrowserArguments(defaultArgs, ["--custom-flag", "--disable-features=CallerFeature,PaintHolding", "--disable-features=OtherFeature", "--mute-audio"]);
    const ignored = options.ignoreDefaultArgs as string[];
    const effective = [...defaultArgs, ...options.args!].filter((arg) => !ignored.includes(arg));
    const disabled = effective.filter((arg) => arg.startsWith("--disable-features="));
    expect(disabled).toHaveLength(1);
    const features = disabled[0]!.slice("--disable-features=".length).split(",");
    const defaults = defaultArgs.find((arg) => arg.startsWith("--disable-features="))!.slice("--disable-features=".length).split(",");
    for (const feature of [...defaults, "PaintHolding", "MacAppCodeSignClone", "CallerFeature", "OtherFeature"]) expect(features).toContain(feature);
    expect(new Set(features).size).toBe(features.length);
    expect(effective.filter((arg) => arg === "--mute-audio")).toHaveLength(1);
    expect(effective).toContain("--custom-flag");
    expect(() => ownedBrowserArguments([])).toThrow("Cannot reconcile");
    expect(() => ownedBrowserArguments(["--disable-features=A", "--disable-features=B"])).toThrow("Cannot reconcile");
    expect(() => ownedBrowserArguments(defaultArgs, ["--disable-features"])).toThrow("Use --disable-features=value");
  });

  test("Playwright's complete-argv filter retains audio and an already compliant default switch", () => {
    for (const initial of [pinnedChromiumDefinition().defaultArgs, ["--disable-features=PaintHolding,MacAppCodeSignClone"]]) {
      const options = ownedBrowserArguments(initial);
      const ignored = options.ignoreDefaultArgs as string[];
      const actual = [...initial, ...options.args!].filter((arg) => !ignored.includes(arg));
      expect(actual).toContain("--mute-audio");
      expect(actual.filter((arg) => arg.startsWith("--disable-features="))).toHaveLength(1);
      expect(actual.some((arg) => arg.includes("MacAppCodeSignClone"))).toBe(true);
    }
  });

  test("owned browser launches enable command-line verification when Playwright omits it", () => {
    const initial = pinnedChromiumDefinition().defaultArgs.filter((arg) => arg !== "--enable-automation");
    const options = ownedBrowserArguments(initial);
    const ignored = options.ignoreDefaultArgs as string[];
    const actual = [...initial, ...options.args!].filter((arg) => !ignored.includes(arg));
    expect(actual).toContain("--enable-automation");
  });

  test("checks actual browser identity and flags and always detaches its CDP session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-browser-identity-"));
    temporaryDirectories.push(directory);
    const executable = join(directory, "fixture-executable");
    await writeFile(executable, "fixture; never executed", { mode: 0o700 });
    const realExecutable = await realpath(executable);
    const { expectedVersion } = pinnedChromiumDefinition();
    const flags = ["--mute-audio", "--disable-features=PaintHolding,MacAppCodeSignClone"];
    let detached = 0;
    const fakeBrowser = (version: string, args: string[]) => ({
      version: () => version,
      newBrowserCDPSession: async () => ({ send: async () => ({ arguments: args }), detach: async () => { detached += 1; } }),
    }) as unknown as Browser;
    await expect(verifyOwnedChromium(fakeBrowser(expectedVersion, [realExecutable, ...flags]), realExecutable)).resolves.toEqual({ executable: realExecutable, browserVersion: expectedVersion });
    expect(detached).toBe(1);
    await expect(verifyOwnedChromium(fakeBrowser("0.0.0.0", [realExecutable, ...flags]), realExecutable)).rejects.toThrow("version mismatch");
    expect(detached).toBe(1);
    for (const invalid of [flags.slice(1), ["--mute-audio", "--disable-features=PaintHolding"], [...flags, "--disable-features=Other"]]) {
      await expect(verifyOwnedChromium(fakeBrowser(expectedVersion, [realExecutable, ...invalid]), realExecutable)).rejects.toThrow();
    }
    expect(detached).toBe(4);
  });

  test("every owned launcher and its CI job uses the provisioned browser route", () => {
    for (const script of ["gallery-browser.ts", "opacity-browser.ts", "vite-adopter-smoke.ts", "next-adopter-smoke.ts", "vite8-adopter-smoke.ts"]) {
      const source = readFileSync(join(import.meta.dir, script), "utf8");
      expect(source).not.toContain("Google Chrome.app");
      expect(source).not.toContain("/usr/bin/google-chrome");
      expect(source).not.toContain("chromium.launch(");
      expect(source).toContain("resolveFirstBrowserExecutable(");
      if (script !== "vite8-adopter-smoke.ts") expect(source).toContain("launchOwnedChromium(");
    }
    const worker = readFileSync(join(import.meta.dir, "../fixtures/vite8-adopter/browser-worker.ts"), "utf8");
    expect(worker).toContain("ownedChromiumLaunchOptions(request.executablePath)");
    expect(worker).toContain("...launchOptions, host:");
    expect(worker).toContain("verifyOwnedChromium(browser, launchOptions.executablePath)");
    const custody = readFileSync(join(import.meta.dir, "vite8-adopter-custody.process.test.ts"), "utf8");
    expect(custody).not.toContain("Google Chrome.app");
    expect(custody).not.toContain("/usr/bin/google-chrome");
    expect(custody).toContain("resolveFirstBrowserExecutable(");
    const workflow = readFileSync(join(import.meta.dir, "../.github/workflows/checks.yml"), "utf8");
    for (const job of ["package", "vite", "next", "browser"]) {
      const section = workflow.slice(workflow.indexOf(`\n  ${job}:`)).split(/\n  [a-z]+:/u)[1];
      assert.ok(section !== undefined);
      expect(section).toContain("bunx --no-install playwright-core install --with-deps chromium");
    }
  });
});
