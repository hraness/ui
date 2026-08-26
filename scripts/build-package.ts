import stylex from "@stylexjs/unplugin/esbuild";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { stylexCompilerOptions } from "./stylex-config.js";

export async function buildPackage(
  repository: string,
  outdir = resolve(repository, "dist"),
): Promise<void> {
  await rm(outdir, { force: true, recursive: true });

  const originalNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const result = await Bun.build({
      conditions: ["production", "browser", "module"],
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      entrypoints: [resolve(repository, "src/index.ts")],
      format: "esm",
      metafile: true,
      minify: true,
      outdir,
      packages: "external",
      plugins: [stylex(stylexCompilerOptions(repository))],
      root: resolve(repository, "src"),
      splitting: true,
      target: "browser",
    });

    if (!result.success) {
      for (const log of result.logs) console.error(log);
      throw new Error("Package build failed");
    }
  } finally {
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
  }
}

if (import.meta.main) await buildPackage(process.cwd());
