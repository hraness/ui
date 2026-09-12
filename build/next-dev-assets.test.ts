import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { materializeNextDevNativeCss, type NextDevCapturedCssInput } from "./next-dev-assets.js";
import { sha256 } from "./compiler.js";

const captured = (path: string, source: string): NextDevCapturedCssInput => ({ path, source, sha256: sha256(source) });
const entry = "app/stylex-dev.css";
const foundation = "node_modules/@example/ui/src/foundation.css";
const tokens = "node_modules/@example/ui/src/tokens.css";
const prelude = "@layer base, components; @layer components.example.legacy, components.hraness-stylex.priority1;";
const union = "@layer components.hraness-stylex.priority1 { .x-example { margin-left: 38.375px; color: rgb(43, 83, 123); } }";
const source = `${prelude}\n@import "../${foundation}";\n${union}`;
const stylesheets = [captured(foundation, '@layer base, components; @import "./tokens.css"; @layer components.example.legacy { button { font: inherit; } }'),
  captured(tokens, "@layer base { :root { --space: 12.125px; } }")];
let compiled: Promise<string> | null = null;
async function nativeHelperSource(): Promise<string> {
  compiled ??= Bun.build({ entrypoints: [`${import.meta.dir}/next-dev-assets.ts`], packages: "external", target: "node",
    format: "esm", splitting: false, minify: false, env: "disable", sourcemap: "none" }).then(async (result) => {
    assert.equal(result.success, true, "Native helper in-memory compilation failed");
    assert.equal(result.logs.length, 0, "Native helper in-memory compilation emitted diagnostics");
    assert.equal(result.outputs.length, 1, "Native helper must remain one in-memory module");
    const code = await result.outputs[0]!.text();
    assert.ok(Buffer.byteLength(code) <= 512 * 1024, "Native helper in-memory module exceeds its bound");
    return code;
  });
  return compiled;
}
async function materialize(inputs = stylesheets, css = source): Promise<Awaited<ReturnType<typeof materializeNextDevNativeCss>>> {
  const node = Bun.which("node");
  assert.ok(node !== null, "Native helper tests require genuine Node 24 on PATH");
  const code = `${await nativeHelperSource()}\nimport { readFileSync as readTestInput } from 'node:fs';
try {
 const result = await materializeNextDevNativeCss(JSON.parse(readTestInput(0,'utf8')));
 process.stdout.write(JSON.stringify({node:process.versions.node,result})+'\\n');
} catch (error) { process.stdout.write(JSON.stringify({error:error instanceof Error ? error.message : String(error)})+'\\n'); }
`;
  // This is one isolated deterministic helper, not a repository/packed build.
  // No output is written to disk. spawnSync bounds stdout/stderr, kills its
  // exact child on timeout and returns only after terminal status and pipe EOF.
  const child = spawnSync(node, ["--input-type=module", "--eval", code], { cwd: import.meta.dir, encoding: "utf8",
    input: JSON.stringify({ entryPath: entry, manifests: [], source: css, stylesheets: inputs }),
    timeout: 5_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
  assert.equal(child.error, undefined, "Native helper child failed or exceeded its bounds");
  assert.equal(child.signal, null, "Native helper child was signalled");
  assert.equal(child.status, 0, `Native helper child failed: ${child.stderr.slice(0, 2048)}`);
  assert.equal(child.stderr, "", "Native helper child emitted unexpected diagnostics");
  assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
    && "code" in error && error.code === "ESRCH", "Native helper child survived terminal collection");
  const reply: unknown = JSON.parse(child.stdout);
  assert.ok(typeof reply === "object" && reply !== null && !Array.isArray(reply), "Native helper reply must be an object");
  if ("error" in reply) {
    assert.deepEqual(Object.keys(reply), ["error"]);
    assert.ok(typeof reply.error === "string" && reply.error.length <= 4096);
    throw new Error(reply.error);
  }
  assert.deepEqual(Object.keys(reply), ["node", "result"]);
  assert.ok("node" in reply && typeof reply.node === "string" && /^24\./u.test(reply.node), "Native helper did not use Node 24");
  assert.ok("result" in reply && typeof reply.result === "object" && reply.result !== null);
  const result = reply.result as Awaited<ReturnType<typeof materializeNextDevNativeCss>>;
  assert.deepEqual(Object.keys(result), ["css", "inputs", "path", "sha256"]);
  assert.ok(typeof result.css === "string" && typeof result.sha256 === "string" && /^[a-f0-9]{64}$/u.test(result.sha256));
  assert.equal(sha256(result.css), result.sha256);
  assert.equal(result.path, `static/css/hraness-stylex/${result.sha256}.css`);
  assert.ok(Array.isArray(result.inputs) && result.inputs.length > 0 && result.inputs.length <= 129);
  for (const input of result.inputs) {
    assert.ok(typeof input === "object" && input !== null);
    assert.deepEqual(Object.keys(input), ["path", "sha256"]);
    assert.ok(typeof input.path === "string" && typeof input.sha256 === "string" && /^[a-f0-9]{64}$/u.test(input.sha256));
  }
  return result;
}

test("the Next-native helper rejects Bun before invoking the asynchronous native resolver", async () => {
  await expect(materializeNextDevNativeCss({ entryPath: entry, manifests: [], source, stylesheets })).rejects.toThrow("genuine Node 24");
});

test("one immutable native CSS digest binds recursively captured foundations and the union", async () => {
  const result = await materialize();
  expect(result.css).toContain("38.375px");
  expect(result.css).toContain("12.125px");
  expect(result.css).toContain("font: inherit");
  expect(result.css).toContain("components.hraness-stylex.priority1");
  expect(result.css).not.toContain("@import");
  expect(result.sha256).toBe(sha256(result.css));
  expect(result.path).toBe(`static/css/hraness-stylex/${result.sha256}.css`);
  expect(result.inputs).toEqual([{ path: entry, sha256: sha256(source) },
    { path: foundation, sha256: stylesheets[0]!.sha256 }, { path: tokens, sha256: stylesheets[1]!.sha256 }]);
  const changed = await materialize([stylesheets[0]!, captured(tokens, stylesheets[1]!.source.replace("12.125", "13.125"))]);
  expect(changed.sha256).not.toBe(result.sha256);
  const sameRulesNewSource = await materialize(stylesheets, `${source}\n/* source revision changed */`);
  expect(sameRulesNewSource.sha256).not.toBe(result.sha256);
});

test("input order and unreachable registered files do not change the emitted native CSS identity", async () => {
  const expected = await materialize();
  expect(await materialize([...stylesheets].reverse())).toEqual(expected);
  expect(await materialize([...stylesheets, captured("node_modules/@example/ui/src/unused.css", "p { color: red; }")])).toEqual(expected);
});

test("foreign CSS hashes, duplicate inputs, external or undeclared imports and cycles fail closed", async () => {
  await expect(materialize([{ ...stylesheets[0]!, sha256: "0".repeat(64) }, stylesheets[1]!])).rejects.toThrow("hash differs");
  await expect(materialize([...stylesheets, stylesheets[0]!])).rejects.toThrow("unique");
  for (const target of ["https://example.com/style.css", "//example.com/style.css", "/absolute.css", "./tokens.css?v=1", "./missing.css"]) {
    await expect(materialize([captured(foundation, `@import ${JSON.stringify(target)};`), stylesheets[1]!])).rejects.toThrow();
  }
  await expect(materialize([stylesheets[0]!, captured(tokens, '@import "./foundation.css";')])).rejects.toThrow("cycle");
});

test("native CSS rejects external asset loads and reserved recipe namespace in a foundation", async () => {
  for (const url of ["./icon.svg", "https://example.com/image.png", "data:text/html,hello"]) {
    await expect(materialize(stylesheets, `${source}\n.x-image { background-image: url(${JSON.stringify(url)}); }`)).rejects.toThrow("inline data image");
  }
  await expect(materialize([captured(foundation, union), stylesheets[1]!])).rejects.toThrow("reserved StyleX");
  const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
  const result = await materialize(stylesheets, `${source}\n.x-image { background-image: url(${JSON.stringify(image)}); }`);
  expect(result.css).toContain("data:image/svg+xml");
});

test("conditional captured CSS imports preserve their media semantics in the single native asset", async () => {
  const result = await materialize(stylesheets, `${prelude}\n@import "../${foundation}" screen and (min-width: 640px);\n${union}`);
  expect(result.css).toContain("@media screen and (width >= 640px)");
  expect(result.css).toContain("38.375px");
  expect(result.css).not.toContain("@import");
});
