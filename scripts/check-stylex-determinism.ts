import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type RunOptions = Readonly<{
  echo?: boolean;
  terminationGraceMs?: number;
  timeoutMs?: number;
}>;

export async function runDeterminismChild(
  command: string[],
  cwd: string,
  label: string,
  options: RunOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const terminationGraceMs = options.terminationGraceMs ?? 2_000;
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  assert.ok(Number.isSafeInteger(terminationGraceMs) && terminationGraceMs > 0);

  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, kind: "exit" as const })),
    new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);

  const timedOut = outcome.kind === "timeout";
  if (timedOut) {
    child.kill("SIGTERM");
    let grace: ReturnType<typeof setTimeout> | undefined;
    const terminated = await Promise.race([
      child.exited.then(() => true),
      new Promise<false>((resolveGrace) => {
        grace = setTimeout(() => resolveGrace(false), terminationGraceMs);
      }),
    ]);
    if (grace !== undefined) clearTimeout(grace);
    if (!terminated) child.kill("SIGKILL");
  }

  const exitCode = await child.exited;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (options.echo !== false && stdoutText.length > 0) {
    process.stdout.write(stdoutText);
  }
  if (options.echo !== false && stderrText.length > 0) {
    process.stderr.write(stderrText);
  }
  if (timedOut) {
    throw new Error(
      `${label} timed out after ${String(timeoutMs)}ms: ${command.join(" ")}`,
    );
  }
  assert.equal(
    child.signalCode,
    null,
    `${label} exited by signal ${String(child.signalCode)}: ${command.join(" ")}`,
  );
  if (exitCode !== 0) {
    throw new Error(
      `${label} failed (${String(exitCode)}): ${command.join(" ")}`,
    );
  }
}

async function buildCopy(repository: string, destination: string): Promise<void> {
  await Promise.all([
    cp(resolve(repository, "src"), resolve(destination, "src"), { recursive: true }),
    cp(resolve(repository, "build"), resolve(destination, "build"), { recursive: true }),
    cp(resolve(repository, "package.json"), resolve(destination, "package.json")),
  ]);
  await runDeterminismChild(
    [process.execPath, resolve(repository, "scripts/build-package.ts")],
    destination,
    "StyleX determinism build",
  );
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await filesBelow(root, path));
    else if (entry.isFile()) paths.push(path.slice(root.length + 1));
    else throw new Error(`Unexpected determinism artifact type: ${path}`);
  }
  return paths.sort();
}

async function requireSameFile(
  firstRoot: string,
  secondRoot: string,
  relativePath: string,
): Promise<void> {
  const [first, second] = await Promise.all([
    readFile(resolve(firstRoot, relativePath)),
    readFile(resolve(secondRoot, relativePath)),
  ]);
  if (!first.equals(second)) {
    throw new Error(`${relativePath} differs across absolute build roots`);
  }
}

async function main(): Promise<void> {
  const repository = process.cwd();
  const work = await mkdtemp(join(tmpdir(), "hraness-ui-stylex-determinism-"));
  const firstRoot = resolve(work, "first");
  const secondRoot = resolve(work, "nested", "second");

  try {
    await buildCopy(repository, firstRoot);
    await buildCopy(repository, secondRoot);

    const [firstOutputs, secondOutputs] = await Promise.all([
      filesBelow(resolve(firstRoot, "dist")),
      filesBelow(resolve(secondRoot, "dist")),
    ]);
    if (JSON.stringify(firstOutputs) !== JSON.stringify(secondOutputs)) {
      throw new Error("StyleX determinism builds emitted different recursive file sets");
    }
    if (!firstOutputs.includes("index.js")
      || !firstOutputs.includes("stylex.css")
      || !firstOutputs.includes("stylex-manifest.json")
      || !firstOutputs.includes("build/index.js")
      || !firstOutputs.includes("build/bun.js")
      || !firstOutputs.includes("build/vite.js")
      || !firstOutputs.includes("build/next-dev.js")
      || !firstOutputs.includes("build/next-dev-session.js")
      || !firstOutputs.includes("build/next-dev-loader.cjs")
      || !firstOutputs.includes("build/next-dev-css-loader.cjs")
      || !firstOutputs.includes("build/next-output-settlement.js")) {
      throw new Error("StyleX determinism build omitted required public artifacts");
    }

    for (const path of firstOutputs) {
      await requireSameFile(firstRoot, secondRoot, `dist/${path}`);
    }
    console.log(
      `${String(firstOutputs.length)} package artifacts are byte-identical across absolute roots`,
    );
  } finally {
    await rm(work, { force: true, recursive: true });
  }
}

if (import.meta.main) await main();
