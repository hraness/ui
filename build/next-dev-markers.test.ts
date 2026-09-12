import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createStylexTransformCollector, sha256 } from "./compiler.js";
import { createNextDevConsumerLedger, type NextDevConsumerTarget } from "./next-dev-consumers.js";
import { NEXT_DEV_CLIENT_IMPORT, stampNextDevConsumerSource } from "./next-dev-markers.js";

const source = `import * as stylex from "@stylexjs/stylex";
import { StylexNextDevConsumer as Boundary, stylexNextDevRevision as revision } from "${NEXT_DEV_CLIENT_IMPORT}";
const styles = stylex.create({ root: { marginLeft: 31.125 } });
export default function Page() {
  return <Boundary as="main" revision={revision()} {...stylex.props(styles.root)} data-witness="source"><h1>Content</h1></Boundary>;
}`;
function descriptor(target: NextDevConsumerTarget = "server") {
  const ledger = createNextDevConsumerLedger({ consumers: [{ source: "app/page.tsx", target }], session: "a".repeat(32) });
  ledger.publish({ sequence: 3, revision: "b".repeat(64), includedRevisions: ["a".repeat(64), "b".repeat(64)], stylesheetSha256: "c".repeat(64) });
  const result = ledger.descriptor("app/page.tsx", 3);
  ledger.close();
  return result;
}
async function captured(code = source) {
  const collector = createStylexTransformCollector(import.meta.dir);
  const transformed = await collector.transformWithMap(code, resolve(import.meta.dir, "app/page.tsx"), { logicalSourceFileName: "app/page.tsx" });
  return { code: transformed.code, logicalPath: "app/page.tsx", map: transformed.map, sourceSha256: sha256(code) };
}

test("the real StyleX output receives one exact producer descriptor and preserves authored source mappings", async () => {
  const input = await captured();
  const output = await stampNextDevConsumerSource(input, descriptor());
  expect(output.code).toContain('kind: "hraness-stylex-next-dev-consumer"');
  expect(output.code).toContain('source: "app/page.tsx"');
  expect(output.code).toContain('sequence: 3');
  expect(output.code).not.toContain("stylexNextDevRevision");
  expect(output.code).not.toContain("revision()");
  expect(output.code).toContain('data-witness="source"');
  expect(output.code).toContain("<h1>Content</h1>");
  expect(output.map.sources).toEqual(["app/page.tsx"]);
  expect(output.map.sourcesContent).toEqual([source]);
  expect(output.map.mappings.length).toBeGreaterThan(0);
});

test("registered client and Edge targets remain distinct from arbitrary authored revision or URL strings", async () => {
  expect((await stampNextDevConsumerSource(await captured(`"use client";\n${source}`), descriptor("client"))).code).toStartWith('"use client"');
  expect((await stampNextDevConsumerSource(await captured(source), descriptor("edge-server"))).code).toContain('target: "edge-server"');
  await expect(stampNextDevConsumerSource(await captured(), descriptor("client"))).rejects.toThrow("directive");
  await expect(stampNextDevConsumerSource(await captured(`"use client";\n${source}`), descriptor())).rejects.toThrow("directive");
  await expect(stampNextDevConsumerSource(await captured(), { ...descriptor(), href: "https://example.com/style.css" })).rejects.toThrow("immutable hash");
  await expect(stampNextDevConsumerSource({ ...await captured(), logicalPath: "app/other.tsx" }, descriptor())).rejects.toThrow("producer authority");
});

test("markers cannot be spoofed, reused, shadowed, aliased or moved outside their exact owned root", async () => {
  for (const code of [
    source.replace("revision={revision()}", 'revision="claimed"'),
    source.replace("revision()", "revision('claimed')"),
    source.replace("revision()", "({ sequence: 3 })"),
    source.replace("return <Boundary", "const other = revision(); return <Boundary"),
    source.replace("return <Boundary", "const call = revision; return <Boundary"),
    source.replace("return <Boundary", "const revision = () => ({}); return <Boundary"),
    source.replace("return <Boundary", "const Boundary = () => null; return <Boundary"),
    source.replace("return <Boundary", "return <section><Boundary").replace("</Boundary>;", "</Boundary></section>;"),
    source.replace("<h1>Content</h1>", '<Boundary as="p" revision={revision()}>Nested</Boundary>'),
    source.replace('as="main"', 'as={"main"}'),
    source.replace('as="main"', 'as="article"'),
    source.replace('data-witness="source"', 'data-hraness-stylex-descriptor="forged"'),
    source.replace('data-witness="source"', 'ref={() => {}}'),
    source.replace('data-witness="source"', '{...{ revision: "forged" }}'),
  ]) await expect(stampNextDevConsumerSource(await captured(code), descriptor())).rejects.toThrow();
});

test("the finite server function rejects async inputs and conditional root returns", async () => {
  for (const code of [
    source.replace("function Page()", "async function Page()"),
    source.replace("function Page()", "function Page(props)"),
    source.replace("return <Boundary", "if (true) return null; return <Boundary"),
    source.replace("return <Boundary", "return true ? <Boundary").replace("</Boundary>;", "</Boundary> : null;"),
    source.replace("function Page() {", "function* Page() {"),
  ]) await expect(stampNextDevConsumerSource(await captured(code), descriptor())).rejects.toThrow();
});

test("client control flow cannot escape its owned root while nested callback returns remain ordinary code", async () => {
  for (const statement of [
    "if (flag) return <aside/>;",
    "switch (flag) { case 1: return <aside/>; }",
    "try { if (flag) return <aside/>; } finally {}",
    "try {} catch (error) { return <aside/>; }",
  ]) {
    const code = `"use client";\n${source.replace("return <Boundary", `${statement} return <Boundary`)}`;
    await expect(stampNextDevConsumerSource(await captured(code), descriptor("client"))).rejects.toThrow("unconditional root");
  }
  const callbacks = `"use client";\n${source.replace("return <Boundary", "const increment = (value) => { return value + 1; }; function read() { return 1; } return <Boundary")}`;
  const output = await stampNextDevConsumerSource(await captured(callbacks), descriptor("client"));
  expect(output.code).toContain("return value + 1");
  expect(output.code).toContain("return 1");
  expect(output.code).toContain('target: "client"');
});
