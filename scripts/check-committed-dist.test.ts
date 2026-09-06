import { expect, test } from "bun:test";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "../build/compiler.js";
import {
  cleanupDistPromotion,
  commitDistPromotion,
  DistPromotionCleanupError,
  DistPromotionInterferenceError,
  DistPromotionLockConflictError,
  DistPromotionLockIntegrityError,
  DistPromotionRecoveryRequiredError,
  DistPromotionRecoveryRefusedError,
  DistPromotionRestoreError,
  inspectDistPromotionDirectoryWitness,
  inspectDistPromotionRecovery,
  promotePreparedDist,
  recoverInterruptedDistPromotion,
  type DistPromotionLockRecord,
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

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await pathExists(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for path: ${path}`);
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

type DistPromotionPhase =
  | "committed"
  | "discarding-previous-dist"
  | "moving-previous-dist"
  | "prepared"
  | "previous-dist-discarded"
  | "previous-dist-moved"
  | "promoting-prepared-dist"
  | "recovering-previous-dist"
  | "released";

type PromotionTopologyOperation =
  | "backup-to-destination"
  | "backup-to-discard"
  | "destination-to-backup"
  | "destination-to-stage"
  | "remove-backup"
  | "remove-discard"
  | "stage-to-destination";

type RecoveryResult = Awaited<ReturnType<typeof recoverInterruptedDistPromotion>>;

type DirectoryIdentity = NonNullable<
  Awaited<ReturnType<typeof inspectDistPromotionDirectoryWitness>>
>;

interface PromotionCrashFixture {
  readonly backupPath: string;
  readonly destinationPath: string;
  readonly discardPath: string;
  readonly lockPath: string;
  readonly phasePath: string;
  readonly previousDistIdentity: DirectoryIdentity | null;
  readonly stageIdentity: DirectoryIdentity;
  readonly stagePath: string;
  readonly token: string;
}

interface PromotionCrashScenario {
  readonly expectedDestination: "absent" | "previous" | "stage";
  readonly expectedResult: RecoveryResult;
  readonly expectedStage: "absent" | "stage";
  readonly name: string;
  readonly operations: readonly PromotionTopologyOperation[];
  readonly phase: DistPromotionPhase;
  readonly previousDist: boolean;
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity | null> {
  return inspectDistPromotionDirectoryWitness(path);
}

async function createPromotionCrashFixture(
  repository: string,
  scenario: PromotionCrashScenario,
): Promise<PromotionCrashFixture> {
  const destinationPath = resolve(repository, "dist");
  if (!scenario.previousDist) {
    await rm(destinationPath, { force: true, recursive: true });
  }
  const previousDistIdentity = await directoryIdentity(destinationPath);
  const stagePath = resolve(
    repository,
    `.dist-build-crash-${scenario.name.replaceAll(/[^a-z0-9]+/gu, "-")}`,
  );
  await mkdir(stagePath);
  await writeFile(resolve(stagePath, "index.js"), "export const value = 2;\n");
  await writeFile(resolve(stagePath, "stylex.css"), ".next {}\n");
  const stageIdentity = await directoryIdentity(stagePath);
  if (stageIdentity === null) throw new Error("Expected the prepared dist stage");

  const token = "00000000-0000-4000-8000-000000000001";
  const backupPath = resolve(repository, `.dist-backup-${token}`);
  const discardPath = resolve(repository, `.dist-discard-${token}`);
  for (const operation of scenario.operations) {
    switch (operation) {
      case "backup-to-destination":
        await rename(backupPath, destinationPath);
        break;
      case "backup-to-discard":
        await rename(backupPath, discardPath);
        break;
      case "destination-to-backup":
        await rename(destinationPath, backupPath);
        break;
      case "destination-to-stage":
        await rename(destinationPath, stagePath);
        break;
      case "remove-backup":
        await rm(backupPath, { force: true, recursive: true });
        break;
      case "remove-discard":
        await rm(discardPath, { force: true, recursive: true });
        break;
      case "stage-to-destination":
        await rename(stagePath, destinationPath);
        break;
    }
  }

  const acquiredAt = "2026-09-05T00:00:00.000Z";
  const lockPath = resolve(repository, ".dist-promotion.lock");
  const phasePath = resolve(repository, `.dist-promotion-state-${token}.json`);
  const owner = {
    acquiredAt,
    backupPath: `.dist-backup-${token}`,
    claimPath: `.dist-promotion-claim-${token}.lock`,
    discardPath: `.dist-discard-${token}`,
    kind: "hraness-ui-dist-promotion-lock",
    phasePath: `.dist-promotion-state-${token}.json`,
    pid: process.pid,
    previousDistDevice: previousDistIdentity?.device ?? null,
    previousDistInode: previousDistIdentity?.inode ?? null,
    previousDistTreeEntries: previousDistIdentity?.treeEntries ?? null,
    previousDistTreeSha256: previousDistIdentity?.treeSha256 ?? null,
    processIdentity: "test-owner-that-is-not-this-process-birth",
    schemaVersion: 6,
    stageDevice: stageIdentity.device,
    stageInode: stageIdentity.inode,
    stagePath: stagePath.slice(repository.length + 1),
    stageTreeSha256: stageIdentity.treeSha256,
    token,
  } satisfies DistPromotionLockRecord;
  const state = {
    acquiredAt,
    backupPath: owner.backupPath,
    disposition: "active",
    discardPath: owner.discardPath,
    kind: "hraness-ui-dist-promotion-state",
    phase: scenario.phase,
    pid: owner.pid,
    previousDistDevice: owner.previousDistDevice,
    previousDistInode: owner.previousDistInode,
    previousDistTreeEntries: owner.previousDistTreeEntries,
    previousDistTreeSha256: owner.previousDistTreeSha256,
    processIdentity: owner.processIdentity,
    schemaVersion: owner.schemaVersion,
    stageDevice: owner.stageDevice,
    stageInode: owner.stageInode,
    stagePath: owner.stagePath,
    stageTreeSha256: owner.stageTreeSha256,
    token,
  };
  await Promise.all([
    writeFile(lockPath, `${canonicalJson(owner)}\n`, { flag: "wx", mode: 0o600 }),
    writeFile(phasePath, `${canonicalJson(state)}\n`, { flag: "wx", mode: 0o600 }),
  ]);
  return {
    backupPath,
    destinationPath,
    discardPath,
    lockPath,
    phasePath,
    previousDistIdentity,
    stageIdentity,
    stagePath,
    token,
  };
}

async function expectDirectoryIdentity(
  path: string,
  expected: DirectoryIdentity | null,
): Promise<void> {
  expect(await directoryIdentity(path)).toEqual(expected);
}

async function expectTerminalPromotionState(
  repository: string,
  fixture: PromotionCrashFixture,
  scenario: PromotionCrashScenario,
): Promise<void> {
  const expectedDestination = scenario.expectedDestination === "absent"
    ? null
    : scenario.expectedDestination === "previous"
      ? fixture.previousDistIdentity
      : fixture.stageIdentity;
  const expectedStage = scenario.expectedStage === "absent"
    ? null
    : fixture.stageIdentity;
  await Promise.all([
    expectDirectoryIdentity(fixture.destinationPath, expectedDestination),
    expectDirectoryIdentity(fixture.stagePath, expectedStage),
    expectDirectoryIdentity(fixture.backupPath, null),
    expectDirectoryIdentity(fixture.discardPath, null),
  ]);
  if (scenario.expectedDestination === "previous") {
    expect(await readFile(resolve(fixture.destinationPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  } else if (scenario.expectedDestination === "stage") {
    expect(await readFile(resolve(fixture.destinationPath, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  }
  if (scenario.expectedStage === "stage") {
    expect(await readFile(resolve(fixture.stagePath, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  }
  const transactionSurvivors = (await readdir(repository))
    .filter((name) => (
      name === ".dist-promotion.lock"
      || name.startsWith(".dist-promotion-claim-")
      || name.startsWith(".dist-promotion-recovery-")
      || name.startsWith(".dist-promotion-release-")
      || name.startsWith(".dist-promotion-state-")
    ))
    .sort();
  expect(transactionSurvivors).toEqual([]);
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

test("restores the old dist when its rename completes before reporting failure", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-ambiguous-previous-move");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const injectedFailure = new Error("injected post-rename failure");

    await expect(promotePreparedDist(
      repository,
      stage,
      async (source, target) => {
        await rename(source, target);
        if (source === destination) throw injectedFailure;
      },
    )).rejects.toBe(injectedFailure);

    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(resolve(repository, ".dist-promotion.lock"))).toBe(false);
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

test("serializes two writers across the complete dist promotion transaction", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const firstStage = resolve(repository, ".dist-build-first-writer");
    const secondStage = resolve(repository, ".dist-build-second-writer");
    await Promise.all([mkdir(firstStage), mkdir(secondStage)]);
    await Promise.all([
      writeFile(resolve(firstStage, "index.js"), "export const value = 2;\n"),
      writeFile(resolve(secondStage, "index.js"), "export const value = 3;\n"),
    ]);
    const oldDistMoved = deferred();
    const resumeFirstWriter = deferred();
    let firstBackupPath: string | undefined;
    const firstWriter = promotePreparedDist(
      repository,
      firstStage,
      async (source, target) => {
        await rename(source, target);
        if (source === destination) {
          firstBackupPath = target;
          oldDistMoved.resolve();
          await resumeFirstWriter.promise;
        }
      },
    );
    await oldDistMoved.promise;
    if (firstBackupPath === undefined) throw new Error("Expected the first writer to move the old dist");

    const lockPath = resolve(repository, ".dist-promotion.lock");
    const lockBefore = await lstat(lockPath, { bigint: true });
    const lockSourceBefore = await readFile(lockPath, "utf8");
    let secondWriterEntered = false;
    let contention: unknown;
    try {
      await promotePreparedDist(
        repository,
        secondStage,
        async (source, target) => {
          secondWriterEntered = true;
          await rename(source, target);
        },
      );
    } catch (error) {
      contention = error;
    }

    try {
      expect(contention).toBeInstanceOf(DistPromotionLockConflictError);
      if (!(contention instanceof DistPromotionLockConflictError)) throw contention;
      expect(contention.state).toBe("promotion-lock-held");
      expect(contention.lockPath).toBe(lockPath);
      expect(contention.owner.pid).toBe(process.pid);
      expect(secondWriterEntered).toBe(false);
      expect(await pathExists(destination)).toBe(false);
      expect(await readFile(resolve(firstBackupPath, "index.js"), "utf8")).toBe(
        "export const value = 1;\n",
      );
      expect(await readFile(resolve(firstStage, "index.js"), "utf8")).toBe(
        "export const value = 2;\n",
      );
      expect(await readFile(resolve(secondStage, "index.js"), "utf8")).toBe(
        "export const value = 3;\n",
      );
      const lockAfter = await lstat(lockPath, { bigint: true });
      expect({ device: lockAfter.dev.toString(), inode: lockAfter.ino.toString() }).toEqual({
        device: lockBefore.dev.toString(),
        inode: lockBefore.ino.toString(),
      });
      expect(await readFile(lockPath, "utf8")).toBe(lockSourceBefore);
      expect(
        (await readdir(repository)).filter((name) => name.startsWith(".dist-promotion-claim-")),
      ).toEqual([]);
    } finally {
      resumeFirstWriter.resolve();
      await firstWriter;
    }

    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(firstStage)).toBe(false);
    expect(await pathExists(firstBackupPath)).toBe(false);
    expect(await pathExists(lockPath)).toBe(false);
    expect(await pathExists(secondStage)).toBe(true);

    await promotePreparedDist(repository, secondStage);
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 3;\n",
    );
    expect(await pathExists(secondStage)).toBe(false);
    expect(await pathExists(lockPath)).toBe(false);
    expect(
      (await readdir(repository)).filter((name) => name.startsWith(".dist-backup-")),
    ).toEqual([]);
  });
});

test("records and recovers an independent writer crash after moving the previous dist", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-crashed-writer");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const moduleUrl = pathToFileURL(resolve(import.meta.dir, "build-package.ts")).href;
    const childSource = `
      import { rename } from "node:fs/promises";
      import { resolve } from "node:path";
      import { promotePreparedDist } from ${JSON.stringify(moduleUrl)};
      const repository = process.env.HRANESS_DIST_TEST_REPOSITORY;
      const stage = process.env.HRANESS_DIST_TEST_STAGE;
      if (repository === undefined || stage === undefined) throw new Error("Missing crash fixture paths");
      const destination = resolve(repository, "dist");
      await promotePreparedDist(repository, stage, async (source, target) => {
        await rename(source, target);
        if (source === destination) process.exit(73);
      });
    `;
    const child = Bun.spawn([process.execPath, "-e", childSource], {
      env: {
        ...process.env,
        HRANESS_DIST_TEST_REPOSITORY: repository,
        HRANESS_DIST_TEST_STAGE: stage,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 73, stdout: "", stderr: "" });

    const inspection = await inspectDistPromotionRecovery(repository);
    expect(inspection.owner.pid).toBe(child.pid);
    expect(inspection.ownerStatus).toBe("absent");
    expect(inspection.phase).toBe("moving-previous-dist");
    expect(inspection.destinationPath).toBe(destination);
    expect(inspection.destinationPresent).toBe(false);
    expect(inspection.stagePath).toBe(stage);
    expect(inspection.stagePresent).toBe(true);
    expect(inspection.backupPath).toBe(
      resolve(repository, `.dist-backup-${inspection.owner.token}`),
    );
    expect(inspection.backupPresent).toBe(true);
    expect(inspection.claimPresent).toBe(false);
    expect(inspection.owner.stagePath).toBe(".dist-build-crashed-writer");
    expect(inspection.owner.backupPath).toBe(
      `.dist-backup-${inspection.owner.token}`,
    );
    expect(inspection.owner.phasePath).toBe(
      `.dist-promotion-state-${inspection.owner.token}.json`,
    );

    await expect(
      recoverInterruptedDistPromotion(repository, inspection.owner.token),
    ).resolves.toBe("restored-previous-dist");
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(inspection.lockPath)).toBe(false);
    expect(await pathExists(inspection.phasePath)).toBe(false);
    expect(await pathExists(inspection.backupPath)).toBe(false);
    expect(
      (await readdir(repository)).filter((name) => name.startsWith(".dist-promotion-recovery-")),
    ).toEqual([]);

    await promotePreparedDist(repository, stage);
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  });
});

test("retains the owner lock when promotion and restoration both fail", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-recovery-required");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    const promotionError = new Error("injected destination rename failure");
    const restorationError = new Error("injected restoration rename failure");
    let backupPath: string | undefined;
    let failure: unknown;

    try {
      await promotePreparedDist(repository, stage, async (source, target) => {
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

    expect(failure).toBeInstanceOf(DistPromotionRecoveryRequiredError);
    if (!(failure instanceof DistPromotionRecoveryRequiredError)) throw failure;
    if (backupPath === undefined) throw new Error("Expected the previous dist to move to a backup");
    expect(failure.state).toBe("promotion-recovery-required");
    expect(failure.transaction).toBeInstanceOf(DistPromotionRestoreError);
    expect(failure.cause).toBe(failure.transaction);
    expect(failure.lockPath).toBe(resolve(repository, ".dist-promotion.lock"));
    expect(await pathExists(failure.lockPath)).toBe(true);
    expect(await pathExists(destination)).toBe(false);
    expect(await readFile(resolve(backupPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  });
});

test("retains the owner lock when an unexpected destination blocks restoration", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-interference");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    let backupPath: string | undefined;
    let failure: unknown;

    try {
      await promotePreparedDist(repository, stage, async (source, target) => {
        if (source === destination) {
          backupPath = target;
          await rename(source, target);
          return;
        }
        if (source === stage && target === destination) {
          await mkdir(destination);
          await writeFile(resolve(destination, "index.js"), "unexpected writer\n");
          throw new Error("injected concurrent destination");
        }
        await rename(source, target);
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DistPromotionRecoveryRequiredError);
    if (!(failure instanceof DistPromotionRecoveryRequiredError)) throw failure;
    if (backupPath === undefined) throw new Error("Expected the previous dist to move to a backup");
    expect(failure.transaction).toBeInstanceOf(DistPromotionInterferenceError);
    expect(failure.lockPath).toBe(resolve(repository, ".dist-promotion.lock"));
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "unexpected writer\n",
    );
    expect(await readFile(resolve(backupPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(failure.lockPath)).toBe(true);
  });
});

test("retains the recovery journal when a destination appears after the previous dist moves", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-post-move-interference");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    let failure: unknown;

    try {
      await promotePreparedDist(repository, stage, async (source, target) => {
        await rename(source, target);
        if (source === destination) {
          await mkdir(destination);
          await writeFile(resolve(destination, "index.js"), "unexpected writer\n");
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DistPromotionRecoveryRequiredError);
    if (!(failure instanceof DistPromotionRecoveryRequiredError)) throw failure;
    expect(failure.transaction).toBeInstanceOf(DistPromotionInterferenceError);
    const inspection = await inspectDistPromotionRecovery(repository);
    expect(inspection.ownerDisposition).toBe("recovery-required");
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "unexpected writer\n",
    );
    expect(await readFile(resolve(inspection.backupPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(stage, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(inspection.lockPath)).toBe(true);
    expect(await pathExists(inspection.phasePath)).toBe(true);
  });
});

test("retains a changed owner lock instead of unlinking another identity", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-lock-integrity");
    const lockPath = resolve(repository, ".dist-promotion.lock");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");
    let replacementIdentity: { readonly device: string; readonly inode: string } | undefined;
    let failure: unknown;

    try {
      await promotePreparedDist(
        repository,
        stage,
        rename,
        async (backupPath) => {
          await rm(backupPath, { force: true, recursive: true });
          await unlink(lockPath);
          await writeFile(lockPath, "changed owner\n", { flag: "wx", mode: 0o600 });
          const replacement = await lstat(lockPath, { bigint: true });
          replacementIdentity = { device: replacement.dev.toString(), inode: replacement.ino.toString() };
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DistPromotionLockIntegrityError);
    if (!(failure instanceof DistPromotionLockIntegrityError)) throw failure;
    expect(failure.state).toBe("promotion-lock-integrity-failed");
    expect(failure.lockPath).toBe(lockPath);
    expect(await readFile(lockPath, "utf8")).toBe("changed owner\n");
    if (replacementIdentity === undefined) throw new Error("Expected a replacement lock identity");
    const restoredReplacement = await lstat(lockPath, { bigint: true });
    expect({ device: restoredReplacement.dev.toString(), inode: restoredReplacement.ino.toString() }).toEqual(
      replacementIdentity,
    );
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(stage)).toBe(false);
    expect(
      (await readdir(repository)).filter((name) => name.startsWith(".dist-backup-")),
    ).toEqual([]);
  });
});

test("does not unlink a new owner created after atomic lock detachment", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-next-owner");
    const lockPath = resolve(repository, ".dist-promotion.lock");
    const replacementSource = "next owner\n";
    let replacementIdentity: { readonly device: string; readonly inode: string } | undefined;
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export const value = 2;\n");

    await promotePreparedDist(
      repository,
      stage,
      rename,
      async (backupPath) => rm(backupPath, { force: true, recursive: true }),
      async (source, target) => {
        await rename(source, target);
        if (source === lockPath) {
          await writeFile(lockPath, replacementSource, { flag: "wx", mode: 0o600 });
          const replacement = await lstat(lockPath, { bigint: true });
          replacementIdentity = { device: replacement.dev.toString(), inode: replacement.ino.toString() };
        }
      },
    );

    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await readFile(lockPath, "utf8")).toBe(replacementSource);
    if (replacementIdentity === undefined) throw new Error("Expected the next owner lock identity");
    const liveReplacement = await lstat(lockPath, { bigint: true });
    expect({ device: liveReplacement.dev.toString(), inode: liveReplacement.ino.toString() }).toEqual(
      replacementIdentity,
    );
    expect(
      (await readdir(repository)).filter((name) => name.startsWith(".dist-promotion-claim-")),
    ).toEqual([]);
  });
});

test("recovers every journaled crash topology without losing either dist identity", async () => {
  const moveAndPromote = [
    "destination-to-backup",
    "stage-to-destination",
  ] as const;
  const scenarios = [
    {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "prepared-with-previous-dist",
      operations: [],
      phase: "prepared",
      previousDist: true,
    },
    {
      expectedDestination: "absent",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "prepared-without-previous-dist",
      operations: [],
      phase: "prepared",
      previousDist: false,
    },
    {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "moving-before-previous-dist-rename",
      operations: [],
      phase: "moving-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "moving-after-previous-dist-rename",
      operations: ["destination-to-backup"],
      phase: "moving-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "previous-dist-moved",
      operations: ["destination-to-backup"],
      phase: "previous-dist-moved",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "promoting-before-stage-rename-with-previous-dist",
      operations: ["destination-to-backup"],
      phase: "promoting-prepared-dist",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "promoting-after-stage-rename-with-previous-dist",
      operations: moveAndPromote,
      phase: "promoting-prepared-dist",
      previousDist: true,
    },
    {
      expectedDestination: "absent",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "promoting-before-stage-rename-without-previous-dist",
      operations: [],
      phase: "promoting-prepared-dist",
      previousDist: false,
    },
    {
      expectedDestination: "absent",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "promoting-after-stage-rename-without-previous-dist",
      operations: ["stage-to-destination"],
      phase: "promoting-prepared-dist",
      previousDist: false,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "committed-with-previous-dist",
      operations: moveAndPromote,
      phase: "committed",
      previousDist: true,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "committed-without-previous-dist",
      operations: ["stage-to-destination"],
      phase: "committed",
      previousDist: false,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "discarding-before-backup-rename",
      operations: moveAndPromote,
      phase: "discarding-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "discarding-after-backup-rename",
      operations: [...moveAndPromote, "backup-to-discard"],
      phase: "discarding-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "discarded-before-backup-remove",
      operations: [...moveAndPromote, "backup-to-discard"],
      phase: "previous-dist-discarded",
      previousDist: true,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "discarded-after-backup-remove",
      operations: [...moveAndPromote, "backup-to-discard", "remove-discard"],
      phase: "previous-dist-discarded",
      previousDist: true,
    },
    {
      expectedDestination: "stage",
      expectedResult: "completed-new-dist",
      expectedStage: "absent",
      name: "released-after-completed-promotion",
      operations: [...moveAndPromote, "remove-backup"],
      phase: "released",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "released-after-untouched-promotion",
      operations: [],
      phase: "released",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "recovery-before-new-dist-rollback-rename",
      operations: moveAndPromote,
      phase: "recovering-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "restored-previous-dist",
      expectedStage: "stage",
      name: "recovery-between-the-two-rollback-renames",
      operations: [...moveAndPromote, "destination-to-stage"],
      phase: "recovering-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "recovery-after-both-rollback-renames",
      operations: [
        ...moveAndPromote,
        "destination-to-stage",
        "backup-to-destination",
      ],
      phase: "recovering-previous-dist",
      previousDist: true,
    },
    {
      expectedDestination: "absent",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "empty-recovery-before-rollback-rename",
      operations: ["stage-to-destination"],
      phase: "recovering-previous-dist",
      previousDist: false,
    },
    {
      expectedDestination: "absent",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "empty-recovery-after-rollback-rename",
      operations: ["stage-to-destination", "destination-to-stage"],
      phase: "recovering-previous-dist",
      previousDist: false,
    },
  ] satisfies readonly PromotionCrashScenario[];
  const documentedResults = [
    "completed-new-dist",
    "released-untouched",
    "restored-previous-dist",
  ] satisfies readonly RecoveryResult[];

  for (const scenario of scenarios) {
    try {
      await withRepository(async (repository) => {
        const fixture = await createPromotionCrashFixture(repository, scenario);
        const inspection = await inspectDistPromotionRecovery(repository);
        expect(inspection.phase).toBe(scenario.phase);
        expect(inspection.ownerStatus).toBe("absent");
        expect(inspection.owner.token).toBe(fixture.token);
        const result = await recoverInterruptedDistPromotion(
          repository,
          fixture.token,
        );
        expect(documentedResults).toContain(result);
        expect(result).toBe(scenario.expectedResult);
        await expectTerminalPromotionState(repository, fixture, scenario);
      });
    } catch (error) {
      throw new Error(`Dist promotion crash scenario failed: ${scenario.name}`, {
        cause: error,
      });
    }
  }
}, 30_000);

test("recovers a crash that retains the admitted primary claim hardlink", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "retained-primary-claim",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const claimPath = resolve(repository, `.dist-promotion-claim-${fixture.token}.lock`);
    await link(fixture.lockPath, claimPath);

    const inspection = await inspectDistPromotionRecovery(repository);
    expect(inspection.claimPresent).toBe(true);
    expect(inspection.claimMatchesOwner).toBe(true);
    await expect(
      recoverInterruptedDistPromotion(repository, fixture.token),
    ).resolves.toBe("released-untouched");
    await expectTerminalPromotionState(repository, fixture, scenario);
  });
}, 30_000);

test("preserves and refuses a foreign primary claim identity", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "foreign-primary-claim",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const claimPath = resolve(repository, `.dist-promotion-claim-${fixture.token}.lock`);
    const foreignSource = "foreign claim\n";
    await writeFile(claimPath, foreignSource, { flag: "wx", mode: 0o600 });

    await expect(
      recoverInterruptedDistPromotion(repository, fixture.token),
    ).rejects.toBeInstanceOf(DistPromotionRecoveryRefusedError);
    expect(await readFile(claimPath, "utf8")).toBe(foreignSource);
    expect(await pathExists(fixture.lockPath)).toBe(true);
  });
});

test("rejects stage content changes after the transaction witness is recorded", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "mutated-stage-content",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    await writeFile(resolve(fixture.stagePath, "index.js"), "export const value = 3;\n");

    const inspection = await inspectDistPromotionRecovery(repository);
    expect(inspection.stageMatchesStage).toBe(false);
    await expect(
      recoverInterruptedDistPromotion(repository, fixture.token),
    ).rejects.toBeInstanceOf(DistPromotionRecoveryRefusedError);
    expect(await pathExists(fixture.lockPath)).toBe(true);
  });
});

test("includes special permission bits in an independent tree witness", async () => {
  await withRepository(async (repository) => {
    const stage = resolve(repository, ".dist-build-special-mode");
    await mkdir(stage);
    await writeFile(resolve(stage, "index.js"), "export {};\n");
    const before = await inspectDistPromotionDirectoryWitness(stage);
    await chmod(stage, 0o1700);
    const after = await inspectDistPromotionDirectoryWitness(stage);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after?.device).toBe(before?.device);
    expect(after?.inode).toBe(before?.inode);
    expect(after?.treeSha256).not.toBe(before?.treeSha256);
  });
});

test("rejects symlinks from a dist transaction tree witness", async () => {
  await withRepository(async (repository) => {
    const stage = resolve(repository, ".dist-build-symlink");
    await mkdir(stage);
    await symlink(resolve(repository, "README.md"), resolve(stage, "linked-readme"));
    await expect(inspectDistPromotionDirectoryWitness(stage)).rejects.toThrow(
      "Dist transaction tree contains a symlink",
    );
  });
});

test("keeps the first same-process recovery lease authoritative", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "same-process-recovery-contention",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const admitted = deferred();
    const resume = deferred();
    const firstRecovery = recoverInterruptedDistPromotion(repository, fixture.token, {
      afterAdvisoryLock: async () => {
        admitted.resolve();
        await resume.promise;
      },
    });
    await admitted.promise;
    try {
      await expect(
        recoverInterruptedDistPromotion(repository, fixture.token),
      ).rejects.toThrow("already owned");
      expect(await pathExists(fixture.lockPath)).toBe(true);
    } finally {
      resume.resolve();
    }
    await expect(firstRecovery).resolves.toBe("released-untouched");
    await expectTerminalPromotionState(repository, fixture, scenario);
  });
});

test("serializes recovery against an independently running process", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "cross-process-recovery-contention",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const readyPath = resolve(repository, ".recovery-ready");
    const resumePath = resolve(repository, ".recovery-resume");
    const moduleUrl = pathToFileURL(resolve(import.meta.dir, "build-package.ts")).href;
    const childSource = `
      import { writeFile } from "node:fs/promises";
      import { recoverInterruptedDistPromotion } from ${JSON.stringify(moduleUrl)};
      const repository = process.env.HRANESS_DIST_TEST_REPOSITORY;
      const token = process.env.HRANESS_DIST_TEST_TOKEN;
      const readyPath = process.env.HRANESS_DIST_TEST_READY;
      const resumePath = process.env.HRANESS_DIST_TEST_RESUME;
      if (!repository || !token || !readyPath || !resumePath) throw new Error("Missing recovery fixture");
      await recoverInterruptedDistPromotion(repository, token, {
        afterAdvisoryLock: async () => {
          await writeFile(readyPath, "ready\\n", { flag: "wx" });
          for (;;) {
            if (await Bun.file(resumePath).exists()) return;
            await Bun.sleep(10);
          }
        },
      });
    `;
    const child = Bun.spawn([process.execPath, "-e", childSource], {
      env: {
        ...process.env,
        HRANESS_DIST_TEST_READY: readyPath,
        HRANESS_DIST_TEST_REPOSITORY: repository,
        HRANESS_DIST_TEST_RESUME: resumePath,
        HRANESS_DIST_TEST_TOKEN: fixture.token,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForPath(readyPath);
    await expect(
      recoverInterruptedDistPromotion(repository, fixture.token),
    ).rejects.toThrow("already owned");
    await writeFile(resumePath, "resume\n", { flag: "wx" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    await expectTerminalPromotionState(repository, fixture, scenario);
  });
});

test("does not leak the advisory descriptor into an executed child", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "advisory-descriptor-inheritance",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const injectedFailure = new Error("stop after child spawn");
    let child: ReturnType<typeof Bun.spawn> | undefined;
    await expect(recoverInterruptedDistPromotion(repository, fixture.token, {
      afterAdvisoryLock: async () => {
        child = Bun.spawn(["/bin/sleep", "5"], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        throw injectedFailure;
      },
    })).rejects.toBe(injectedFailure);
    if (child === undefined) throw new Error("Expected the inheritance probe child");
    try {
      await expect(
        recoverInterruptedDistPromotion(repository, fixture.token),
      ).resolves.toBe("released-untouched");
    } finally {
      child.kill();
      await child.exited;
    }
    await expectTerminalPromotionState(repository, fixture, scenario);
  });
});

test("refuses a byte-identical canonical owner rebound after advisory admission", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "canonical-owner-rebound",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const source = await readFile(fixture.lockPath, "utf8");
    const before = await lstat(fixture.lockPath, { bigint: true });

    await expect(recoverInterruptedDistPromotion(repository, fixture.token, {
      afterAdvisoryLock: async () => {
        await unlink(fixture.lockPath);
        await writeFile(fixture.lockPath, source, { flag: "wx", mode: 0o600 });
      },
    })).rejects.toBeInstanceOf(DistPromotionLockIntegrityError);

    const after = await lstat(fixture.lockPath, { bigint: true });
    expect({ device: after.dev.toString(), inode: after.ino.toString() }).not.toEqual({
      device: before.dev.toString(),
      inode: before.ino.toString(),
    });
    expect(await readFile(fixture.lockPath, "utf8")).toBe(source);
    expect(await readFile(resolve(fixture.destinationPath, "index.js"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await readFile(resolve(fixture.stagePath, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
  });
});

test("recovers a same-process failure after partial obsolete-dist deletion", async () => {
  await withRepository(async (repository) => {
    const destination = resolve(repository, "dist");
    const stage = resolve(repository, ".dist-build-partial-discard");
    await mkdir(stage);
    await Promise.all([
      writeFile(resolve(stage, "index.js"), "export const value = 2;\n"),
      writeFile(resolve(stage, "stylex.css"), ".next {}\n"),
    ]);
    const injectedFailure = new Error("injected partial discard failure");
    let failure: unknown;
    try {
      await promotePreparedDist(repository, stage, rename, async (discardPath) => {
        await unlink(resolve(discardPath, "stylex.css"));
        throw injectedFailure;
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DistPromotionRecoveryRequiredError);
    const inspection = await inspectDistPromotionRecovery(repository);
    expect(inspection.phase).toBe("previous-dist-discarded");
    expect(inspection.ownerDisposition).toBe("recovery-required");
    expect(inspection.ownerStatus).toBe("active");
    expect(inspection.discardPresent).toBe(true);
    expect(inspection.discardMatchesPreviousDist).toBe(false);
    expect(inspection.discardMatchesPreviousDistRoot).toBe(true);
    expect(inspection.discardIsRecordedDeletionSubset).toBe(true);

    await expect(
      recoverInterruptedDistPromotion(repository, inspection.owner.token),
    ).resolves.toBe("completed-new-dist");
    expect(await readFile(resolve(destination, "index.js"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await pathExists(stage)).toBe(false);
    expect(await pathExists(inspection.discardPath)).toBe(false);
    expect(await pathExists(inspection.lockPath)).toBe(false);
    expect(await pathExists(inspection.phasePath)).toBe(false);
  });
});

test("refuses foreign or replaced entries in a partially deleted discard tree", async () => {
  const mutations = [
    {
      name: "added-path",
      run: (discardPath: string) => writeFile(resolve(discardPath, "foreign.txt"), "private bytes\n"),
    },
    {
      name: "byte-identical-replacement",
      run: async (discardPath: string) => {
        const path = resolve(discardPath, "index.js");
        const original = await open(path, "r");
        try {
          const [source, before] = await Promise.all([
            original.readFile(),
            original.stat({ bigint: true }),
          ]);
          await unlink(path);
          await writeFile(path, source, { flag: "wx" });
          const replacement = await lstat(path, { bigint: true });
          expect({ device: replacement.dev, inode: replacement.ino }).not.toEqual({
            device: before.dev,
            inode: before.ino,
          });
        } finally {
          await original.close();
        }
      },
    },
    {
      name: "mode-change",
      run: (discardPath: string) => chmod(resolve(discardPath, "index.js"), 0o600),
    },
  ] as const;

  for (const mutation of mutations) {
    await withRepository(async (repository) => {
      const scenario = {
        expectedDestination: "stage",
        expectedResult: "completed-new-dist",
        expectedStage: "absent",
        name: `partial-discard-${mutation.name}`,
        operations: [
          "destination-to-backup",
          "stage-to-destination",
          "backup-to-discard",
        ],
        phase: "previous-dist-discarded",
        previousDist: true,
      } satisfies PromotionCrashScenario;
      const fixture = await createPromotionCrashFixture(repository, scenario);
      await mutation.run(fixture.discardPath);
      const inspection = await inspectDistPromotionRecovery(repository);
      expect(inspection.discardMatchesPreviousDist).toBe(false);
      expect(inspection.discardIsRecordedDeletionSubset).toBe(false);

      await expect(
        recoverInterruptedDistPromotion(repository, fixture.token),
      ).rejects.toBeInstanceOf(DistPromotionRecoveryRefusedError);
      expect(await pathExists(fixture.lockPath)).toBe(true);
      expect(await pathExists(fixture.discardPath)).toBe(true);
    });
  }
});

test("releases recovery advisory ownership when the recovery process exits", async () => {
  await withRepository(async (repository) => {
    const scenario = {
      expectedDestination: "previous",
      expectedResult: "released-untouched",
      expectedStage: "stage",
      name: "crashed-recovery-owner",
      operations: [],
      phase: "prepared",
      previousDist: true,
    } satisfies PromotionCrashScenario;
    const fixture = await createPromotionCrashFixture(repository, scenario);
    const moduleUrl = pathToFileURL(resolve(import.meta.dir, "build-package.ts")).href;
    const childSource = `
      import { recoverInterruptedDistPromotion } from ${JSON.stringify(moduleUrl)};
      const repository = process.env.HRANESS_DIST_TEST_REPOSITORY;
      const token = process.env.HRANESS_DIST_TEST_TOKEN;
      if (repository === undefined || token === undefined) throw new Error("Missing recovery fixture");
      await recoverInterruptedDistPromotion(repository, token, {
        afterAdvisoryLock: async () => process.exit(73),
      });
    `;
    const child = Bun.spawn([process.execPath, "-e", childSource], {
      env: {
        ...process.env,
        HRANESS_DIST_TEST_REPOSITORY: repository,
        HRANESS_DIST_TEST_TOKEN: fixture.token,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 73, stdout: "", stderr: "" });

    await expect(
      recoverInterruptedDistPromotion(repository, fixture.token),
    ).resolves.toBe("released-untouched");
    await expectTerminalPromotionState(repository, fixture, scenario);
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
