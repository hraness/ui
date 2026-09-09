import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
const sourceMaps = process.argv[3];
assert.ok(sourceMaps === "disabled" || sourceMaps === "external");
const generationId = sourceMaps === "external" ? "vite-production-maps" : "vite-production-matrix";
const root = process.cwd();
const outputDirectory = resolve(root, "output");
const manifestPath = import.meta.resolve("@hraness/ui/stylex-manifest.json");
const expectedGraphs = [
  { adapter: "vite", entrypoints: ["src/client.ts", "src/secondary.ts"], id: "client", kind: "client" },
  { adapter: "vite", entrypoints: ["src/server.ts"], id: "ssr", kind: "ssr" },
];
const generation = await createStylexGeneration({
  expectedGraphs, generationId, outputDirectory,
  packageManifests: [manifestPath], rootDirectory: root,
  templates: [{ cssHref: "/stylex.css", graphId: "ssr", outputPath: "index.html", sourcePath: "index.html", stylesheetGraphId: "client" }],
});
const receipts = [];
for (const graph of expectedGraphs) {
  await build({
    configFile: false, logLevel: "silent",
    build: { minify: true, sourcemap: false, target: "es2022", ...(graph.kind === "ssr" ? { ssr: resolve(root, "src/server.ts") } : {}) },
    ssr: { noExternal: ["@hraness/ui"] },
    plugins: [stylexVite({ generation, graphId: graph.id, rootDirectory: root,
      ...(sourceMaps === "external" ? { sourceMaps } : {}) })],
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
    if (sourceMaps === "disabled") assert.ok(!output.path.endsWith(".map"));
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
const mappedSources = new Set();
const companions = new Set();
// Receipts use private staging roots; final publication uses this exact graph
// projection. Bind the complete map artifact to one output, then its own inputs.
function assertPublishedMapInput(graphs, artifact, logical) {
  const matches = graphs.flatMap((graph) => graph.outputs
    .filter((output) => artifact.path === `graphs/${graph.graphId}/${output.path}`)
    .map((output) => ({ graph, output })));
  assert.equal(matches.length, 1, `Published map must identify one graph output: ${artifact.path}`);
  const { graph, output } = matches[0];
  assert.deepEqual({ bytes: artifact.bytes, sha256: artifact.sha256 }, { bytes: output.bytes, sha256: output.sha256 },
    `Published map differs from its graph output: ${artifact.path}`);
  assert.ok(graph.inputs.some((input) => input.path === logical), `Map source was not a loaded graph input: ${logical}`);
  return graph.graphId;
}
function verifyPublishedMapInputControls() {
  const output = { path: "assets/client.js.map", bytes: 123, sha256: "a".repeat(64) };
  const client = { graphId: "client", outputRoot: ".stylex-generation/graphs/client/output", outputs: [output], inputs: [{ path: "src/client.ts" }] };
  const server = { graphId: "ssr", outputRoot: ".stylex-generation/graphs/ssr/output", outputs: [output], inputs: [{ path: "src/server.ts" }] };
  const artifact = { ...output, path: "graphs/client/assets/client.js.map" };
  assert.equal(assertPublishedMapInput([client, server], artifact, "src/client.ts"), "client");
  assert.equal(assertPublishedMapInput([client, server], { ...artifact, path: "graphs/ssr/assets/client.js.map" }, "src/server.ts"), "ssr");
  assert.throws(() => assertPublishedMapInput([client, server], artifact, "src/server.ts"), /not a loaded graph input/u);
  assert.throws(() => assertPublishedMapInput([client, server], artifact, "src/missing.ts"), /not a loaded graph input/u);
  assert.throws(() => assertPublishedMapInput([server], artifact, "src/client.ts"), /one graph output/u);
  assert.throws(() => assertPublishedMapInput([{ ...client, outputs: [] }], artifact, "src/client.ts"), /one graph output/u);
  assert.throws(() => assertPublishedMapInput([client, client], artifact, "src/client.ts"), /one graph output/u);
  assert.throws(() => assertPublishedMapInput([{ ...client, outputs: [output, output] }], artifact, "src/client.ts"), /one graph output/u);
  for (const path of ["graphs/client-extra/assets/client.js.map", ".stylex-generation/graphs/client/output/assets/client.js.map"])
    assert.throws(() => assertPublishedMapInput([client, server], { ...artifact, path }, "src/client.ts"), /one graph output/u);
  assert.throws(() => assertPublishedMapInput([client], { ...artifact, bytes: 124 }, "src/client.ts"), /differs from its graph output/u);
  assert.throws(() => assertPublishedMapInput([client], { ...artifact, sha256: "b".repeat(64) }, "src/client.ts"), /differs from its graph output/u);
}
verifyPublishedMapInputControls();
for (const artifact of [...complete.artifacts, complete.finalCss]) {
  assert.deepEqual(await artifactForFile(finalDirectory, artifact.path), artifact);
  if (sourceMaps === "disabled") assert.ok(!artifact.path.endsWith(".map"));
  if (/\.[cm]?js$/u.test(artifact.path)) {
    const code = await readFile(join(finalDirectory, artifact.path), "utf8");
    assert.doesNotMatch(code, /314159px|271828px|161803px|141421px|data-stylex|stylex-inject|stylesheet-group/u);
    if (sourceMaps === "disabled") assert.doesNotMatch(code, /sourceMappingURL/u);
    else {
      const path = `${artifact.path}.map`;
      const companion = complete.artifacts.find((item) => item.path === path);
      assert.ok(companion, `Missing sealed native map: ${path}`);
      companions.add(path);
      const references = [...code.matchAll(/^\/\/# sourceMappingURL=([^\r\n]+)$/gmu)];
      assert.equal(references.length, 1);
      assert.equal(references[0][1], basename(path));
      const map = JSON.parse(await readFile(join(finalDirectory, path), "utf8"));
      assert.equal(map.version, 3);
      assert.equal(map.file, basename(artifact.path));
      assert.ok(Array.isArray(map.sources) && map.sources.length > 0);
      assert.equal(map.sources.length, map.sourcesContent.length);
      assert.ok(typeof map.mappings === "string" && map.mappings.length > 0);
      for (const [index, source] of map.sources.entries()) {
        assert.ok(typeof source === "string" && !isAbsolute(source) && !/[\\\\:%?#\u0000-\u001f]/u.test(source));
        const physical = resolve(dirname(join(finalDirectory, path)), source);
        const logical = relative(root, physical).split(sep).join("/");
        assert.ok(logical !== ".." && !logical.startsWith("../") && !isAbsolute(logical));
        assert.equal(await realpath(physical), physical);
        assert.equal(map.sourcesContent[index], await readFile(physical, "utf8"));
        assertPublishedMapInput(receipts, companion, logical);
        mappedSources.add(logical);
      }
    }
    assert.ok(!code.includes(root));
  }
}
assert.deepEqual(complete.artifacts.filter((artifact) => artifact.path.endsWith(".map")).map((artifact) => artifact.path).sort(), [...companions].sort());
if (sourceMaps === "external") {
  for (const path of ["src/client.ts", "src/secondary.ts", "src/lazy.ts", "src/server.ts", "src/view.ts"]) {
    assert.ok(mappedSources.has(path), `Final native maps omitted fixture source: ${path}`);
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
const copiedMapCases = [];
for (const extension of sourceMaps === "disabled" ? ["JS", "MJS", "CJS"] : []) {
  const entry = `src/copied-map-${extension.toLowerCase()}.ts`;
  await writeFile(join(root, "src", `copied.${extension}`), "globalThis.asset = true;\n//# sourceMappingURL=data:application/json;base64,e30=\n", { flag: "wx" });
  await writeFile(join(root, entry), `globalThis.assetUrl = new URL('./copied.${extension}', import.meta.url).href;\n`, { flag: "wx" });
  copiedMapCases.push({ name: `copied-map-${extension.toLowerCase()}`, entry, diagnostic: /source-map references/u });
}
const cases = sourceMaps === "external" ? [
  { name: "mapped-missing-companion", plugin: { name: "mapped-missing-companion", generateBundle: { order: "pre", handler(_options, bundle) {
    const map = Object.keys(bundle).find((path) => path.endsWith(".map"));
    assert.ok(map);
    delete bundle[map];
  } } }, diagnostic: /source.map.*companion|companion.*source.map/u },
  { name: "mapped-late-bytes", plugin: { name: "mapped-late-bytes", generateBundle: { order: "post", handler(_options, bundle) {
    const map = Object.values(bundle).find((item) => item.type === "asset" && item.fileName.endsWith(".map"));
    assert.ok(map);
    map.source = `${map.source} `;
  } } }, diagnostic: /bundle bytes or linkage changed|map.*serialization|canonical/u },
] : [
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
  ...copiedMapCases,
];
for (const control of cases) {
  const negative = await createStylexGeneration({
    expectedGraphs: [{ adapter: "vite", entrypoints: [control.entry ?? "src/client.ts"], id: "client", kind: "client" }],
    generationId: `reject-${control.name}`, outputDirectory, packageManifests: [manifestPath], rootDirectory: root,
  });
  let failure;
  try {
    await build({ configFile: false, logLevel: "silent", ...control.config,
      plugins: [stylexVite({ generation: negative, graphId: "client", rootDirectory: root,
        ...(sourceMaps === "external" ? { sourceMaps } : {}) }), ...(control.plugin ? [control.plugin] : [])],
    });
  } catch (error) { failure = error; }
  assert.ok(failure !== undefined, `Expected ${control.name} rejection`);
  assert.match(diagnostics(failure), control.diagnostic, control.name);
  assert.deepEqual(await readdir(join(negative.directory, ".stylex-generation/receipts")), []);
  negatives.push(control.name);
}
await writeFile(`matrix-receipt-${sourceMaps}.json`, `${canonicalJson({
  finalDirectory: `output/${generationId}`, foundationHref: `/graphs/client/${foundation}`,
  clientHrefs: [`/graphs/client/${clientEntry}`, `/graphs/client/${secondEntry}`, `/graphs/client/${lazyEntry}`],
  graphReceipts: receipts.map((receipt) => ({ id: receipt.graphId, inputs: receipt.inputs.length, outputs: receipt.outputs.length, rules: receipt.rules.length })),
  externalImports, negatives, sourceMaps, mappedSources: [...mappedSources].sort(), vite: version,
})}\n`, { flag: "wx" });
