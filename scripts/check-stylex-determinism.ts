import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildPackage } from "./build-package.js";

async function buildCopy(repository: string, destination: string): Promise<void> {
  await cp(resolve(repository, "src"), resolve(destination, "src"), {
    recursive: true,
  });
  await buildPackage(destination);
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

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-ui-stylex-determinism-"));
const firstRoot = resolve(work, "first");
const secondRoot = resolve(work, "nested", "second");

try {
  await buildCopy(repository, firstRoot);
  await buildCopy(repository, secondRoot);

  const [firstOutputs, secondOutputs] = await Promise.all([
    readdir(resolve(firstRoot, "dist")),
    readdir(resolve(secondRoot, "dist")),
  ]);
  const expectedOutputs = ["index.js", "stylex.css"];
  if (
    JSON.stringify(firstOutputs.sort()) !== JSON.stringify(expectedOutputs)
    || JSON.stringify(secondOutputs.sort()) !== JSON.stringify(expectedOutputs)
  ) {
    throw new Error("StyleX determinism builds emitted an unexpected file set");
  }

  await requireSameFile(firstRoot, secondRoot, "dist/index.js");
  await requireSameFile(firstRoot, secondRoot, "dist/stylex.css");
  console.log("StyleX JS and CSS are byte-identical across absolute roots");
} finally {
  await rm(work, { force: true, recursive: true });
}
