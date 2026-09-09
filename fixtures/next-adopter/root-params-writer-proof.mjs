import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";

// Writer-level evidence only. The packed compiler fixture separately proves
// native pre-webpack invocation, environment imports and complete graph joins.
assert.equal(typeof globalThis.Bun, "undefined");
assert.match(process.versions.node, /^24\./u);
assert.equal(process.argv.length, 4, "Expected exact installed Next root and isolated proof directory");
const [nextRoot, proofRoot] = process.argv.slice(2);
assert.ok(typeof nextRoot === "string" && typeof proofRoot === "string");
for (const path of [nextRoot, proofRoot]) assert.ok(isAbsolute(path) && resolve(path) === path);
assert.equal(await realpath(nextRoot), nextRoot);
const manifest = JSON.parse(await readFile(join(nextRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "next");
assert.equal(manifest.version, "16.3.3");
const writer = join(nextRoot, "dist/server/lib/router-utils/root-params-type-utils.js");
const writerState = await lstat(writer);
assert.ok(writerState.isFile() && !writerState.isSymbolicLink());
assert.equal(await realpath(writer), writer);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const writerHash = "d08e53213b27e02f5b7825c863f90c27d6885f096b6234781068c0cf0678e0a2";
assert.equal(hash(await readFile(writer)), writerHash);
const require = createRequire(join(nextRoot, "package.json"));
const { generateRootParamsTypes, writeRootParamsTypes } = require(writer);
assert.equal(typeof generateRootParamsTypes, "function");
assert.equal(typeof writeRootParamsTypes, "function");
await mkdir(proofRoot, { mode: 0o700 });
assert.equal(await realpath(proofRoot), proofRoot);

const values = ["string", "string[]", "undefined"];
const header = "// Type definitions for Next.js root params (next/root-params)\n";
let cases = 0;
for (let mask = 1; mask < 8; mask += 1) {
  const selected = values.filter((_, index) => (mask & (1 << index)) !== 0);
  const expected = `${header}\ndeclare module 'next/root-params' {\n  export function alpha(): Promise<${selected.join(" | ")}>\n  export function zulu(): Promise<${selected.join(" | ")}>\n}\n`;
  for (const reverse of [false, true]) {
    const names = reverse ? ["zulu", "alpha"] : ["alpha", "zulu"];
    const inputs = reverse ? [...selected].reverse() : selected;
    const rootParams = new Map(names.map((name) => [name, new Set(inputs)]));
    assert.equal(generateRootParamsTypes(rootParams), expected);
    const path = join(proofRoot, `union-${mask}-${reverse ? "reverse" : "forward"}.d.ts`);
    await writeRootParamsTypes({ rootParams }, path);
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
    assert.equal(await realpath(path), path);
    assert.equal(await readFile(path, "utf8"), expected);
    cases += 1;
  }
}
const emptyPath = join(proofRoot, "empty.d.ts");
await writeRootParamsTypes({ rootParams: new Map() }, emptyPath);
assert.equal(await readFile(emptyPath, "utf8"), `${header}// No root params detected.\nexport {}\n`);
const settledWriter = await lstat(writer);
assert.ok(settledWriter.isFile() && !settledWriter.isSymbolicLink());
for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"]) assert.equal(settledWriter[key], writerState[key]);
assert.equal(hash(await readFile(writer)), writerHash);
console.log(`Next 16.3.3 exact installed root-params writer passed ${cases} nonempty cases (seven unions, two orders) and one empty declaration; not full dynamic-root route acceptance`);
