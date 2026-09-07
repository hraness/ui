import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { test } from "bun:test";

test("packed Next fixture separates clean runtime config from private build state", () => {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("HRANESS_STYLEX_NEXT_")) delete environment[key];
  }
  const fixture = pathToFileURL(`${import.meta.dir}/../fixtures/next-adopter/next.config.mjs`).href;
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import config from ${JSON.stringify(fixture)};
    import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
    const runtime = config(PHASE_PRODUCTION_SERVER);
    assert.equal(runtime.reactStrictMode, true);
    assert.equal(runtime.outputFileTracingRoot, process.cwd());
    assert.equal(runtime.webpack, undefined);
    assert.equal(runtime.distDir, undefined);
    assert.deepEqual(await runtime.headers(), [{source:"/:path*", headers:[{key:"Content-Security-Policy", value:"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'"}]}]);
    assert.throws(() => config(PHASE_DEVELOPMENT_SERVER), /production build and start only/);
    assert.throws(() => config("unknown"), /production build and start only/);
    assert.throws(() => config(PHASE_PRODUCTION_BUILD), /attempt missing/);
    process.env.HRANESS_STYLEX_NEXT_ATTEMPT_DIRECTORY = process.cwd() + "/.stylex-next/phase-contract";
    process.env.HRANESS_STYLEX_NEXT_MODE = "discovery";
    process.env.HRANESS_STYLEX_NEXT_PLAN_SHA256 = "0".repeat(64);
    const build = config(PHASE_PRODUCTION_BUILD);
    assert.equal(typeof build.webpack, "function");
    assert.deepEqual(await build.headers(), await runtime.headers());
    assert.equal(config(PHASE_PRODUCTION_SERVER).webpack, undefined);
  `], { cwd: `${import.meta.dir}/..`, env: environment, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  assert.equal(child.signalCode, undefined, child.stderr.toString());
  assert.equal(child.exitCode, 0, child.stderr.toString());
});
