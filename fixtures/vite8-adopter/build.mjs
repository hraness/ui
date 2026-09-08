import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build, version } from "vite";
import {
  artifactForFile, canonicalJson, createStylexGeneration, finalizeStylexGeneration,
  prepareStylexProducedTemplate, sealStylexProducedTemplate, STYLEX_TEMPLATE_CSS_PLACEHOLDER,
} from "@hraness/ui/stylex-build";
import { stylexVite } from "@hraness/ui/stylex-build/vite";

assert.equal(globalThis.Bun, undefined);
assert.match(process.versions.node, /^24\./u);
assert.ok(["7.3.6", "8.2.1"].includes(version));
assert.equal(version, process.argv[2]);
const root = process.cwd();
const outputDirectory = resolve(root, "output");
const manifestPath = import.meta.resolve("@hraness/ui/stylex-manifest.json");
const expectedGraphs = [
  { adapter: "vite", entrypoints: ["src/client.ts", "src/secondary.ts"], id: "client", kind: "client" },
  { adapter: "vite", entrypoints: ["src/server.ts"], id: "ssr", kind: "ssr" },
];
const generation = await createStylexGeneration({
  expectedGraphs, generationId: "vite-production-matrix", outputDirectory,
  packageManifests: [manifestPath], rootDirectory: root,
  templates: [{ cssHref: "/stylex.css", graphId: "ssr", outputPath: "index.html", sourcePath: "index.html", stylesheetGraphId: "client" }],
});
const receipts = [];
for (const graph of expectedGraphs) {
  await build({
    configFile: false, logLevel: "silent",
    build: { minify: true, sourcemap: false, target: "es2022", ...(graph.kind === "ssr" ? { ssr: resolve(root, "src/server.ts") } : {}) },
    ssr: { noExternal: ["@hraness/ui"] },
    plugins: [stylexVite({ generation, graphId: graph.id, rootDirectory: root })],
  });
  const receipt = JSON.parse(await readFile(join(generation.directory, ".stylex-generation/receipts", `${graph.id}.json`), "utf8"));
  assert.equal(receipt.adapter, "vite");
  assert.equal(receipt.target, graph.kind);
  assert.deepEqual(receipt.entrypoints, graph.entrypoints);
  for (const entrypoint of graph.entrypoints) {
    assert.ok(receipt.inputs.some((input) => input.path === entrypoint));
    assert.ok(receipt.edges.some((edge) => edge.kind === "entry" && edge.to === `input:${entrypoint}`));
  }
  for (const input of receipt.inputs) assert.deepEqual(await artifactForFile(root, input.path), input);
  for (const output of receipt.outputs) {
    assert.ok(!output.path.endsWith(".map"));
    assert.deepEqual(await artifactForFile(join(generation.directory, receipt.outputRoot), output.path), output);
  }
  receipts.push(receipt);
}
const [client, server] = receipts;
assert.ok(client.edges.some((edge) => edge.kind === "dynamic-import" && edge.from === "input:src/client.ts" && edge.to === "input:src/lazy.ts"));
for (const [from, to] of [
  ["src/styles/app.css", "src/styles/foundation.css"],
  ["src/styles/foundation.css", "node_modules/@hraness/ui/src/compiler-foundation.css"],
]) assert.ok(client.edges.some((edge) => edge.kind === "css-import" && edge.from === `input:${from}` && edge.to === `input:${to}`));
assert.ok(client.inputs.some((input) => input.path === "node_modules/@hraness/ui/dist/index.js"));
assert.ok(server.inputs.some((input) => input.path === "node_modules/@hraness/ui/dist/index.js"));
// These imports are exercised by the emitted SSR renderer below. Neither
// engine may erase their external status or invent a source input for them.
const externalImports = ["node:assert/strict", "node:fs/promises", "react", "react-dom/server"];
for (const id of externalImports) assert.ok(server.edges.some((edge) => edge.external === true
  && edge.kind === "static-import" && edge.from === "input:src/server.ts" && edge.to === `external:${id}`), id);
function oneOutput(receipt, predicate) {
  const found = receipt.outputs.filter(predicate);
  assert.equal(found.length, 1);
  return found[0].path;
}
function entry(receipt, name) {
  return oneOutput(receipt, ({ path }) => /\.[cm]?js$/u.test(path)
    && (basename(path).startsWith(`${name}-`) || basename(path) === `${name}.js` || basename(path) === `${name}.mjs`));
}
const clientEntry = entry(client, "client");
const secondEntry = entry(client, "secondary");
const lazyEntry = entry(client, "lazy");
const serverEntry = entry(server, "server");
const foundation = oneOutput(client, ({ path }) => path.endsWith(".css"));
assert.equal(server.outputs.filter(({ path }) => path.endsWith(".css")).length, 0);
const template = await prepareStylexProducedTemplate(generation, "index.html");
const renderer = spawnSync(process.execPath, [
  join(generation.directory, server.outputRoot, serverEntry), template.sourcePath,
  `/graphs/client/${clientEntry}`, `/graphs/client/${secondEntry}`, `/graphs/client/${foundation}`,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
], { cwd: root, encoding: "utf8", timeout: 60_000 });
assert.ifError(renderer.error);
assert.equal(renderer.status, 0, renderer.stderr);
assert.equal(renderer.signal, null);
await sealStylexProducedTemplate(generation, "index.html");
const finalDirectory = await finalizeStylexGeneration({ generation, outputDirectory, rootDirectory: root });
const complete = JSON.parse(await readFile(join(finalDirectory, "stylex-complete.json"), "utf8"));
assert.equal(complete.state, "complete");
assert.deepEqual(complete.graphs.map(({ id }) => id), ["client", "ssr"]);
assert.equal(complete.packages.length, 1);
assert.equal(complete.packages[0].name, "@hraness/ui");
const finalCss = await readFile(join(finalDirectory, "stylex.css"), "utf8");
for (const [property, value] of [
  ["scroll-margin-bottom", "314159px"], ["scroll-padding-inline-start", "271828px"],
  ["margin-inline-end", "161803px"], ["outline-offset", "141421px"],
]) assert.equal([...finalCss.matchAll(new RegExp(`${property}\\s*:\\s*${value}(?=[;}])`, "gu"))].length, 1);
const foundationCss = await readFile(join(finalDirectory, "graphs/client", foundation), "utf8");
assert.match(foundationCss, /--vite-foundation-proof\s*:\s*present/u);
assert.match(foundationCss, /--ui-background/u);
assert.doesNotMatch(foundationCss, /@layer\s+components\.hraness-ui\.priority/u);
for (const artifact of [...complete.artifacts, complete.finalCss]) {
  assert.deepEqual(await artifactForFile(finalDirectory, artifact.path), artifact);
  assert.ok(!artifact.path.endsWith(".map"));
  if (/\.[cm]?js$/u.test(artifact.path)) {
    const code = await readFile(join(finalDirectory, artifact.path), "utf8");
    assert.doesNotMatch(code, /sourceMappingURL|314159px|271828px|161803px|141421px|data-stylex|stylex-inject|stylesheet-group/u);
    assert.ok(!code.includes(root));
  }
}
const html = await readFile(join(finalDirectory, "index.html"), "utf8");
assert.match(html, /data-hydrated="false"/u);
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/gu)].map((match) => match[1]);
assert.deepEqual(links, [`/graphs/client/${foundation}`, "/stylex.css"]);
assert.ok(!html.includes(STYLEX_TEMPLATE_CSS_PLACEHOLDER));

// Vite 8 wraps hook failures in BundleError.errors. Inspect every actual
// diagnostic; an unrelated build failure must not satisfy a negative control.
function diagnostics(error) {
  return [String(error?.message ?? error), ...(Array.isArray(error?.errors) ? error.errors.flatMap(diagnostics) : [])].join("\n");
}
const negatives = [];
const cases = [
  ...[true, "hidden", "inline"].map((sourcemap) => ({ name: `map-${String(sourcemap)}`, config: { build: { sourcemap } }, diagnostic: /build\.sourcemap false or undefined/u })),
  ...["rollupOptions", "rolldownOptions"].flatMap((alias) => ["input", "output", "external"].map((field) => ({
    name: `${alias.toLowerCase()}-${field}`, config: { build: { [alias]: { [field]: field === "input" ? "src/secondary.ts" : field === "output" ? { sourcemap: "hidden" } : ["react"] } } },
    diagnostic: /StyleX Vite adapter owns/u,
  }))),
  { name: "late-map", plugin: { name: "late-map", outputOptions(options) { return { ...options, sourcemap: "hidden" }; } }, diagnostic: /sourcemap output.*disabled/u },
  { name: "late-bytes", plugin: { name: "late-bytes", generateBundle: { order: "post", handler(_options, bundle) {
    const chunk = Object.values(bundle).find((item) => item.type === "chunk");
    assert.ok(chunk);
    chunk.code += "\nglobalThis.unreviewedOutput = true;\n";
  } } }, diagnostic: /bundle bytes or linkage changed/u },
  ...["relative", "absolute"].map((kind) => ({
    name: `external-${kind}-file`,
    plugin: { name: `external-${kind}-file`, enforce: "pre", resolveId(source, importer) {
      if (source !== "./lazy.ts" || importer !== resolve(root, "src/client.ts")) return null;
      return { id: kind === "relative" ? "./lazy.ts" : resolve(root, "src/lazy.ts"), external: true };
    } },
    diagnostic: /may not externalize a relative or absolute file/u,
  })),
];
for (const control of cases) {
  const negative = await createStylexGeneration({
    expectedGraphs: [{ adapter: "vite", entrypoints: ["src/client.ts"], id: "client", kind: "client" }],
    generationId: `reject-${control.name}`, outputDirectory, packageManifests: [manifestPath], rootDirectory: root,
  });
  let failure;
  try {
    await build({ configFile: false, logLevel: "silent", ...control.config,
      plugins: [stylexVite({ generation: negative, graphId: "client", rootDirectory: root }), ...(control.plugin ? [control.plugin] : [])],
    });
  } catch (error) { failure = error; }
  assert.ok(failure !== undefined, `Expected ${control.name} rejection`);
  assert.match(diagnostics(failure), control.diagnostic, control.name);
  assert.deepEqual(await readdir(join(negative.directory, ".stylex-generation/receipts")), []);
  negatives.push(control.name);
}
await writeFile("matrix-receipt.json", `${canonicalJson({
  finalDirectory: "output/vite-production-matrix", foundationHref: `/graphs/client/${foundation}`,
  clientHrefs: [`/graphs/client/${clientEntry}`, `/graphs/client/${secondEntry}`, `/graphs/client/${lazyEntry}`],
  graphReceipts: receipts.map((receipt) => ({ id: receipt.graphId, inputs: receipt.inputs.length, outputs: receipt.outputs.length, rules: receipt.rules.length })),
  externalImports, negatives, vite: version,
})}\n`, { flag: "wx" });
