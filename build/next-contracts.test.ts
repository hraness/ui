import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { describe, test } from "bun:test";

import {
  compilerSha256,
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import {
  STYLEX_NEXT_ADAPTER_VERSION,
  STYLEX_NEXT_AUXILIARY_TRACE_CREATOR,
  STYLEX_NEXT_PROXY_RENAME_CREATOR,
  STYLEX_NEXT_GRAPH_SCHEMA_VERSION,
  STYLEX_NEXT_MODULE_SCHEMA_VERSION,
  STYLEX_NEXT_REQUIRED_VERSION,
  STYLEX_NEXT_SSG_INITIAL_SOURCE,
  STYLEX_NEXT_SSG_INPUTS,
  STYLEX_NEXT_TARGETS,
  STYLEX_NEXT_FRAMEWORK_INPUTS,
  STYLEX_NEXT_EMPTY_ENTRY_INPUTS,
  STYLEX_NEXT_EMPTY_ENTRY_LOADER,
  compareStylexNextStrings,
  defineStylexNextGraphMap,
  graphIdForStylexNextTarget,
  resolveStylexNextTarget,
  stylexNextDeliveryCssOwnerNames,
  validateStylexNextGraphReceipt,
  validateStylexNextModuleReceipt,
  validateStylexNextFrameworkPayload,
  stylexNextFrameworkRole,
  normalizeStylexNextManifestPagePath,
  validateStylexNextEmptyEntryPayload,
  validateStylexNextPostprocessingReceipt,
  validateStylexNextAuxiliaryTraceAsset,
  validateStylexNextAuxiliaryTraceSnapshot,
} from "./next-contracts.js";
import { STYLEX_NEXT_BUILTIN_GLOBAL_ERROR_ENTRY } from "./next-profile.js";

const emptyRules = [] as const;
const emptyEntryGraph = {
  chunkIds: [167, 428, 698, 819, 851, 896, 988],
  dependencies: [{ cssFiles: [], files: ["static/app.js"], id: 441 }, { cssFiles: [], files: ["static/app.js"], id: 794 }, { cssFiles: [], files: ["static/app.js"], id: 358 }],
  entryModuleId: 4441,
  entrypoints: ["empty"],
  loader: STYLEX_NEXT_EMPTY_ENTRY_LOADER,
  loaderOptions: "server=false",
  originalSource: { bytes: 0, sha256: sha256("") },
} as const;
const emptyEntryCode = "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[167,428,698,819,851,896,988],{4441:()=>{}},_=>{_.O(0,[441,794,358],()=>_(_.s=4441)),_N_E=_.O()}]);";
const independentEmptyEntryGraph = { ...emptyEntryGraph, dependencies: [] } as const;
const independentEmptyEntryCode = emptyEntryCode.replace("[441,794,358]", "[]");

function moduleReceipt(path = "src/fixture.tsx") {
  const source = "export const fixture = true;\n";
  const output = "export const fixture = true;";
  const map = '{"mappings":"AAAA","names":[],"sources":["src/fixture.tsx"],"version":3}';
  return {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
    attemptId: "fixture",
    compilerSha256,
    graphId: "client",
    input: { bytes: Buffer.byteLength(source), path, sha256: sha256(source) },
    kind: "hraness-stylex-next-module",
    mode: "discovery",
    output: { bytes: Buffer.byteLength(output), sha256: sha256(output) },
    rules: emptyRules,
    rulesSha256: stylexRulesSha256(emptyRules),
    schemaVersion: STYLEX_NEXT_MODULE_SCHEMA_VERSION,
    sourceMap: {
      inputSha256: null,
      logicalSourceFileName: path,
      output: { bytes: Buffer.byteLength(map), sha256: sha256(map) },
      sources: ["authored/z.tsx", "authored/a.tsx"],
    },
    target: "client",
  } as const;
}

describe("Next adapter contracts", () => {
  test("derives only physical App Router root-layout and global-error CSS owners", () => {
    assert.deepEqual(stylexNextDeliveryCssOwnerNames([
      "main",
      "main-app",
      "app/_global-error/page",
      "app/_not-found/page",
      "app/layout",
      "app/page",
      "app/nested/layout",
      "app/nested/page",
      "app/global-error",
      "next/dist/client/components/builtin/app-error",
    ]), ["app/global-error", "app/layout"]);
    assert.deepEqual(stylexNextDeliveryCssOwnerNames([
      "main-app",
      "app/(marketing)/layout",
      "app/(marketing)/page",
      "app/[lang]/layout",
      "app/[lang]/page",
    ]), ["app/(marketing)/layout", "app/[lang]/layout"]);
    assert.deepEqual(stylexNextDeliveryCssOwnerNames([
      "main-app", "app/layout", "app/page", "app/@modal/layout", "app/@modal/page", "app/(.)modal/layout", "app/(.)modal/page",
    ]), ["app/layout"]);
    for (const entries of [
      ["main-app", "app/page"],
      ["main-app", "pages/index", "app/layout", "app/page"],
      ["main-app", "app/layout", "app/global-not-found", "app/page"],
      ["main-app", "app/layout", "app/global-not-found/page", "app/page"],
      ["main-app", "app/layout", "app/nested/global-error/page", "app/page"],
      ["main-app", "app/@slot/layout", "app/@slot/page"],
      ["main-app", "app/(.)modal/layout", "app/(.)modal/page"],
      ["main-app", "app/(one)/layout", "app/(two)/page"],
    ]) assert.throws(() => stylexNextDeliveryCssOwnerNames(entries));
  });

  test("admits only the exact built-in global-error as a non-owner without changing physical owners", () => {
    const builtin = STYLEX_NEXT_BUILTIN_GLOBAL_ERROR_ENTRY;
    const base = ["main-app", "app/_global-error/page", "app/layout", "app/page"];
    assert.deepEqual(stylexNextDeliveryCssOwnerNames([...base, builtin]), ["app/layout"]);
    assert.deepEqual(stylexNextDeliveryCssOwnerNames([...base, builtin, "app/global-error"]), ["app/global-error", "app/layout"]);
    for (const name of [
      `app/${builtin}`, `node_modules/${builtin}`, `${builtin}/page`, `${builtin}/layout`,
      `other/${builtin}`, builtin.replace("/builtin/", "/custom/"), builtin.replace("next/", "Next/"),
      builtin.replace("/components/", "/components/../components/"), `./${builtin}`, `/${builtin}`,
      builtin.replaceAll("/", "\\"), "app/nested/global-error", "app/nested/global-error/page",
    ]) assert.throws(() => stylexNextDeliveryCssOwnerNames([...base, name]), `Unexpected global-error identity: ${name}`);
    assert.throws(() => stylexNextDeliveryCssOwnerNames([...base, builtin, builtin]), /unique/u);
  });

  test("derives BUILD_ID and SSG output artifacts from the declared UTF-8 values", () => {
    const artifact = (path: string, source: string) => ({ bytes: Buffer.byteLength(source, "utf8"), path, sha256: sha256(source) });
    const creators = STYLEX_NEXT_SSG_INPUTS.map(([path, hash]) => ({ bytes: 1, path: `node_modules/next/${path}`, sha256: hash }));
    const outputPath = "static/build/_ssgManifest.js";
    const emptySource = "self.__SSG_MANIFEST=new Set([]);self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()";
    const proof = {
      buildId: "build", creators,
      initial: {
        input: creators.find(({ path }) => path === `node_modules/next/${STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"][0]}`)!,
        output: artifact(outputPath, STYLEX_NEXT_SSG_INITIAL_SOURCE), role: "ssg-manifest",
      },
      inputs: [artifact("BUILD_ID", "build"), artifact("prerender-manifest.json", "{}"), artifact("routes-manifest.json", "{}")],
      locales: null, output: artifact(outputPath, emptySource),
      package: artifact("node_modules/next/package.json", "{}"), routes: [] as readonly string[],
    };
    const receipt = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "fixture", compilerSha256,
      auxiliaryTraceSnapshots: [],
      graphs: STYLEX_NEXT_TARGETS.map((target) => ({ graphId: target, receiptSha256: sha256(target), target })),
      kind: "hraness-stylex-next-postprocessing", mode: "discovery", nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: ".next", planSha256: sha256("plan"), schemaVersion: 1, ssg: [proof],
    };
    assert.deepEqual(validateStylexNextPostprocessingReceipt(receipt), receipt);

    // Rebinding both asset paths must not hide a stale BUILD_ID input artifact.
    const renamedPath = "static/other/_ssgManifest.js";
    const renamed = {
      ...proof, buildId: "other",
      initial: { ...proof.initial, output: { ...proof.initial.output, path: renamedPath } },
      output: { ...proof.output, path: renamedPath },
    };
    assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [renamed] }), /BUILD_ID artifact/u);
    for (const changed of [
      { ...proof.inputs[0]!, bytes: 4 },
      { ...proof.inputs[0]!, sha256: sha256("other") },
      artifact("BUILD_ID", "build\n"),
    ]) {
      assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [{ ...proof, inputs: [changed, ...proof.inputs.slice(1)] }] }), /BUILD_ID artifact/u);
    }
    const coherentRename = { ...renamed, inputs: [artifact("BUILD_ID", "other"), ...proof.inputs.slice(1)] };
    assert.deepEqual(validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [coherentRename] }).ssg, [coherentRename]);

    // The expected bytes are independently written, not derived by the validator.
    const routes = ["/a", "/é", "/😀"];
    const source = 'self.__SSG_MANIFEST=new Set(["\\u002Fa","\\u002Fé","\\u002F😀"]);self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()';
    const withRoutes = { ...proof, output: artifact(outputPath, source), routes };
    assert.ok(withRoutes.output.bytes > source.length, "Unicode must exercise UTF-8 byte length");
    assert.deepEqual(validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [withRoutes] }).ssg, [withRoutes]);
    for (const changed of [
      { ...proof, routes },
      { ...withRoutes, routes: [] },
      { ...withRoutes, routes: ["/b", "/é", "/😀"] },
      { ...withRoutes, output: { ...withRoutes.output, bytes: source.length } },
      { ...withRoutes, output: { ...withRoutes.output, sha256: sha256(source.replace("002Fa", "002Fb")) } },
      { ...withRoutes, output: artifact(outputPath, `${source}\n`) },
    ]) {
      assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [changed] }), /exact declared route serialization/u);
    }
    const coherentRoutes = { ...withRoutes, routes: ["/b", "/é", "/😀"], output: artifact(outputPath, source.replace("002Fa", "002Fb")) };
    assert.deepEqual(validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [coherentRoutes] }).ssg, [coherentRoutes]);
    for (const routes of [["/b", "/a"], ["/a", "/a"], ["relative"], ["/\0bad"]]) {
      assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, ssg: [{ ...proof, routes }] }));
    }
  });

  test("uses canonical code-unit ordering for mixed-case build IDs, paths and package names", () => {
    const paths = [
      "static/chunks/client.js", "static/media/fixture.woff2",
      "static/ZXEfbqoku3Jea6WTn_4bj/_buildManifest.js",
      "static/ZXEfbqoku3Jea6WTn_4bj/_ssgManifest.js",
      "app/_not-found/page", "app/Z/page", "app/a/page", "app/A/page",
      "@scope/with-dash", "@scope/with.dot", "@scope/with_underscore",
    ];
    const expected = [...paths].sort();
    assert.notDeepEqual([...paths].sort((a, b) => a.localeCompare(b, "en")), expected);
    for (let offset = 0; offset < paths.length; offset++) {
      const permutation = [...paths.slice(offset), ...paths.slice(0, offset)];
      assert.deepEqual(permutation.sort(compareStylexNextStrings), expected);
    }
    assert.equal(compareStylexNextStrings("same", "same"), 0);
    for (const a of paths) for (const b of paths) {
      assert.equal(Math.sign(compareStylexNextStrings(a, b)), a === b ? 0 : a < b ? -1 : 1);
    }
  });

  test("normalizes RSC manifest paths exactly like pinned Next, including index and intercepted routes", () => {
    const pinned = createRequire(import.meta.url)("next/dist/shared/lib/page-path/normalize-page-path.js") as { normalizePagePath(page: string): string };
    const pages = ["/", "/page", "/(..)item", "/index", "/index/page", "/index/docs/page", "/index/[slug]/page", "/index/prefix[slug]/page", "/index/[...all]/page", "/index/[[...all]]/page", "/index/(.)item/page", "/index/(.)[slug]/page", "/index/(group)/@slot/(..)item/page", "/index/deep/(..)(..)[slug]/page", "/index/(...)[slug]/page"];
    for (const page of pages) {
      const expected = pinned.normalizePagePath(page);
      assert.equal(normalizeStylexNextManifestPagePath(page), expected, page);
      if (!page.endsWith("/page") || expected !== page) continue;
      const source = `globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{};globalThis.__RSC_MANIFEST[${JSON.stringify(page)}]={};`;
      assert.doesNotThrow(() => validateStylexNextFrameworkPayload("client-reference-manifest", `server/app${expected}_client-reference-manifest.js`, source));
      assert.throws(() => validateStylexNextFrameworkPayload("client-reference-manifest", "server/app/incorrect_client-reference-manifest.js", source), /route differs from output path/u);
    }
    assert.equal(normalizeStylexNextManifestPagePath("/index/page"), "/index/index/page");
    assert.equal(normalizeStylexNextManifestPagePath("/index/[slug]/page"), "/index/[slug]/page");
    for (const page of ["/../page", "/index/../page", "/index//page", "/index/(..)(..)item", "/index/(.)"]) {
      assert.throws(() => pinned.normalizePagePath(page), page);
      assert.throws(() => normalizeStylexNextManifestPagePath(page), page);
    }
    for (const page of ["relative", "/index\\page", "/index\0page"]) assert.throws(() => normalizeStylexNextManifestPagePath(page));
  });

  test("rejects the pinned static leading index mismatch but admits its working dynamic descendant", () => {
    const staticRoute = "/index/manifest-proof/page";
    const staticSource = `globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{};globalThis.__RSC_MANIFEST[${JSON.stringify(staticRoute)}]={};`;
    assert.equal(normalizeStylexNextManifestPagePath(staticRoute), "/index/index/manifest-proof/page");
    assert.throws(
      () => validateStylexNextFrameworkPayload(
        "client-reference-manifest",
        "server/app/index/index/manifest-proof/page_client-reference-manifest.js",
        staticSource,
      ),
      /unsupported static leading \/index route because its client-reference manifest writer and reader disagree/u,
    );

    const dynamicRoute = "/index/[manifestProof]/page";
    const dynamicSource = `globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{};globalThis.__RSC_MANIFEST[${JSON.stringify(dynamicRoute)}]={};`;
    assert.equal(normalizeStylexNextManifestPagePath(dynamicRoute), dynamicRoute);
    assert.doesNotThrow(() => validateStylexNextFrameworkPayload(
      "client-reference-manifest",
      "server/app/index/[manifestProof]/page_client-reference-manifest.js",
      dynamicSource,
    ));
    assert.throws(() => validateStylexNextFrameworkPayload(
      "client-reference-manifest",
      "server/app/index/index/[manifestProof]/page_client-reference-manifest.js",
      dynamicSource,
    ), /route differs from output path/u);
  });

  test("accepts only the exact graph-bound empty client bootstrap grammar", () => {
    assert.doesNotThrow(() => validateStylexNextEmptyEntryPayload(emptyEntryGraph, emptyEntryCode));
    assert.doesNotThrow(() => validateStylexNextEmptyEntryPayload(independentEmptyEntryGraph, independentEmptyEntryCode));
    assert.throws(() => validateStylexNextEmptyEntryPayload(independentEmptyEntryGraph, emptyEntryCode), /exact proven empty bootstrap/u);
    assert.throws(
      () => validateStylexNextEmptyEntryPayload({ ...emptyEntryGraph, dependencies: "not-an-array" }, emptyEntryCode),
      /dependencies must be an array bounded to 4096 startup chunks/u,
    );
    assert.throws(
      () => validateStylexNextEmptyEntryPayload({ ...emptyEntryGraph, dependencies: Array.from({ length: 4097 }, (_, id) => ({ cssFiles: [], files: ["static/app.js"], id })) }, emptyEntryCode),
      /dependencies must be an array bounded to 4096 startup chunks/u,
    );
    assert.doesNotThrow(() => validateStylexNextEmptyEntryPayload(emptyEntryGraph, emptyEntryCode.replaceAll("_=>", "r=>").replaceAll("_.", "r.").replaceAll("()=>_(", "()=>r(")));
    for (const changed of [
      emptyEntryCode.replace("4441:()=>{}", "4441:()=>{fetch('/')}"),
      emptyEntryCode.replace("4441:()=>{}", "4441:()=>globalThis"),
      emptyEntryCode.replace("4441:()=>{}", "4441:async()=>{}"),
      emptyEntryCode.replace("4441:()=>{}", "get 4441(){return ()=>{}}"),
      emptyEntryCode.replace("[441,794,358]", "[441,794,359]"),
      emptyEntryCode.replace("[167,428,698,819,851,896,988]", "[167]"),
      emptyEntryCode.replace("_.s=4441", "_.s=4442"),
      emptyEntryCode.replace("_N_E=_.O()", "globalThis.changed=_.O()"),
      emptyEntryCode.replace("webpackChunk_N_E", "otherGlobal"),
      `${emptyEntryCode}fetch('/');`, `${emptyEntryCode}\n//# sourceMappingURL=fake.map`,
      emptyEntryCode.replace("4441:()=>{}", "4441:(unexpected)=>{}"),
    ]) assert.throws(() => validateStylexNextEmptyEntryPayload(emptyEntryGraph, changed));
    for (const graph of [
      { ...emptyEntryGraph, loaderOptions: "modules=app.tsx&server=false" },
      { ...emptyEntryGraph, originalSource: { bytes: 1, sha256: sha256("x") } },
      { ...emptyEntryGraph, chunkIds: [1, 1] }, { ...emptyEntryGraph, chunkIds: [-1] },
      { ...emptyEntryGraph, entrypoints: [] },
    ]) assert.throws(() => validateStylexNextEmptyEntryPayload(graph, emptyEntryCode));
  });
  test("retains native CSS-only startup IDs and rejects dropped or reordered dependencies", () => {
    const cssDependency = { cssFiles: ["static/recipes.css"], files: [], id: 625 };
    const graph = { ...emptyEntryGraph, dependencies: [cssDependency, ...emptyEntryGraph.dependencies] };
    const source = emptyEntryCode.replace("[441,794,358]", "[625,441,794,358]");
    assert.doesNotThrow(() => validateStylexNextEmptyEntryPayload(graph, source));
    for (const changed of [
      emptyEntryCode,
      source.replace("[625,441,794,358]", "[441,625,794,358]"),
      source.replace("[625,441,794,358]", "[625,441,794,358,625]"),
      source.replace("[625,441,794,358]", "[626,441,794,358]"),
    ]) assert.throws(() => validateStylexNextEmptyEntryPayload(graph, changed), /exact proven empty bootstrap/u);
    for (const dependency of [
      { files: [], id: 625 },
      { ...cssDependency, cssFiles: [] },
      { ...cssDependency, cssFiles: ["static/recipes.js"] },
      { ...cssDependency, files: ["static/recipes.css"] },
      { ...cssDependency, cssFiles: ["../outside.css"] },
      { ...cssDependency, cssFiles: ["static/z.css", "static/a.css"] },
      { ...cssDependency, cssFiles: ["static/recipes.css", "static/recipes.css"] },
      { ...cssDependency, cssFiles: ["static/recipes.css.map"] },
      { ...cssDependency, cssFiles: Array.from({ length: 4097 }, (_, index) => `static/${String(index).padStart(4, "0")}.css`) },
    ]) assert.throws(() => validateStylexNextEmptyEntryPayload({ ...graph, dependencies: [dependency, ...emptyEntryGraph.dependencies] }, source));
  });
  test("accepts only audited framework initialization payloads, including minified sequences and devalue data", () => {
    const fixtures = [
      ["build-manifest", "static/build/_buildManifest.js", 'self.__BUILD_MANIFEST=(function(a,b){return {__rewrites:{afterFiles:[],beforeFiles:[],fallback:[]},sortedPages:["/"],missing:a,count:b}}(void 0,1));self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()'],
      ["build-manifest", "static/build/_buildManifest.js", 'self.__BUILD_MANIFEST=(function(a){a[0]="/";return {sortedPages:a}}(Array(1))),self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB();'],
      ["ssg-manifest", "static/build/_ssgManifest.js", "self.__SSG_MANIFEST=new Set,self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB();"],
      ["middleware-build-manifest", "server/middleware-build-manifest.js", "globalThis.__BUILD_MANIFEST={pages:{},polyfillFiles:[]};"],
      ["client-reference-manifest", "server/app/page_client-reference-manifest.js", 'globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{},globalThis.__RSC_MANIFEST["/page"]={clientModules:{}};'],
      ["build-manifest", "static/build/_buildManifest.js", 'self.__BUILD_MANIFEST=(function(a,b){return {__rewrites:{afterFiles:[],beforeFiles:[],fallback:[]},__routerFilterStatic:{numItems:b,errorRate:.0001,numBits:20,numHashes:14,bitArray:[b,a]},__routerFilterDynamic:{numItems:a,errorRate:.0001,numBits:a,numHashes:NaN,bitArray:[]},sortedPages:["/"]}}(0,1));self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()'],
      ["server-reference-manifest", "server/server-reference-manifest.js", `self.__RSC_SERVER_MANIFEST=${JSON.stringify(JSON.stringify({ node: {}, edge: {}, encryptionKey: "fixture" }))}`],
      ["react-loadable-manifest", "server/middleware-react-loadable-manifest.js", 'self.__REACT_LOADABLE_MANIFEST="{}"'],
      ["next-font-manifest", "server/next-font-manifest.js", 'self.__NEXT_FONT_MANIFEST="{}"'],
      ["dynamic-css-manifest", "server/dynamic-css-manifest.js", 'self.__DYNAMIC_CSS_MANIFEST="[]"'],
      ["interception-rewrite-manifest", "server/interception-route-rewrite-manifest.js", 'self.__INTERCEPTION_ROUTE_REWRITE_MANIFEST="[]"'],
    ] as const;
    for (const [role, path, source] of fixtures) assert.doesNotThrow(() => validateStylexNextFrameworkPayload(role, path, source));
    const attackExpressions = [
      "fetch('/exfiltrate')", "globalThis.secret", "(()=>{throw Error('ran')})()",
      "{get value(){return fetch('/')}}", "{...globalThis}", "{['__proto__']:{}}",
      "(function(a){a.__proto__={};return a}({}))", "(function(a){a[0]=a;return a}(Array(1)))",
      "(function(a){globalThis.changed=true;return a}({}))", "new Date()", "eval('{}')",
      "(function(Array){return Array(1)}(1))", "(function(a){a[1000000000]=1;return a}(Array(1)))",
      "(function(a,b){return {a,b}}(Array(100001),Array(100001)))",
    ];
    for (const expression of attackExpressions) assert.throws(() => validateStylexNextFrameworkPayload(
      "build-manifest", "static/build/_buildManifest.js",
      `self.__BUILD_MANIFEST=${expression};self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()`,
    ));
    for (const expression of [
      "{__routerFilterDynamic:{numItems:1,errorRate:.0001,numBits:1,numHashes:NaN,bitArray:[0]}}",
      "{unexpected:{numHashes:NaN}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:.0001,numBits:0,numHashes:Infinity,bitArray:[]}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:.0001,numBits:0,numHashes:undefined,bitArray:[]}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:null,numBits:0,numHashes:NaN,bitArray:[]}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:0,numBits:0,numHashes:NaN,bitArray:[]}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:1,numBits:0,numHashes:NaN,bitArray:[]}}",
      "{__routerFilterDynamic:{numItems:0,errorRate:.0001,numBits:0,numHashes:NaN,bitArray:[],extra:0}}",
    ]) assert.throws(() => validateStylexNextFrameworkPayload(
      "build-manifest", "static/build/_buildManifest.js",
      `self.__BUILD_MANIFEST=${expression};self.__BUILD_MANIFEST_CB&&self.__BUILD_MANIFEST_CB()`,
    ));
    assert.throws(() => validateStylexNextFrameworkPayload(
      "middleware-build-manifest", "server/middleware-build-manifest.js",
      "globalThis.__BUILD_MANIFEST={filter:{numHashes:NaN}};",
    ), /external identifier/u);
    assert.throws(() => validateStylexNextFrameworkPayload("ssg-manifest", "static/build/_ssgManifest.js", "self.__SSG_MANIFEST=new Set;fetch('/');self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB()"));
    assert.throws(() => validateStylexNextFrameworkPayload("ssg-manifest", "static/build/_ssgManifest.js", "self.__SSG_MANIFEST=new Set;self.__SSG_MANIFEST_CB&&self.__SSG_MANIFEST_CB(fetch('/'))"));
    assert.throws(() => validateStylexNextFrameworkPayload("client-reference-manifest", "server/app/wrong_client-reference-manifest.js", fixtures[4][2]), /route differs/u);
    assert.throws(() => validateStylexNextFrameworkPayload("next-font-manifest", "server/next-font-manifest.js", "self.__NEXT_FONT_MANIFEST=fetch('/')"));
    assert.throws(() => validateStylexNextFrameworkPayload("next-font-manifest", "server/next-font-manifest.js", 'self.__NEXT_FONT_MANIFEST="{}";\n//# sourceMappingURL=invented.js.map'), /cannot claim a source map/u);
    assert.throws(() => validateStylexNextFrameworkPayload("polyfill-nomodule", "static/chunks/polyfills-0.js", "export const application = true"), /pinned original bytes/u);
    assert.equal(stylexNextFrameworkRole("server/next-font-manifest.js", "node-rsc"), undefined);
    assert.equal(stylexNextFrameworkRole("static/chunks/application.js", "client"), undefined);
  });
  test("maps the exact Next webpack production target set", () => {
    assert.equal(resolveStylexNextTarget({ dev: false, isServer: false }), "client");
    assert.equal(resolveStylexNextTarget({ dev: false, isServer: true }), "node-rsc");
    assert.equal(resolveStylexNextTarget({ dev: false, isServer: true, nextRuntime: "nodejs" }), "node-rsc");
    assert.equal(resolveStylexNextTarget({ dev: false, isServer: true, nextRuntime: "edge" }), "edge-rsc");
    assert.throws(() => resolveStylexNextTarget({ dev: true, isServer: false }), /reject dev\/HMR/u);
    assert.throws(() => resolveStylexNextTarget({ dev: false, isServer: false, nextRuntime: "edge" }), /must not declare/u);
  });

  test("accepts an explicit graph map and rejects aliases or extra targets", () => {
    const map = defineStylexNextGraphMap({ client: "browser", edgeRsc: "edge", nodeRsc: "server" });
    assert.equal(graphIdForStylexNextTarget("edge-rsc", map), "edge");
    assert.throws(
      () => defineStylexNextGraphMap({ client: "same", edgeRsc: "edge", nodeRsc: "same" }),
      /must be unique/u,
    );
    assert.throws(
      () => defineStylexNextGraphMap({ client: "browser", edgeRsc: "edge", nodeRsc: "server", worker: "extra" }),
      /unknown keys/u,
    );
  });

  test("preserves source-map source order while binding exact module bytes", () => {
    const parsed = validateStylexNextModuleReceipt(moduleReceipt());
    assert.deepEqual(parsed.sourceMap.sources, ["authored/z.tsx", "authored/a.tsx"]);
    assert.throws(
      () => validateStylexNextModuleReceipt({ ...moduleReceipt(), stray: true }),
      /unknown keys/u,
    );
    assert.throws(
      () => validateStylexNextModuleReceipt({
        ...moduleReceipt(),
        sourceMap: { ...moduleReceipt().sourceMap, logicalSourceFileName: "src/other.tsx" },
      }),
      /must equal its input path/u,
    );
  });

  test("rejects private or ambiguous source-map paths in module receipts", () => {
    const receipt = moduleReceipt();
    for (const path of [
      "/Users/example/private/page.tsx", "C:/private/page.tsx", "C:\\private\\page.tsx",
      "C:private/page.tsx", "\\\\server\\share\\page.tsx", "//server/share/page.tsx",
      "file:///private/page.tsx", "https://example.invalid/private/page.tsx", "http://example.invalid/page.tsx",
      "data:text/plain,private", "../page.tsx", "src/../page.tsx", "./src/page.tsx",
      "src//page.tsx", "src/%2e%2e/page.tsx", "%2Fprivate/page.tsx", "src/page.tsx?private",
      "src/page.tsx#private", "src/pa\nge.tsx", " src/page.tsx",
    ]) {
      assert.throws(() => validateStylexNextModuleReceipt({
        ...receipt, sourceMap: { ...receipt.sourceMap, sources: [path] },
      }), `accepted ${JSON.stringify(path)}`);
    }
    const sources = ["authored/nested/z.tsx", "authored/a.tsx", "authored/nested/z.tsx"];
    assert.deepEqual(validateStylexNextModuleReceipt({
      ...receipt, sourceMap: { ...receipt.sourceMap, sources },
    }).sourceMap.sources, sources);
    assert.throws(() => validateStylexNextModuleReceipt({
      ...receipt, sourceMap: { ...receipt.sourceMap, sources: [] },
    }), /nonempty/u);
    assert.throws(() => validateStylexNextModuleReceipt({
      ...receipt,
      input: { ...receipt.input, path: "file:private/fixture.tsx" },
      sourceMap: { ...receipt.sourceMap, logicalSourceFileName: "file:private/fixture.tsx" },
    }), /repository-logical/u);
  });

  test("rejects unlinked maps and incomplete graph outputs", () => {
    const module = moduleReceipt();
    const modules = [{ path: module.input.path, receiptSha256: sha256("module\n") }];
    const base = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
      attemptId: "fixture",
      auxiliaryTraceAssets: [],
      compilerSha256,
      cssInputs: [],
      entrypoints: [{ css: ["static/app.css"], files: ["static/app.css", "static/app.js"], javascript: ["static/app.js"], name: "app", stylexCss: [] }],
      delegatedEntryBootstraps: [], emptyEntryBootstraps: [],
      frameworkAssets: [],
      javascriptChunks: ["static/app.js"],
      graphId: "client",
      kind: "hraness-stylex-next-graph",
      mode: "discovery",
      modules,
      nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: ".next",
      outputs: [
        { bytes: 1, path: "static/app.css", sha256: sha256("a") },
        { bytes: 1, path: "static/app.js", sha256: sha256("b") },
        { bytes: 1, path: "static/app.js.map", sha256: sha256("m") },
      ],
      packages: [],
      rules: emptyRules,
      rulesSha256: stylexRulesSha256(emptyRules),
      schemaVersion: STYLEX_NEXT_GRAPH_SCHEMA_VERSION,
      sourceMaps: [{ bytes: 1, path: "static/app.js.map", sha256: sha256("m") }],
      sourcesSha256: sha256(JSON.stringify(modules)),
      target: "client",
      webpackVersion: "5.99.0",
    } as const;
    const withCanonicalSources = { ...base, sourcesSha256: sha256('[{"path":"src/fixture.tsx","receiptSha256":"' + sha256("module\n") + '"}]') };
    assert.equal(validateStylexNextGraphReceipt(withCanonicalSources).target, "client");
    const deliveryOwner = {
      css: ["static/app.css"],
      files: ["static/app.css", "static/app.js"],
      javascript: ["static/app.js"],
      name: "app/layout",
      stylexCss: ["static/app.css"],
    };
    const deliveryGlobalError = { ...deliveryOwner, name: "app/global-error" };
    const deliveryNonowner = {
      css: [], files: ["static/app.js"], javascript: ["static/app.js"], name: "app/page", stylexCss: [],
    };
    const deliveryRuntime = {
      css: [], files: ["static/app.js"], javascript: ["static/app.js"], name: "main-app", stylexCss: [],
    };
    const delivery = {
      ...withCanonicalSources,
      mode: "delivery",
      entrypoints: [deliveryGlobalError, deliveryOwner, deliveryNonowner, deliveryRuntime],
    };
    assert.equal(validateStylexNextGraphReceipt(delivery).mode, "delivery");
    for (const entrypoints of [
      [{ ...deliveryGlobalError, stylexCss: [] }, deliveryOwner, deliveryNonowner, deliveryRuntime],
      [deliveryGlobalError, { ...deliveryOwner, stylexCss: [] }, deliveryNonowner, deliveryRuntime],
      [deliveryGlobalError, deliveryOwner, { ...deliveryNonowner, css: ["static/app.css"], files: ["static/app.css", "static/app.js"], stylexCss: ["static/app.css"] }, deliveryRuntime],
      [deliveryGlobalError, deliveryOwner, deliveryNonowner, { ...deliveryRuntime, css: ["static/app.css"], files: ["static/app.css", "static/app.js"], stylexCss: ["static/app.css"] }],
    ]) assert.throws(
      () => validateStylexNextGraphReceipt({ ...delivery, entrypoints }),
      /every and only planned physical owner/u,
    );
    const bootstrap = {
      graph: emptyEntryGraph,
      inputs: STYLEX_NEXT_EMPTY_ENTRY_INPUTS.map(([path, hash]) => ({ bytes: 1, path: `node_modules/next/${path}`, sha256: hash })),
      output: { bytes: emptyEntryCode.length, path: "static/empty.js", sha256: sha256(emptyEntryCode) },
    };
    const withEmpty = {
      ...withCanonicalSources,
      emptyEntryBootstraps: [bootstrap],
      entrypoints: [...base.entrypoints, { css: [], files: ["static/app.js", "static/empty.js"], javascript: ["static/app.js", "static/empty.js"], name: "empty", stylexCss: [] }],
      outputs: [...base.outputs, bootstrap.output],
      javascriptChunks: ["static/app.js", "static/empty.js"],
    };
    assert.equal(validateStylexNextGraphReceipt(withEmpty).emptyEntryBootstraps.length, 1);
    for (const value of [
      { ...withEmpty, delegatedEntryBootstraps: [], emptyEntryBootstraps: [] },
      { ...withEmpty, javascriptChunks: ["static/app.js"] },
      { ...withEmpty, target: "node-rsc" },
      { ...withEmpty, emptyEntryBootstraps: [bootstrap, bootstrap] },
      { ...withEmpty, emptyEntryBootstraps: [{ ...bootstrap, output: { ...bootstrap.output, sha256: sha256("changed") } }] },
      { ...withEmpty, emptyEntryBootstraps: [{ ...bootstrap, inputs: [] }] },
      { ...withEmpty, emptyEntryBootstraps: [{ ...bootstrap, graph: { ...emptyEntryGraph, entrypoints: ["wrong"] } }] },
      { ...withEmpty, emptyEntryBootstraps: [{ ...bootstrap, graph: { ...emptyEntryGraph, dependencies: [{ cssFiles: [], files: ["static/empty.js"], id: 441 }] } }] },
    ]) assert.throws(() => validateStylexNextGraphReceipt(value));
    const cssCode = emptyEntryCode.replace("[441,794,358]", "[625,441,794,358]");
    const cssDependency = { cssFiles: ["static/app.css"], files: [], id: 625 };
    const cssBootstrap = {
      ...bootstrap,
      graph: { ...emptyEntryGraph, dependencies: [cssDependency, ...emptyEntryGraph.dependencies] },
      output: { ...bootstrap.output, bytes: Buffer.byteLength(cssCode), sha256: sha256(cssCode) },
    };
    const cssEntry = { ...withEmpty.entrypoints[1]!, css: ["static/app.css"], files: ["static/app.css", "static/app.js", "static/empty.js"] };
    const withCss = {
      ...withEmpty,
      emptyEntryBootstraps: [cssBootstrap],
      entrypoints: [base.entrypoints[0], cssEntry],
      outputs: [...base.outputs, cssBootstrap.output],
    };
    assert.deepEqual(validateStylexNextGraphReceipt(withCss).emptyEntryBootstraps[0]!.graph.dependencies.map(({ id }) => id), [625, 441, 794, 358]);
    const mixedDependency = { ...emptyEntryGraph.dependencies[0], cssFiles: ["static/app.css"] };
    assert.deepEqual(validateStylexNextGraphReceipt({
      ...withCss,
      emptyEntryBootstraps: [{ ...bootstrap, graph: { ...emptyEntryGraph, dependencies: [mixedDependency, ...emptyEntryGraph.dependencies.slice(1)] } }],
      outputs: withEmpty.outputs,
    }).emptyEntryBootstraps[0]!.graph.dependencies[0], mixedDependency);
    for (const value of [
      { ...withCss, entrypoints: withEmpty.entrypoints },
      { ...withCss, entrypoints: [base.entrypoints[0], { ...cssEntry, css: [] }] },
      { ...withCss, outputs: withCss.outputs.filter(({ path }) => path !== "static/app.css") },
      { ...withCss, sourceMaps: [], outputs: withCss.outputs.filter(({ path }) => !path.endsWith(".map")) },
      { ...withCss, javascriptChunks: ["static/app.css", ...withCss.javascriptChunks] },
      { ...withCss, emptyEntryBootstraps: [{ ...cssBootstrap, graph: { ...cssBootstrap.graph, dependencies: [{ ...cssDependency, cssFiles: ["static/other.css"] }, ...emptyEntryGraph.dependencies] } }] },
    ]) assert.throws(() => validateStylexNextGraphReceipt(value));
    const cssMap = { bytes: 1, path: "static/app.css.map", sha256: sha256("c") };
    const withCssMap = {
      ...withCss, outputs: [...withCss.outputs, cssMap].sort((a, b) => compareStylexNextStrings(a.path, b.path)),
      sourceMaps: [cssMap, ...base.sourceMaps],
    };
    assert.equal(validateStylexNextGraphReceipt(withCssMap).sourceMaps.length, 2);
    assert.throws(() => validateStylexNextGraphReceipt({ ...withCssMap, sourceMaps: base.sourceMaps }), /complete exact source-map inventory/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...withCssMap, sourceMaps: [{ ...cssMap, sha256: sha256("forged") }, ...base.sourceMaps] }), /complete exact source-map inventory/u);
    const [inputPath, inputHash] = STYLEX_NEXT_FRAMEWORK_INPUTS["ssg-manifest"];
    const framework = {
      input: { bytes: 1, path: `node_modules/next/${inputPath}`, sha256: inputHash },
      output: { bytes: 1, path: "static/build/_ssgManifest.js", sha256: sha256("s") },
      role: "ssg-manifest",
    } as const;
    const proven = { ...withCanonicalSources, frameworkAssets: [framework], outputs: [...base.outputs, framework.output].sort((a, b) => a.path < b.path ? -1 : 1) };
    assert.equal(validateStylexNextGraphReceipt(proven).outputs.length, 4);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, frameworkAssets: [] }), /proven framework provenance/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, frameworkAssets: [framework, framework] }), /unique and path sorted/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, frameworkAssets: [{ ...framework, input: { ...framework.input, sha256: sha256("changed") } }] }), /input hash/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, javascriptChunks: [...proven.javascriptChunks, framework.output.path].sort() }), /chunk cannot use/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, frameworkAssets: [{ ...framework, output: { ...framework.output, sha256: sha256("changed") } }] }), /output bytes/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, outputs: [...proven.outputs, { bytes: 1, path: "static/unmapped.js", sha256: sha256("bad") }] }), /proven framework provenance/u);
    assert.throws(() => validateStylexNextGraphReceipt({ ...proven, sourceMaps: [{ ...base.sourceMaps[0], sha256: sha256("forged-map") }] }), /complete exact source-map inventory/u);
    assert.throws(
      () => validateStylexNextGraphReceipt({ ...withCanonicalSources, sourceMaps: [] }),
      /must retain emitted source maps/u,
    );
    assert.throws(
      () => validateStylexNextGraphReceipt({
        ...withCanonicalSources,
        sourceMaps: [
          ...withCanonicalSources.sourceMaps,
          { bytes: 1, path: "static/orphan.js.map", sha256: sha256("o") },
        ],
      }),
      /must be present in outputs/u,
    );
    assert.throws(
      () => validateStylexNextGraphReceipt({
        ...withCanonicalSources,
        entrypoints: [{
          ...withCanonicalSources.entrypoints[0],
          files: ["static/app.css", "static/app.js", "static/missing.js"],
          javascript: ["static/app.js", "static/missing.js"],
        }],
      }),
      /entrypoint file must be present/u,
    );
  });

  test("classifies only exact registered Node entry traces as observation-only metadata", () => {
    const artifact = (path: string, source: string) => ({ bytes: Buffer.byteLength(source), path, sha256: sha256(source) });
    const initial = artifact("server/app/page.js.nft.json", '{"version":1,"files":[]}');
    const asset = {
      creator: { bytes: 1, path: `node_modules/next/${STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]}`, sha256: STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[1] },
      entrypoint: "app/page", initial, kind: "next-node-dependency-trace",
    };
    const javascript = artifact("server/app/page.js", "export const page = true;");
    const map = artifact("server/app/page.js.map", "{}");
    const modules = [{ path: "app/page.tsx", receiptSha256: sha256("module") }];
    const entry = { css: [], files: [javascript.path], javascript: [javascript.path], name: "app/page", stylexCss: [] };
    const graph = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "fixture", auxiliaryTraceAssets: [asset], compilerSha256,
      cssInputs: [], delegatedEntryBootstraps: [], emptyEntryBootstraps: [], entrypoints: [entry], frameworkAssets: [], graphId: "node-rsc",
      javascriptChunks: [javascript.path], kind: "hraness-stylex-next-graph", mode: "discovery", modules,
      nextVersion: STYLEX_NEXT_REQUIRED_VERSION, outputDirectory: ".next", outputs: [javascript, map, initial],
      packages: [], rules: emptyRules, rulesSha256: stylexRulesSha256(emptyRules), schemaVersion: 1,
      sourceMaps: [map], sourcesSha256: sha256(JSON.stringify(modules)), target: "node-rsc", webpackVersion: "5.99.0",
    };
    assert.deepEqual(validateStylexNextGraphReceipt(graph).auxiliaryTraceAssets, [asset]);
    for (const change of [
      { auxiliaryTraceAssets: undefined }, { auxiliaryTraceAssets: [] }, { auxiliaryTraceAssets: [asset, asset] },
      { target: "client" }, { target: "edge-rsc" }, { javascriptChunks: [] },
      { outputs: [javascript, map] },
      { outputs: [javascript, map, initial, artifact("server/orphan.js.nft.json", '{"version":1,"files":[]}')] },
      { entrypoints: [{ ...entry, name: "app/other" }] },
      { entrypoints: [{ ...entry, files: [], javascript: [] }] },
      { entrypoints: [{ ...entry, files: [javascript.path, initial.path] }] },
      { auxiliaryTraceAssets: [{ ...asset, initial: { ...initial, sha256: sha256("changed") } }] },
      { auxiliaryTraceAssets: [{ ...asset, initial: javascript }] },
      { auxiliaryTraceAssets: [{ ...asset, initial: map }] },
    ]) assert.throws(() => validateStylexNextGraphReceipt({ ...graph, ...change }));
    const auxiliaryMap = artifact(`${initial.path}.map`, "{}");
    assert.throws(() => validateStylexNextGraphReceipt({ ...graph, outputs: [...graph.outputs, auxiliaryMap], sourceMaps: [map, auxiliaryMap] }), /cannot waive a source map/u);
    for (const entrypoint of ["pages/index", "app/(group)/@slot/[slug]/page"]) {
      assert.equal(validateStylexNextAuxiliaryTraceAsset({ ...asset, entrypoint, initial: { ...initial, path: `server/${entrypoint}.js.nft.json` } }).entrypoint, entrypoint);
    }
    for (const change of [
      { kind: "runtime" }, { safeToPublish: true }, { entrypoint: "../app/page" }, { entrypoint: "runtime/main" },
      { creator: { ...asset.creator, sha256: sha256("other") } },
      { creator: { ...asset.creator, path: "node_modules/next/other.js" } },
      { initial: { ...initial, bytes: 16 * 1024 * 1024 + 1 } },
    ]) assert.throws(() => validateStylexNextAuxiliaryTraceAsset({ ...asset, ...change }));

    const snapshot = { asset, output: artifact(initial.path, '{"version":1,"files":["missing.js","../../../unread"]}'), semantics: "observation-only" };
    assert.deepEqual(validateStylexNextAuxiliaryTraceSnapshot(snapshot), snapshot);
    for (const change of [
      { semantics: "dependency-safe" }, { verifiedClosure: true }, { output: javascript },
      { output: { ...snapshot.output, bytes: 16 * 1024 * 1024 + 1 } },
    ]) assert.throws(() => validateStylexNextAuxiliaryTraceSnapshot({ ...snapshot, ...change }));
    const receipt = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "fixture", auxiliaryTraceSnapshots: [snapshot], compilerSha256,
      graphs: STYLEX_NEXT_TARGETS.map((target) => ({ graphId: target, receiptSha256: sha256(target), target })),
      kind: "hraness-stylex-next-postprocessing", mode: "delivery", nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: ".next", planSha256: sha256("plan"), schemaVersion: 1, ssg: [],
    };
    assert.deepEqual(validateStylexNextPostprocessingReceipt(receipt).auxiliaryTraceSnapshots, [snapshot]);
    assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, auxiliaryTraceSnapshots: undefined }));
    assert.throws(() => validateStylexNextPostprocessingReceipt({ ...receipt, auxiliaryTraceSnapshots: [snapshot, snapshot] }), /unique and path sorted/u);
  });

  test("admits only the literal registered Node proxy trace without exempting its source or map", () => {
    const artifact = (path: string, source: string) => ({ bytes: Buffer.byteLength(source), path, sha256: sha256(source) });
    const initial = artifact("server/proxy.js.nft.json", '{"version":1,"files":[]}');
    const asset = {
      creator: { bytes: 1, path: `node_modules/next/${STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[0]}`, sha256: STYLEX_NEXT_AUXILIARY_TRACE_CREATOR[1] },
      entrypoint: "proxy", initial, kind: "next-node-dependency-trace",
    };
    const javascript = artifact("server/proxy.js", "export const proxy = true;");
    const map = artifact("server/proxy.js.map", "{}");
    const entry = { css: [], files: [javascript.path], javascript: [javascript.path], name: "proxy", stylexCss: [] };
    for (const source of ["proxy.ts", "src/proxy.ts"]) {
      const modules = [{ path: source, receiptSha256: sha256(source) }];
      const graph = {
        adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: "fixture", auxiliaryTraceAssets: [asset], compilerSha256,
        cssInputs: [], delegatedEntryBootstraps: [], emptyEntryBootstraps: [], entrypoints: [entry], frameworkAssets: [], graphId: "node-rsc",
        javascriptChunks: [javascript.path], kind: "hraness-stylex-next-graph", mode: "discovery", modules,
        nextVersion: STYLEX_NEXT_REQUIRED_VERSION, outputDirectory: ".next", outputs: [javascript, map, initial],
        packages: [], rules: emptyRules, rulesSha256: stylexRulesSha256(emptyRules), schemaVersion: 1,
        sourceMaps: [map], sourcesSha256: sha256(JSON.stringify(modules)), target: "node-rsc", webpackVersion: "5.99.0",
      };
      assert.deepEqual(validateStylexNextGraphReceipt(graph).auxiliaryTraceAssets, [asset]);
      for (const change of [
        { target: "client" }, { target: "edge-rsc" }, { javascriptChunks: [] },
        { entrypoints: [] }, { entrypoints: [{ ...entry, name: "middleware" }] },
        { entrypoints: [{ ...entry, files: [], javascript: [] }] },
        { outputs: [javascript, initial], sourceMaps: [] },
        { outputs: [javascript, map] }, { auxiliaryTraceAssets: [] },
        { outputs: [javascript, map, initial, artifact("server/orphan.js.nft.json", '{"version":1,"files":[]}')] },
        { entrypoints: [{ ...entry, files: [javascript.path, initial.path] }] },
        { auxiliaryTraceAssets: [{ ...asset, initial: { ...initial, sha256: sha256("changed") } }] },
        { sourcesSha256: sha256("changed") },
      ]) assert.throws(() => validateStylexNextGraphReceipt({ ...graph, ...change }));
      const auxiliaryMap = artifact(`${initial.path}.map`, "{}");
      assert.throws(() => validateStylexNextGraphReceipt({ ...graph, outputs: [...graph.outputs, auxiliaryMap], sourceMaps: [map, auxiliaryMap] }), /cannot waive a source map/u);
    }
    for (const entrypoint of ["middleware", "instrumentation", "runtime/main", "src/proxy", "proxy/sub", "proxy.js", "Proxy", "../proxy", "/proxy"]) {
      assert.throws(() => validateStylexNextAuxiliaryTraceAsset({
        ...asset, entrypoint, initial: { ...initial, path: `server/${entrypoint}.js.nft.json` },
      }));
    }
    const proxyRename = {
      absent: ["server/proxy.js", "server/proxy.js.nft.json"],
      creator: { bytes: 1, path: `node_modules/next/${STYLEX_NEXT_PROXY_RENAME_CREATOR[0]}`, sha256: STYLEX_NEXT_PROXY_RENAME_CREATOR[1] },
      initial: javascript, output: { ...javascript, path: "server/middleware.js" }, sourceMap: map,
    };
    const snapshot = { asset, output: { ...initial, path: "server/middleware.js.nft.json" }, proxyRename, semantics: "observation-only" };
    assert.deepEqual(validateStylexNextAuxiliaryTraceSnapshot(snapshot), snapshot);
    for (const change of [
      { proxyRename: undefined }, { output: initial },
      ...[
        { absent: [] }, { absent: ["server/proxy.js"] }, { absent: [...proxyRename.absent].reverse() },
        { creator: { ...proxyRename.creator, sha256: sha256("changed") } },
        { creator: { ...proxyRename.creator, path: "node_modules/next/dist/build/entries.js" } },
        { initial: { ...javascript, path: "server/other.js" } },
        { output: { ...proxyRename.output, sha256: sha256("changed") } },
        { output: { ...proxyRename.output, path: "server/other.js" } },
        { sourceMap: { ...map, path: "server/middleware.js.map" } }, { arbitraryRename: true },
      ].map((change) => ({ proxyRename: { ...proxyRename, ...change } })),
      { asset: { ...asset, entrypoint: "app/page", initial: { ...initial, path: "server/app/page.js.nft.json" } } },
    ]) assert.throws(() => validateStylexNextAuxiliaryTraceSnapshot({ ...snapshot, ...change }));
  });

  test("represents an observed-empty production target with an explicit empty graph", () => {
    const modules = [] as const;
    const receipt = validateStylexNextGraphReceipt({
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION,
      attemptId: "fixture",
      auxiliaryTraceAssets: [],
      compilerSha256,
      cssInputs: [],
      entrypoints: [],
      delegatedEntryBootstraps: [], emptyEntryBootstraps: [],
      frameworkAssets: [],
      javascriptChunks: [],
      graphId: "edge-rsc",
      kind: "hraness-stylex-next-graph",
      mode: "discovery",
      modules,
      nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: ".next",
      outputs: [],
      packages: [],
      rules: emptyRules,
      rulesSha256: stylexRulesSha256(emptyRules),
      schemaVersion: STYLEX_NEXT_GRAPH_SCHEMA_VERSION,
      sourceMaps: [],
      sourcesSha256: sha256(JSON.stringify(modules)),
      target: "edge-rsc",
      webpackVersion: "5.99.0",
    });
    assert.deepEqual(receipt.modules, []);
    assert.deepEqual(receipt.entrypoints, []);
    assert.deepEqual(receipt.outputs, []);
    assert.throws(
      () => validateStylexNextGraphReceipt({ ...receipt, rules: [["x", { ltr: ".x{color:red}" }, 3000]] }),
      /empty Next source graph cannot contain StyleX rules/u,
    );
  });
});
