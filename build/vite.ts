import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { transform as inspectCss } from "lightningcss";
import type { Plugin, ResolvedConfig } from "vite";

import {
  STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
  type StylexArtifactV1,
  type StylexGenerationHandleV1,
  type StylexGraphEdgeV1,
  type StylexPackageManifestV1,
} from "./contracts.js";
import {
  artifactForFile,
  auditCssWithoutStandaloneRecipes,
  auditCssWithoutStylexRules,
  canonicalJson,
  compilerSha256,
  createStylexTransformCollector,
  normalizeLogicalPath,
  resolveRootRelativeInput,
  sha256,
  stylexRulesSha256,
} from "./compiler.js";
import {
  loadStylexGeneration,
  prepareStylexGraph,
  writeStylexGraphReceipt,
} from "./generation.js";

export type StylexViteOptions = Readonly<{
  generation: StylexGenerationHandleV1;
  graphId: string;
  rootDirectory: string;
}>;

type CssDependency = Readonly<{ kind: "css-import" | "css-url"; url: string }>;
type InputSnapshot = Readonly<{ bytes: number; sha256: string }>;

const javascriptFilter = /\.[cm]?[jt]sx?$/u;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanModuleId(id: string): string {
  return id.replace(/[?#].*$/u, "");
}

function hasUnsupportedAssetQuery(id: string): boolean {
  const query = id.split("?", 2)[1]?.split("#", 1)[0];
  return query !== undefined
    && query.split("&").some((part) => ["inline", "raw"].some((name) => part === name || part.startsWith(`${name}=`)));
}

function rootInputPath(id: string, rootDirectory: string): string | undefined {
  const clean = cleanModuleId(id);
  if (!isAbsolute(clean)) return undefined;
  const logical = relative(rootDirectory, clean).split(sep).join("/");
  assert.ok(
    logical.length > 0 && logical !== ".." && !logical.startsWith("../"),
    "Vite graph module escaped the declared root",
  );
  return normalizeLogicalPath(logical, "Vite graph input");
}

function packageBelowNodeModules(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const first = parts[index + 1]!;
  if (first.startsWith("@") && index + 2 < parts.length) return `${first}/${parts[index + 2]!}`;
  return first;
}

function packageRelativePath(path: string): string | undefined {
  const parts = path.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const packageSegments = parts[index + 1]!.startsWith("@") ? 2 : 1;
  const start = index + 1 + packageSegments;
  return start < parts.length ? parts.slice(start).join("/") : undefined;
}

function localTransformPath(id: string, rootDirectory: string): string | undefined {
  const logical = rootInputPath(id, rootDirectory);
  return logical === undefined || packageBelowNodeModules(logical) !== undefined ? undefined : logical;
}

function graphName(id: string, rootDirectory: string): string {
  const clean = cleanModuleId(id);
  const logical = rootInputPath(clean, rootDirectory);
  if (logical !== undefined) return `input:${logical}`;
  if (/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/iu.test(clean)) {
    return `external:${clean}`;
  }
  const stable = clean.replaceAll(rootDirectory, "<graph-root>");
  return `virtual:${sha256(stable)}`;
}

function externalGraphName(id: string): string {
  const clean = cleanModuleId(id);
  assert.ok(
    clean.length > 0
      && !clean.includes("\\")
      && !/[\u0000-\u001f\u007f]/u.test(clean),
    `Vite external import contains forbidden characters: ${id}`,
  );
  assert.ok(
    !isAbsolute(clean)
      && !/^[A-Za-z]:\//u.test(clean)
      && !clean.startsWith("./")
      && !clean.startsWith("../")
      && !clean.toLowerCase().startsWith("file:"),
    `Vite may not externalize a relative or absolute file from a complete graph: ${id}`,
  );
  return `external:${clean}`;
}

function verifyRegisteredPackageInput(
  path: string,
  artifact: StylexArtifactV1,
  manifests: readonly StylexPackageManifestV1[],
): void {
  const packageName = packageBelowNodeModules(path);
  const packagePath = packageRelativePath(path);
  if (packageName === undefined || packagePath === undefined) return;
  const manifest = manifests.find((item) => item.package.name === packageName);
  if (manifest === undefined) return;
  assert.ok(
    !manifest.buildTools.some((item) => item.path === packagePath),
    `Package build tool entered the production graph: ${path}`,
  );
  const runtime = manifest.runtime.find((item) => item.path === packagePath);
  const stylesheet = manifest.stylesheets.find((item) => item.path === packagePath);
  if (javascriptFilter.test(packagePath)) {
    assert.ok(runtime !== undefined, `Package runtime is not bound by its manifest: ${path}`);
  }
  if (packagePath.endsWith(".css")) {
    assert.ok(
      stylesheet !== undefined || manifest.standaloneCss.path === packagePath,
      `Package stylesheet is not bound by its manifest: ${path}`,
    );
  }
  if (runtime !== undefined) {
    assert.deepEqual(
      { bytes: artifact.bytes, sha256: artifact.sha256 },
      { bytes: runtime.bytes, sha256: runtime.sha256 },
      `Installed package runtime differs from its manifest: ${path}`,
    );
  }
  const expectedStylesheet = stylesheet
    ?? (manifest.standaloneCss.path === packagePath ? manifest.standaloneCss : undefined);
  if (expectedStylesheet !== undefined) {
    assert.deepEqual(
      { bytes: artifact.bytes, sha256: artifact.sha256 },
      { bytes: expectedStylesheet.bytes, sha256: expectedStylesheet.sha256 },
      `Installed package stylesheet differs from its manifest: ${path}`,
    );
  }
}

function targetsStylexRuntime(id: string, rootDirectory: string): boolean {
  const clean = cleanModuleId(id);
  if (clean === "@stylexjs/stylex" || clean.startsWith("@stylexjs/stylex/")) return true;
  const logical = rootInputPath(clean, rootDirectory);
  return logical !== undefined && packageBelowNodeModules(logical) === "@stylexjs/stylex";
}

function verifyStylexDependencyEdges(
  importerId: string,
  importedIds: readonly string[],
  rootDirectory: string,
  manifests: readonly StylexPackageManifestV1[],
): void {
  const importer = rootInputPath(importerId, rootDirectory);
  if (importer === undefined) return;
  const dependencyPackage = packageBelowNodeModules(importer);
  if (dependencyPackage === undefined || dependencyPackage === "@stylexjs/stylex") return;
  if (!importedIds.some((id) => targetsStylexRuntime(id, rootDirectory))) return;
  assert.ok(
    manifests.some((manifest) => manifest.package.name === dependencyPackage),
    `StyleX dependency ${dependencyPackage} has no verified package manifest`,
  );
}

function inspectStylexViteCss(source: string, filename: string): readonly CssDependency[] {
  const dependencies: CssDependency[] = [];
  const result = inspectCss({
    code: Buffer.from(source),
    filename,
    minify: false,
    visitor: {
      Rule: {
        import(rule) {
          dependencies.push({ kind: "css-import", url: rule.value.url });
        },
      },
      Url(url) {
        dependencies.push({ kind: "css-url", url: url.url });
      },
    },
  });
  assert.equal(result.warnings.length, 0, `Vite CSS inspection emitted warnings for ${filename}`);
  return dependencies.sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));
}

function externalCssUrl(url: string): boolean {
  return /^(?:data:|https?:|blob:|#|\/\/)/iu.test(url);
}

function rejectOutputOverrides(config: Record<string, unknown>): void {
  assert.equal(config.root, undefined, "The StyleX Vite adapter owns Vite root");
  assert.equal(config.publicDir, undefined, "The StyleX Vite adapter disables Vite public-directory copying");
  const build = config.build;
  if (build === undefined) return;
  assert.ok(typeof build === "object" && build !== null && !Array.isArray(build), "Vite build config must be an object");
  const record = build as Record<string, unknown>;
  assert.ok(
    record.sourcemap === undefined || record.sourcemap === false,
    "The StyleX Vite adapter accepts only build.sourcemap false or undefined",
  );
  for (const key of ["assetsInlineLimit", "outDir", "assetsDir", "copyPublicDir", "cssCodeSplit", "emptyOutDir", "lib", "write"] as const) {
    assert.equal(record[key], undefined, `The StyleX Vite adapter owns build.${key}`);
  }
  const rollup = record.rollupOptions;
  if (rollup === undefined) return;
  assert.ok(typeof rollup === "object" && rollup !== null && !Array.isArray(rollup), "Vite rollupOptions must be an object");
  const rollupRecord = rollup as Record<string, unknown>;
  assert.equal(rollupRecord.external, undefined, "The StyleX Vite adapter owns Rollup externalization");
  assert.equal(rollupRecord.input, undefined, "The StyleX Vite adapter owns Rollup input");
  assert.equal(rollupRecord.output, undefined, "The StyleX Vite adapter owns Rollup output paths");
}

type EmittedAsset = Readonly<{
  fileName: string;
  originalFileName?: string | null;
  originalFileNames?: readonly string[];
  source: string | Uint8Array;
  type: "asset";
}>;

function emittedAssetProvenance(output: EmittedAsset, rootDirectory: string): readonly string[] {
  const names = [...(output.originalFileNames ?? [])];
  if (output.originalFileName !== null && output.originalFileName !== undefined) {
    assert.ok(
      names.length === 0 || names.includes(output.originalFileName),
      `Vite asset provenance fields disagree for ${output.fileName}`,
    );
    names.push(output.originalFileName);
  }
  return [...new Set(names)].map((name) => {
    assert.ok(
      name.length > 0 && !name.includes("?") && !name.includes("#"),
      `Vite asset provenance is not an ordinary source path for ${output.fileName}`,
    );
    const absolute = isAbsolute(name) ? name : resolve(rootDirectory, name);
    const logical = rootInputPath(absolute, rootDirectory);
    assert.ok(logical !== undefined, `Vite asset provenance is not root-contained for ${output.fileName}`);
    return logical;
  }).sort(compareStrings);
}

function assertOwnedOutputDirectory(
  outputOptions: Readonly<{
    dir?: string | undefined;
    file?: string | undefined;
    sourcemap?: boolean | "hidden" | "inline" | undefined;
  }>,
  outputDirectory: string,
): void {
  assert.equal(outputOptions.file, undefined, "StyleX Vite does not support a single-file output override");
  assert.ok(typeof outputOptions.dir === "string", "StyleX Vite requires an owned Rollup output directory");
  assert.equal(resolve(outputOptions.dir), outputDirectory, "Rollup output escaped the owned graph staging root");
  assert.ok(
    outputOptions.sourcemap === undefined || outputOptions.sourcemap === false,
    "StyleX Vite requires Rollup sourcemap output to remain disabled",
  );
}

export function stylexVite(options: StylexViteOptions): Plugin {
  const rootDirectory = resolve(options.rootDirectory);
  const collector = createStylexTransformCollector(rootDirectory);
  const transformed = new Set<string>();
  const auditedCss = new Set<string>();
  const cssInputs = new Set<string>();
  const nativeInputs = new Set<string>();
  const emittedAssetInputs = new Set<string>();
  const cssEdges: StylexGraphEdgeV1[] = [];
  const inputSnapshots = new Map<string, InputSnapshot>();
  let configured = false;
  let resolved = false;
  let complete = false;
  let sealedRules: ReturnType<typeof collector.seal> | undefined;
  let prepared: Awaited<ReturnType<typeof prepareStylexGraph>> | undefined;
  let plannedOutput: Readonly<{ outputDirectory: string; outputRoot: string }> | undefined;
  let loaded: Awaited<ReturnType<typeof loadStylexGeneration>> | undefined;
  let resolvedConfig: ResolvedConfig | undefined;

  const snapshotInput = (logical: string, bytes: string | Uint8Array): void => {
    const snapshot = {
      bytes: typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength,
      sha256: sha256(bytes),
    };
    const previous = inputSnapshots.get(logical);
    if (previous === undefined) inputSnapshots.set(logical, snapshot);
    else assert.deepEqual(snapshot, previous, `Vite input changed between loads: ${logical}`);
  };

  const readAndSnapshotInput = async (logical: string): Promise<Buffer> => {
    const ordinary = await resolveRootRelativeInput(rootDirectory, logical);
    const bytes = await readFile(ordinary);
    snapshotInput(logical, bytes);
    return bytes;
  };

  const validateResolvedConfig = (config: ResolvedConfig): void => {
    assert.equal(configured, true, "StyleX Vite config was not prepared");
    assert.equal(config.command, "build", "StyleX Vite supports build mode only");
    assert.ok(config.build.watch === null || config.build.watch === undefined, "StyleX Vite does not support watch mode");
    assert.ok(plannedOutput !== undefined && loaded !== undefined);
    assert.equal(resolve(config.root), rootDirectory, "Resolved Vite root differs from the owned graph root");
    const publicDirectory: unknown = config.publicDir;
    assert.ok(
      publicDirectory === false || publicDirectory === "",
      "StyleX Vite must disable public-directory copying",
    );
    assert.equal(config.build.copyPublicDir, false, "StyleX Vite must own all graph output files");
    assert.equal(config.build.assetsInlineLimit, 0, "StyleX Vite must disable implicit asset inlining");
    assert.equal(config.build.cssCodeSplit, false, "StyleX Vite must emit one complete graph stylesheet");
    assert.equal(resolve(config.build.outDir), plannedOutput.outputDirectory, "Resolved Vite outDir differs from the graph staging root");
    assert.equal(config.build.sourcemap, false, "StyleX Vite must disable sourcemap output");
    assert.equal(config.build.write, true, "StyleX Vite requires filesystem output for receipt sealing");
    assert.equal(
      config.build.rollupOptions.output,
      undefined,
      "The StyleX Vite adapter owns resolved Rollup output options",
    );
    const graph = loaded.expectedGraph(options.graphId);
    const target = config.build.ssr === false || config.build.ssr === undefined ? "client" : "ssr";
    assert.equal(target, graph.kind, `Vite target differs from graph ${graph.id}`);
  };

  return {
    name: "@hraness/ui-stylex-vite",
    enforce: "pre",
    async config(config, environment) {
      assert.equal(environment.command, "build", "StyleX Vite supports one-shot builds only; serve and HMR are unsupported");
      assert.equal(configured, false, "StyleX Vite may be configured only once");
      rejectOutputOverrides(config as Record<string, unknown>);
      assert.ok(config.build?.watch === null || config.build?.watch === undefined, "StyleX Vite does not support watch mode");
      loaded = await loadStylexGeneration(options.generation);
      const graph = loaded.expectedGraph(options.graphId);
      assert.equal(graph.adapter, "vite", `Graph ${graph.id} is not a Vite graph`);
      const outputRoot = `.stylex-generation/graphs/${graph.id}/output`;
      plannedOutput = {
        outputDirectory: join(options.generation.directory, ...outputRoot.split("/")),
        outputRoot,
      };
      configured = true;
      return {
        publicDir: false,
        root: rootDirectory,
        build: {
          assetsInlineLimit: 0,
          copyPublicDir: false,
          cssCodeSplit: false,
          emptyOutDir: false,
          outDir: plannedOutput.outputDirectory,
          rollupOptions: { input: graph.entrypoints.map((entrypoint) => resolve(rootDirectory, entrypoint)) },
          sourcemap: false,
          write: true,
        },
      };
    },
    async configResolved(config) {
      validateResolvedConfig(config);
      resolvedConfig = config;
      resolved = true;
    },
    load: {
      order: "pre",
      async handler(id) {
        assert.equal(hasUnsupportedAssetQuery(id), false, `Vite content-inlining asset queries are unsupported: ${id}`);
        const logical = rootInputPath(id, rootDirectory);
        if (logical !== undefined) await readAndSnapshotInput(logical);
        return null;
      },
    },
    async transform(code, id) {
      assert.equal(resolved, true, "StyleX Vite received a module before config resolution");
      const loadedGeneration = loaded;
      assert.ok(loadedGeneration !== undefined);
      const clean = cleanModuleId(id);
      const input = rootInputPath(clean, rootDirectory);
      if (input !== undefined) {
        if (javascriptFilter.test(clean) || /\.css$/iu.test(clean)) snapshotInput(input, code);
        else await readAndSnapshotInput(input);
      }
      if (/\.css$/iu.test(clean)) {
        const auditCss = async (source: string, sourceId: string): Promise<void> => {
          const sourceClean = cleanModuleId(sourceId);
          auditCssWithoutStandaloneRecipes(source, loadedGeneration.packageManifests);
          const logical = rootInputPath(sourceClean, rootDirectory);
          if (logical !== undefined) {
            cssInputs.add(logical);
            snapshotInput(logical, source);
          }
          if (auditedCss.has(sourceClean)) return;
          auditedCss.add(sourceClean);
          for (const dependency of inspectStylexViteCss(source, sourceClean)) {
            const from = graphName(sourceClean, rootDirectory);
            if (externalCssUrl(dependency.url)) {
              cssEdges.push({ external: true, from, kind: dependency.kind, to: `resource:${sha256(dependency.url)}` });
              continue;
            }
            const resolution = await this.resolve(dependency.url, sourceClean, { skipSelf: true });
            assert.ok(resolution !== null && resolution !== undefined, `Unresolved owned CSS import ${dependency.url} from ${from}`);
            assert.ok(
              resolution.external === undefined || resolution.external === false,
              `Owned CSS import may not be external: ${dependency.url}`,
            );
            const target = cleanModuleId(resolution.id);
            assert.ok(isAbsolute(target), `Owned CSS dependency is not an auditable file: ${dependency.url}`);
            cssEdges.push({ external: false, from, kind: dependency.kind, to: graphName(target, rootDirectory) });
            const targetLogical = rootInputPath(target, rootDirectory);
            assert.ok(targetLogical !== undefined);
            const targetBytes = await readAndSnapshotInput(targetLogical);
            if (dependency.kind === "css-url") {
              nativeInputs.add(targetLogical);
              continue;
            }
            assert.ok(/\.css$/iu.test(target), `Owned CSS import is not a CSS file: ${dependency.url}`);
            await auditCss(targetBytes.toString("utf8"), target);
          }
        };
        await auditCss(code, clean);
        return null;
      }
      if (input === undefined || !javascriptFilter.test(clean)) return null;
      if (packageBelowNodeModules(input) !== undefined) return null;
      const logical = localTransformPath(clean, rootDirectory);
      assert.ok(logical !== undefined);
      assert.equal(transformed.has(logical), false, `Vite transformed ${logical} more than once`);
      transformed.add(logical);
      const result = await collector.transform(code, clean);
      return { code: result.code, map: null };
    },
    generateBundle: {
      order: "post",
      async handler(outputOptions, bundle) {
        assert.equal(resolved, true, "StyleX Vite bundle was generated before config resolution");
        const loadedGeneration = loaded;
        const finalConfig = resolvedConfig;
        const outputPlan = plannedOutput;
        assert.ok(loadedGeneration !== undefined && finalConfig !== undefined && outputPlan !== undefined);
        validateResolvedConfig(finalConfig);
        assertOwnedOutputDirectory(outputOptions, outputPlan.outputDirectory);
        assert.equal(prepared, undefined, "StyleX Vite graph staging may be prepared only once");
        const preparedGraph = await prepareStylexGraph(options.generation, options.graphId);
        assert.deepEqual(preparedGraph, outputPlan, "Prepared Vite graph location differs from its configured output location");
        prepared = preparedGraph;
        assert.equal(sealedRules, undefined, "StyleX Vite may generate one bundle only");
        sealedRules = collector.seal();
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset") continue;
          const asset = output as EmittedAsset;
          const generatedCss = /\.css$/iu.test(asset.fileName);
          // With cssCodeSplit disabled, Vite reports the synthetic bundle label
          // `style.css` as an original file name. The actual CSS sources are
          // already snapshotted by the transform-time CSS graph audit; treating
          // this output label as an input path would invent a root file that
          // does not exist. Non-CSS assets must still carry exact source
          // provenance so their emitted bytes can be verified below.
          const provenance = generatedCss ? [] : emittedAssetProvenance(asset, rootDirectory);
          assert.ok(
            generatedCss || provenance.length > 0,
            `Vite emitted non-CSS asset without source provenance: ${asset.fileName}`,
          );
          if (generatedCss) {
            const css = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
            auditCssWithoutStandaloneRecipes(css, loadedGeneration.packageManifests);
            auditCssWithoutStylexRules(css, sealedRules, "Vite graph output");
          }
          const emittedBytes = typeof asset.source === "string" ? Buffer.from(asset.source) : Buffer.from(asset.source);
          for (const logical of provenance) {
            const sourceBytes = await readAndSnapshotInput(logical);
            emittedAssetInputs.add(logical);
            if (!generatedCss) {
              assert.deepEqual(
                { bytes: emittedBytes.byteLength, sha256: sha256(emittedBytes) },
                { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
                `Vite emitted asset differs from its source provenance: ${asset.fileName} <- ${logical}`,
              );
            }
          }
        }
      },
    },
    configureServer() {
      throw new Error("StyleX Vite does not support serve or HMR mode");
    },
    handleHotUpdate() {
      throw new Error("StyleX Vite does not support HMR");
    },
    writeBundle: {
      order: "post",
      async handler(outputOptions, bundle) {
        assert.equal(complete, false, "StyleX Vite may write one graph receipt only");
        const loadedGeneration = loaded;
        const preparedGraph = prepared;
        assert.ok(preparedGraph !== undefined && loadedGeneration !== undefined);
        assertOwnedOutputDirectory(outputOptions, preparedGraph.outputDirectory);
        const graph = loadedGeneration.expectedGraph(options.graphId);
        const rules = sealedRules;
        assert.ok(rules !== undefined, "Vite bundle rules were not sealed before receipt publication");
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset") continue;
          const asset = output as EmittedAsset;
          const path = normalizeLogicalPath(asset.fileName, "Vite output path");
          const generatedCss = /\.css$/iu.test(path);
          const provenance = generatedCss ? [] : emittedAssetProvenance(asset, rootDirectory);
          assert.ok(
            generatedCss || provenance.length > 0,
            `Vite emitted non-CSS asset without source provenance: ${path}`,
          );
          const settledBytes: Buffer = await readFile(
            join(preparedGraph.outputDirectory, ...path.split("/")),
          );
          for (const logical of provenance) {
            const sourceBytes = await readAndSnapshotInput(logical);
            emittedAssetInputs.add(logical);
            if (!generatedCss) {
              assert.deepEqual(
                { bytes: settledBytes.byteLength, sha256: sha256(settledBytes) },
                { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
                `Vite settled asset differs from its source provenance: ${path} <- ${logical}`,
              );
            }
          }
        }
        const moduleIds = [...this.getModuleIds()];
        const entrypoints = moduleIds
          .filter((id) => this.getModuleInfo(id)?.isEntry === true)
          .map((id) => rootInputPath(id, rootDirectory))
          .filter((id): id is string => id !== undefined)
          .sort();
        assert.deepEqual(entrypoints, [...graph.entrypoints].sort(), "Vite entry modules differ from the declared graph");
        const edges: StylexGraphEdgeV1[] = [...cssEdges];
        const dependency = (id: string): Readonly<{ external: boolean; to: string }> => {
          const external = this.getModuleInfo(id)?.isExternal ?? true;
          return {
            external,
            to: external ? externalGraphName(id) : graphName(id, rootDirectory),
          };
        };
        for (const id of moduleIds) {
          const info = this.getModuleInfo(id);
          if (info === null) continue;
          if (info.isExternal) externalGraphName(id);
          const from = graphName(id, rootDirectory);
          const importedIds = [...info.importedIds, ...info.dynamicallyImportedIds];
          verifyStylexDependencyEdges(
            id,
            importedIds,
            rootDirectory,
            loadedGeneration.packageManifests,
          );
          if (info.isEntry) edges.push({ external: false, from: "$entry", kind: "entry", to: from });
          for (const imported of info.importedIds) {
            const target = dependency(imported);
            edges.push({
              external: target.external,
              from,
              kind: "static-import",
              to: target.to,
            });
          }
          for (const imported of info.dynamicallyImportedIds) {
            const target = dependency(imported);
            edges.push({
              external: target.external,
              from,
              kind: "dynamic-import",
              to: target.to,
            });
          }
        }
        const canonicalEdges = [...new Map(edges.map((edge) => [canonicalJson(edge), edge])).values()]
          .sort((left, right) => compareStrings(canonicalJson(left), canonicalJson(right)));
        const expectedInputPaths = [...new Set([
          ...moduleIds.map((id) => rootInputPath(id, rootDirectory)).filter((id): id is string => id !== undefined),
          ...cssInputs,
          ...nativeInputs,
          ...emittedAssetInputs,
        ])].sort();
        assert.deepEqual(
          [...inputSnapshots.keys()].sort(),
          expectedInputPaths,
          "Vite input settlement differs from its module, CSS, and native-asset inventory",
        );
        const inputPaths = [...inputSnapshots.keys()].sort();
        for (const path of inputPaths.filter((path) => /\.css$/iu.test(path))) {
          assert.ok(cssInputs.has(path), `Vite CSS input bypassed the StyleX audit: ${path}`);
        }
        const inputs = await Promise.all(inputPaths.map(async (path) => {
          const artifact = await artifactForFile(rootDirectory, path);
          const snapshot = inputSnapshots.get(path);
          assert.ok(snapshot !== undefined);
          assert.deepEqual(
            { bytes: artifact.bytes, sha256: artifact.sha256 },
            snapshot,
            `Vite input changed during compilation: ${path}`,
          );
          verifyRegisteredPackageInput(path, artifact, loadedGeneration.packageManifests);
          return artifact;
        }));
        const outputPaths = Object.values(bundle).map((output) => normalizeLogicalPath(output.fileName, "Vite output path")).sort();
        assert.equal(new Set(outputPaths).size, outputPaths.length, "Vite output paths must be unique");
        const stylesheetOutputPaths = outputPaths.filter((path) => /\.css$/iu.test(path));
        assert.ok(
          stylesheetOutputPaths.length <= 1,
          `Vite graph ${graph.id} emitted split CSS despite the owned single-stylesheet contract`,
        );
        const hasStyledTemplate = loadedGeneration.plan.templates.some(
          (template) => template.stylesheetGraphId === graph.id,
        );
        if (graph.kind === "client" && hasStyledTemplate) {
          assert.equal(
            stylesheetOutputPaths.length,
            1,
            `Vite client graph ${graph.id} with a produced template must emit exactly one complete compiler-foundation stylesheet`,
          );
        }
        for (const path of stylesheetOutputPaths) {
          const css = await readFile(
            join(preparedGraph.outputDirectory, ...path.split("/")),
            "utf8",
          );
          auditCssWithoutStandaloneRecipes(
            css,
            loadedGeneration.packageManifests,
          );
          auditCssWithoutStylexRules(css, rules, "Vite settled graph output");
        }
        const outputs = await Promise.all(outputPaths.map((path) => artifactForFile(preparedGraph.outputDirectory, path)));
        await writeStylexGraphReceipt({
          generation: options.generation,
          rootDirectory,
          receipt: {
            adapter: "vite",
            compilerSha256,
            edges: canonicalEdges,
            entrypoints: graph.entrypoints,
            generationId: loadedGeneration.plan.generationId,
            graphId: graph.id,
            inputs,
            kind: "hraness-stylex-graph-receipt",
            outputRoot: preparedGraph.outputRoot,
            outputs,
            packages: loadedGeneration.plan.packages,
            planSha256: options.generation.planSha256,
            rules,
            rulesSha256: stylexRulesSha256(rules),
            schemaVersion: STYLEX_GRAPH_RECEIPT_SCHEMA_VERSION,
            state: "complete",
            target: graph.kind,
          },
        });
        complete = true;
      },
    },
  };
}
