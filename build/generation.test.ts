import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";

import {
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
  type FinalizeStylexGenerationOptions,
  type StylexGenerationHandleV1,
  type StylexGraphReceiptV1,
  type StylexPackageManifestV1,
  type StylexRuleV1,
  type StylexTemplateV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  canonicalJson,
  canonicalizeStylexRules,
  compilerContract,
  compilerSha256,
  createStylexTransformCollector,
  normalizeLogicalPath,
  parseStylexRules,
  readStylexPackageManifest,
  serializeStylexPackageRules,
  serializeStylexRules,
  sha256,
  stylexRulesSha256,
  validateStylexPackageManifest,
} from "./compiler.js";
import {
  cleanupFailedPublicationLock,
  createStylexGeneration,
  finalizeStylexGeneration,
  loadStylexGeneration,
  prepareStylexGraph,
  prepareStylexProducedTemplate,
  sealStylexProducedTemplate,
  writeStylexGraphReceipt,
} from "./generation.js";

const roots: string[] = [];

const packageRule = ["x-package", { ltr: ".x-package{color:red}" }, 1000] as const satisfies StylexRuleV1;
const clientRule = ["x-client", { ltr: ".x-client{display:block}" }, 3000] as const satisfies StylexRuleV1;
const serverRule = ["x-server", { ltr: ".x-server{display:grid}" }, 3000] as const satisfies StylexRuleV1;

type Fixture = Readonly<{
  manifestPath: string;
  outputDirectory: string;
  root: string;
  templatePath: string;
}>;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function write(path: string, source: string | Uint8Array): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, source, { flag: "wx" });
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false);
}

function logical(root: string, path: string): string {
  const result = relative(root, path).split(sep).join("/");
  return normalizeLogicalPath(result);
}

async function packageAt(
  root: string,
  directory = "package",
  color = "red",
  name = "@fixture/ui",
  version = "1.0.0",
  ruleKey = "x-package",
  standalonePrefix = `components.${name.replace(/^@/u, "").replaceAll("/", "-")}`,
): Promise<string> {
  const packageRoot = join(root, directory);
  const standaloneSerializer = {
    before: [`${standalonePrefix}.legacy`],
    prefix: standalonePrefix,
  } as const;
  await write(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name, version })}\n`,
  );
  await write(join(packageRoot, "build/index.js"), "export const tool = true;\n");
  await write(join(packageRoot, "dist/index.js"), "export const runtime = true;\n");
  await write(join(packageRoot, "src/compiler-foundation.css"), ".foundation{display:block}\n");
  const rules: readonly StylexRuleV1[] = [[ruleKey, { ltr: `.${ruleKey}{color:${color}}` }, 1000]];
  await write(join(packageRoot, "dist/stylex.css"), serializeStylexPackageRules(rules, standaloneSerializer));
  const manifest: StylexPackageManifestV1 = {
    buildTools: [await artifactForFile(packageRoot, "build/index.js")],
    compiler: compilerContract,
    compilerSha256,
    compilerFoundation: "src/compiler-foundation.css",
    kind: "hraness-stylex-package-manifest",
    package: { name, version },
    rules,
    rulesSha256: stylexRulesSha256(rules),
    runtime: [await artifactForFile(packageRoot, "dist/index.js")],
    schemaVersion: 1,
    standaloneCss: await artifactForFile(packageRoot, "dist/stylex.css"),
    standaloneSerializer,
    stylesheets: [await artifactForFile(packageRoot, "src/compiler-foundation.css")],
  };
  const manifestPath = join(packageRoot, "dist/stylex-manifest.json");
  await write(manifestPath, `${canonicalJson(manifest)}\n`);
  return manifestPath;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "hraness-ui-generation-"));
  roots.push(root);
  await write(join(root, "package.json"), '{"name":"generation-fixture","type":"module"}\n');
  const manifestPath = await packageAt(root);
  const templatePath = join(root, "src/index.html");
  await write(
    templatePath,
    `<html><head><link href="/graphs/client/foundation.css" rel="stylesheet"><link href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}" rel="stylesheet"></head></html>\n`,
  );
  return { manifestPath, outputDirectory: join(root, "generations"), root, templatePath };
}

function expectedGraph(id: string, kind: "client" | "ssr" = "client") {
  return { adapter: "bun" as const, entrypoints: [`src/${id}.ts`], id, kind };
}

async function create(
  context: Fixture,
  generationId: string,
  graphIds: readonly (readonly [string, "client" | "ssr"])[] = [["client", "client"]],
  withTemplate = false,
  templates?: readonly StylexTemplateV1[],
): Promise<StylexGenerationHandleV1> {
  for (const [id] of graphIds) {
    const input = join(context.root, `src/${id}.ts`);
    if (!(await Bun.file(input).exists())) await write(input, `export const ${id.replaceAll("-", "_")} = true;\n`);
  }
  return createStylexGeneration({
    expectedGraphs: graphIds.map(([id, kind]) => expectedGraph(id, kind)),
    generationId,
    outputDirectory: context.outputDirectory,
    packageManifests: [logical(context.root, context.manifestPath)],
    rootDirectory: context.root,
    templates: templates ?? (withTemplate ? [{
      cssHref: "assets/recipes.css",
      outputPath: "index.html",
      sourcePath: logical(context.root, context.templatePath),
      stylesheetGraphId: "client",
    }] : []),
    finalCssPath: withTemplate ? "assets/recipes.css" : "stylex.css",
  });
}

async function receiptValue(
  context: Fixture,
  generation: StylexGenerationHandleV1,
  graphId: string,
  rule: StylexRuleV1,
  outputPath = "index.js",
  outputSource = `export const ${graphId.replaceAll("-", "_")} = true;\n`,
): Promise<StylexGraphReceiptV1> {
  const loaded = await loadStylexGeneration(generation);
  const graph = loaded.expectedGraph(graphId);
  const prepared = await prepareStylexGraph(generation, graphId);
  await write(join(prepared.outputDirectory, outputPath), outputSource);
  const inputs = await Promise.all(
    graph.entrypoints.map((entrypoint) => artifactForFile(context.root, entrypoint)),
  );
  if (loaded.plan.templates.some(({ stylesheetGraphId }) => stylesheetGraphId === graphId)) {
    const packageInputDirectory = join(generation.directory, ".stylex-generation/package-inputs");
    for (const locator of await readdir(packageInputDirectory)) {
      const manifestPath = (await readFile(join(packageInputDirectory, locator), "utf8")).trimEnd();
      const manifest = await readStylexPackageManifest(join(context.root, manifestPath));
      const packageRoot = resolve(join(context.root, manifestPath), "../..");
      inputs.push(await artifactForFile(
        context.root,
        logical(context.root, join(packageRoot, manifest.compilerFoundation)),
      ));
    }
    inputs.sort((left, right) => left.path.localeCompare(right.path));
  }
  const outputs = [await artifactForFile(prepared.outputDirectory, outputPath)];
  const rules = canonicalizeStylexRules([rule]);
  return {
    adapter: graph.adapter,
    compilerSha256,
    edges: [],
    entrypoints: graph.entrypoints,
    generationId: loaded.plan.generationId,
    graphId,
    inputs,
    kind: "hraness-stylex-graph-receipt",
    outputRoot: prepared.outputRoot,
    outputs,
    packages: loaded.plan.packages,
    planSha256: generation.planSha256,
    rules,
    rulesSha256: stylexRulesSha256(rules),
    schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
    state: "complete",
    target: graph.kind,
  };
}

async function seal(
  context: Fixture,
  generation: StylexGenerationHandleV1,
  graphId: string,
  rule: StylexRuleV1,
  outputPath?: string,
  outputSource?: string,
): Promise<StylexGraphReceiptV1> {
  const receipt = await receiptValue(context, generation, graphId, rule, outputPath, outputSource);
  return writeStylexGraphReceipt({ generation, receipt, rootDirectory: context.root });
}

async function finalize(context: Fixture, generation: StylexGenerationHandleV1, failAfter?: FinalizeStylexGenerationOptions["failAfter"]): Promise<string> {
  return finalizeStylexGeneration({
    ...(failAfter === undefined ? {} : { failAfter }),
    generation,
    outputDirectory: context.outputDirectory,
    rootDirectory: context.root,
  });
}

describe("compiler boundary", () => {
  test("preserves publication failures together with close and unlink cleanup failures", async () => {
    const operationError = new Error("injected publication failure");
    const closeError = new Error("injected publication close failure");
    const unlinkError = new Error("injected publication unlink failure");
    const publicationLock = "/output/.hraness-stylex-test.publish.lock";
    let failure: unknown;

    try {
      await cleanupFailedPublicationLock(
        publicationLock,
        { close: async () => { throw closeError; } },
        true,
        operationError,
        async (path) => {
          expect(path).toBe(publicationLock);
          throw unlinkError;
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toEqual([operationError, closeError, unlinkError]);
    expect(failure.cause).toBe(operationError);
    expect(failure.message).toContain(publicationLock);
  });

  test("canonicalizes rules without dropping zero or fractional priorities and rejects malformed foreign values", () => {
    const zero = ["zero", { constKey: "--zero", constVal: 0, ltr: "", rtl: null }, 0] as const satisfies StylexRuleV1;
    const fractional = ["fractional", { ltr: ".fractional{color:blue}" }, 0.4] as const satisfies StylexRuleV1;
    expect(canonicalizeStylexRules([fractional, zero], [zero])).toEqual([zero, fractional]);
    expect(canonicalJson({ z: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"z":1}');
    expect(() => parseStylexRules([["bad", { ltr: ".bad{}", extra: true }, 1]])).toThrow(/unknown keys/u);
    expect(() => parseStylexRules([["bad", { constKey: "--bad", ltr: ".bad{}" }, 1]])).toThrow(/together/u);
    expect(() => parseStylexRules([["bad", { ltr: "" }, 0]])).toThrow(/nonempty/u);
    expect(() => parseStylexRules([["bad", { constKey: "bad", constVal: 1, ltr: "" }, 0]])).toThrow(/null rtl/u);
    expect(() => parseStylexRules([["bad", { ltr: ".bad{}" }, Number.NaN]])).toThrow(/finite nonnegative/u);
    expect(() => canonicalizeStylexRules([["same", { ltr: ".a{}" }, 1]], [["same", { ltr: ".b{}" }, 1]])).toThrow(/Conflicting/u);
    expect(() => normalizeLogicalPath("../escape")).toThrow(/normalized/u);
  });

  test("collects and finalizes real defineConsts metadata with dependent rules", async () => {
    const context = await fixture();
    const inputPath = join(context.root, "src/client.stylex.ts");
    const source = [
      'import * as stylex from "@stylexjs/stylex";',
      "export const constants = stylex.defineConsts({ color: \"red\", gap: 8 });",
      "export const styles = stylex.create({ root: { color: constants.color, padding: constants.gap } });",
      "",
    ].join("\n");
    await write(inputPath, source);
    const generation = await createStylexGeneration({
      expectedGraphs: [{ adapter: "bun", entrypoints: ["src/client.stylex.ts"], id: "client", kind: "client" }],
      generationId: "real-define-consts",
      outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath)],
      rootDirectory: context.root,
    });
    const collector = createStylexTransformCollector(context.root);
    await collector.transform(source, inputPath);
    const rules = collector.seal();
    const constants = rules.filter((rule) => rule[1].constKey !== undefined);
    expect(constants).toHaveLength(2);
    expect(constants.every((rule) => rule[1].ltr === "" && rule[1].rtl === null)).toBe(true);
    expect(rules.some((rule) => rule[2] > 0 && rule[1].ltr.includes("padding:8px"))).toBe(true);

    const loaded = await loadStylexGeneration(generation);
    const graph = loaded.expectedGraph("client");
    const prepared = await prepareStylexGraph(generation, "client");
    await write(join(prepared.outputDirectory, "index.js"), "export const client = true;\n");
    await writeStylexGraphReceipt({
      generation,
      rootDirectory: context.root,
      receipt: {
        adapter: graph.adapter,
        compilerSha256,
        edges: [],
        entrypoints: graph.entrypoints,
        generationId: loaded.plan.generationId,
        graphId: graph.id,
        inputs: [await artifactForFile(context.root, graph.entrypoints[0]!)],
        kind: "hraness-stylex-graph-receipt",
        outputRoot: prepared.outputRoot,
        outputs: [await artifactForFile(prepared.outputDirectory, "index.js")],
        packages: loaded.plan.packages,
        planSha256: generation.planSha256,
        rules,
        rulesSha256: stylexRulesSha256(rules),
        schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
        state: "complete",
        target: graph.kind,
      },
    });
    const output = await finalize(context, generation);
    const css = await readFile(join(output, "stylex.css"), "utf8");
    expect(css).toMatch(/padding:\s*8px/u);
    expect(css).toMatch(/color:\s*red/u);
  });

  test("validates canonical package manifests against the package root and every bound byte", async () => {
    const context = await fixture();
    const packageJson = join(context.root, "package/package.json");
    await expect(readStylexPackageManifest(context.manifestPath)).resolves.toMatchObject({ package: { name: "@fixture/ui", version: "1.0.0" } });
    await writeFile(packageJson, '{"name":"@fixture/wrong","version":"1.0.0"}\n');
    await expect(readStylexPackageManifest(context.manifestPath)).rejects.toThrow(/package\.json identity/u);
    await writeFile(packageJson, '{"name":"@fixture/ui","version":"2.0.0"}\n');
    await expect(readStylexPackageManifest(context.manifestPath)).rejects.toThrow(/package\.json identity/u);
    await writeFile(packageJson, '{"name":"@fixture/ui","version":"1.0.0"}\n');
    await writeFile(join(context.root, "package/dist/index.js"), "mutated\n");
    await expect(readStylexPackageManifest(context.manifestPath)).rejects.toThrow(/hash|byte count/u);
    expect(() => validateStylexPackageManifest({ unknown: true })).toThrow(/unknown keys|missing/u);
  });

  test("collects raw metadata with the pinned ambient-config-free transform and seals exactly once", async () => {
    const context = await fixture();
    await write(join(context.root, ".babelrc"), "this is intentionally invalid ambient config\n");
    const modulePath = join(context.root, "src/recipe.mts");
    const source = [
      'import * as stylex from "@stylexjs/stylex";',
      "const styles = stylex.create({ root: { color: 'red' } });",
      "export const root: string = styles.root;",
      "",
    ].join("\n");
    await write(modulePath, source);
    const collector = createStylexTransformCollector(context.root);
    const transformed = await collector.transform(source, modulePath);
    expect(transformed.code).not.toContain("stylex.create");
    expect(transformed.rules.length).toBeGreaterThan(0);
    expect(collector.seal()).toEqual(canonicalizeStylexRules(transformed.rules));
    await expect(collector.transform(source, modulePath)).rejects.toThrow(/sealed/u);
    expect(() => collector.seal()).toThrow(/only once/u);
  });

  test("parses TypeScript assertions without treating non-TSX modules as JSX", async () => {
    const context = await fixture();
    const collector = createStylexTransformCollector(context.root);
    const typescriptPath = join(context.root, "src/assertion.ts");
    const tsxPath = join(context.root, "src/view.tsx");

    const typescript = await collector.transform(
      "export const value = <number>1;\n",
      typescriptPath,
    );
    const tsx = await collector.transform(
      "export const view = <div data-fixture=\"tsx\" />;\n",
      tsxPath,
    );

    expect(typescript.code).toMatch(/<number>\s*1/u);
    expect(tsx.code).toContain("<div");
    expect(collector.seal()).toEqual([]);
  });

  test("canonicalizes real transform metadata independently of transform completion order", async () => {
    const context = await fixture();
    const modules = [
      {
        id: join(context.root, "src/entry-a.stylex.ts"),
        source: [
          'import * as stylex from "@stylexjs/stylex";',
          "export const styles = stylex.create({ root: { color: { default: 'red', '@supports (display: grid)': 'blue', '@media (min-width: 1px)': 'green' } } });",
          "",
        ].join("\n"),
      },
      {
        id: join(context.root, "src/entry-b.stylex.ts"),
        source: [
          'import * as stylex from "@stylexjs/stylex";',
          "const still = stylex.keyframes({ from: { opacity: 1 }, to: { opacity: 1 } });",
          "export const styles = stylex.create({ root: { animationName: still, paddingInline: 8, '::before': { content: '\"deterministic\"' } } });",
          "",
        ].join("\n"),
      },
    ] as const;

    const collect = async (order: readonly number[]): Promise<readonly StylexRuleV1[]> => {
      const collector = createStylexTransformCollector(context.root);
      for (const index of order) {
        const module = modules[index];
        if (module === undefined) throw new Error(`Missing transform fixture at index ${String(index)}`);
        await collector.transform(module.source, module.id);
      }
      return collector.seal();
    };

    const forward = await collect([0, 1]);
    const reverse = await collect([1, 0]);
    expect(reverse).toEqual(forward);
    expect(serializeStylexRules(reverse)).toBe(serializeStylexRules(forward));
    expect(forward.some((rule) => rule[2] === 0 && rule[1].ltr.includes("@keyframes"))).toBe(true);
    expect(forward.some((rule) => rule[1].ltr.includes("@supports"))).toBe(true);
    expect(forward.some((rule) => rule[1].ltr.includes("@media"))).toBe(true);
  });

  test("rejects exact, reformatted, minified, namespaced, and registered recipe leakage", () => {
    const manifest = validateStylexPackageManifest({
      buildTools: [], compiler: compilerContract, compilerSha256, kind: "hraness-stylex-package-manifest",
      compilerFoundation: "src/compiler-foundation.css",
      package: { name: "@fixture/ui", version: "1.0.0" }, rules: [packageRule], rulesSha256: stylexRulesSha256([packageRule]),
      runtime: [], schemaVersion: 1, standaloneCss: { bytes: 0, path: "dist/stylex.css", sha256: sha256("") },
      standaloneSerializer: { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" },
      stylesheets: [{ bytes: 0, path: "src/compiler-foundation.css", sha256: sha256("") }],
    });
    expect(() => auditCssWithoutStandaloneRecipes(".foundation{display:block}", [manifest])).not.toThrow();
    for (const css of [
      ".x-package{color:red}",
      ".x-package { color: red; }",
      ".\\78-package { color: red; }",
      "@layer components.hraness-ui.priority1{.other{color:red}}",
      "@layer/* format */ components.hraness-ui.priority1;",
      "@layer components.hraness-ui.\\70 riority1;",
      "@layer components.hraness-ui { @layer priority1 { .other { color: red; } } }",
      "@layer components { @layer hraness-ui { @layer priority1 { .other { color: red; } } } }",
      "@layer components.fixture-ui.priority1{.other{color:red}}",
      "@layer components.fixture-ui { @layer priority1 { .other { color: red; } } }",
      "@layer components.fixture-ui.\\70 riority1{.other{color:red}}",
      '@import "@hraness/ui/stylex.css";',
    ]) expect(() => auditCssWithoutStandaloneRecipes(css, [manifest])).toThrow(/recipe|selector|layer|import/u);
    const registration = ["registered", { ltr: "@keyframes x-spin{to{opacity:0}}" }, 0] as const satisfies StylexRuleV1;
    expect(() => auditCssWithoutStylexRules("@keyframes x-spin { to { opacity: 0 } }", [registration])).toThrow(/registration/u);
    expect(() => auditCssWithoutStylexRules("@keyframes \\78-spin { to { opacity: 0 } }", [registration])).toThrow(/registration/u);
  });

  test("rejects obsolete Tailwind directives directly", () => {
    const manifest = validateStylexPackageManifest({
      buildTools: [], compiler: compilerContract, compilerSha256, kind: "hraness-stylex-package-manifest",
      compilerFoundation: "src/compiler-foundation.css",
      package: { name: "@fixture/ui", version: "1.0.0" }, rules: [packageRule], rulesSha256: stylexRulesSha256([packageRule]),
      runtime: [], schemaVersion: 1, standaloneCss: { bytes: 0, path: "dist/stylex.css", sha256: sha256("") },
      standaloneSerializer: { before: ["components.fixture-ui.legacy"], prefix: "components.fixture-ui" },
      stylesheets: [{ bytes: 0, path: "src/compiler-foundation.css", sha256: sha256("") }],
    });
    for (const [name, css] of [
      ["source", '@source "./";'],
      ["custom-variant", "@custom-variant dark (&:hover);"],
      ["theme", "@theme inline { --color-background: var(--ui-background); }"],
    ] as const) {
      expect(() => auditCssWithoutStandaloneRecipes(css, [manifest])).toThrow(`unsupported @${name} directive`);
      expect(() => auditCssWithoutStylexRules(css, [])).toThrow(`unsupported @${name} directive`);
    }
    expect(() => auditCssWithoutStandaloneRecipes("@unknown-directive value;", [manifest])).toThrow(/parser warnings/u);
  });

  test("keeps the upstream within-priority contract invariant to graph arrival order", () => {
    const rules = [
      ["media", { ltr: "@media (max-width:600px){.x-media{color:red}}" }, 3130],
      ["supports", { ltr: "@supports (display:grid){.x-supports{display:grid}}" }, 3130],
      ["nested", { ltr: ".x-nested:hover .child{color:blue}" }, 3130],
      ["important", { ltr: ".x-important:focus{color:green!important}" }, 3130],
      ["pseudo", { ltr: ".x-pseudo:before{content:''}" }, 8000],
    ] as const satisfies readonly StylexRuleV1[];
    const forward = serializeStylexRules(rules);
    const reverse = serializeStylexRules([...rules].reverse());
    expect(forward).toBe(reverse);
    expect(forward).toStartWith("@layer base, components;\n@layer components.hraness-ui.legacy.base, components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2;");
    for (const selector of ["x-media", "x-supports", "x-nested", "x-important", "x-pseudo"]) expect(forward).toContain(selector);
    expect(forward).toContain("!important");
    expect(forward.indexOf("x-media")).not.toBe(forward.indexOf("x-supports"));
  });

  test("declares the complete finite layer inventory before every serialized recipe block", () => {
    const css = serializeStylexRules(Array.from({ length: 5 }, (_, index) => [
      `x-priority-${String(index + 1)}`,
      { ltr: `.x-priority-${String(index + 1)}{z-index:${String(index + 1)}}` },
      (index + 1) * 1000,
    ] as const satisfies StylexRuleV1));
    expect(css).toStartWith(
      "@layer base, components;\n@layer components.hraness-ui.legacy.base, components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2, components.hraness-ui.priority3, components.hraness-ui.priority4, components.hraness-ui.priority5;",
    );
    expect(css.indexOf("@layer components.hraness-ui.priority1 {")).toBeGreaterThan(css.indexOf("priority5;"));
    expect(serializeStylexRules([])).toBe(
      "@layer base, components;\n@layer components.hraness-ui.legacy.base, components.hraness-ui.legacy;\n",
    );
  });
});

describe("generation lifecycle", () => {
  test("finalizes identical bytes across entry, package-manifest, and client/SSR arrival permutations", async () => {
    const context = await fixture();
    const secondManifest = await packageAt(
      context.root,
      "second-package",
      "purple",
      "@fixture/second-ui",
      "2.0.0",
      "x-second-package",
    );
    for (const path of ["src/client-a.ts", "src/client-b.ts", "src/server.ts"]) {
      await write(join(context.root, path), `export const marker = ${JSON.stringify(path)};\n`);
    }

    const buildPermutation = async (
      generationId: string,
      reverse: boolean,
    ): Promise<{
      client: string;
      css: string;
      entrypoints: readonly string[];
      graphIds: readonly string[];
      packages: readonly string[];
      server: string;
    }> => {
      const clientEntrypoints = reverse
        ? ["src/client-b.ts", "src/client-a.ts"]
        : ["src/client-a.ts", "src/client-b.ts"];
      const graphs = [
        { adapter: "bun" as const, entrypoints: clientEntrypoints, id: "client", kind: "client" as const },
        { adapter: "bun" as const, entrypoints: ["src/server.ts"], id: "server", kind: "ssr" as const },
      ];
      const manifests = [
        logical(context.root, context.manifestPath),
        logical(context.root, secondManifest),
      ];
      const generation = await createStylexGeneration({
        expectedGraphs: reverse ? [...graphs].reverse() : graphs,
        generationId,
        outputDirectory: context.outputDirectory,
        packageManifests: reverse ? [...manifests].reverse() : manifests,
        rootDirectory: context.root,
      });
      const loaded = await loadStylexGeneration(generation);
      const arrivals = reverse ? ["server", "client"] : ["client", "server"];
      for (const graphId of arrivals) {
        await seal(
          context,
          generation,
          graphId,
          graphId === "client" ? clientRule : serverRule,
        );
      }
      const output = await finalize(context, generation);
      return {
        client: await readFile(join(output, "graphs/client/index.js"), "utf8"),
        css: await readFile(join(output, "stylex.css"), "utf8"),
        entrypoints: loaded.expectedGraph("client").entrypoints,
        graphIds: loaded.plan.expectedGraphs.map(({ id }) => id),
        packages: loaded.plan.packages.map(({ name }) => name),
        server: await readFile(join(output, "graphs/server/index.js"), "utf8"),
      };
    };

    const forward = await buildPermutation("order-forward", false);
    const reverse = await buildPermutation("order-reverse", true);
    expect(reverse).toEqual(forward);
    expect(forward.entrypoints).toEqual(["src/client-a.ts", "src/client-b.ts"]);
    expect(forward.graphIds).toEqual(["client", "server"]);
    expect([...forward.packages].sort()).toEqual(["@fixture/second-ui", "@fixture/ui"]);
    for (const marker of ["x-package", "x-second-package", "x-client", "x-server"]) {
      expect(forward.css).toContain(marker);
    }
    expect(forward.css).toContain("components.hraness-ui.priority1");
    expect(forward.css).not.toContain("components.fixture-ui.priority");
    expect(forward.css).not.toContain("components.fixture-second-ui.priority");
  });

  test("unions package, client, and SSR metadata once and publishes collision-safe graph trees deterministically", async () => {
    const context = await fixture();
    const graphSet = [["server", "ssr"], ["client", "client"]] as const;
    const first = await create(context, "union-a", graphSet, true);
    await seal(context, first, "server", serverRule);
    await seal(context, first, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
    const firstOutput = await finalize(context, first);

    const second = await create(context, "union-b", [...graphSet].reverse(), true);
    await seal(context, second, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
    await seal(context, second, "server", serverRule);
    const secondOutput = await finalize(context, second);

    const firstCss = await readFile(join(firstOutput, "assets/recipes.css"), "utf8");
    const secondCss = await readFile(join(secondOutput, "assets/recipes.css"), "utf8");
    expect(firstCss).toBe(secondCss);
    for (const name of ["x-package", "x-client", "x-server"]) expect(firstCss).toContain(name);
    expect(await Bun.file(join(firstOutput, "graphs/client/foundation.css")).exists()).toBe(true);
    expect(await Bun.file(join(firstOutput, "graphs/server/index.js")).exists()).toBe(true);
    expect(await readFile(join(firstOutput, "index.html"), "utf8")).toContain('href="assets/recipes.css"');
    const completeSource = await readFile(join(firstOutput, "stylex-complete.json"), "utf8");
    const complete = JSON.parse(completeSource) as { artifacts: { path: string }[]; state: string };
    expect(completeSource).toBe(`${canonicalJson(complete)}\n`);
    expect(complete.state).toBe("complete");
    expect(complete.artifacts.map(({ path }) => path)).toEqual([
      "graphs/client/foundation.css",
      "graphs/server/index.js",
      "index.html",
    ]);
    expect(completeSource).not.toContain(context.root);
    expect(await pathExists(first.directory)).toBe(false);
  });

  test("rejects recipe CSS copied from a sibling graph while allowing unrelated graph CSS", async () => {
    const context = await fixture();
    const graphs = [["client", "client"], ["server", "ssr"]] as const;
    const leaking = await create(context, "cross-graph-recipe-leak", graphs);
    await seal(context, leaking, "client", clientRule, "copied.css", `${serverRule[1].ltr}\n`);
    await seal(context, leaking, "server", serverRule);
    await expect(finalize(context, leaking)).rejects.toThrow(/Graph client contains standalone recipe selector x-server/u);
    expect(await pathExists(join(context.outputDirectory, "cross-graph-recipe-leak"))).toBe(false);

    const clean = await create(context, "cross-graph-clean-control", graphs);
    const foundationCss = ".client-foundation{display:flow-root}\n";
    await seal(context, clean, "client", clientRule, "foundation.css", foundationCss);
    await seal(context, clean, "server", serverRule);
    const cleanOutput = await finalize(context, clean);
    expect(await readFile(join(cleanOutput, "graphs/client/foundation.css"), "utf8")).toBe(foundationCss);
    const cleanRecipes = await readFile(join(cleanOutput, "stylex.css"), "utf8");
    expect(cleanRecipes).toContain("x-client");
    expect(cleanRecipes).toContain("x-server");
  });

  test("rejects duplicate package names across divergent manifests or versions", async () => {
    const context = await fixture();
    const divergent = await packageAt(context.root, "divergent-package", "blue");
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")],
      generationId: "divergent-package",
      outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath), logical(context.root, divergent)],
      rootDirectory: context.root,
    })).rejects.toThrow(/more than one identity/iu);
    const secondVersion = await packageAt(
      context.root,
      "second-version-package",
      "red",
      "@fixture/ui",
      "2.0.0",
    );
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")],
      generationId: "second-version-package",
      outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath), logical(context.root, secondVersion)],
      rootDirectory: context.root,
    })).rejects.toThrow(/more than one identity/iu);
  });

  test("rejects overlapping standalone package namespaces", async () => {
    const context = await fixture();
    const same = await packageAt(
      context.root,
      "same-prefix-package",
      "blue",
      "@fixture/other-ui",
      "1.0.0",
      "x-other-package",
      "components.fixture-ui",
    );
    const descendant = await packageAt(
      context.root,
      "descendant-prefix-package",
      "green",
      "@fixture/nested-ui",
      "1.0.0",
      "x-nested-package",
      "components.fixture-ui.nested",
    );
    for (const [generationId, manifestPath] of [
      ["same-prefix", same],
      ["descendant-prefix", descendant],
    ] as const) {
      await expect(createStylexGeneration({
        expectedGraphs: [expectedGraph("client")],
        generationId,
        outputDirectory: context.outputDirectory,
        packageManifests: [logical(context.root, context.manifestPath), logical(context.root, manifestPath)],
        rootDirectory: context.root,
      })).rejects.toThrow(/overlapping standalone StyleX namespaces/u);
    }
  });

  test("requires every registered package foundation in a template stylesheet graph and rechecks receipts", async () => {
    const context = await fixture();
    const secondManifest = await packageAt(
      context.root,
      "second-package",
      "purple",
      "@fixture/second-ui",
      "2.0.0",
      "x-second-package",
    );
    await write(join(context.root, "src/client.ts"), "export const client = true;\n");
    const createTwoPackageGeneration = (generationId: string) => createStylexGeneration({
      expectedGraphs: [expectedGraph("client")],
      generationId,
      outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath), logical(context.root, secondManifest)],
      rootDirectory: context.root,
      templates: [{
        cssHref: "stylex.css",
        outputPath: "index.html",
        sourcePath: logical(context.root, context.templatePath),
        stylesheetGraphId: "client",
      }],
    });

    const canonicalPrimaryFoundation = "package/src/compiler-foundation.css";
    const primaryFoundationSource = await readFile(
      join(context.root, canonicalPrimaryFoundation),
      "utf8",
    );
    const aliasedFoundation = "node_modules/@fixture/ui/src/compiler-foundation.css";
    await write(join(context.root, aliasedFoundation), primaryFoundationSource);
    const aliased = await createTwoPackageGeneration("aliased-primary-foundation");
    const aliasedReceipt = await receiptValue(
      context,
      aliased,
      "client",
      clientRule,
      "foundation.css",
      ".foundation { display: block; }\n",
    );
    const aliasedArtifact = await artifactForFile(context.root, aliasedFoundation);
    await expect(writeStylexGraphReceipt({
      generation: aliased,
      receipt: {
        ...aliasedReceipt,
        inputs: aliasedReceipt.inputs.map((input) =>
          input.path === canonicalPrimaryFoundation ? aliasedArtifact : input
        ),
      },
      rootDirectory: context.root,
    })).resolves.toMatchObject({ graphId: "client" });
    await expect(finalize(context, aliased)).resolves.toBe(
      join(context.outputDirectory, "aliased-primary-foundation"),
    );

    const mismatchedFoundation =
      "nested/node_modules/@fixture/ui/src/compiler-foundation.css";
    await write(join(context.root, mismatchedFoundation), ".foundation{display:grid}\n");
    const mismatched = await createTwoPackageGeneration("mismatched-aliased-foundation");
    const mismatchedReceipt = await receiptValue(
      context,
      mismatched,
      "client",
      clientRule,
      "foundation.css",
      ".foundation { display: block; }\n",
    );
    const mismatchedArtifact = await artifactForFile(context.root, mismatchedFoundation);
    await expect(writeStylexGraphReceipt({
      generation: mismatched,
      receipt: {
        ...mismatchedReceipt,
        inputs: mismatchedReceipt.inputs.map((input) =>
          input.path === canonicalPrimaryFoundation ? mismatchedArtifact : input
        ),
      },
      rootDirectory: context.root,
    })).rejects.toThrow(/compiler foundation differs from @fixture\/ui/u);

    const missing = await createTwoPackageGeneration("missing-second-foundation");
    const missingReceipt = await receiptValue(
      context,
      missing,
      "client",
      clientRule,
      "foundation.css",
      ".foundation { display: block; }\n",
    );
    const withoutSecond = missingReceipt.inputs.filter(({ path }) => !path.includes("second-package/src/compiler-foundation.css"));
    expect(withoutSecond).toHaveLength(missingReceipt.inputs.length - 1);
    await expect(writeStylexGraphReceipt({
      generation: missing,
      receipt: { ...missingReceipt, inputs: withoutSecond },
      rootDirectory: context.root,
    })).rejects.toThrow(/compiler foundation for @fixture\/second-ui/u);

    const tampered = await createTwoPackageGeneration("tampered-second-foundation");
    const sealed = await seal(
      context,
      tampered,
      "client",
      clientRule,
      "foundation.css",
      ".foundation { display: block; }\n",
    );
    const receiptPath = join(tampered.directory, ".stylex-generation/receipts/client.json");
    await writeFile(receiptPath, `${canonicalJson({
      ...sealed,
      inputs: sealed.inputs.filter(({ path }) => !path.includes("second-package/src/compiler-foundation.css")),
    })}\n`);
    await expect(finalize(context, tampered)).rejects.toThrow(/compiler foundation for @fixture\/second-ui/u);
  });

  test("rejects missing and unexpected receipts, then fences late graph work", async () => {
    const context = await fixture();
    const missing = await create(context, "missing", [["client", "client"], ["server", "ssr"]]);
    await seal(context, missing, "client", clientRule);
    await expect(finalize(context, missing)).rejects.toThrow(/missing or unexpected/u);
    await expect(receiptValue(context, missing, "server", serverRule)).rejects.toThrow(/late|finalization/u);

    const unexpected = await create(context, "unexpected");
    await seal(context, unexpected, "client", clientRule);
    await write(join(unexpected.directory, ".stylex-generation/receipts/extra.json"), "{}\n");
    await expect(finalize(context, unexpected)).rejects.toThrow(/missing or unexpected/u);
  });

  test("rejects duplicate, malformed, and stale graph receipts without publishing", async () => {
    const context = await fixture();
    const duplicate = await create(context, "duplicate");
    const receipt = await seal(context, duplicate, "client", clientRule);
    await expect(writeStylexGraphReceipt({ generation: duplicate, receipt, rootDirectory: context.root })).rejects.toThrow();
    expect(await readdir(join(duplicate.directory, ".stylex-generation/receipts"))).toEqual(["client.json"]);
    await expect(finalize(context, duplicate)).resolves.toBe(join(context.outputDirectory, "duplicate"));

    const malformed = await create(context, "malformed");
    const malformedReceipt = await receiptValue(context, malformed, "client", clientRule);
    await expect(writeStylexGraphReceipt({
      generation: malformed,
      receipt: { ...malformedReceipt, unknown: true },
      rootDirectory: context.root,
    })).rejects.toThrow(/unknown keys/u);

    for (const [index, externalPath] of ["FILE:///tmp/outside.js", "C:/outside.js"].entries()) {
      const unsafeExternal = await create(context, `unsafe-external-${String(index)}`);
      const unsafeReceipt = await receiptValue(context, unsafeExternal, "client", clientRule);
      await expect(writeStylexGraphReceipt({
        generation: unsafeExternal,
        receipt: {
          ...unsafeReceipt,
          edges: [{
            external: true,
            from: "$entry",
            kind: "import-statement",
            to: `external:${externalPath}`,
          }],
        },
        rootDirectory: context.root,
      })).rejects.toThrow(/external payload must not identify a local path/u);
    }

    const staleRuleHash = await create(context, "stale-rule-hash");
    const staleRuleReceipt = await receiptValue(context, staleRuleHash, "client", clientRule);
    await expect(writeStylexGraphReceipt({
      generation: staleRuleHash,
      receipt: { ...staleRuleReceipt, rulesSha256: "0".repeat(64) },
      rootDirectory: context.root,
    })).rejects.toThrow(/rule hash is stale/u);

    const staleInput = await create(context, "stale-input");
    await seal(context, staleInput, "client", clientRule);
    await writeFile(join(context.root, "src/client.ts"), "export const client = 'changed';\n");
    await expect(finalize(context, staleInput)).rejects.toThrow(/changed|Artifact/u);
  });

  test("runs graph receipt precommit revalidation under the mutation lock and leaves a failed receipt retryable", async () => {
    const context = await fixture();
    const generation = await create(context, "precommit-revalidation");
    const receipt = await receiptValue(context, generation, "client", clientRule);
    const mutationLock = join(generation.directory, ".stylex-generation/mutation.lock");
    const receiptDirectory = join(generation.directory, ".stylex-generation/receipts");
    let revalidated = false;

    await expect(writeStylexGraphReceipt({
      generation,
      receipt,
      revalidateBeforeCommit: async () => {
        revalidated = true;
        expect(await pathExists(mutationLock)).toBe(true);
        const precommitEntries = await readdir(receiptDirectory);
        expect(precommitEntries).toHaveLength(1);
        expect(precommitEntries[0]).toMatch(/^\.client\.json\.[0-9a-f-]+\.tmp$/u);
        expect(precommitEntries).not.toContain("client.json");
        throw new Error("injected precommit revalidation failure");
      },
      rootDirectory: context.root,
    })).rejects.toThrow(/injected precommit revalidation failure/u);

    expect(revalidated).toBe(true);
    expect(await pathExists(mutationLock)).toBe(false);
    expect(await readdir(receiptDirectory)).toEqual([]);
    await expect(writeStylexGraphReceipt({
      generation,
      receipt,
      rootDirectory: context.root,
    })).resolves.toEqual(receipt);
    expect(await readdir(receiptDirectory)).toEqual(["client.json"]);
  });

  test("rejects conflicting package and graph rules before serialization can publish", async () => {
    const context = await fixture();
    const generation = await create(context, "conflicting-union");
    const conflict = ["x-package", { ltr: ".x-package{color:blue}" }, 1000] as const satisfies StylexRuleV1;
    await seal(context, generation, "client", conflict);
    await expect(finalize(context, generation)).rejects.toThrow(/Conflicting StyleX rule/u);
    expect(await pathExists(join(context.outputDirectory, "conflicting-union"))).toBe(false);
    expect(await pathExists(generation.directory)).toBe(true);
  });

  test("rejects unlisted, changed, and mixed graph outputs", async () => {
    const context = await fixture();
    const unlisted = await create(context, "unlisted");
    const unlistedReceipt = await receiptValue(context, unlisted, "client", clientRule);
    await write(join(unlisted.directory, unlistedReceipt.outputRoot, "extra.js"), "extra\n");
    await expect(writeStylexGraphReceipt({ generation: unlisted, receipt: unlistedReceipt, rootDirectory: context.root })).rejects.toThrow(/inventory/u);

    const stale = await create(context, "stale-output");
    const staleReceipt = await seal(context, stale, "client", clientRule);
    await writeFile(join(stale.directory, staleReceipt.outputRoot, "index.js"), "changed\n");
    await expect(finalize(context, stale)).rejects.toThrow(/changed|Artifact/u);

    const mixed = await create(context, "mixed-output");
    const mixedReceipt = await receiptValue(context, mixed, "client", clientRule, "bundle.css", ".x-client { display: block; }\n");
    await expect(writeStylexGraphReceipt({ generation: mixed, receipt: mixedReceipt, rootDirectory: context.root })).rejects.toThrow(/selector|recipe/u);

    const unexpectedPayload = await create(context, "unexpected-payload");
    await seal(context, unexpectedPayload, "client", clientRule);
    await write(join(unexpectedPayload.directory, "payload/stale.txt"), "stale\n");
    await expect(finalize(context, unexpectedPayload)).rejects.toThrow(/payload contains stale or unexpected/u);
  });

  test("rebinds every receipt filename, graph ID, and output root before publication", async () => {
    const context = await fixture();
    const crossCopied = await create(context, "cross-copied-receipt", [["client", "client"], ["server", "ssr"]]);
    await seal(context, crossCopied, "client", clientRule);
    await seal(context, crossCopied, "server", serverRule);
    const receiptsRoot = join(crossCopied.directory, ".stylex-generation/receipts");
    const serverReceipt = await readFile(join(receiptsRoot, "server.json"), "utf8");
    await writeFile(join(receiptsRoot, "client.json"), serverReceipt);
    await expect(finalize(context, crossCopied)).rejects.toThrow(/filename does not match graph ID/u);

    const changedRoot = await create(context, "changed-output-root");
    await seal(context, changedRoot, "client", clientRule);
    const receiptPath = join(changedRoot.directory, ".stylex-generation/receipts/client.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as StylexGraphReceiptV1;
    await writeFile(receiptPath, `${canonicalJson({ ...receipt, outputRoot: "graphs/other/output" })}\n`);
    await expect(finalize(context, changedRoot)).rejects.toThrow(/outputRoot is not the owned staging root/u);
  });

  test("revalidates package artifacts and registered templates immediately before publication", async () => {
    const context = await fixture();
    const packageChanged = await create(context, "package-changed");
    await seal(context, packageChanged, "client", clientRule);
    await writeFile(join(context.root, "package/dist/index.js"), "changed\n");
    await expect(finalize(context, packageChanged)).rejects.toThrow(/hash|byte count/u);

    await writeFile(join(context.root, "package/dist/index.js"), "export const runtime = true;\n");
    const templateChanged = await create(context, "template-changed", [["client", "client"]], true);
    await seal(context, templateChanged, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
    await writeFile(context.templatePath, `<html>${STYLEX_TEMPLATE_CSS_PLACEHOLDER} changed</html>\n`);
    await expect(finalize(context, templateChanged)).rejects.toThrow(/Template input changed/u);
  });

  test("binds a post-receipt rendered template in the immutable plan and publishes its rendered bytes", async () => {
    const context = await fixture();
    const graphTemplate: StylexTemplateV1 = {
      cssHref: "stylex.css",
      graphId: "server",
      outputPath: "index.html",
      sourcePath: "ssr/index.html",
      stylesheetGraphId: "server",
    };
    const generation = await create(context, "graph-template", [["server", "ssr"]], false, [graphTemplate]);
    const source = `<html><head><link rel="stylesheet" href="/graphs/server/foundation.css"><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"></head><body>SSR</body></html>\n`;
    await seal(
      context,
      generation,
      "server",
      serverRule,
      "foundation.css",
      ".foundation { display: block; }\n",
    );
    const prepared = await prepareStylexProducedTemplate(generation, graphTemplate.outputPath);
    await write(prepared.sourcePath, source);
    await sealStylexProducedTemplate(generation, graphTemplate.outputPath);
    const output = await finalize(context, generation);
    expect(await readFile(join(output, "index.html"), "utf8")).toBe(source.replace(STYLEX_TEMPLATE_CSS_PLACEHOLDER, graphTemplate.cssHref));
    expect(await pathExists(join(output, "graphs/server/foundation.css"))).toBe(true);
  });

  test("requires every graph stylesheet exactly once in produced templates", async () => {
    const context = await fixture();
    const graphTemplate: StylexTemplateV1 = {
      cssHref: "stylex.css",
      graphId: "server",
      outputPath: "index.html",
      sourcePath: "ssr/index.html",
      stylesheetGraphId: "client",
    };
    const prepare = async (generationId: string, linkedStylesheets: readonly string[]) => {
      const generation = await create(
        context,
        generationId,
        [["client", "client"], ["server", "ssr"]],
        false,
        [graphTemplate],
      );
      const receipt = await receiptValue(
        context,
        generation,
        "client",
        clientRule,
        "foundation-a.css",
        ".foundation-a { display: block; }\n",
      );
      const graphRoot = join(generation.directory, ...receipt.outputRoot.split("/"));
      await write(join(graphRoot, "foundation-b.css"), ".foundation-b { display: contents; }\n");
      const outputs = [
        ...receipt.outputs,
        await artifactForFile(graphRoot, "foundation-b.css"),
      ].sort((left, right) => left.path.localeCompare(right.path));
      await writeStylexGraphReceipt({
        generation,
        receipt: { ...receipt, outputs },
        rootDirectory: context.root,
      });
      await seal(context, generation, "server", serverRule);
      const prepared = await prepareStylexProducedTemplate(generation, graphTemplate.outputPath);
      await write(
        prepared.sourcePath,
        `<html><head>${linkedStylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"></head><body>SSR</body></html>\n`,
      );
      await sealStylexProducedTemplate(generation, graphTemplate.outputPath);
      return generation;
    };

    const missing = await prepare("graph-template-missing-css", [
      "/graphs/client/foundation-a.css",
    ]);
    await expect(finalize(context, missing)).rejects.toThrow(/every graph stylesheet|exactly once|missing/u);

    const duplicate = await prepare("graph-template-duplicate-css", [
      "/graphs/client/foundation-a.css",
      "/graphs/client/foundation-b.css",
      "/graphs/client/foundation-b.css",
    ]);
    await expect(finalize(context, duplicate)).rejects.toThrow(/exactly once|duplicate/u);

    const complete = await prepare("graph-template-complete-css", [
      "/graphs/client/foundation-b.css",
      "/graphs/client/foundation-a.css",
    ]);
    const output = await finalize(context, complete);
    const html = await readFile(join(output, "index.html"), "utf8");
    expect(html.match(/graphs\/client\/foundation-a\.css/gu)).toHaveLength(1);
    expect(html.match(/graphs\/client\/foundation-b\.css/gu)).toHaveLength(1);
    expect(html.match(/href="stylex\.css"/gu)).toHaveLength(1);
  });

  test("requires every graph stylesheet to precede the finalized CSS link", async () => {
    const context = await fixture();
    const run = async (generationId: string, source: string, secondStylesheet: boolean) => {
      await writeFile(context.templatePath, source);
      const generation = await create(context, generationId, [["client", "client"]], true);
      const receipt = await receiptValue(
        context,
        generation,
        "client",
        clientRule,
        "foundation-a.css",
        ".foundation-a { display: block; }\n",
      );
      if (secondStylesheet) {
        const graphRoot = join(generation.directory, ...receipt.outputRoot.split("/"));
        await write(join(graphRoot, "foundation-b.css"), ".foundation-b { display: contents; }\n");
        await writeStylexGraphReceipt({
          generation,
          receipt: {
            ...receipt,
            outputs: [
              ...receipt.outputs,
              await artifactForFile(graphRoot, "foundation-b.css"),
            ].sort((left, right) => left.path.localeCompare(right.path)),
          },
          rootDirectory: context.root,
        });
      } else {
        await writeStylexGraphReceipt({ generation, receipt, rootDirectory: context.root });
      }
      return generation;
    };

    const finalFirst = await run(
      "template-final-first",
      `<html><head><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/graphs/client/foundation-a.css"></head></html>\n`,
      false,
    );
    await expect(finalize(context, finalFirst)).rejects.toThrow(/must precede the finalized CSS/u);

    const finalBetween = await run(
      "template-final-between",
      `<html><head><link rel="stylesheet" href="/graphs/client/foundation-a.css"><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/graphs/client/foundation-b.css"></head></html>\n`,
      true,
    );
    await expect(finalize(context, finalBetween)).rejects.toThrow(/must precede the finalized CSS/u);
  });

  test("requires the declared stylesheet graph for prepared templates", async () => {
    const context = await fixture();
    await writeFile(
      context.templatePath,
      `<html><head><link href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}" rel="stylesheet"></head></html>\n`,
    );
    const missing = await create(context, "prepared-template-missing-css", [["client", "client"]], true);
    await seal(context, missing, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
    await expect(finalize(context, missing)).rejects.toThrow(/required graph stylesheet exactly once/u);

    await writeFile(
      context.templatePath,
      `<html><head><link href="/graphs/client/foundation.css" rel="stylesheet"><link href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}" rel="stylesheet"></head></html>\n`,
    );
    const complete = await create(context, "prepared-template-complete-css", [["client", "client"]], true);
    await seal(context, complete, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
    const output = await finalize(context, complete);
    const html = await readFile(join(output, "index.html"), "utf8");
    expect(html.match(/graphs\/client\/foundation\.css/gu)).toHaveLength(1);
    expect(html.match(/href="assets\/recipes\.css"/gu)).toHaveLength(1);
  });

  test("rejects missing, graph-output-aliased, drifted, and stale post-receipt templates", async () => {
    const context = await fixture();
    const declared = (generationId: string) => create(context, generationId, [["server", "ssr"]], false, [{
      cssHref: "stylex.css", graphId: "server", outputPath: "index.html", sourcePath: "ssr/index.html", stylesheetGraphId: "server",
    }]);

    const missing = await declared("graph-template-missing");
    await seal(context, missing, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
    const missingPrepared = await prepareStylexProducedTemplate(missing, "index.html");
    expect(await pathExists(missingPrepared.sourcePath)).toBe(false);
    await expect(sealStylexProducedTemplate(missing, "index.html")).rejects.toThrow(/empty directory|ENOENT|inventory/u);
    await expect(finalize(context, missing)).rejects.toThrow(/receipts are missing/u);

    const aliased = await create(context, "graph-template-aliased", [["server", "ssr"]], false, [{
      cssHref: "stylex.css", graphId: "server", outputPath: "index.html", sourcePath: "foundation.css", stylesheetGraphId: "server",
    }]);
    await seal(context, aliased, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
    await expect(prepareStylexProducedTemplate(aliased, "index.html")).rejects.toThrow(/must not alias/u);

    const drifted = await declared("graph-template-drifted");
    await seal(context, drifted, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
    const driftedPrepared = await prepareStylexProducedTemplate(drifted, "index.html");
    await write(driftedPrepared.sourcePath, `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`);
    await sealStylexProducedTemplate(drifted, "index.html");
    await writeFile(driftedPrepared.sourcePath, "changed\n");
    await expect(finalize(context, drifted)).rejects.toThrow(/changed|Artifact/u);

    const stale = await declared("graph-template-stale");
    await seal(context, stale, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
    const stalePrepared = await prepareStylexProducedTemplate(stale, "index.html");
    await write(stalePrepared.sourcePath, `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="@hraness/ui/stylex.css">\n`);
    await sealStylexProducedTemplate(stale, "index.html");
    await expect(finalize(context, stale)).rejects.toThrow(/unregistered stylesheet/u);

    for (const [generationId, source] of [
      ["graph-template-unquoted", `<link rel=stylesheet href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-renamed-stale", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/recipes-v1.css">\n`],
      ["graph-template-unknown-stylesheet", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/theme.css">\n`],
      ["graph-template-commented", `<!-- <link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"> -->\n`],
      ["graph-template-script-string", `<script>const example = '<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">'</script>\n`],
      ["graph-template-self-closing-script", `<script src="/runtime.js"/><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-self-closing-iframe", `<iframe src="/frame.html"/><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-plaintext", `<plaintext><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-percent-path", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/%2e%2e/stylex.css">\n`],
      ["graph-template-base", `<base href="/other/"><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-disabled", `<link disabled rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-media", `<link media="not all" rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["graph-template-inline-style", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><style>@import "@hraness/ui/stylex.css";</style>\n`],
      ["graph-template-noscript-style", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><noscript><link rel="stylesheet" href="/recipes-v1.css"></noscript>\n`],
      ["graph-template-encoded-rel", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="style&#x73;heet" href="/recipes-v1.css">\n`],
      ["graph-template-encoded-href", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="&#47;recipes-v1.css">\n`],
      ["graph-template-encoded-type", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}" type="text&sol;css">\n`],
    ] as const) {
      const generation = await declared(generationId);
      await seal(context, generation, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
      const prepared = await prepareStylexProducedTemplate(generation, "index.html");
      await write(prepared.sourcePath, source);
      await sealStylexProducedTemplate(generation, "index.html");
      await expect(finalize(context, generation)).rejects.toThrow(
        generationId.endsWith("unquoted")
          ? /quoted rel/u
          : generationId.endsWith("renamed-stale") || generationId.endsWith("unknown-stylesheet")
            ? /unregistered stylesheet/u
            : generationId.includes("self-closing-")
              ? /self-closing (?:iframe|script)/u
              : generationId.endsWith("plaintext")
                ? /plaintext elements/u
              : generationId.endsWith("percent-path")
                ? /unencoded local path/u
                : generationId.endsWith("base")
                  ? /base element/u
                  : generationId.endsWith("disabled")
                    ? /disabled/u
                    : generationId.endsWith("media")
                      ? /conditional/u
                      : generationId.endsWith("inline-style")
                        ? /inline style/u
                        : generationId.endsWith("noscript-style")
                          ? /noscript/u
                          : generationId.includes("encoded-")
                            ? /character references/u
                            : /finalized CSS exactly once/u,
      );
    }
  }, 30_000);

  test("rejects character-reference link attributes in prepared templates", async () => {
    const context = await fixture();
    for (const [generationId, source] of [
      ["prepared-encoded-rel", `<link rel="style&#115;heet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`],
      ["prepared-encoded-href", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}&#x3f;stale">\n`],
      ["prepared-encoded-type", `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}" type="text&#47;css">\n`],
    ] as const) {
      await writeFile(context.templatePath, source);
      const generation = await create(context, generationId, [["client", "client"]], true);
      await seal(context, generation, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
      await expect(finalize(context, generation)).rejects.toThrow(/character references/u);
    }
  });

  test("matches browser tokenization for registered template tags and link attributes", async () => {
    const context = await fixture();
    const declared = (generationId: string) => create(context, generationId, [["server", "ssr"]], false, [{
      cssHref: "stylex.css", graphId: "server", outputPath: "index.html", sourcePath: "ssr/index.html", stylesheetGraphId: "server",
    }]);
    for (const [generationId, source, expected] of [
      [
        "quoted-fake-attributes",
        `<link data-note=' rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"'><link rel="stylesheet" href="/foundation.css">\n`,
        /quoted rel/u,
      ],
      [
        "tag-name-boundary",
        `<template=x><link rel="stylesheet" href="/unregistered.css"></template><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /malformed markup/u,
      ],
      [
        "mismatched-inert-close",
        `<template></noscript><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css"></template>\n`,
        /mismatched noscript/u,
      ],
      [
        "raw-text-spaced-close",
        `<script></ script><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /unterminated script/u,
      ],
      [
        "raw-text-attributed-close",
        `<script></script data-note="closed"><link rel="stylesheet" href="/unregistered.css"></script><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /noncanonical script closing element/u,
      ],
      [
        "raw-text-solidus-close",
        `<script></script/><link rel="stylesheet" href="/unregistered.css"></script><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /noncanonical script closing element/u,
      ],
      [
        "non-html-rel-whitespace",
        `<link rel="stylesheet\u00a0" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /finalized CSS exactly once/u,
      ],
      [
        "malformed-tag-quote-swallow",
        `<foo"><link rel="stylesheet" href="/unregistered.css"><bar"><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /malformed markup/u,
      ],
      [
        "nested-link-in-malformed-tag",
        `<foo=<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">><link rel="stylesheet" href="/foundation.css">\n`,
        /malformed markup/u,
      ],
      [
        "nested-link-in-bogus-comment",
        `<!bogus <link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">><link rel="stylesheet" href="/foundation.css">\n`,
        /malformed markup/u,
      ],
      [
        "non-ascii-raw-close",
        `<script></ſcript><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /unterminated script/u,
      ],
      [
        "noncanonical-comment-close",
        `<!-- --!><link rel="stylesheet" href="/unregistered.css"><!-- --><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /noncanonical HTML comment close/u,
      ],
      [
        "abrupt-comment-close",
        `<!--><link rel="stylesheet" href="/unregistered.css"><!-- --><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /noncanonical HTML comment close/u,
      ],
      [
        "abrupt-dash-comment-close",
        `<!---><link rel="stylesheet" href="/unregistered.css"><!-- --><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /noncanonical HTML comment close/u,
      ],
      [
        "declarative-shadow-link",
        `<div><template shadowrootmode="open"><link rel="stylesheet" href="/unregistered.css"></template></div><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /declarative shadow roots/u,
      ],
      [
        "svg-namespace-phantom-link",
        `<svg><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"></link></svg><link rel="stylesheet" href="/foundation.css">\n`,
        /HTML-namespace/u,
      ],
      [
        "svg-unquoted-solidus-phantom-link",
        `<svg data=x/><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"></svg><link rel="stylesheet" href="/foundation.css">\n`,
        /HTML-namespace/u,
      ],
      [
        "select-mode-phantom-link",
        `<select><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"></select><link rel="stylesheet" href="/foundation.css">\n`,
        /select insertion mode/u,
      ],
      [
        "select-reprocessed-active-link",
        `<select><iframe><input><link rel="stylesheet" href="/unregistered.css"></iframe></select><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /unregistered stylesheet/u,
      ],
      [
        "after-frameset-ignored-links",
        `<frameset></frameset><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /finalized CSS exactly once/u,
      ],
      [
        "script-double-escaped-links",
        `<script><!--<script></script><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css"></script>`,
        /finalized CSS exactly once/u,
      ],
      [
        "svg-active-style",
        `<svg><style>@import "/unregistered.css";</style></svg><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><link rel="stylesheet" href="/foundation.css">\n`,
        /active inline style/u,
      ],
    ] as const) {
      const generation = await declared(generationId);
      await seal(context, generation, "server", serverRule, "foundation.css", ".foundation { display: block; }\n");
      const prepared = await prepareStylexProducedTemplate(generation, "index.html");
      await write(prepared.sourcePath, source);
      await sealStylexProducedTemplate(generation, "index.html");
      await expect(finalize(context, generation)).rejects.toThrow(expected);
    }
  }, 30_000);

  test("rejects unsafe paths, malformed handles, bad template links, and existing outputs", async () => {
    const context = await fixture();
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "unsafe", outputDirectory: context.outputDirectory,
      packageManifests: ["../manifest.json"], rootDirectory: context.root,
    })).rejects.toThrow(/normalized/u);
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "bad-template", outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath)], rootDirectory: context.root,
      finalCssPath: "stylex.css", templates: [{ cssHref: "other.css", outputPath: "index.html", sourcePath: logical(context.root, context.templatePath), stylesheetGraphId: "client" }],
    })).rejects.toThrow(/link the exact final CSS/u);
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "encoded-template", outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath)], rootDirectory: context.root,
      finalCssPath: "%2e%2e/stylex.css", templates: [{ cssHref: "%2e%2e/stylex.css", outputPath: "index.html", sourcePath: logical(context.root, context.templatePath), stylesheetGraphId: "client" }],
    })).rejects.toThrow(/unencoded local path/u);
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "space-padded-template", outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath)], rootDirectory: context.root,
      finalCssPath: " stylex.css ", templates: [{ cssHref: " stylex.css ", outputPath: "index.html", sourcePath: logical(context.root, context.templatePath), stylesheetGraphId: "client" }],
    })).rejects.toThrow(/unencoded local path/u);
    await expect(loadStylexGeneration({ directory: context.root, planSha256: "bad" })).rejects.toThrow(/SHA-256/u);
    await mkdir(join(context.outputDirectory, "occupied"), { recursive: true });
    await expect(create(context, "occupied")).rejects.toThrow(/already exists/u);
  });

  test("accepts root-contained manifest paths resolved through the public export", async () => {
    const context = await fixture();
    const absolute = await createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "absolute-manifest", outputDirectory: context.outputDirectory,
      packageManifests: [context.manifestPath], rootDirectory: context.root,
    });
    const fileUrl = await createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "file-url-manifest", outputDirectory: context.outputDirectory,
      packageManifests: [pathToFileURL(context.manifestPath).href], rootDirectory: context.root,
    });
    for (const generation of [absolute, fileUrl]) {
      const packageInputs = await readdir(join(generation.directory, ".stylex-generation", "package-inputs"));
      expect(packageInputs).toHaveLength(1);
      expect(
        await readFile(join(generation.directory, ".stylex-generation", "package-inputs", packageInputs[0]!), "utf8"),
      ).toBe(`${logical(context.root, context.manifestPath)}\n`);
    }
    await expect(createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "remote-manifest", outputDirectory: context.outputDirectory,
      packageManifests: ["https://example.com/stylex-manifest.json"], rootDirectory: context.root,
    })).rejects.toThrow(/file protocol/u);
  });

  test("enforces output ownership against registered template paths", async () => {
    const context = await fixture();
    await write(join(context.root, "src/client.ts"), "export const client = true;\n");
    await writeFile(context.templatePath, `<link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}">\n`);
    const generation = await createStylexGeneration({
      expectedGraphs: [expectedGraph("client")], generationId: "collision", outputDirectory: context.outputDirectory,
      packageManifests: [logical(context.root, context.manifestPath)], rootDirectory: context.root,
      templates: [{ cssHref: "../../stylex.css", outputPath: "graphs/client/index.js", sourcePath: logical(context.root, context.templatePath), stylesheetGraphId: "client" }],
    });
    await seal(context, generation, "client", clientRule);
    await expect(finalize(context, generation)).rejects.toThrow(/collision/u);
  });

  test("allows exactly one finalizer and supports concurrent independent generations", async () => {
    const context = await fixture();
    const contested = await create(context, "contested");
    await seal(context, contested, "client", clientRule);
    const outcomes = await Promise.allSettled([finalize(context, contested), finalize(context, contested)]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const left = await create(context, "independent-left");
    const right = await create(context, "independent-right");
    await seal(context, left, "client", clientRule, "left.js");
    await seal(context, right, "client", clientRule, "right.js");
    const outputs = await Promise.all([finalize(context, left), finalize(context, right)]);
    expect(await Promise.all(outputs.map((path) => Bun.file(join(path, "stylex-complete.json")).exists()))).toEqual([true, true]);
  });

  test("a publication loser cannot unlink the winner's live lock or enter its critical section", async () => {
    const context = await fixture();
    const winner = await create(context, "publication-contested");
    const loser = await create(context, "publication-contested");
    expect(loser.directory).not.toBe(winner.directory);
    expect(loser.planSha256).toBe(winner.planSha256);
    await seal(context, winner, "client", clientRule, "winner.js");
    await seal(context, loser, "client", clientRule, "loser.js");

    const finalDirectory = join(context.outputDirectory, "publication-contested");
    const publicationLock = join(
      context.outputDirectory,
      ".hraness-stylex-publication-contested.publish.lock",
    );
    const lockMarker = `${winner.directory}\n`;
    const publicationHandle = await open(publicationLock, "wx", 0o600);
    await publicationHandle.writeFile(lockMarker);
    await publicationHandle.sync();
    try {
      await expect(finalize(context, loser)).rejects.toThrow(/EEXIST|already exists/u);
      expect(await pathExists(loser.directory)).toBe(true);
      expect(await pathExists(join(loser.directory, "payload/stylex-complete.json"))).toBe(true);
      expect(await pathExists(finalDirectory)).toBe(false);
      expect(await readFile(publicationLock, "utf8")).toBe(lockMarker);
      const liveLock = await publicationHandle.stat();
      expect(liveLock.isFile()).toBe(true);
      expect(liveLock.size).toBe(Buffer.byteLength(lockMarker));
      await publicationHandle.sync();
    } finally {
      await publicationHandle.close();
      if (await pathExists(publicationLock)) await unlink(publicationLock);
    }

    await expect(finalize(context, winner)).resolves.toBe(finalDirectory);
    expect(await pathExists(join(finalDirectory, "graphs/client/winner.js"))).toBe(true);
    expect(await pathExists(join(finalDirectory, "graphs/client/loser.js"))).toBe(false);
    expect(await pathExists(winner.directory)).toBe(false);
    expect(await pathExists(loser.directory)).toBe(true);
    expect(await pathExists(publicationLock)).toBe(false);
  });

  test("does not leak a removed SSR graph into the next generation", async () => {
    const context = await fixture();
    const withServer = await create(context, "with-server", [["client", "client"], ["server", "ssr"]]);
    await seal(context, withServer, "client", clientRule);
    await seal(context, withServer, "server", serverRule);
    const firstOutput = await finalize(context, withServer);
    expect(await readFile(join(firstOutput, "stylex.css"), "utf8")).toContain("x-server");

    const withoutServer = await create(context, "without-server");
    await seal(context, withoutServer, "client", clientRule);
    const secondOutput = await finalize(context, withoutServer);
    expect(await readFile(join(secondOutput, "stylex.css"), "utf8")).not.toContain("x-server");
  });

  test("retains every injected failed staging tree and preserves prior complete output across success-failure-success", async () => {
    const context = await fixture();
    const before = await create(context, "success-before");
    await seal(context, before, "client", clientRule);
    const prior = await finalize(context, before);
    const priorRecord = await readFile(join(prior, "stylex-complete.json"), "utf8");

    for (const boundary of ["artifacts", "css", "templates", "complete-record", "promotion"] as const) {
      const failed = await create(context, `failed-${boundary}`, [["client", "client"]], true);
      await seal(context, failed, "client", clientRule, "foundation.css", ".foundation { display: block; }\n");
      await expect(finalize(context, failed, boundary)).rejects.toThrow(/evidence retained/u);
      expect(await pathExists(failed.directory)).toBe(true);
      expect(await pathExists(join(context.outputDirectory, `failed-${boundary}`))).toBe(false);
    }
    expect(await readFile(join(prior, "stylex-complete.json"), "utf8")).toBe(priorRecord);

    const after = await create(context, "success-after");
    await seal(context, after, "client", clientRule);
    await expect(finalize(context, after)).resolves.toBe(join(context.outputDirectory, "success-after"));
  });

  test("rejects removed graph inputs and canonical plan tampering", async () => {
    const context = await fixture();
    const removed = await create(context, "removed-input");
    await seal(context, removed, "client", clientRule);
    await rm(join(context.root, "src/client.ts"));
    await expect(finalize(context, removed)).rejects.toThrow();

    const tampered = await create(context, "tampered-plan");
    const planPath = join(tampered.directory, ".stylex-generation/plan.json");
    const plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
    plan.unexpected = true;
    const source = `${canonicalJson(plan)}\n`;
    await writeFile(planPath, source);
    await expect(loadStylexGeneration({ directory: tampered.directory, planSha256: sha256(source) })).rejects.toThrow(/unknown keys/u);
    expect((await lstat(tampered.directory)).isDirectory()).toBe(true);
    expect(await readdir(tampered.directory)).toContain(".stylex-generation");
  });
});
