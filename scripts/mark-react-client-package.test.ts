import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { markReactClientPackage } from "./mark-react-client-package.js";

test("marks only runtime JavaScript and leaves build tools server-compatible", async () => {
  const root = await mkdtemp(join(tmpdir(), "hraness-ui-client-mark-"));
  try {
    await mkdir(join(root, "build"));
    await Promise.all([
      writeFile(join(root, "index.js"), "export const runtime = true;\n"),
      writeFile(join(root, "chunk.js"), '"use client";\nexport const chunk = true;\n'),
      writeFile(join(root, "build/index.js"), "export const tool = true;\n"),
    ]);

    expect(await markReactClientPackage(root)).toEqual(["chunk.js", "index.js"]);
    expect(await readFile(join(root, "index.js"), "utf8")).toStartWith('"use client";\n');
    expect(await readFile(join(root, "chunk.js"), "utf8")).toBe(
      '"use client";\nexport const chunk = true;\n',
    );
    expect(await readFile(join(root, "build/index.js"), "utf8")).toBe(
      "export const tool = true;\n",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects build-tool paths from an explicit runtime inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "hraness-ui-client-mark-"));
  try {
    await mkdir(join(root, "build"));
    await writeFile(join(root, "build/index.js"), "export {};\n");
    await expect(markReactClientPackage(root, ["build/index.js"])).rejects.toThrow(
      "Invalid runtime JavaScript path",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
