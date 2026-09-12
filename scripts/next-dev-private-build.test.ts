import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNextDevPrivateBrowserArtifacts, NEXT_DEV_PRIVATE_OUTPUTS, validateNextDevPrivateBrowserSource } from "./next-dev-private-build.js";

test("the real minified private browser artifacts keep exact exports and browser-only dependencies", async () => {
  const stage = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-browser-build-"));
  try {
    await mkdir(join(stage, "build"));
    expect(await buildNextDevPrivateBrowserArtifacts(dirname(import.meta.dir), stage)).toEqual(NEXT_DEV_PRIVATE_OUTPUTS);
    const bootstrap = await readFile(join(stage, NEXT_DEV_PRIVATE_OUTPUTS[0]), "utf8");
    const client = await readFile(join(stage, NEXT_DEV_PRIVATE_OUTPUTS[1]), "utf8");
    expect(client).toContain("react/jsx-runtime");
    expect(client).not.toContain("react/jsx-dev-runtime");
    expect(client).not.toContain(dirname(import.meta.dir));
    expect(() => validateNextDevPrivateBrowserSource(NEXT_DEV_PRIVATE_OUTPUTS[0], bootstrap)).not.toThrow();
    expect(() => validateNextDevPrivateBrowserSource(NEXT_DEV_PRIVATE_OUTPUTS[1], client)).not.toThrow();
    expect(() => validateNextDevPrivateBrowserSource(NEXT_DEV_PRIVATE_OUTPUTS[1], client.replace('"use client";\n', ""))).toThrow("directive");
    for (const dependency of ["node:fs", "@babel/core", "@stylexjs/babel-plugin", "./another.js"]) {
      expect(() => validateNextDevPrivateBrowserSource(NEXT_DEV_PRIVATE_OUTPUTS[1], client + `\nimport ${JSON.stringify(dependency)};`)).toThrow("unowned");
    }
    expect(() => validateNextDevPrivateBrowserSource(NEXT_DEV_PRIVATE_OUTPUTS[0], bootstrap + '\nrequire("react");')).toThrow();
    expect(() => validateNextDevPrivateBrowserSource("build/foreign.js", client)).toThrow("Unknown");
    await expect(buildNextDevPrivateBrowserArtifacts(dirname(import.meta.dir), stage)).rejects.toThrow("EEXIST");
  } finally { await rm(stage, { recursive: true, force: true }); }
});

test("private JSX bytes remain closed in the real Bun CLI, outside the Bun test transform", async () => {
  const stage = await mkdtemp(join(await realpath(tmpdir()), "ui-next-dev-browser-cli-"));
  try {
    await mkdir(join(stage, "build"));
    const module = pathToFileURL(join(import.meta.dir, "next-dev-private-build.ts")).href;
    const script = `import { buildNextDevPrivateBrowserArtifacts } from ${JSON.stringify(module)};
      process.env.NODE_ENV="production";
      await buildNextDevPrivateBrowserArtifacts(${JSON.stringify(dirname(import.meta.dir))},${JSON.stringify(stage)});`;
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "CIRCLE_NODE_TOTAL", "GOMAXPROCS", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const child = spawnSync(process.execPath, ["--no-env-file", "--eval", script], { cwd: dirname(import.meta.dir), env,
      encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024, killSignal: "SIGKILL" });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "ESRCH", "Private build CLI child survived collection");
    const source = await readFile(join(stage, NEXT_DEV_PRIVATE_OUTPUTS[1]), "utf8");
    expect(source).toContain("react/jsx-runtime");
    expect(source).not.toContain("react/jsx-dev-runtime");
    expect(source).not.toContain(dirname(import.meta.dir));
  } finally { await rm(stage, { recursive: true, force: true }); }
}, 40_000);
