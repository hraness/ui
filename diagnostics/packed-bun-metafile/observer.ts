import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type DiagnosticMode = "single-package" | "cross-package";
export type DiagnosticArguments = Readonly<{
  mode: DiagnosticMode;
  consumer: string;
  entry: string;
  output: string;
}>;

export function containsPath(root: string, path: string): boolean {
  const back = relative(root, path);
  return back === "" || (!isAbsolute(back) && back !== ".." && !back.startsWith(`..${sep}`));
}

/** Parsing performs no filesystem access, build, import, or global mutation. */
export function parseDiagnosticArguments(argv: readonly string[], cwd: string, repository: string): DiagnosticArguments {
  assert.equal(argv.length, 8, "Expected --mode, --consumer, --entry, and --output pairs");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok(flag !== undefined && ["--mode", "--consumer", "--entry", "--output"].includes(flag), "Unknown diagnostic argument");
    assert.ok(!values.has(flag), "Duplicate diagnostic argument");
    assert.ok(value !== undefined && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f]/u.test(value), "Invalid diagnostic argument value");
    values.set(flag, value);
  }
  const mode = values.get("--mode");
  assert.ok(mode === "single-package" || mode === "cross-package", "Unknown diagnostic mode");
  const entry = values.get("--entry")!;
  assert.ok(!isAbsolute(entry) && !entry.includes("\\") && !entry.includes(":")
    && entry.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    && /\.(?:ts|mts|js|mjs)$/u.test(entry), "Entry must be a normalized relative build-only script");
  const consumer = resolve(cwd, values.get("--consumer")!);
  const output = resolve(cwd, values.get("--output")!);
  assert.ok(!containsPath(consumer, output) && !containsPath(output, consumer), "Output and consumer must be separate trees");
  assert.ok(!containsPath(repository, output) && !containsPath(output, repository), "Output and public source must be separate trees");
  return { mode, consumer, entry, output };
}

export function diagnosticDigest(bytes: string | Uint8Array | ArrayBuffer): string {
  return createHash("sha256").update(typeof bytes === "string" ? Buffer.from(bytes)
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).digest("hex");
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "Expected metafile object");
  return value as Record<string, unknown>;
}

export function selectMetafileImports(raw: unknown, mode: DiagnosticMode, root: string, cwd: string) {
  const inputs = raw === undefined ? {} : object(object(raw).inputs ?? {});
  const keys = Object.keys(inputs);
  const target = mode === "single-package" ? "Collection.mjs" : "openLink.mjs";
  const matches = keys.flatMap((key) => {
    const metadata = object(inputs[key]);
    const imports = metadata.imports ?? [];
    assert.ok(Array.isArray(imports), "Expected metafile imports array");
    return imports.map(object).filter((entry) => key.includes("react-aria-components")
      && typeof entry.path === "string" && entry.path.includes(target)).map((entry) => ({
        importer: key,
        importerMetadata: metadata,
        rawImport: entry,
        ownKeys: Object.keys(entry),
        resolvedFromImporter: resolve(dirname(isAbsolute(key) ? key : resolve(root, key)), String(entry.path)),
        resolvedFromRoot: resolve(root, String(entry.path)),
        resolvedFromCwd: resolve(cwd, String(entry.path)),
      }));
  });
  return { keys, matches };
}

export function diagnosticPackagePaths(mode: DiagnosticMode, root: string) {
  const component = resolve(root, "node_modules/react-aria-components");
  if (mode === "single-package") return {
    roots: [component],
    paths: [component, resolve(component, "package.json"), resolve(component, "dist/package.json"),
      resolve(component, "dist/exports/package.json"), resolve(component, "dist/private/package.json"),
      resolve(component, "dist/exports/index.mjs"), resolve(component, "dist/private/Collection.mjs")],
  };
  const aria = resolve(root, "node_modules/react-aria");
  return {
    roots: [component, aria],
    paths: [component, aria, resolve(component, "package.json"), resolve(aria, "package.json"),
      resolve(component, "dist/exports/index.mjs"), resolve(aria, "dist/exports/private/utils/openLink.mjs"),
      resolve(aria, "dist/private/utils/openLink.mjs")],
  };
}

export type BuildObservation = Readonly<{
  number: number;
  root: string;
  cwd: string;
  options: Bun.BuildConfig;
  result: Bun.BuildOutput;
  events: readonly Record<string, unknown>[];
}>;

/** Inject a build function and sink so tests never invoke Bun.build or write. */
export function createObservedBuild(original: typeof Bun.build, record: (observation: BuildObservation) => Promise<void>, cwd: () => string): typeof Bun.build {
  let sequence = 0;
  return async (options) => {
    const number = ++sequence;
    const workingDirectory = cwd();
    const root = resolve(workingDirectory, options.root ?? workingDirectory);
    const events: Record<string, unknown>[] = [];
    const plugins = options.plugins?.map((plugin) => ({
      ...plugin,
      setup(builder: Bun.PluginBuilder) {
        const facade = new Proxy(builder, {
          get(target, property) {
            if (property === "onLoad") {
              return (filter: Parameters<Bun.PluginBuilder["onLoad"]>[0], callback: Bun.OnLoadCallback) => target.onLoad(filter, async (args) => {
                const event: Record<string, unknown> = {
                  plugin: plugin.name, path: args.path, namespace: args.namespace,
                  logical: relative(root, resolve(workingDirectory, args.path)), state: "started",
                };
                events.push(event);
                try {
                  const loaded = await callback(args);
                  const contents = loaded !== undefined && "contents" in loaded ? loaded.contents : undefined;
                  event.state = "completed";
                  event.loader = loaded?.loader;
                  event.hasResult = loaded !== undefined;
                  if (typeof contents === "string" || contents instanceof Uint8Array || contents instanceof ArrayBuffer) {
                    event.bytes = typeof contents === "string" ? Buffer.byteLength(contents) : contents.byteLength;
                    event.sha256 = diagnosticDigest(contents);
                  }
                  return loaded;
                } catch (error) {
                  event.state = "rejected";
                  event.error = String(error);
                  throw error;
                }
              });
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return plugin.setup(facade);
      },
    }));
    const result = await original({ ...options, ...(plugins === undefined ? {} : { plugins }) });
    await record({ number, root, cwd: workingDirectory, options, result, events });
    return result;
  };
}
