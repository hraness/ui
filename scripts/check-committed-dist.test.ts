import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  cleanupDistPromotion,
  commitDistPromotion,
  DistPromotionCleanupError,
  DistPromotionRestoreError,
} from "./build-package.js";
import { checkCommittedDist } from "./check-committed-dist.js";

async function git(repository: string, ...arguments_: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...arguments_], {
    cwd: repository,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${arguments_.join(" ")} failed (${String(exitCode)}):\n${stderr.trimEnd()}`,
    );
  }
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(
    join(tmpdir(), "hraness-ui-committed-dist-"),
  );
  try {
    await git(repository, "init", "--quiet");
    await Promise.all([
      mkdir(resolve(repository, "dist"), { recursive: true }),
      mkdir(resolve(repository, "src"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(resolve(repository, ".gitignore"), "/dist/ignored.js\n"),
      writeFile(resolve(repository, "README.md"), "baseline\n"),
      writeFile(resolve(repository, "dist/index.js"), "export const value = 1;\n"),
      writeFile(resolve(repository, "dist/stylex.css"), ".root {}\n"),
      writeFile(resolve(repository, "src/index.ts"), "export {};\n"),
    ]);
    await git(repository, "add", "--all");
    await git(
      repository,
      "-c",
      "user.name=Committed Dist Test",
      "-c",
      "user.email=committed-dist@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "baseline",
    );
    return repository;
  } catch (error) {
    await rm(repository, { force: true, recursive: true });
    throw error;
  }
}

async function withRepository(
  run: (repository: string) => Promise<void>,
): Promise<void> {
  const repository = await createRepository();
  try {
    await run(repository);
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
}

async function requireFailure(repository: string): Promise<Error> {
  try {
    await checkCommittedDist(repository);
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the committed-dist guard to fail");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) return false;
    throw error;
  }
}

test("accepts clean committed dist output", async () => {
  await withRepository(async (repository) => {
    await expect(checkCommittedDist(repository)).resolves.toBeUndefined();
  });
});

test("ignores tracked and untracked changes outside dist", async () => {
  await withRepository(async (repository) => {
    await Promise.all([
      writeFile(resolve(repository, "README.md"), "changed outside dist\n"),
      writeFile(resolve(repository, "generated.txt"), "untracked outside dist\n"),
    ]);
    await expect(checkCommittedDist(repository)).resolves.toBeUndefined();
  });
});

test("ignores files excluded by the repository ignore rules", async () => {
  await withRepository(async (repository) => {
    await writeFile(resolve(repository, "dist/ignored.js"), "ignored\n");
    await expect(checkCommittedDist(repository)).resolves.toBeUndefined();
  });
});

test("rejects staged dist changes", async () => {
  await withRepository(async (repository) => {
    await writeFile(resolve(repository, "dist/index.js"), "export const value = 2;\n");
    await git(repository, "add", "--", "dist/index.js");
    expect((await requireFailure(repository)).message).toContain("dist/index.js");
  });
});

test("rejects unstaged dist changes", async () => {
  await withRepository(async (repository) => {
    await writeFile(resolve(repository, "dist/index.js"), "export const value = 2;\n");
    expect((await requireFailure(repository)).message).toContain("dist/index.js");
  });
});

test("rejects simultaneous staged and unstaged dist changes", async () => {
  await withRepository(async (repository) => {
    await writeFile(resolve(repository, "dist/index.js"), "export const value = 2;\n");
    await git(repository, "add", "--", "dist/index.js");
    await writeFile(resolve(repository, "dist/index.js"), "export const value = 3;\n");
    const error = await requireFailure(repository);
    expect(error.message).toContain("MM dist/index.js");
  });
});

test("rejects deleted committed dist files", async () => {
  await withRepository(async (repository) => {
    await rm(resolve(repository, "dist/stylex.css"));
    expect((await requireFailure(repository)).message).toContain("dist/stylex.css");
  });
});

test("rejects renamed committed dist files", async () => {
  await withRepository(async (repository) => {
    await git(repository, "mv", "dist/stylex.css", "dist/renamed.css");
    const error = await requireFailure(repository);
    expect(error.message).toContain("dist/stylex.css");
    expect(error.message).toContain("dist/renamed.css");
  });
});

test("rejects nested untracked dist files", async () => {
  await withRepository(async (repository) => {
    await mkdir(resolve(repository, "dist/nested"), { recursive: true });
    await writeFile(resolve(repository, "dist/nested/generated.js"), "generated\n");
    expect((await requireFailure(repository)).message).toContain(
      "dist/nested/generated.js",
    );
  });
});

test("fails closed outside a Git repository", async () => {
  const repository = await mkdtemp(
    join(tmpdir(), "hraness-ui-committed-dist-nongit-"),
  );
  try {
    expect((await requireFailure(repository)).message).toContain(
      "git status failed",
    );
  } finally {
    await rm(repository, { force: true, recursive: true });
  }
});

test("restores the old dist and retains the stage when the destination rename fails", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-destination-rename-failure");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const injectedFailure = new Error("injected destination rename failure");

    await expect(commitDistPromotion(
      repository,
      stage,
      async (source, target) => {
        if (source === stage && target === destination) throw injectedFailure;
        await rename(source, target);
      },
    )).rejects.toBe(injectedFailure);

    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(
      (await readdir(repository)).filter((name) => name.startsWith(".dist-backup-")),
    ).toEqual([]);
  });
});

test("preserves promotion and restoration failures with both retained trees", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-double-rename-failure");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const promotionError = new Error("injected destination rename failure");
    const restorationError = new Error("injected restoration rename failure");
    let backupPath: string | undefined;
    let failure: unknown;

    try {
      await commitDistPromotion(repository, stage, async (source, target) => {
        if (source === destination) {
          backupPath = target;
          await rename(source, target);
          return;
        }
        if (source === stage && target === destination) throw promotionError;
        if (source === backupPath && target === destination) throw restorationError;
        await rename(source, target);
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DistPromotionRestoreError);
    if (!(failure instanceof DistPromotionRestoreError)) throw failure;
    if (backupPath === undefined) throw new Error("Expected the previous dist to move to a backup");
    expect(failure.state).toBe("promotion-failed-with-retained-backup");
    expect(failure.errors).toEqual([promotionError, restorationError]);
    expect(failure.cause).toBe(promotionError);
    expect(failure.destinationPath).toBe(destination);
    expect(failure.backupPath).toBe(backupPath);
    expect(failure.stagePath).toBe(stage);
    expect(failure.message).toContain(destination);
    expect(failure.message).toContain(backupPath);
    expect(failure.message).toContain(stage);
    expect(await pathExists(destination)).toBe(false);
    expect(await readFile(resolve(backupPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  });
});

test("keeps the new dist live and reports the retained backup when backup removal fails", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-backup-remove-failure");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const promotion = await commitDistPromotion(repository, stage);
    const backupPath = promotion.backupPath;
    if (backupPath === null) throw new Error("Expected the promotion to retain the old dist backup");
    const injectedFailure = new Error("injected backup removal failure");
    let failure: unknown;

    try {
      await cleanupDistPromotion(promotion, async (path) => {
        expect(path).toBe(backupPath);
        throw injectedFailure;
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DistPromotionCleanupError);
    if (!(failure instanceof DistPromotionCleanupError)) {
      throw failure ?? new Error("Expected backup cleanup to fail");
    }
    expect(failure.state).toBe("promoted-with-retained-backup");
    expect(failure.destinationPath).toBe(destination);
    expect(failure.backupPath).toBe(backupPath);
    expect(failure.cause).toBe(injectedFailure);
    expect(failure.message).toContain(destination);
    expect(failure.message).toContain(backupPath);
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await readFile(resolve(backupPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await pathExists(destination)).toBe(true);
    expect(await pathExists(stage)).toBe(false);
    expect(await pathExists(backupPath)).toBe(true);
  });
});

test("keeps committed-dist parity immediately after the package build", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(import.meta.dir, "..", "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts;
  if (scripts === undefined) throw new Error("package.json scripts are missing");

  expect(scripts["check:committed-dist"]).toBe(
    "bun run ./scripts/check-committed-dist.ts",
  );
  const testCommand = scripts.test;
  const checkCommand = scripts.check;
  if (testCommand === undefined || checkCommand === undefined) {
    throw new Error("package.json test or check script is missing");
  }
  expect(testCommand).toContain("./scripts/check-committed-dist.test.ts");

  const steps = checkCommand.split(" && ");
  const buildIndex = steps.indexOf("bun run build");
  expect(buildIndex).toBeGreaterThanOrEqual(0);
  expect(steps.slice(buildIndex, buildIndex + 5)).toEqual([
    "bun run build",
    "bun run check:committed-dist",
    "bun run check:stylex-artifacts",
    "bun run check:stylex-compiler-artifacts",
    "bun run check:stylex-determinism",
  ]);
});
