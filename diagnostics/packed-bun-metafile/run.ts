import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { containsPath, createObservedBuild, diagnosticDigest, diagnosticPackagePaths, parseDiagnosticArguments, selectMetafileImports } from "./observer.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;

async function ordinaryBytes(path: string): Promise<Buffer> {
  const before = await lstat(path);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= MAX_FILE_BYTES, "Expected bounded ordinary diagnostic input");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    const identity = (info: typeof opened) => [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs];
    assert.deepEqual(identity(opened), identity(before), "Diagnostic input changed before reading");
    const bytes = await handle.readFile();
    assert.ok(bytes.length <= MAX_FILE_BYTES, "Diagnostic input exceeded byte bound");
    assert.deepEqual(identity(await handle.stat()), identity(before), "Diagnostic input changed while reading");
    assert.deepEqual(identity(await lstat(path)), identity(before), "Diagnostic input path changed while reading");
    return bytes;
  } finally { await handle.close(); }
}

async function run(): Promise<never> {
  assert.equal(Bun.version, "1.3.14", "This observer is pinned to Bun 1.3.14");
  const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const args = parseDiagnosticArguments(process.argv.slice(2), process.cwd(), repository);
  assert.equal(await realpath(args.consumer), args.consumer, "Consumer must be an existing physical directory");
  assert.ok((await lstat(args.consumer)).isDirectory(), "Consumer must be a directory");
  assert.equal(await realpath(args.output), args.output, "Output must be an existing physical directory");
  const outputInfo = await lstat(args.output);
  assert.ok(outputInfo.isDirectory() && (outputInfo.mode & 0o077) === 0
    && outputInfo.uid === process.getuid?.(), "Output must be a caller-owned private directory");
  const entry = resolve(args.consumer, args.entry);
  assert.equal(await realpath(entry), entry, "Entry must be an existing physical build-only script");
  await ordinaryBytes(entry);

  async function snapshot(path: string): Promise<Record<string, unknown>> {
    // Preserve all candidate resolutions, but do not read an unrelated tree
    // merely because a foreign metafile contains an escaping path or symlink.
    if (!containsPath(args.consumer, path)) return { path, error: "Outside consumer snapshot boundary" };
    try {
      const info = await lstat(path);
      const physical = await realpath(path);
      const metadata = { path, realpath: physical, mode: info.mode, file: info.isFile(),
        directory: info.isDirectory(), symlink: info.isSymbolicLink(), bytes: info.size };
      if (!containsPath(args.consumer, physical)) return { ...metadata, error: "Outside consumer snapshot boundary" };
      return { ...metadata, ...(info.isFile() && !info.isSymbolicLink() ? { sha256: diagnosticDigest(await ordinaryBytes(path)) } : {}) };
    } catch (error) { return { path, error: String(error) }; }
  }

  const originalBuild = Bun.build;
  let observations = 0;
  Bun.build = createObservedBuild(originalBuild.bind(Bun), async ({ number, root, cwd, options, result, events }) => {
    assert.ok(containsPath(args.consumer, root), "Build root must remain inside the explicit consumer");
    assert.equal(await realpath(root), root, "Build root must be physical");
    const raw: unknown = result.metafile;
    const { keys, matches } = selectMetafileImports(raw, args.mode, root, cwd);
    const inventory = diagnosticPackagePaths(args.mode, root);
    const packages = await Promise.all(inventory.roots.map(async (packageRoot) => {
      const path = resolve(packageRoot, "package.json");
      assert.ok(containsPath(args.consumer, await realpath(path)), "Package metadata must remain inside the consumer");
      const text = (await ordinaryBytes(path)).toString("utf8");
      const value: unknown = JSON.parse(text);
      assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Expected package metadata object");
      const record = value as Record<string, unknown>;
      return { name: record.name, version: record.version, sideEffects: record.sideEffects,
        hasOwnSideEffects: Object.hasOwn(record, "sideEffects"), sha256: diagnosticDigest(text) };
    }));
    const paths = new Set([...inventory.paths, ...matches.flatMap((match) => [
      match.resolvedFromImporter, match.resolvedFromRoot, match.resolvedFromCwd,
    ])]);
    const bytes = Buffer.from(`${JSON.stringify({
      bun: Bun.version, root, cwd,
      options: { target: options.target, conditions: options.conditions, entrypoints: options.entrypoints,
        minify: options.minify, splitting: options.splitting, format: options.format },
      success: result.success, metafile: raw, authoritativeInputKeys: keys, matches, onLoadEvents: events,
      ...(args.mode === "single-package" ? { package: packages[0] } : { packages }),
      paths: await Promise.all([...paths].map(snapshot)),
    }, null, 2)}\n`);
    assert.ok(bytes.length <= MAX_FILE_BYTES, "Diagnostic receipt exceeds byte bound");
    assert.equal(await realpath(args.output), args.output, "Output directory changed");
    const current = await lstat(args.output);
    assert.deepEqual([current.dev, current.ino, current.mode, current.uid], [outputInfo.dev, outputInfo.ino, outputInfo.mode, outputInfo.uid], "Output directory identity changed");
    const prefix = args.mode === "single-package" ? "diagnostic" : "cross-package-diagnostic";
    const handle = await open(resolve(args.output, `${prefix}-build-${number}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    observations += 1;
  }, () => process.cwd());
  const previousCwd = process.cwd();
  try {
    process.chdir(args.consumer);
    // The reviewed entry must end after building; never pass the browser smoke
    // orchestrator here. No package setup or browser is supplied by this driver.
    await import(pathToFileURL(entry).href);
    assert.ok(observations > 0, "The selected entry did not complete an observed build");
  } finally {
    Bun.build = originalBuild;
    process.chdir(previousCwd);
  }
  throw new Error("Diagnostic build completed; browser phase deliberately not started. This is not acceptance evidence.");
}

if (import.meta.main) await run();
