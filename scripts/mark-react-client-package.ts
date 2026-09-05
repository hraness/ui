import assert from "node:assert/strict";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const DIRECTIVE = '"use client";\n';

function logicalPath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(
    value.length > 0
      && value !== ".."
      && !value.startsWith("../")
      && !value.startsWith("/")
      && !value.split("/").includes(".."),
    `Runtime path escapes dist: ${path}`,
  );
  return value;
}

async function runtimeJavascriptFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    const logical = logicalPath(root, path);
    if (logical === "build" || logical.startsWith("build/")) return [];
    if (entry.isDirectory()) return runtimeJavascriptFiles(root, path);
    assert.ok(entry.isFile(), `dist contains a nonordinary entry: ${logical}`);
    return entry.name.endsWith(".js") ? [logical] : [];
  }));
  return nested.flat().sort();
}

export async function markReactClientPackage(
  distDirectory: string,
  runtimePaths?: readonly string[],
): Promise<readonly string[]> {
  const root = resolve(distDirectory);
  const rootStat = await lstat(root);
  assert.ok(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    "dist must be an ordinary directory",
  );
  const paths = runtimePaths === undefined
    ? await runtimeJavascriptFiles(root)
    : [...runtimePaths].sort();
  assert.ok(paths.length > 0, "At least one runtime JavaScript artifact is required");
  assert.equal(new Set(paths).size, paths.length, "Runtime JavaScript paths must be unique");

  for (const logical of paths) {
    assert.ok(
      logical.endsWith(".js")
        && logical !== "build"
        && !logical.startsWith("build/")
        && logical.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
      `Invalid runtime JavaScript path: ${logical}`,
    );
    const path = join(root, ...logical.split("/"));
    const stat = await lstat(path);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink(),
      `Runtime artifact must be an ordinary file: ${logical}`,
    );
    const source = await readFile(path, "utf8");
    if (!source.startsWith(DIRECTIVE)) {
      await writeFile(path, DIRECTIVE + source, { flag: "w" });
    }
  }
  return paths;
}

if (import.meta.main) {
  assert.equal(process.argv.length, 2, "This script accepts no command-line arguments");
  await markReactClientPackage(join(process.cwd(), "dist"));
}
