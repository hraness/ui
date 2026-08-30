import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  expect(steps.slice(buildIndex, buildIndex + 3)).toEqual([
    "bun run build",
    "bun run check:committed-dist",
    "bun run check:stylex-artifacts",
  ]);
});
