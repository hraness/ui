import { resolve } from "node:path";

const DIST_PATHSPEC = ":(top)dist";

export async function checkCommittedDist(
  repositoryRoot = resolve(import.meta.dir, ".."),
): Promise<void> {
  const status = Bun.spawn(
    [
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      DIST_PATHSPEC,
    ],
    {
      cwd: repositoryRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    status.exited,
    new Response(status.stdout).text(),
    new Response(status.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const detail = stderr.trimEnd();
    throw new Error(
      detail.length === 0
        ? `git status failed with exit code ${String(exitCode)}`
        : `git status failed with exit code ${String(exitCode)}:\n${detail}`,
    );
  }

  if (stdout.length > 0) {
    throw new Error(
      `dist does not match the committed build output:\n${stdout.trimEnd()}`,
    );
  }
}

if (import.meta.main) await checkCommittedDist();
