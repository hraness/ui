import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "bun:test";

import { sha256 } from "./compiler.js";
import { STYLEX_NEXT_AUXILIARY_TRACE_CREATOR } from "./next-contracts.js";
import {
  captureStylexNextAuxiliaryTraceAsset,
  observeStylexNextAuxiliaryTraceSnapshot,
  validateStylexNextAuxiliaryTraceSource,
} from "./next-auxiliary.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const source = '{"version":1,"files":["first.js"]}';
const path = "server/app/page.js.nft.json";
const initial = { bytes: Buffer.byteLength(source), path, sha256: sha256(source) };

async function fixture(hardlinkedCreator = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ui-next-auxiliary-")));
  roots.push(root);
  const creatorPath = join(root, "node_modules/next", STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]);
  const creatorSource = await readFile(new URL(`../node_modules/next/${STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]}`, import.meta.url));
  assert.equal(sha256(creatorSource), STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[1]);
  await mkdir(dirname(creatorPath), { recursive: true });
  await writeFile(creatorPath, creatorSource);
  const creatorAlias = join(root, "installed-creator-alias.js");
  if (hardlinkedCreator) await link(creatorPath, creatorAlias);
  const outputRoot = join(root, ".next");
  const outputPath = join(outputRoot, path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source);
  const asset = await captureStylexNextAuxiliaryTraceAsset(root, "app/page", initial, source);
  return { asset, creatorAlias, creatorPath, creatorSource, outputPath, outputRoot, root };
}

describe("Next framework auxiliary trace observations", () => {
  test("accepts stable hardlinked installed creators only at the pinned source hash", async () => {
    const context = await fixture(true);
    const creator = await lstat(context.creatorPath);
    const alias = await lstat(context.creatorAlias);
    assert.equal(creator.nlink, 2);
    assert.equal(creator.ino, alias.ino);
    assert.equal(creator.dev, alias.dev);
    const observe = () => observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset);
    assert.deepEqual(await observe(), { asset: context.asset, output: initial, semantics: "observation-only" });
    const changed = Buffer.from(context.creatorSource);
    changed[0] = changed[0]! ^ 1;
    await writeFile(context.creatorAlias, changed);
    assert.equal((await lstat(context.creatorPath)).nlink, 2);
    assert.equal(sha256(await readFile(context.creatorPath)), sha256(changed));
    await assert.rejects(captureStylexNextAuxiliaryTraceAsset(context.root, "app/page", initial, source), /pinned source bytes/u);
    await assert.rejects(observe(), /pinned source bytes/u);
    await writeFile(context.creatorAlias, context.creatorSource);
    assert.deepEqual(await observe(), { asset: context.asset, output: initial, semantics: "observation-only" });
    await unlink(context.creatorPath);
    await symlink(context.creatorAlias, context.creatorPath);
    await assert.rejects(captureStylexNextAuxiliaryTraceAsset(context.root, "app/page", initial, source), /symlink/u);
    await assert.rejects(observe(), /symlink/u);
  });

  test("still rejects hardlinked outputs with a valid hardlinked installed creator", async () => {
    const context = await fixture(true);
    await link(context.outputPath, join(context.root, "output-alias.json"));
    await assert.rejects(observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset), /single-link/u);
  });

  test("retains initial bytes while observing unsorted final names without following them", async () => {
    const context = await fixture();
    const before = await observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset);
    assert.deepEqual(before, { asset: context.asset, output: initial, semantics: "observation-only" });
    const final = '{"version":1,"files":["z-does-not-exist.js","../../../../unread","a-does-not-exist.js"]}';
    await writeFile(context.outputPath, final);
    const after = await observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset);
    assert.deepEqual(after.asset.initial, initial);
    assert.deepEqual(after.output, { bytes: Buffer.byteLength(final), path, sha256: sha256(final) });
    assert.equal(after.semantics, "observation-only");
    assert.notDeepEqual(after, before, "A later observation must not silently rebind an already sealed snapshot");
    assert.deepEqual(Object.keys(after).sort(), ["asset", "output", "semantics"]);
    assert.equal(await readFile(context.outputPath, "utf8"), final, "Observation must not rewrite native metadata");
  });

  test("copies initial source bytes before asynchronous creator checks and rejects mismatched identities", async () => {
    const context = await fixture();
    const input = Buffer.from(source);
    const pending = captureStylexNextAuxiliaryTraceAsset(context.root, "app/page", initial, input);
    input.fill(0);
    assert.deepEqual(await pending, context.asset);
    for (const changed of [
      { ...initial, bytes: initial.bytes + 1 }, { ...initial, sha256: sha256("other") },
      { ...initial, path: "server/app/other.js.nft.json" }, { ...initial, path: "server/app/page.js" },
    ]) await assert.rejects(captureStylexNextAuxiliaryTraceAsset(context.root, "app/page", changed, source), /source bytes or entrypoint/u);
    await writeFile(context.creatorPath, `${context.creatorSource.toString("utf8")}\n`);
    await assert.rejects(captureStylexNextAuxiliaryTraceAsset(context.root, "app/page", initial, source), /pinned source bytes/u);
    await assert.rejects(observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset), /pinned source bytes/u);
    await writeFile(context.creatorPath, context.creatorSource);
    await assert.rejects(observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, { ...context.asset, creator: { ...context.asset.creator, bytes: 1 } }), /captured creator changed/u);
    assert.deepEqual(await observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset), { asset: context.asset, output: initial, semantics: "observation-only" });
  });

  test("accepts only bounded native JSON with relative names, without sorting include order", () => {
    for (const files of [[], ["z", "a"], ["../shared/a.js", "../../../node_modules/package/index.js"], ["name with spaces.js", "é/😀.js"], ["x".repeat(4096)]]) {
      assert.doesNotThrow(() => validateStylexNextAuxiliaryTraceSource(JSON.stringify({ version: 1, files })));
    }
    for (const invalid of [
      "", "null", "[]", "{}", '{"version":2,"files":[]}', '{"version":1,"files":null}',
      '{"version":1,"files":[],"safe":true}', '{"version":2,"version":1,"files":[]}',
      '{"version":1,"files":[]}\nfetch("/")', '{"version":1,"files":[false]}',
      ...["", "/absolute", "C:/absolute", "C:relative", "\\\\server\\share", "file:///absolute", "https://host/file", "a\\b", "a\0b", "a\nb", "\u007f", "x".repeat(4097)].map((file) => JSON.stringify({ version: 1, files: [file] })),
      JSON.stringify({ version: 1, files: Array<string>(100_001).fill("x") }),
    ]) assert.throws(() => validateStylexNextAuxiliaryTraceSource(invalid));
    assert.throws(() => validateStylexNextAuxiliaryTraceSource(Buffer.from([0xff])), /valid UTF-8/u);
    assert.throws(() => validateStylexNextAuxiliaryTraceSource(Buffer.alloc(16 * 1024 * 1024 + 1)), /byte bound/u);
  });

  test("rejects missing, linked, special, oversized and malformed final artifacts", async () => {
    const context = await fixture();
    const observe = () => observeStylexNextAuxiliaryTraceSnapshot(context.root, context.outputRoot, context.asset);
    const retained = join(context.root, "retained.json");
    await writeFile(retained, source);
    await unlink(context.outputPath);
    await assert.rejects(observe(), /ENOENT/u);
    await symlink(retained, context.outputPath);
    await assert.rejects(observe(), /symlink/u);
    await unlink(context.outputPath);
    await link(retained, context.outputPath);
    await assert.rejects(observe(), /single-link/u);
    await unlink(context.outputPath);
    await mkdir(context.outputPath);
    await assert.rejects(observe(), /ordinary single-link/u);
    await rmdir(context.outputPath);
    for (const final of [Buffer.from([0xff]), Buffer.from('{"version":1,"files":["/absolute"]}'), Buffer.alloc(16 * 1024 * 1024 + 1)]) {
      await writeFile(context.outputPath, final);
      await assert.rejects(observe());
    }
    await writeFile(context.outputPath, source);
    const alias = join(context.root, "alias");
    await symlink(context.outputRoot, alias);
    await assert.rejects(observeStylexNextAuxiliaryTraceSnapshot(context.root, alias, context.asset), /root traverses a symlink/u);
    const creatorCopy = join(context.root, "creator.js");
    await writeFile(creatorCopy, context.creatorSource);
    await unlink(context.creatorPath);
    await symlink(creatorCopy, context.creatorPath);
    await assert.rejects(observe(), /symlink/u);
  });
});
