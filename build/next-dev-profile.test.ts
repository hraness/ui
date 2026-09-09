import { expect, test } from "bun:test";
import { sha256 } from "./compiler.js";
import { validateNextDevNativeProfile } from "./next-dev-profile.js";
import { NEXT_DEV_CLIENT_IMPORT, stampNextDevConsumerSource } from "./next-dev-markers.js";
import { createNextDevConsumerLedger } from "./next-dev-consumers.js";
import type { NextDevSource } from "./next-dev-session.js";

const consumerImport = `import { StylexNextDevConsumer as Boundary, stylexNextDevRevision as revision } from "${NEXT_DEV_CLIENT_IMPORT}";`;
const authored: Readonly<Record<string, string>> = {
  "app/layout.tsx": `import type { ReactNode } from "react";
import { StylexNextDevDocument } from "${NEXT_DEV_CLIENT_IMPORT}";
import "./stylex-dev.css";
export default function Layout({ children }: { children: ReactNode }) {
return <html lang="en"><body><StylexNextDevDocument>{children}</StylexNextDevDocument></body></html>;
}`,
  "app/page.tsx": `${consumerImport}
import Client from "./client"; import { Link } from "@hraness/ui";
export default function Page() { return <Boundary as="main" revision={revision()}><Link href="/unvisited">Next</Link><Client/></Boundary>; }`,
  "app/client.tsx": `"use client"; ${consumerImport}
import { lazy, Suspense, useState } from "react";
const LazyPanel = lazy(() => import("./lazy"));
export default function Client() { const [count, setCount] = useState(0); return <Boundary as="section" revision={revision()}>
<button onClick={() => setCount((value) => value + 1)}>{count}</button><Suspense fallback={<p>Loading</p>}><LazyPanel/></Suspense></Boundary>; }`,
  "app/lazy.tsx": `"use client"; ${consumerImport}
export default function LazyPanel() { return <Boundary as="p" revision={revision()}>Lazy</Boundary>; }`,
  "app/unvisited/page.tsx": `${consumerImport} export const runtime = "edge";
export default function Unvisited() { return <Boundary as="main" revision={revision()}>Unvisited</Boundary>; }`,
  "app/shared.stylex.ts": 'import * as stylex from "@stylexjs/stylex"; export const styles = stylex.create({ root: { marginLeft: 31.125 } });',
};
const consumers = [{ source: "app/page.tsx", target: "server" }, { source: "app/client.tsx", target: "client" },
  { source: "app/lazy.tsx", target: "client" }, { source: "app/unvisited/page.tsx", target: "edge-server" }] as const;
// Constructed capture/map records exercise the complete authored-source parser.
// The marker tests separately use the real StyleX compiler and composed maps.
function sources(values = authored): readonly NextDevSource[] {
  return Object.entries(values).map(([logicalPath, code]) => ({ logicalPath, code, sourceSha256: sha256(code),
    map: { version: 3, names: [], sources: [logicalPath], sourcesContent: [code], mappings: "AAAA" } }));
}
const change = (path: string, before: string, after: string) => ({ ...authored, [path]: authored[path]!.replace(before, after) });

test("the finite page/client/lazy/Edge graph and style-free root preserve data-only source creation and reexports", async () => {
  await validateNextDevNativeProfile(sources(), consumers);
  await validateNextDevNativeProfile(sources({ ...authored, "app/recovery.stylex.ts": 'export { recovery } from "./created-later";',
    "app/created-later.tsx": 'import * as stylex from "@stylexjs/stylex"; export const recovery = stylex.create({ root: { marginLeft: 119.125 } });' }), consumers);
  expect(true).toBeTrue();
  const noEdge = change("app/unvisited/page.tsx", 'export const runtime = "edge";', "");
  await validateNextDevNativeProfile(sources(noEdge), consumers.map((entry) => entry.target === "edge-server" ? { ...entry, target: "server" as const } : entry));
  expect(true).toBeTrue();
});

test("unknown JSX, nested layouts and opaque route compositions fail closed", async () => {
  for (const [path, code] of [
    ["app/extra.tsx", "export const node = <aside/>;"],
    ["app/nested/layout.tsx", authored["app/layout.tsx"]!],
    ["app/loading.tsx", "export default function Loading() { return <p>Loading</p>; }"],
    ["app/template.tsx", "export const template = 1;"],
    ["app/route.ts", "export const GET = 1;"],
    ["app/(group)/extra.tsx", "export const data = 1;"],
    ["app/[slug]/extra.tsx", "export const data = 1;"],
  ]) await expect(validateNextDevNativeProfile(sources({ ...authored, [path!]: code! }), consumers)).rejects.toThrow();
});

test("root ownership cannot be hidden under another Suspense, styling, child transform or duplicate CSS import", async () => {
  for (const [before, after] of [
    ["<body>", '<body className="opaque">'],
    ["<html lang=\"en\">", '<html style={{ color: "red" }}>'],
    ["<StylexNextDevDocument>{children}</StylexNextDevDocument>", "{children}"],
    ["{children}</StylexNextDevDocument>", "{children}<p>Extra</p></StylexNextDevDocument>"],
    ['import "./stylex-dev.css";', 'import "./stylex-dev.css"; import "./stylex-dev.css";'],
    ["<body>", "<body><section>"],
    ["{ children }: { children: ReactNode }", "{ children, extra }: { children: ReactNode, extra: ReactNode }"],
  ]) await expect(validateNextDevNativeProfile(sources(change("app/layout.tsx", before!, after!)), consumers)).rejects.toThrow();
});

test("server consumers cannot obtain async inputs, call deferred render helpers or import another server page", async () => {
  for (const code of [
    authored["app/page.tsx"]!.replace("function Page()", "async function Page()"),
    authored["app/page.tsx"]!.replace("function Page()", "function Page({ params })"),
    authored["app/page.tsx"]!.replace("<Client/>", "{renderChild()}"),
    authored["app/page.tsx"]! + "\nfunction renderChild() { return <p>Later</p>; }",
    authored["app/page.tsx"]!.replace('"./client"', '"./unvisited/page"'),
    authored["app/page.tsx"]! + "\nexport const dynamic = 'force-dynamic';",
    authored["app/page.tsx"]!.replace("<Client/>", "<Unknown/>"),
    authored["app/page.tsx"]!.replace("<Client/>", "<script>opaque</script>"),
  ]) await expect(validateNextDevNativeProfile(sources({ ...authored, "app/page.tsx": code }), consumers)).rejects.toThrow();
});

test("client and data imports cannot smuggle unregistered renderers, native authority or arbitrary lazy work", async () => {
  for (const code of [
    authored["app/client.tsx"]!.replace('"react"', '"unknown-renderer"'),
    authored["app/client.tsx"]!.replace("useState }", "useState, use }"),
    authored["app/client.tsx"]!.replace('import("./lazy")', 'import("./unvisited/page")'),
    authored["app/client.tsx"]!.replace('import("./lazy")', 'import("./shared.stylex")'),
    authored["app/client.tsx"]! + '\nconst other = import("./lazy");',
    authored["app/client.tsx"]! + "\nconst foreign = globalThis.document;",
  ]) await expect(validateNextDevNativeProfile(sources({ ...authored, "app/client.tsx": code }), consumers)).rejects.toThrow();
  for (const code of [
    'export { default as Layout } from "./layout";',
    'import Client from "./client"; export const node = Client;',
    'export const value = Promise.resolve(1);',
    'export function data() { return 1; }',
    'import { Link } from "@hraness/ui"; export const node = Link;',
  ]) await expect(validateNextDevNativeProfile(sources({ ...authored, "app/added.stylex.ts": code }), consumers)).rejects.toThrow();
});

test("profile registration, source hashes and declared runtime must match the complete captured graph", async () => {
  const captured = sources();
  await expect(validateNextDevNativeProfile(captured.slice(1), consumers)).rejects.toThrow("root layout");
  await expect(validateNextDevNativeProfile(captured, consumers.filter(({ source }) => source !== "app/client.tsx"))).rejects.toThrow();
  await expect(validateNextDevNativeProfile([...captured, captured[0]!], consumers)).rejects.toThrow("unique");
  await expect(validateNextDevNativeProfile(captured.map((entry, index) => index === 0 ? { ...entry, sourceSha256: "a".repeat(64) } : entry), consumers)).rejects.toThrow("authored bytes");
  await expect(validateNextDevNativeProfile(sources(change("app/unvisited/page.tsx", 'runtime = "edge"', 'runtime = "nodejs"')), consumers)).rejects.toThrow("route exports");
  await expect(validateNextDevNativeProfile(sources(change("app/lazy.tsx", '"use client";', "")), consumers)).rejects.toThrow("directive");
});

test("the complete profile closes pre-boundary thenable suspension even when the per-module marker alone can stamp its root", async () => {
  const code = authored["app/client.tsx"]!.replace("const [count", "throw { then() {} }; const [count");
  const captured = sources({ ...authored, "app/client.tsx": code });
  const ledger = createNextDevConsumerLedger({ consumers: [{ source: "app/client.tsx", target: "client" }], session: "a".repeat(32) });
  ledger.publish({ sequence: 1, revision: "b".repeat(64), includedRevisions: ["b".repeat(64)], stylesheetSha256: "c".repeat(64) });
  const stamped = await stampNextDevConsumerSource(captured.find(({ logicalPath }) => logicalPath === "app/client.tsx")!, ledger.descriptor("app/client.tsx", 1));
  expect(stamped.code).toContain("throw");
  await expect(validateNextDevNativeProfile(captured, consumers)).rejects.toThrow("opaque rendering");
  ledger.close();
});

test("nested HTML injection, spread aliases, custom thenables and ambient access cannot bypass the finite profile", async () => {
  for (const child of [
    '<div dangerouslySetInnerHTML={{ __html: "<style>div{color:red}</style>" }}/>',
    '<div {...{ dangerouslySetInnerHTML: { __html: "<style/>" } }}/>',
    '<div {...unknownProps}/>',
    '{self["document"]}',
    '{top["document"]}',
    '{({}).constructor.constructor("return self")()}',
    '{({ then: () => {} })}',
    '{unownedCall()}',
  ]) await expect(validateNextDevNativeProfile(sources(change("app/client.tsx", "<button onClick", `${child}<button onClick`)), consumers)).rejects.toThrow();
  for (const code of [
    authored["app/client.tsx"]! + "\nfunction unownedCall() { return 1; }",
    authored["app/client.tsx"]! + "\nconst props = { dangerouslySetInnerHTML: { __html: '<style/>' } };",
  ]) {
    const changed = code.includes("function unownedCall") ? code.replace("const [count", "unownedCall(); const [count")
      : code.replace("<button onClick", "<div {...props}/><button onClick");
    await expect(validateNextDevNativeProfile(sources({ ...authored, "app/client.tsx": changed }), consumers)).rejects.toThrow();
  }
});

test("bound callbacks cannot write native DOM, bypass captured JSX bindings, or loop before the owned boundary", async () => {
  for (const child of [
    '<button onClick={(event) => { event.currentTarget.innerHTML = "<style/>"; }}>Unsafe</button>',
    '<div ref={(element) => element}/>',
    '<button onClick={(event) => { delete event.currentTarget.innerHTML; }}>Unsafe</button>',
    '<button onClick={() => { count++; }}>Unsafe</button>',
  ]) await expect(validateNextDevNativeProfile(sources(change("app/client.tsx", "<button onClick", `${child}<button onClick`)), consumers)).rejects.toThrow();
  for (const beforeRoot of [
    "while (true) {}",
    "for (;;) {}",
    "do {} while (true);",
    "const Suspense = () => <div/>;",
    "const LazyPanel = () => <div/>;",
  ]) await expect(validateNextDevNativeProfile(sources(change("app/client.tsx", "const [count", `${beforeRoot} const [count`)), consumers)).rejects.toThrow();
});
