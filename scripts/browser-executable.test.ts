import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { resolveFirstBrowserExecutable } from "./browser-executable.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

describe("resolveFirstBrowserExecutable", () => {
  test("resolves a symlink to its ordinary executable target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-browser-executable-"));
    temporaryDirectories.push(directory);
    const target = join(directory, "chrome-target");
    const launcher = join(directory, "google-chrome");
    await writeFile(target, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await symlink(target, launcher);

    await expect(resolveFirstBrowserExecutable([launcher], "missing browser")).resolves.toBe(
      await realpath(target),
    );
  });

  test("skips broken links and non-executable files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hraness-browser-executable-"));
    temporaryDirectories.push(directory);
    const broken = join(directory, "broken-chrome");
    const nonExecutable = join(directory, "non-executable-chrome");
    const executable = join(directory, "chromium");
    await symlink(join(directory, "missing-target"), broken);
    await writeFile(nonExecutable, "not executable\n", { mode: 0o600 });
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    assert.equal(
      await resolveFirstBrowserExecutable([broken, nonExecutable, executable], "missing browser"),
      await realpath(executable),
    );
    await chmod(executable, 0o600);
    await expect(
      resolveFirstBrowserExecutable([broken, nonExecutable, executable], "missing browser"),
    ).rejects.toThrow("missing browser");
  });
});
