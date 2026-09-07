import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, test } from "bun:test";
import ts from "typescript";

import { canonicalJson, compilerSha256, stylexRulesSha256, stylexUnionPolicySha256 } from "./compiler.js";
import { STYLEX_NEXT_ADAPTER_VERSION, STYLEX_NEXT_REQUIRED_VERSION, STYLEX_NEXT_TARGETS, defaultStylexNextGraphMap } from "./next-contracts.js";
import {
  beginStylexNextTypeScriptLifecycle,
  endStylexNextTypeScriptLifecycle,
  observeStylexNextTypeScriptInputs,
  projectStylexNextTypeScript,
  settleStylexNextTypeScriptPass,
} from "./next-typescript.js";

function hash(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

function write(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function json(path: string, value: unknown): void {
  write(path, `${canonicalJson(value)}\n`);
}

function mutateJson(path: string, change: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  change(value);
  json(path, value);
}

function context(name: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `stylex-next-types-${name}-`)));
  write(join(root, "package.json"), '{"type":"module"}\n');
  symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
  write(join(root, "app", "page.ts"), "export const value: number = 1;\n");
  const plan = "{}\n";
  const attempt = { directory: join(root, ".stylex-next", name), planSha256: hash(plan) };
  write(join(attempt.directory, "plan.json"), plan);
  const options = {
    attempt, config: {}, distDir: `.stylex-next/${name}/next-discovery`, mode: "discovery" as const,
    root, stateDirectory: ".stylex-next",
  };
  return { root, attempt, options, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function parsed(path: string): ts.ParsedCommandLine {
  const result = ts.getParsedCommandLineOfConfigFile(path, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(error) { assert.fail(ts.flattenDiagnosticMessageText(error.messageText, "\n")); },
  });
  assert.ok(result !== undefined);
  assert.deepEqual(result.errors.filter(({ code }) => code !== 18003), []);
  return result;
}

function expectedEnvironment(directory: string, mode: "discovery" | "delivery" = "discovery"): string {
  return readFileSync(join(directory, "typescript", mode, "projection.json"), "utf8").length > 0
    ? (JSON.parse(readFileSync(join(directory, "typescript", mode, "projection.json"), "utf8")) as { expectedNextEnv: string }).expectedNextEnv
    : assert.fail("Missing projection");
}

async function previousTypes(root: string, files: Readonly<Record<string, string>>) {
  const prior = nativePlan(root, "previous");
  const attempt = { directory: prior.directory, planSha256: prior.planSha256 };
  const lifecycle = await beginStylexNextTypeScriptLifecycle(root, attempt, ".next");
  projectStylexNextTypeScript({ attempt, config: {}, distDir: ".next", mode: "delivery", root, stateDirectory: ".stylex-next" });
  for (const name of ["routes.d.ts", "validator.ts"]) write(join(root, ".next", "types", name), `// native ${name}\n`);
  observeStylexNextTypeScriptInputs(root, attempt, "delivery");
  for (const [path, source] of Object.entries(files)) write(join(root, path), source);
  nativeGraphFixtures(root, prior, "previous", ".next", files, "delivery");
  await settleStylexNextTypeScriptPass(lifecycle, "delivery");
  endStylexNextTypeScriptLifecycle(lifecycle);
  return prior;
}

function nativePlan(root: string, name: string, sources: readonly string[] = ["app/page.ts"]) {
  const directory = join(root, ".stylex-next", name);
  const identity = { name: "@fixture/ui", version: "1.0.0", manifestSha256: "0".repeat(64) };
  const plan = {
    adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: name, compilerSha256,
    graphMap: defaultStylexNextGraphMap, kind: "hraness-stylex-next-attempt", nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
    outputDirectory: ".next", packageManifests: [{ artifact: { path: "package-manifest.json", bytes: 0, sha256: "0".repeat(64) }, identity }],
    requiredSources: { client: sources, "edge-rsc": [], "node-rsc": [] }, schemaVersion: 2, unionPolicySha256: stylexUnionPolicySha256,
  };
  json(join(directory, "plan.json"), plan);
  return { directory, planSha256: hash(`${canonicalJson(plan)}\n`), identity };
}

function nativeGraphFixtures(root: string, attempt: ReturnType<typeof nativePlan>, name: string, distDir: string, guards: Readonly<Record<string, string>>, mode: "discovery" | "delivery" = "discovery"): void {
  const emptyRules = stylexRulesSha256([]);
  const plan = JSON.parse(readFileSync(join(attempt.directory, "plan.json"), "utf8")) as { requiredSources: { client: string[] } };
  const clientModules = plan.requiredSources.client.map((path) => {
    const source = readFileSync(join(root, path));
    const module = {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: name, compilerSha256, graphId: "client",
      input: { path, bytes: source.byteLength, sha256: hash(source) }, kind: "hraness-stylex-next-module",
      mode, output: { bytes: source.byteLength, sha256: hash(source) }, rules: [], rulesSha256: emptyRules,
      schemaVersion: 1, sourceMap: { inputSha256: null, logicalSourceFileName: path, output: { bytes: 0, sha256: hash("") }, sources: [path] }, target: "client",
    };
    const modulePath = join(attempt.directory, mode, "client", "modules", `${hash(path)}.json`);
    json(modulePath, module);
    return { path, receiptSha256: hash(readFileSync(modulePath)) };
  });
  for (const target of STYLEX_NEXT_TARGETS) {
    mkdirSync(join(attempt.directory, mode, target, "modules"), { recursive: true });
    const modules = target === "client" ? clientModules : [];
    const outputs = target === "client" ? [
      { path: "static/client.js", bytes: 0, sha256: hash("") },
      { path: "static/client.js.map", bytes: 0, sha256: hash("") },
      ...(mode === "delivery" ? [{ path: "static/stylex.css", bytes: 0, sha256: hash("") }] : []),
      ...Object.entries(guards).map(([path, source]) => ({ path: path.slice(distDir.length + 1), bytes: Buffer.byteLength(source), sha256: hash(source) })),
    ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : [];
    const css = mode === "delivery" ? ["static/stylex.css"] : [];
    json(join(attempt.directory, mode, target, "graph.json"), {
      adapterVersion: STYLEX_NEXT_ADAPTER_VERSION, attemptId: name, auxiliaryTraceAssets: [], compilerSha256, cssInputs: [],
      entrypoints: target === "client" ? [{ name: mode === "delivery" ? "app/layout" : "main-app", css, files: ["static/client.js", "static/client.js.map", ...css], javascript: ["static/client.js"], stylexCss: css }] : [],
      emptyEntryBootstraps: [], frameworkAssets: [], graphId: target, javascriptChunks: target === "client" ? ["static/client.js"] : [],
      kind: "hraness-stylex-next-graph", mode, modules, nextVersion: STYLEX_NEXT_REQUIRED_VERSION,
      outputDirectory: distDir, outputs, packages: [attempt.identity], rules: [], rulesSha256: emptyRules, schemaVersion: 1,
      sourceMaps: outputs.filter(({ path }) => path.endsWith(".map")), sourcesSha256: hash(canonicalJson(modules)), target, webpackVersion: "5.98.0",
    });
  }
}

describe("Next native TypeScript input lifecycle", () => {
  test("mints complete native type provenance after compiler settlement and rebuilds after route removal without deleting history", async () => {
    const fixture = context("mint");
    try {
      const { root } = fixture;
      const original = '{"include":["app/**/*.ts",".stylex-next/**/next-discovery/types/**/*.ts"]}\n';
      write(join(root, "tsconfig.json"), original);
      write(join(root, "app", "removed.ts"), "export const oldRoute = true;\n");
      const first = nativePlan(root, "mint", ["app/page.ts", "app/removed.ts"]);
      const attempt = { directory: first.directory, planSha256: first.planSha256 };
      const firstLifecycle = await beginStylexNextTypeScriptLifecycle(root, attempt, ".next");
      const distDir = ".stylex-next/mint/next-discovery";
      const projected = projectStylexNextTypeScript({ ...fixture.options, attempt, distDir });
      for (const name of ["routes.d.ts", "validator.ts", "cache-life.d.ts"]) write(join(root, distDir, "types", name), `// native ${name}\n`);
      observeStylexNextTypeScriptInputs(root, attempt, "discovery");
      const guard = "import '../../../../../app/removed.js';\n";
      const guardPath = join(root, distDir, "types", "app", "removed.ts");
      write(guardPath, guard);
      nativeGraphFixtures(root, first, "mint", distDir, { [`${distDir}/types/app/removed.ts`]: guard });
      write(join(root, "next-env.d.ts"), expectedEnvironment(first.directory));
      await settleStylexNextTypeScriptPass(firstLifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(firstLifecycle);
      const receipt = join(first.directory, "typescript", "discovery", "types.json");
      const receiptBytes = readFileSync(receipt);
      assert.equal((JSON.parse(receiptBytes.toString()) as { artifacts: unknown[] }).artifacts.length, 4);
      assert.ok(parsed(join(root, projected)).fileNames.includes(guardPath), "first pass keeps its native guard");
      unlinkSync(join(root, "app", "removed.ts"));
      const second = nativePlan(root, "removed-route");
      const secondAttempt = { directory: second.directory, planSha256: second.planSha256 };
      const lifecycle = await beginStylexNextTypeScriptLifecycle(root, secondAttempt, ".next");
      const secondPath = projectStylexNextTypeScript({ ...fixture.options, attempt: secondAttempt, distDir: ".stylex-next/removed-route/next-discovery" });
      const selected = parsed(join(root, secondPath)).fileNames;
      assert.ok(!selected.includes(guardPath));
      assert.ok(!selected.includes(join(root, "app", "removed.ts")));
      assert.ok(selected.includes(join(root, "app", "page.ts")));
      assert.equal(readFileSync(guardPath, "utf8"), guard);
      assert.deepEqual(readFileSync(receipt), receiptBytes);
      assert.equal(readFileSync(join(root, "tsconfig.json"), "utf8"), original);
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });
  test("preserves JSONC, array/nested extends, aliases, references, files, and exclusions beside a custom config", async () => {
    const fixture = context("inheritance");
    try {
      const { root } = fixture;
      write(join(root, "configs", "base.json"), '{ "compilerOptions": { "strict": true, "paths": { "@app/*": ["../app/*"] }, "typeRoots": ["../ambient"] }, "include": ["../app/**/*.ts"], "exclude": ["../app/excluded.ts"] }\n');
      write(join(root, "configs", "additional.json"), '{ "compilerOptions": { "noUnusedLocals": true } }\n');
      write(join(root, "configs", "nested.json"), '{ "extends": "./base.json" }\n');
      const authored = '{\n // Keep these comments and trailing commas.\n "extends": ["./nested.json", "./additional.json"],\n "compilerOptions": {"target":"es2023",},\n "references":[{"path":"../referenced"}],\n}\n';
      write(join(root, "configs", "site.json"), authored);
      write(join(root, "app", "excluded.ts"), "const broken: number = 'excluded';\n");
      const initial = parsed(join(root, "configs", "site.json"));
      const lifecycle = await beginStylexNextTypeScriptLifecycle(root, fixture.attempt, ".next");
      const path = projectStylexNextTypeScript({ ...fixture.options, config: { typescript: { tsconfigPath: "configs/site.json" } } });
      const projected = parsed(join(root, path));
      for (const key of ["strict", "paths", "typeRoots", "target", "noUnusedLocals"] as const) {
        assert.deepEqual(projected.options[key], initial.options[key], key);
      }
      assert.equal(Reflect.get(projected.options, "pathsBasePath"), Reflect.get(initial.options, "pathsBasePath"));
      assert.deepEqual(projected.projectReferences, initial.projectReferences);
      assert.ok(projected.fileNames.includes(join(root, "app", "page.ts")));
      assert.ok(!projected.fileNames.includes(join(root, "app", "excluded.ts")));
      assert.equal(readFileSync(join(root, "configs", "site.json"), "utf8"), authored);
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("admits future current native guards and keeps authored and active guard errors visible", async () => {
    const fixture = context("current");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"compilerOptions":{"noLib":true,"types":[],"strict":true},"include":["app/**/*.ts"],"exclude":["app/excluded.ts"]}\n');
      write(join(fixture.root, "app", "page.ts"), "export const value: number = 'authored error';\n");
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      const path = projectStylexNextTypeScript(fixture.options);
      const currentGuard = join(fixture.root, fixture.options.distDir, "types", "app", "page.ts");
      write(currentGuard, "export const route: number = 'native guard error';\n");
      const projection = parsed(join(fixture.root, path));
      assert.ok(projection.fileNames.includes(currentGuard));
      const program = ts.createProgram(projection.fileNames, projection.options);
      const errors = program.getSemanticDiagnostics().filter(({ code }) => code === 2322);
      assert.deepEqual(errors.map(({ file }) => file?.fileName).sort(), [join(fixture.root, "app", "page.ts"), currentGuard].sort());
      // No full compiler receipt was minted, so this synthetic guard is not owned.
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("excludes only hash-bound prior types while preserving unrelated same-directory roots and imports", async () => {
    const fixture = context("historical");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
      await previousTypes(fixture.root, { ".next/types/app/removed.ts": "import './missing-route.js';\n" });
      write(join(fixture.root, ".next", "types", "authored.ts"), "export const authored: number = 'still checked';\n");
      write(join(fixture.root, "app", "explicit.ts"), "import '../.next/types/app/removed.js';\n");
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      const path = projectStylexNextTypeScript(fixture.options);
      const config = parsed(join(fixture.root, path));
      assert.ok(!config.fileNames.includes(join(fixture.root, ".next", "types", "app", "removed.ts")));
      assert.ok(config.fileNames.includes(join(fixture.root, ".next", "types", "authored.ts")));
      const program = ts.createProgram(config.fileNames, { ...config.options, noLib: true, types: [] });
      assert.ok(program.getSourceFile(join(fixture.root, ".next", "types", "app", "removed.ts")) !== undefined, "explicit imports must not be hidden by root-file settlement");
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("keeps unreceipted historical types and rejects altered owned artifacts", async () => {
    const fixture = context("tamper");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
      await previousTypes(fixture.root, { ".next/types/owned.ts": "export {};\n" });
      write(join(fixture.root, ".next", "types", "unowned.ts"), "export {};\n");
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      const path = projectStylexNextTypeScript(fixture.options);
      assert.ok(parsed(join(fixture.root, path)).fileNames.includes(join(fixture.root, ".next", "types", "unowned.ts")));
      write(join(fixture.root, ".next", "types", "owned.ts"), "export const changed = true;\n");
      assert.throws(() => projectStylexNextTypeScript({ ...fixture.options, mode: "delivery", distDir: ".next" }), /changed without a matching receipt/u);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("historical receipts remain valid after old authored config and source bytes disappear", async () => {
    const fixture = context("old-config");
    try {
      const { root } = fixture;
      write(join(root, "configs", "old.json"), '{"include":["../app/**/*.ts"]}\n');
      const first = nativePlan(root, "old-owner");
      const attempt = { directory: first.directory, planSha256: first.planSha256 };
      const lifecycle = await beginStylexNextTypeScriptLifecycle(root, attempt, ".next");
      const options = { ...fixture.options, attempt, config: { typescript: { tsconfigPath: "configs/old.json" } }, mode: "delivery" as const, distDir: ".next" };
      projectStylexNextTypeScript(options);
      for (const name of ["routes.d.ts", "validator.ts"]) write(join(root, ".next", "types", name), `// native ${name}\n`);
      observeStylexNextTypeScriptInputs(root, attempt, "delivery");
      const guards = { ".next/types/app/old.ts": "export {};\n" };
      write(join(root, ".next/types/app/old.ts"), guards[".next/types/app/old.ts"]);
      nativeGraphFixtures(root, first, "old-owner", ".next", guards, "delivery");
      await settleStylexNextTypeScriptPass(lifecycle, "delivery");
      endStylexNextTypeScriptLifecycle(lifecycle);
      unlinkSync(join(root, "configs", "old.json"));
      write(join(root, "app", "page.ts"), "export const changedAfterPriorBuild = true;\n");
      write(join(root, "tsconfig.json"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
      const current = await beginStylexNextTypeScriptLifecycle(root, fixture.attempt, ".next");
      const projection = projectStylexNextTypeScript(fixture.options);
      assert.ok(!parsed(join(root, projection)).fileNames.includes(join(root, ".next/types/app/old.ts")));
      // Historical package-manifest.json and emitted static/client.js never
      // existed in this fixture. Only their retained receipt records exist.
      assert.equal(existsSync(join(root, "package-manifest.json")), false);
      assert.equal(existsSync(join(root, ".next/static/client.js")), false);
      endStylexNextTypeScriptLifecycle(current);
    } finally { fixture.cleanup(); }
  });

  test("historical first-time seed is retained and hash-bound without creating authored configuration", async () => {
    const fixture = context("historical-seed");
    try {
      const { root } = fixture;
      const prior = await previousTypes(root, { ".next/types/old.ts": "export {};\n" });
      assert.equal(existsSync(join(root, "tsconfig.json")), false);
      const receipt = JSON.parse(readFileSync(join(prior.directory, "typescript", "delivery", "projection.json"), "utf8")) as { seed: { path: string } };
      const seed = join(root, receipt.seed.path);
      assert.ok(existsSync(seed));
      write(join(root, "tsconfig.json"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
      const current = await beginStylexNextTypeScriptLifecycle(root, fixture.attempt, ".next");
      const projection = projectStylexNextTypeScript(fixture.options);
      assert.ok(!parsed(join(root, projection)).fileNames.includes(join(root, ".next/types/old.ts")));
      endStylexNextTypeScriptLifecycle(current);
      write(seed, "{}\n");
      const next = nativePlan(root, "seed-tamper");
      const attempt = { directory: next.directory, planSha256: next.planSha256 };
      const lifecycle = await beginStylexNextTypeScriptLifecycle(root, attempt, ".next");
      assert.throws(() => projectStylexNextTypeScript({ ...fixture.options, attempt, distDir: ".stylex-next/seed-tamper/next-discovery" }), /TypeScript input changed/u);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  for (const attack of [
    "missing-graph", "missing-before", "plan-hash", "inventory-dist", "forged-app-types",
    "inventory-traversal", "before-traversal", "extra-union", "extra-before", "writer-pin",
    "projection-dist", "projection-mode", "projection-traversal", "projection-bytes", "seed-bytes",
    "graph-target", "graph-census", "module-hash", "module-filename", "surviving-type",
  ]) test(`rejects incomplete or altered historical provenance: ${attack}`, async () => {
    const fixture = context(`attack-${attack}`);
    try {
      const { root } = fixture;
      write(join(root, "tsconfig.json"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
      const prior = await previousTypes(root, { ".next/types/app/old.ts": "export {};\n" });
      const phase = join(prior.directory, "typescript", "delivery");
      const inventoryPath = join(phase, "types.json");
      const beforePath = join(phase, "before-webpack.json");
      const projectionPath = join(phase, "projection.json");
      const graphPath = join(prior.directory, "delivery", "client", "graph.json");
      const moduleDirectory = join(prior.directory, "delivery", "client", "modules");
      const projection = JSON.parse(readFileSync(projectionPath, "utf8")) as { projectedConfig: { path: string }; seed: { path: string } | null };
      const replaceArtifactPrefix = (value: Record<string, unknown>, prefix: string) => {
        const list = value.artifacts as { path: string }[];
        for (const file of list) file.path = file.path.replace(/^\.next/u, prefix);
        value.distDir = prefix;
      };
      switch (attack) {
        case "missing-graph": unlinkSync(join(prior.directory, "delivery", "node-rsc", "graph.json")); break;
        case "missing-before": unlinkSync(beforePath); break;
        case "plan-hash": mutateJson(join(prior.directory, "plan.json"), (value) => { value.outputDirectory = ".other"; }); break;
        case "inventory-dist": mutateJson(inventoryPath, (value) => { replaceArtifactPrefix(value, ".other"); }); break;
        case "forged-app-types": mutateJson(inventoryPath, (value) => { replaceArtifactPrefix(value, "app"); }); break;
        case "inventory-traversal":
        case "before-traversal": mutateJson(attack === "inventory-traversal" ? inventoryPath : beforePath, (value) => {
          const list = value.artifacts as { path: string }[];
          const first = list[0]; assert.ok(first !== undefined);
          first.path = ".next/types/../../app/page.ts";
          list.sort((a, b) => a.path < b.path ? -1 : 1);
        }); break;
        case "extra-union":
        case "extra-before": mutateJson(attack === "extra-union" ? inventoryPath : beforePath, (value) => {
          const list = value.artifacts as { path: string; bytes: number; sha256: string }[];
          list.push({ path: ".next/types/unproved.ts", bytes: 0, sha256: hash("") });
          list.sort((a, b) => a.path < b.path ? -1 : 1);
        }); break;
        case "writer-pin": mutateJson(beforePath, (value) => { value.nativeInputs = {}; }); break;
        case "projection-dist": mutateJson(projectionPath, (value) => { value.distDir = ".other"; }); break;
        case "projection-mode": mutateJson(projectionPath, (value) => {
          const file = value.projectedConfig as { path: string };
          file.path = file.path.replace("-delivery.json", "-discovery.json");
        }); break;
        case "projection-traversal": mutateJson(projectionPath, (value) => {
          (value.projectedConfig as { path: string }).path = "../outside.json";
        }); break;
        case "projection-bytes": write(join(root, projection.projectedConfig.path), "{}\n"); break;
        case "seed-bytes": write(join(prior.directory, "typescript", "default-seed.json"), "{}\n"); break;
        case "graph-target": mutateJson(graphPath, (value) => { value.target = "node-rsc"; }); break;
        case "graph-census": mutateJson(graphPath, (value) => { value.modules = []; value.sourcesSha256 = hash(canonicalJson([])); }); break;
        case "module-hash": mutateJson(join(moduleDirectory, `${hash("app/page.ts")}.json`), (value) => {
          (value.input as { sha256: string }).sha256 = "f".repeat(64);
        }); break;
        case "module-filename": write(join(moduleDirectory, `${"a".repeat(64)}.json`), "{}\n"); break;
        case "surviving-type": write(join(root, ".next/types/app/old.ts"), "export const changed = true;\n"); break;
        default: assert.fail("Unknown attack fixture");
      }
      const current = await beginStylexNextTypeScriptLifecycle(root, fixture.attempt, ".next");
      assert.throws(() => projectStylexNextTypeScript(fixture.options));
      endStylexNextTypeScriptLifecycle(current);
      assert.equal(readFileSync(join(root, "tsconfig.json"), "utf8"), '{"include":["app/**/*.ts",".next/types/**/*.ts"]}\n');
    } finally { fixture.cleanup(); }
  });

  test("preserves first-time authored absence and restores exact native next-env output on a failed pass", async () => {
    const fixture = context("first-time");
    try {
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      const path = projectStylexNextTypeScript(fixture.options);
      assert.equal(existsSync(join(fixture.root, "tsconfig.json")), false);
      assert.ok(parsed(join(fixture.root, path)).fileNames.includes(join(fixture.root, "app", "page.ts")));
      const require = createRequire(join(fixture.root, "package.json"));
      const native = require("next/dist/lib/typescript/writeAppTypeDeclarations") as { writeAppTypeDeclarations(options: object): Promise<void> };
      await native.writeAppTypeDeclarations({ baseDir: fixture.root, distDir: fixture.options.distDir, imageImportsEnabled: true, hasPagesDir: false, hasAppDir: true, strictRouteTypes: false, typedRoutes: false });
      assert.equal(readFileSync(join(fixture.root, "next-env.d.ts"), "utf8"), expectedEnvironment(fixture.attempt.directory));
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      assert.equal(existsSync(join(fixture.root, "next-env.d.ts")), false);
      assert.equal(existsSync(join(fixture.root, "tsconfig.json")), false);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("restores authored CRLF bytes and mode, including a shorter file, after native cancellation output", async () => {
    const fixture = context("preservation");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"]}\n');
      const prior = "// authored\r\nexport {};\r\n";
      writeFileSync(join(fixture.root, "next-env.d.ts"), prior, { mode: 0o640 });
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      projectStylexNextTypeScript({ ...fixture.options, config: { images: { disableStaticImages: true }, experimental: { strictRouteTypes: true }, typedRoutes: true } });
      const expected = expectedEnvironment(fixture.attempt.directory);
      assert.ok(expected.includes("\r\n") && !expected.includes("image-types"));
      assert.ok(expected.includes("cache-life.d.ts") && expected.includes("validator.ts") && expected.includes("link.d.ts"));
      writeFileSync(join(fixture.root, "next-env.d.ts"), expected);
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      assert.equal(readFileSync(join(fixture.root, "next-env.d.ts"), "utf8"), prior);
      assert.equal(statSync(join(fixture.root, "next-env.d.ts")).mode & 0o777, 0o640);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("detects new authored roots and config changes without discarding edits, but restores owned native environment", async () => {
    const fixture = context("drift");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"]}\n');
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      projectStylexNextTypeScript(fixture.options);
      write(join(fixture.root, "next-env.d.ts"), expectedEnvironment(fixture.attempt.directory));
      write(join(fixture.root, "app", "new.ts"), "export const unchecked: number = 'error';\n");
      await assert.rejects(settleStylexNextTypeScriptPass(lifecycle, "discovery"), /source selection changed/u);
      assert.equal(existsSync(join(fixture.root, "next-env.d.ts")), false);
      assert.ok(existsSync(join(fixture.root, "app", "new.ts")));
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"],"compilerOptions":{"strict":true}}\n');
      await assert.rejects(settleStylexNextTypeScriptPass(lifecycle, "discovery"), /TypeScript input changed/u);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("preserves unexpected environment edits and retains the root ownership fence", async () => {
    const fixture = context("unexpected");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"]}\n');
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      projectStylexNextTypeScript(fixture.options);
      write(join(fixture.root, "next-env.d.ts"), "// another writer's change\n");
      await assert.rejects(settleStylexNextTypeScriptPass(lifecycle, "discovery"), /preserving unexpected bytes/u);
      assert.throws(() => endStylexNextTypeScriptLifecycle(lifecycle), /not restored/u);
      assert.equal(readFileSync(join(fixture.root, "next-env.d.ts"), "utf8"), "// another writer's change\n");
      assert.ok(existsSync(join(fixture.root, ".hraness-stylex-next-typescript.lock")));
    } finally { fixture.cleanup(); }
  });

  test("serializes different outputs by physical root and fails closed on missing lifecycle or unsafe options", async () => {
    const fixture = context("ownership");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"]}\n');
      assert.throws(() => projectStylexNextTypeScript(fixture.options), /ENOENT/u);
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      await assert.rejects(beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, "other-output"), /EEXIST/u);
      assert.throws(() => projectStylexNextTypeScript({ ...fixture.options, config: { cleanDistDir: false } }), /active-output cleaning/u);
      assert.throws(() => projectStylexNextTypeScript({ ...fixture.options, config: { typescript: { ignoreBuildErrors: true } } }), /never bypasses/u);
      assert.throws(() => projectStylexNextTypeScript({ ...fixture.options, config: { typescript: { tsconfigPath: "../outside.json" } } }), /normalized|relative|travers/u);
      await settleStylexNextTypeScriptPass(lifecycle, "discovery");
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });

  test("rejects an unproved installed TypeScript version without creating authored configuration", async () => {
    const fixture = context("typescript-version");
    try {
      unlinkSync(join(fixture.root, "node_modules"));
      mkdirSync(join(fixture.root, "node_modules"));
      symlinkSync(join(process.cwd(), "node_modules", "next"), join(fixture.root, "node_modules", "next"), "dir");
      write(join(fixture.root, "node_modules", "typescript", "package.json"), '{"name":"typescript","main":"index.cjs"}\n');
      write(join(fixture.root, "node_modules", "typescript", "index.cjs"), 'module.exports = {version:"6.0.4", getParsedCommandLineOfConfigFile(){}};\n');
      await assert.rejects(beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next"), /exactly TypeScript 6\.0\.3/u);
      assert.equal(existsSync(join(fixture.root, "tsconfig.json")), false);
      assert.equal(existsSync(join(fixture.root, ".hraness-stylex-next-typescript.lock")), false);
    } finally { fixture.cleanup(); }
  });

  test("binds pre-webpack native types exactly and rejects symlinked or changed observations", async () => {
    const fixture = context("observation");
    try {
      write(join(fixture.root, "tsconfig.json"), '{"include":["app/**/*.ts"]}\n');
      const lifecycle = await beginStylexNextTypeScriptLifecycle(fixture.root, fixture.attempt, ".next");
      projectStylexNextTypeScript(fixture.options);
      assert.throws(() => observeStylexNextTypeScriptInputs(fixture.root, fixture.attempt, "discovery"), /did not create/u);
      for (const name of ["routes.d.ts", "validator.ts", "cache-life.d.ts"]) write(join(fixture.root, fixture.options.distDir, "types", name), `// native ${name}\n`);
      observeStylexNextTypeScriptInputs(fixture.root, fixture.attempt, "discovery");
      observeStylexNextTypeScriptInputs(fixture.root, fixture.attempt, "discovery");
      write(join(fixture.root, fixture.options.distDir, "types", "routes.d.ts"), "// unexpected change\n");
      assert.throws(() => observeStylexNextTypeScriptInputs(fixture.root, fixture.attempt, "discovery"), /record collision/u);
      endStylexNextTypeScriptLifecycle(lifecycle);
    } finally { fixture.cleanup(); }
  });
});
