import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createNextDevCompilationOwner, type NextDevCompilationContext } from "./next-dev-compilation.js";
import { NEXT_DEV_CLIENT_IMPORT } from "./next-dev-markers.js";
import type { NextDevNativeCompilation, NextDevNativeWebpack } from "./next-dev-native-plugin.js";
import type { NextDevPrivateArtifacts } from "./next-dev-artifacts.js";
import { canonicalJson, sha256 } from "./compiler.js";

import {
  createNextDevSession,
  isNextDevSource,
  STYLEX_NEXT_DEV_CONTEXT,
  STYLEX_NEXT_DEV_EXTENSION_ALIASES,
  STYLEX_NEXT_DEV_EXTENSIONS,
  type NextDevCompilerTarget,
  type StylexNextDevOptions,
} from "./next-dev-session.js";

type Compilation = NextDevNativeCompilation & {
  contextDependencies: Set<string>;
  errors: Error[];
  fileDependencies: Set<string>;
  hooks: NextDevNativeCompilation["hooks"] & Readonly<{
    finishModules: Readonly<{ tap(name: string, callback: (modules: Iterable<CompilationModule>) => void): void }>;
  }>;
  missingDependencies: Set<string>;
};
type CompilationModule = Readonly<{
  resource?: unknown;
  resourceResolveData?: unknown;
}>;
type Stats = Readonly<{
  compilation: Compilation;
  hasErrors(): boolean;
}>;
type LoaderContext = Record<symbol, unknown> & Readonly<{ resourceFragment?: unknown; resourcePath?: unknown; resourceQuery?: unknown }>;
type Compiler = Readonly<{
  hooks: Readonly<{
    beforeCompile: Readonly<{ tapPromise(name: string, callback: () => Promise<void>): void }>;
    done: Readonly<{ tap(name: string, callback: (stats: Stats) => void): void }>;
    failed: Readonly<{ tap(name: string, callback: (error: Error) => void): void }>;
    thisCompilation: Readonly<{ tap(name: string, callback: (compilation: Compilation) => void): void }>;
  }>;
  name?: unknown;
  options: Readonly<{ name?: unknown; optimization?: unknown }>;
  watching?: Readonly<{ invalidate(): void }>;
  webpack: NextDevNativeWebpack & Readonly<{
    NormalModule: Readonly<{
      getCompilationHooks(compilation: Compilation): Readonly<{
        loader: Readonly<{ tap(name: string, callback: (context: LoaderContext) => void): void }>;
      }>;
    }>;
  }>;
}>;
type WebpackConfig = Record<string, unknown> & {
  module?: { rules?: unknown[] };
  optimization?: unknown;
  plugins?: unknown[];
  resolve?: Record<string, unknown>;
};
type WebpackContext = Readonly<{
  dev: boolean;
  isServer: boolean;
  nextRuntime?: "edge" | "nodejs";
  webpack: Readonly<{ version?: unknown }>;
}>;
type Config = Record<string, unknown> & {
  webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig;
};

const MAX_COMPILATION_MODULES = 100_000;
const NEXT_EDGE_SSR_ENTRY_QUERY = "?__next_edge_ssr_entry__";

function splitResource(resource: string): Readonly<{ fragment: string; path: string; query: string }> {
  const fragmentStart = resource.indexOf("#");
  const beforeFragment = fragmentStart === -1 ? resource : resource.slice(0, fragmentStart);
  const queryStart = beforeFragment.indexOf("?");
  return {
    fragment: fragmentStart === -1 ? "" : resource.slice(fragmentStart),
    path: queryStart === -1 ? beforeFragment : beforeFragment.slice(0, queryStart),
    query: queryStart === -1 ? "" : beforeFragment.slice(queryStart),
  };
}

function requireErrorEmissionDisabled(optimization: unknown): void {
  // finishModules reports coherence failures through compilation.errors. Next's
  // pinned development policy must prevent those compilations from emitting.
  assert.ok(typeof optimization === "object" && optimization !== null && !Array.isArray(optimization), "Next development requires an explicit optimization.emitOnErrors=false policy");
  assert.ok(Object.hasOwn(optimization, "emitOnErrors") && "emitOnErrors" in optimization
    && optimization.emitOnErrors === false, "Next development requires optimization.emitOnErrors=false to prevent failed revision emission");
}

function below(root: string, path: string): boolean {
  const back = relative(root, path);
  return back.length > 0 && back !== ".." && !back.startsWith(`..${sep}`) && !back.startsWith(sep);
}

function compilerTarget(context: WebpackContext): NextDevCompilerTarget {
  if (!context.isServer) {
    assert.equal(context.nextRuntime, undefined, "Next development client compiler cannot declare a server runtime");
    return "client";
  }
  if (context.nextRuntime === "edge") return "edge-server";
  assert.equal(context.nextRuntime, "nodejs", "Next development server compiler must identify its Node or Edge runtime");
  return "server";
}

/** Private wiring core. Only the public adapter supplies its package-bound artifact reader. */
export function createNextDevAdapter<T extends object>(config: T, options: StylexNextDevOptions, artifacts: Readonly<{
  clientPath: string;
  sourceLoader: string;
  cssLoader: string;
  read(): Promise<NextDevPrivateArtifacts>;
}>): T {
  assert.ok(typeof config === "object" && config !== null && !Array.isArray(config), "Next development config must be an object");
  const base = config as Config;
  assert.equal(base.turbopack, undefined, "StyleX Next development requires next dev --webpack; Turbopack is unsupported");
  assert.ok(base.distDir === undefined || base.distDir === ".next", "StyleX Next development currently owns the ordinary .next output boundary");
  const session = createNextDevSession(options);
  const owner = createNextDevCompilationOwner(session);
  let artifactIdentity: string | null = null;
  const original = base.webpack;
  assert.ok(original === undefined || typeof original === "function", "Next webpack configuration must be a function");
  const { sourceLoader, cssLoader } = artifacts;
  const root = session.options.rootDirectory;
  const installedPackages = session.options.packageManifests.map((path) => resolve(root, path, "../.."));
  const firstParty = (path: string): boolean => {
    const parts = relative(root, path).split(sep);
    return !parts.some((part) => ["node_modules", ".next", ".git", ".stylex-generation"].includes(part));
  };
  const requireRegisteredPackage = (resource: unknown): void => {
    if (typeof resource !== "string" || !isAbsolute(resource)) return;
    if (isNextDevSource(resource) || resource.endsWith(".css")) assert.ok(below(root, resource), "Next development source or stylesheet resolves outside its owned root");
    if (!below(root, resource)) return;
    const parts = relative(root, resource).split(sep);
    const dependency = parts.lastIndexOf("node_modules");
    if (dependency < 0) return;
    const name = parts[dependency + 1];
    if (name === undefined) return;
    const packageRoot = resolve(root, ...parts.slice(0, dependency + (name.startsWith("@") ? 3 : 2)));
    if (existsSync(resolve(packageRoot, "dist/stylex-manifest.json"))) assert.ok(installedPackages.includes(packageRoot), "Next development graph contains an unregistered StyleX package");
  };
  return {
    ...config,
    webpack(initial: WebpackConfig, context: WebpackContext): WebpackConfig {
      assert.equal(context.dev, true, "StyleX Next development must not run in a production build");
      const target = compilerTarget(context);
      assert.ok(typeof context.webpack.version === "string" && /^5\./u.test(context.webpack.version), "StyleX Next development requires Webpack 5");
      const require = createRequire(resolve(root, "package.json"));
      const next: unknown = JSON.parse(readFileSync(require.resolve("next/package.json"), "utf8"));
      assert.ok(typeof next === "object" && next !== null && "version" in next && next.version === "16.2.12", "StyleX Next development requires Next 16.2.12");
      const configured = original === undefined ? initial : original(initial, context);
      assert.ok(typeof configured === "object" && configured !== null && !("then" in configured), "Next webpack config must return a synchronous configuration");
      requireErrorEmissionDisabled(configured.optimization);
      if (configured.resolve?.extensions !== undefined) assert.deepEqual(configured.resolve.extensions, STYLEX_NEXT_DEV_EXTENSIONS, "Next development resolution extensions differ from its source inventory resolution");
      const aliases = configured.resolve?.extensionAlias;
      if (aliases !== undefined) {
        assert.ok(typeof aliases === "object" && aliases !== null && !Array.isArray(aliases), "Next development extension aliases must be an object");
        for (const [key, value] of Object.entries(aliases)) {
          assert.ok(Object.hasOwn(STYLEX_NEXT_DEV_EXTENSION_ALIASES, key), "Next development extension alias is outside the reviewed source boundary");
          assert.deepEqual(value, STYLEX_NEXT_DEV_EXTENSION_ALIASES[key as keyof typeof STYLEX_NEXT_DEV_EXTENSION_ALIASES], "Next development extension alias differs from its source inventory resolution");
        }
      }
      const configuredAliases = configured.resolve?.alias;
      assert.ok(configuredAliases === undefined || typeof configuredAliases === "object" && configuredAliases !== null && !Array.isArray(configuredAliases),
        "Next development requires an ordinary alias map");
      for (const key of Object.keys(configuredAliases ?? {})) {
        const exact = key.endsWith("$");
        const prefix = exact ? key.slice(0, -1) : key;
        assert.ok(prefix !== NEXT_DEV_CLIENT_IMPORT && (exact || !NEXT_DEV_CLIENT_IMPORT.startsWith(`${prefix}/`)),
          "Next development private client alias is already owned");
      }
      const plugin = {
        apply(compiler: Compiler): void {
          assert.equal(compiler.options.name, target, "Next development compiler configured identity differs from its public configuration context");
          requireErrorEmissionDisabled(compiler.options.optimization);
          let prepared: NextDevCompilationContext | null = null;
          let capturedArtifacts: NextDevPrivateArtifacts | null = null;
          const compilationStates = new WeakMap<Compilation, { classified: boolean; context: NextDevCompilationContext; relevant: boolean }>();
          if (target === "client") owner.registerClientInvalidator(() => {
            if (compiler.watching === undefined) return false;
            compiler.watching.invalidate();
            return true;
          });
          compiler.hooks.beforeCompile.tapPromise(STYLEX_NEXT_DEV_CONTEXT, async () => {
            assert.equal(compiler.options.name, target, "Next development compiler configured identity changed after plugin application");
            assert.equal(compiler.name, target, "Next development compiler identity differs from its public configuration context");
            requireErrorEmissionDisabled(compiler.options.optimization);
            prepared = await owner.prepare(target);
            capturedArtifacts = null;
            if (prepared.preparation.snapshot !== null && prepared.preparation.error === null) {
              capturedArtifacts = await artifacts.read();
              assert.equal(capturedArtifacts.clientPath, artifacts.clientPath, "Next development private client path changed");
              assert.ok(installedPackages.includes(capturedArtifacts.packageRoot), "Next development adapter package must be registered in its source snapshot");
              if (artifactIdentity === null) artifactIdentity = capturedArtifacts.identity;
              else assert.equal(capturedArtifacts.identity, artifactIdentity, "Next development private browser artifacts changed; restart next dev");
              const manifest = prepared.preparation.snapshot.manifests.find((entry) => entry.package.name === "@hraness/ui");
              assert.ok(manifest !== undefined && sha256(canonicalJson(manifest)) === capturedArtifacts.manifestSha256,
                "Next development private browser input differs from its compilation snapshot");
            }
          });
          compiler.hooks.thisCompilation.tap(STYLEX_NEXT_DEV_CONTEXT, (compilation) => {
            assert.ok(prepared !== null, "Next development compilation started without source preparation");
            const context = prepared;
            const captured = context.preparation;
            const state = { classified: false, context, relevant: false };
            compilationStates.set(compilation, state);
            if (target === "client" && owner.hasNativeCandidate(context)) {
              assert.ok(capturedArtifacts !== null, "Next development native candidate has no exact private browser inputs");
              owner.installNative(context, compilation, compiler.webpack, capturedArtifacts.factoryExpression, () => state.classified && state.relevant);
            }
            const retained = captured.snapshot ?? captured.lastGood;
            for (const directory of session.options.sourceDirectories) {
              compilation.contextDependencies.add(resolve(root, directory));
              compilation.missingDependencies.add(resolve(root, directory));
            }
            for (const file of captured.attemptedFiles) compilation.fileDependencies.add(file);
            for (const missing of captured.attemptedMissing) compilation.missingDependencies.add(missing);
            for (const directory of retained?.directories ?? []) compilation.contextDependencies.add(directory);
            for (const file of retained?.files ?? []) {
              if (existsSync(file)) compilation.fileDependencies.add(file);
              else compilation.missingDependencies.add(file);
            }
            compilation.hooks.finishModules.tap(STYLEX_NEXT_DEV_CONTEXT, (modules) => {
              assert.equal(state.classified, false, "Next development compilation modules were classified more than once");
              state.classified = true;
              let count = 0;
              let source = false;
              let stylesheet = false;
              for (const module of modules) {
                assert.ok(++count <= MAX_COMPILATION_MODULES, "Next development compilation exceeds its module bound");
                if (typeof module !== "object" || module === null) continue;
                const resolution = typeof module.resourceResolveData === "object" && module.resourceResolveData !== null
                  ? module.resourceResolveData as Readonly<Record<string, unknown>>
                  : null;
                const raw = typeof module.resource === "string" ? module.resource : null;
                const rawParts = raw === null ? null : splitResource(raw);
                const rawPath = rawParts?.path ?? null;
                const path = typeof resolution?.path === "string" ? resolution.path : rawPath;
                if (rawPath !== null && isAbsolute(rawPath)) {
                  requireRegisteredPackage(rawPath);
                  const rawOwned = below(root, rawPath)
                    && (isNextDevSource(rawPath) || rawPath.endsWith(".css"))
                    && (firstParty(rawPath) || installedPackages.some((directory) => below(directory, rawPath)));
                  assert.ok(!rawOwned || path === rawPath, "Next development owned module graph resource path differs from its resolution");
                }
                if (path === null || !isAbsolute(path)) continue;
                requireRegisteredPackage(path);
                // Next owns native assets, including icon.svg?__next_metadata__.
                // Their loader-generated JavaScript is not an authored StyleX
                // source. Match the same JS/CSS boundary as our loader hook.
                // The sole source-query exception is pinned Next's first-party
                // Edge SSR entry; dynamic metadata and every queried stylesheet
                // stay closed.
                if (!isNextDevSource(path) && !path.endsWith(".css")) continue;
                const owned = below(root, path) && (firstParty(path) || installedPackages.some((directory) => below(directory, path)));
                if (!owned) continue;
                assert.ok(raw === null || rawPath === path, "Next development owned module graph resource path differs from its resolution");
                const rawFragment = rawParts?.fragment ?? "";
                const resolutionFragment = resolution?.fragment;
                assert.ok(rawFragment === "" && (resolutionFragment === undefined || resolutionFragment === ""), "Next development owned module graph contains a resource fragment");
                const rawQuery = rawParts?.query ?? "";
                const resolutionQuery = resolution?.query;
                const ordinaryQuery = rawQuery === "" && (resolutionQuery === undefined || resolutionQuery === "");
                const exactEdgeSsrQuery = target === "edge-server"
                  && isNextDevSource(path)
                  && firstParty(path)
                  && rawParts !== null
                  && rawParts.path === path
                  && rawQuery === NEXT_EDGE_SSR_ENTRY_QUERY
                  && resolution !== null
                  && resolution.path === path
                  && resolutionQuery === NEXT_EDGE_SSR_ENTRY_QUERY;
                assert.ok(ordinaryQuery || exactEdgeSsrQuery, "Next development owned module graph contains a resource query outside the exact Edge SSR entry contract");
                stylesheet ||= path === resolve(root, session.options.cssEntry);
                source ||= isNextDevSource(path);
              }
              if (target === "client" && source && !stylesheet) {
                compilation.errors.push(new Error("Next development client source graph omitted its owned StyleX stylesheet entry"));
              }
              state.relevant = target === "client" ? stylesheet : source;
              if ((source || stylesheet) && captured.error !== null) compilation.errors.push(captured.error);
              const error = owner.validate(context, state.relevant);
              if (error !== null && !compilation.errors.includes(error)) compilation.errors.push(error);
            });
            compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(STYLEX_NEXT_DEV_CONTEXT, (loaderContext) => {
              requireRegisteredPackage(loaderContext.resourcePath);
              const path = loaderContext.resourcePath;
              const owned = typeof path === "string" && below(root, path) && (isNextDevSource(path) || path.endsWith(".css")) && (firstParty(path) || installedPackages.some((directory) => below(directory, path)));
              if (owned) {
                assert.ok(loaderContext.resourceFragment === undefined || loaderContext.resourceFragment === "", "Next development owned resources must not contain a fragment");
                const ordinaryQuery = loaderContext.resourceQuery === undefined || loaderContext.resourceQuery === "";
                const exactEdgeSsrQuery = target === "edge-server"
                  && typeof path === "string"
                  && isNextDevSource(path)
                  && firstParty(path)
                  && loaderContext.resourceQuery === NEXT_EDGE_SSR_ENTRY_QUERY;
                assert.ok(ordinaryQuery || exactEdgeSsrQuery, "Next development owned resources must not contain a query outside the exact Edge SSR entry contract");
              }
              Object.defineProperty(loaderContext, Symbol.for(STYLEX_NEXT_DEV_CONTEXT), { value: context });
            });
          });
          compiler.hooks.done.tap(STYLEX_NEXT_DEV_CONTEXT, (stats) => {
            const state = compilationStates.get(stats.compilation);
            assert.ok(state !== undefined, "Next development compiler completed an unknown compilation");
            if (!state.classified && !stats.hasErrors()) stats.compilation.errors.push(new Error("Next development successful compilation omitted its final module-graph classification"));
            try { owner.complete(state.context, state.relevant, !stats.hasErrors()); }
            finally { prepared = null; }
          });
          compiler.hooks.failed.tap(STYLEX_NEXT_DEV_CONTEXT, () => {
            try { owner.abort(target); }
            finally { prepared = null; }
          });
        },
      };
      return {
        ...configured,
        resolve: { ...configured.resolve, alias: { ...configuredAliases, [`${NEXT_DEV_CLIENT_IMPORT}$`]: artifacts.clientPath },
          extensions: [...STYLEX_NEXT_DEV_EXTENSIONS], extensionAlias: { ...STYLEX_NEXT_DEV_EXTENSION_ALIASES } },
        module: {
          ...configured.module,
          rules: [
            ...(configured.module?.rules ?? []),
            {
              enforce: "pre",
              include: (path: string) => below(root, path) && isNextDevSource(path) && (firstParty(path) || installedPackages.some((directory) => below(directory, path))),
              use: [{ loader: sourceLoader }],
            },
            {
              enforce: "pre",
              include: (path: string) => path.endsWith(".css") && below(root, path) && (firstParty(path) || installedPackages.some((directory) => below(directory, path))),
              use: [{ loader: cssLoader }],
            },
          ],
        },
        plugins: [...(configured.plugins ?? []), plugin],
      };
    },
  };
}
