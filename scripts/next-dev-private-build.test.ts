import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
