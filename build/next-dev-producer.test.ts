import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";
import { createNextDevNativeProducer } from "./next-dev-producer.js";
import { compilerContract, compilerSha256, serializeStylexPackageRules, sha256, validateStylexPackageManifest } from "./compiler.js";

const foundationSource = "@layer base { body { margin: 0; } }";
const standaloneSerializer = { before: ["components.example-ui.legacy"], prefix: "components.example-ui" };
const standaloneSource = serializeStylexPackageRules([], standaloneSerializer);
const manifest = validateStylexPackageManifest({ buildTools: [], compiler: compilerContract, compilerFoundation: "src/foundation.css", compilerSha256,
  kind: "hraness-stylex-package-manifest", package: { name: "@example/ui", version: "1.0.0" }, rules: [], rulesSha256: sha256("[]"), runtime: [], schemaVersion: 1,
  standaloneCss: { path: "dist/stylex.css", bytes: Buffer.byteLength(standaloneSource), sha256: sha256(standaloneSource) }, standaloneSerializer,
  stylesheets: [{ path: "src/foundation.css", bytes: Buffer.byteLength(foundationSource), sha256: sha256(foundationSource) }] });

let compiled: Promise<string> | null = null;
async function nativeChecks(program: string): Promise<number> {
  const node = Bun.which("node");
  assert.ok(node !== null, "Native producer tests require genuine Node 24 on PATH");
  compiled ??= Bun.build({ entrypoints: [`${import.meta.dir}/next-dev-producer.ts`], packages: "external", target: "node",
    format: "esm", splitting: false, minify: false, env: "disable", sourcemap: "none" }).then(async (result) => {
    assert.equal(result.success, true);
    assert.equal(result.logs.length, 0);
    assert.equal(result.outputs.length, 1);
    const code = await result.outputs[0]!.text();
    assert.ok(Buffer.byteLength(code) <= 512 * 1024);
    return code;
  });
  // These are constructed captured snapshots, not a packed Next compilation.
  // The exact shipped producer/materializer executes in genuine Node with its
  // real pinned native resolver. No browser, source loader or CSS load is faked.
  const code = `${await compiled}
import nativeAssert from 'node:assert/strict';
import { createHash as nativeHash } from 'node:crypto';
await (async () => {
const digest = value => nativeHash('sha256').update(value).digest('hex');
const freezeInput = value => {
 if (value !== null && typeof value === 'object') {
  for (const item of Object.values(value)) freezeInput(item);
  Object.freeze(value);
 }
 return value;
};
const consumers = [{ source:'app/client.tsx',target:'client' },{ source:'app/page.tsx',target:'server' },{ source:'app/unvisited/page.tsx',target:'edge-server' }];
const makeSnapshot = index => {
 const revision = digest('snapshot-'+index);
 const source = '@layer base { body { margin: 0; } }';
 return freezeInput({ css:'@layer base, components; @layer components.example-ui.legacy, components.hraness-stylex.priority1;\\n@import "../node_modules/@example/ui/src/foundation.css";\\n/* '+revision+' */\\n@layer components.hraness-stylex.priority1 { .x-'+index+' { margin-left: '+index+'.125px; } }',
  cssEntry:'/captured/app/stylex-dev.css',directories:[],files:[],foundations:['../node_modules/@example/ui/src/foundation.css'],
  includedRevisions:[revision],manifests:[${JSON.stringify(manifest)}],packageInputs:[],replacedRuleKeys:[],revision,rootDirectory:'/captured',
  rules:[['x-'+index,{ltr:'.x-'+index+'{margin-left:'+index+'.125px}'},1000]],
  sources:consumers.map(({ source:logicalPath }) => ({code:'export const captured = '+index+';',logicalPath,map:{version:3,sources:[logicalPath],names:[],mappings:''},sourceSha256:digest(logicalPath+index)})),
  stylesheets:[{path:'node_modules/@example/ui/src/foundation.css',source,sha256:digest(source)}] });
};
const emitted = (producer,handle) => producer.compilation(handle).assets.map(({path,css}) => ({path,css}));
let checks = 0;
const check = fn => { fn(); checks++; };
${program}
process.stdout.write(JSON.stringify({node:process.versions.node,checks})+'\\n');
})();
`;
  const child = spawnSync(node, ["--input-type=module", "--eval", code], { cwd: import.meta.dir, encoding: "utf8",
    timeout: 5_000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" });
  assert.equal(child.error, undefined, "Native producer child failed or exceeded its bounds");
  assert.equal(child.signal, null, "Native producer child was signalled");
  assert.equal(child.status, 0, `Native producer child failed: ${child.stderr.slice(0, 4096)}`);
  assert.equal(child.stderr, "", "Native producer child emitted unexpected diagnostics");
  assert.throws(() => process.kill(child.pid, 0), (error: unknown) => typeof error === "object" && error !== null
    && "code" in error && error.code === "ESRCH", "Native producer child survived terminal collection");
  const result: unknown = JSON.parse(child.stdout);
  assert.ok(typeof result === "object" && result !== null);
  assert.deepEqual(Object.keys(result), ["node", "checks"]);
  assert.ok("node" in result && typeof result.node === "string" && /^24\./u.test(result.node));
  assert.ok("checks" in result && Number.isSafeInteger(result.checks) && typeof result.checks === "number" && result.checks > 0);
  return result.checks;
}

test("private native producer rejects Bun before materialization or session creation", () => {
  expect(() => createNextDevNativeProducer({ consumers: [{ source: "app/page.tsx", target: "server" }] })).toThrow("genuine Node 24");
});

test("native producer binds real immutable assets and finite descriptors before publishing only exact emission", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
const first = makeSnapshot(1);
const attempt = producer.prepare(first);
check(() => nativeAssert.equal(producer.prepare(first),attempt));
check(() => nativeAssert.throws(() => producer.prepare(makeSnapshot(2)),/in flight/));
check(() => nativeAssert.throws(() => producer.published(first),/no exact published/));
const handle = await attempt;
check(() => nativeAssert.equal(producer.inspect().published,0));
const compilation = producer.compilation(handle);
check(() => nativeAssert.equal(compilation.assets.length,1));
const asset = compilation.assets[0];
check(() => nativeAssert.equal(digest(asset.css),asset.sha256));
check(() => nativeAssert.ok(asset.css.includes('1.125px') && !asset.css.includes('@import')));
const descriptor = producer.descriptor(handle,'app/page.tsx','server');
check(() => nativeAssert.equal(descriptor.stylesheetSha256,asset.sha256));
check(() => nativeAssert.equal(descriptor.href,'/_next/'+asset.path));
check(() => nativeAssert.match(descriptor.session,/^[a-f0-9]{32}$/));
check(() => nativeAssert.throws(() => producer.complete(handle,true),/complete captured asset census/));
producer.complete(handle,true,emitted(producer,handle));
check(() => nativeAssert.equal(producer.published(first),handle));
check(() => nativeAssert.equal(producer.inspect().published,1));
check(() => nativeAssert.equal(producer.inspect().active,false));
check(() => nativeAssert.equal(Object.isFrozen(compilation.catalogue.snapshots[0]),true));
const cached = await producer.prepare(first);
check(() => nativeAssert.equal(cached,handle));
producer.complete(cached,false);
check(() => nativeAssert.equal(producer.published(first),handle));
`)).toBe(17);
});

test("failed emission is absent from later catalogues and exact assets survive recovery", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
const first = makeSnapshot(1), second = makeSnapshot(2), third = makeSnapshot(3);
const a = await producer.prepare(first);
producer.complete(a,true,emitted(producer,a));
const firstAsset = producer.compilation(a).assets[0];
const b = await producer.prepare(second);
check(() => nativeAssert.throws(() => producer.prepare(third),/uncompleted client candidate/));
const bad = emitted(producer,b).map((asset,index) => index === 0 ? {...asset,css:asset.css+'changed'} : asset);
check(() => nativeAssert.throws(() => producer.complete(b,true,bad),/complete captured asset census/));
check(() => nativeAssert.equal(producer.inspect().published,1));
producer.complete(b,false);
check(() => nativeAssert.throws(() => producer.compilation(b),/unknown or failed/));
check(() => nativeAssert.throws(() => producer.published(second),/no exact published/));
const c = await producer.prepare(third);
const output = producer.compilation(c);
check(() => nativeAssert.deepEqual(output.catalogue.snapshots.map(({sequence}) => sequence),[1,4,5]));
check(() => nativeAssert.deepEqual(output.assets.find(({sha256}) => sha256 === firstAsset.sha256),firstAsset));
producer.complete(c,true,emitted(producer,c));
check(() => nativeAssert.equal(producer.inspect().published,2));
check(() => nativeAssert.equal(producer.inspect().residentAssets,3));
`)).toBe(9);
});

test("foreign handles, wrong source targets, uncaptured sources and altered identities fail closed", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
const first = makeSnapshot(1);
const a = await producer.prepare(first);
check(() => nativeAssert.throws(() => producer.compilation({}),/unknown or failed/));
check(() => nativeAssert.throws(() => producer.descriptor(a,'app/page.tsx','edge-server'),/registered source and target/));
check(() => nativeAssert.throws(() => producer.descriptor(a,'app/unknown.tsx','client'),/registered source and target/));
const foreign = createNextDevNativeProducer({consumers});
check(() => nativeAssert.throws(() => foreign.compilation(a),/unknown or failed/));
producer.complete(a,true,emitted(producer,a));
const changed = freezeInput({...first,sources:first.sources.map((source,index) => index === 0 ? {...source,code:'different'} : source)});
check(() => nativeAssert.throws(() => producer.published(changed),/no exact published/));
for (const altered of [
 {...first,cssEntry:'/captured/other/stylex-dev.css'},
 {...first,packageInputs:[{logicalPath:'node_modules/@example/ui/dist/other.js',role:'runtime',sha256:digest('other')}]},
 {...first,rules:[['x-altered',{ltr:'.x-altered{color:red}'},1000]]},
]) check(() => nativeAssert.throws(() => producer.published(freezeInput(altered)),/no exact published/));
const absent = freezeInput({...makeSnapshot(2),sources:[]});
await nativeAssert.rejects(producer.prepare(absent),/absent from the captured/); checks++;
const external = freezeInput({...makeSnapshot(2),css:'@import "https://example.com/foreign.css";'});
await nativeAssert.rejects(producer.prepare(external),/ordinary relative captured paths/); checks++;
const valid = await producer.prepare(makeSnapshot(2));
check(() => nativeAssert.equal(producer.compilation(valid).catalogue.currentSequence,3));
const duplicate = [...emitted(producer,valid),emitted(producer,valid)[0]];
check(() => nativeAssert.throws(() => producer.complete(valid,true,duplicate),/complete captured asset census/));
producer.complete(valid,false);
`)).toBe(12);
});

test("source reversion advances captured sequence without duplicating identical immutable CSS assets", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
const first = makeSnapshot(1), second = makeSnapshot(2);
const a = await producer.prepare(first); producer.complete(a,true,emitted(producer,a));
const b = await producer.prepare(second); producer.complete(b,true,emitted(producer,b));
const again = await producer.prepare(first);
check(() => nativeAssert.notEqual(again,a));
check(() => nativeAssert.deepEqual(producer.compilation(again).catalogue.snapshots.map(({sequence}) => sequence),[1,2,3,4,5]));
check(() => nativeAssert.equal(producer.compilation(again).assets.length,4));
check(() => nativeAssert.equal(producer.descriptor(again,'app/page.tsx','server').revision,first.revision));
producer.complete(again,true,emitted(producer,again));
check(() => nativeAssert.equal(producer.published(first),again));
check(() => nativeAssert.equal(producer.inspect().published,3));
check(() => nativeAssert.equal(producer.inspect().residentAssets,4));
`)).toBe(7);
});

test("native producer retains the finite complete history and fails closed at its session bound", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
for (let index=1; index<=16; index++) {
 const handle = await producer.prepare(makeSnapshot(index));
 producer.complete(handle,true,emitted(producer,handle));
}
check(() => nativeAssert.equal(producer.inspect().published,16));
check(() => nativeAssert.equal(producer.inspect().capturedSnapshots,31));
check(() => nativeAssert.equal(producer.inspect().residentAssets,31));
await nativeAssert.rejects(producer.prepare(makeSnapshot(17)),/snapshot limit requires restart/); checks++;
check(() => nativeAssert.equal(producer.inspect().active,false));
check(() => nativeAssert.equal(producer.inspect().materializing,false));
const latest = producer.published(makeSnapshot(16));
check(() => nativeAssert.equal(producer.compilation(latest).catalogue.snapshots.length,31));
check(() => nativeAssert.equal(producer.compilation(latest).assets.length,31));
`)).toBe(8);
});

test("two edit/prune cycles emit a genuine retained-history union before the selected pruned asset", async () => {
  expect(await nativeChecks(`
const producer = createNextDevNativeProducer({consumers});
for (const index of [1,2,3]) {
 const handle = await producer.prepare(makeSnapshot(index));
 producer.complete(handle,true,emitted(producer,handle));
}
const handle = producer.published(makeSnapshot(3));
const {assets,catalogue} = producer.compilation(handle);
const union = catalogue.snapshots.find(({includedRevisions}) => includedRevisions.length === 3);
check(() => nativeAssert.ok(union));
check(() => nativeAssert.deepEqual(union.includedRevisions,[1,2,3].map(index=>makeSnapshot(index).revision).sort()));
check(() => nativeAssert.ok(union.sequence < catalogue.currentSequence));
const unionCss = assets.find(({sha256}) => sha256 === union.stylesheetSha256).css;
for (const value of ['1.125px','2.125px','3.125px']) check(() => nativeAssert.ok(unionCss.includes(value)));
const selected = catalogue.snapshots.at(-1);
check(() => nativeAssert.deepEqual(selected.includedRevisions,[makeSnapshot(3).revision]));
const currentCss = assets.find(({sha256}) => sha256 === selected.stylesheetSha256).css;
check(() => nativeAssert.ok(!currentCss.includes('1.125px') && !currentCss.includes('2.125px')));
check(() => nativeAssert.equal(producer.descriptor(handle,'app/page.tsx','server').sequence,selected.sequence));
`)).toBe(9);
});
