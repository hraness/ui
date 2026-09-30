import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { browserLaunchOptions, resolveFirstBrowserExecutable } from "./browser-executable.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("resolveFirstBrowserExecutable", () => {
  test("rejects installed Chrome and a symlink to it", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "hraness-browser-executable-")));
    temporaryDirectories.push(directory);
    const target = join(directory, "chrome-target");
    const launcher = join(directory, "google-chrome");
    await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await symlink(target, launcher);

    await expect(resolveFirstBrowserExecutable([target, launcher,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome", "/usr/bin/chromium",
    ], "missing provisioned browser")).rejects.toThrow("missing provisioned browser");
  });

  test("skips broken links and non-executable files", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "hraness-browser-executable-")));
    temporaryDirectories.push(directory);
    const broken = join(directory, "broken-chrome");
    const nonExecutable = join(directory, "non-executable-chrome");
    const executable = join(directory, "chrome-for-testing", "154.0.8037.57", "chrome-linux64", "chrome");
    await Bun.write(executable, "#!/bin/sh\nexit 0\n");
    await symlink(join(directory, "missing-target"), broken);
    await writeFile(nonExecutable, "not executable\n", { mode: 0o600 });
    await chmod(executable, 0o700);

    assert.equal(
      await resolveFirstBrowserExecutable([broken, nonExecutable, executable], "missing browser"),
      await realpath(executable),
    );
    await chmod(executable, 0o600);
    await expect(
      resolveFirstBrowserExecutable([broken, nonExecutable, executable], "missing browser"),
    ).rejects.toThrow("missing browser");
  });

  test("rejects a symlink even when it points to versioned Chrome for Testing", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "hraness-browser-executable-")));
    temporaryDirectories.push(directory);
    const target = join(directory, "chrome-for-testing", "154.0.8037.57", "chrome-linux64", "chrome");
    await Bun.write(target, "#!/bin/sh\nexit 0\n");
    await chmod(target, 0o700);
    const launcher = join(directory, "launcher");
    await symlink(target, launcher);
    await expect(resolveFirstBrowserExecutable([launcher], "missing provisioned browser")).rejects.toThrow("missing provisioned browser");
  });
});

test("owned launch mutes audio and merges feature guards in one switch", () => {
  const options = browserLaunchOptions(["--no-sandbox", "--disable-features=CustomFeature,PaintHolding", "--mute-audio", "--disable-features=OtherFeature"]);
  assert.equal(options.args.filter((arg) => arg === "--mute-audio").length, 1);
  assert.ok(options.args.includes("--no-sandbox"));
  const switches = options.args.filter((arg) => arg.startsWith("--disable-features="));
  assert.equal(switches.length, 1);
  const features = switches[0]!.slice("--disable-features=".length).split(",");
  for (const feature of ["CustomFeature", "OtherFeature", "PaintHolding", "MacAppCodeSignClone", "DestroyProfileOnBrowserClose"]) assert.ok(features.includes(feature));
  assert.equal(features.filter((feature) => feature === "PaintHolding").length, 1);
  assert.equal(options.ignoreDefaultArgs.length, 1);
});
