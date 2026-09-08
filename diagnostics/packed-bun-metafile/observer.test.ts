import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  createObservedBuild, diagnosticDigest, diagnosticPackagePaths, parseDiagnosticArguments,
  selectMetafileImports, type BuildObservation,
} from "./observer.ts";

const cwd = resolve("/");
const repository = resolve(cwd, "public-source");
const consumer = resolve(cwd, "consumer");
const output = resolve(cwd, "private-output");
const argumentsFor = (mode = "single-package") => [
  "--mode", mode, "--consumer", consumer, "--entry", "scripts/build.ts", "--output", output,
];

test("arguments select only the finite modes and separate consumer, source, and private output", () => {
  for (const mode of ["single-package", "cross-package"] as const) {
    expect(parseDiagnosticArguments(argumentsFor(mode), cwd, repository)).toEqual({ mode, consumer, entry: "scripts/build.ts", output });
  }
  expect(parseDiagnosticArguments(argumentsFor().map((value) => value === consumer ? "consumer" : value), cwd, repository).consumer).toBe(consumer);
  const replace = (flag: string, value: string) => {
    const argv = argumentsFor();
    argv[argv.indexOf(flag) + 1] = value;
    return argv;
  };
  for (const argv of [
    [], argumentsFor().slice(0, 6), [...argumentsFor(), "--extra", "x"],
    ["--mode", "single-package", "--mode", "cross-package", "--entry", "build.ts", "--output", output],
    replace("--mode", "all"), replace("--consumer", ""), replace("--consumer", "a\u0000b"),
    ...["../build.ts", "nested/../build.ts", "./build.ts", "/build.ts", "a\\build.ts", "file:build.ts", "build.json", "a//build.ts"]
      .map((value) => replace("--entry", value)),
    ...[consumer, resolve(consumer, "output"), repository, resolve(repository, "output"), cwd].map((value) => replace("--output", value)),
  ]) expect(() => parseDiagnosticArguments(argv, cwd, repository)).toThrow();
});

test("mode-specific import selection preserves original raw metadata, keys, order, and all resolution hypotheses", () => {
  const collection = { path: "../private/Collection.mjs", kind: "import-statement", external: false };
  const openLink = { path: "../../../react-aria/dist/private/utils/openLink.mjs", external: true, custom: "retained" };
  const importer = "node_modules/react-aria-components/dist/exports/index.mjs";
  const metadata = { format: "esm", bytes: 42, imports: [collection, openLink] };
  const raw = { inputs: { [importer]: metadata, "src/app.ts": { imports: [collection] } }, outputs: { "app.js": { bytes: 7 } } };
  for (const [mode, entry] of [["single-package", collection], ["cross-package", openLink]] as const) {
    const selected = selectMetafileImports(raw, mode, consumer, cwd);
    expect(selected.keys).toEqual([importer, "src/app.ts"]);
    expect(selected.matches).toHaveLength(1);
    expect(selected.matches[0]?.rawImport).toBe(entry);
    expect(selected.matches[0]?.importerMetadata).toBe(metadata);
    expect(selected.matches[0]?.ownKeys).toEqual(Object.keys(entry));
    expect(selected.matches[0]?.resolvedFromImporter).toBe(resolve(consumer, "node_modules/react-aria-components/dist/exports", entry.path));
    expect(selected.matches[0]?.resolvedFromRoot).toBe(resolve(consumer, entry.path));
    expect(selected.matches[0]?.resolvedFromCwd).toBe(resolve(cwd, entry.path));
  }
  expect(selectMetafileImports(undefined, "single-package", consumer, cwd)).toEqual({ keys: [], matches: [] });
  expect(() => selectMetafileImports({ inputs: [] }, "single-package", consumer, cwd)).toThrow();
  expect(() => selectMetafileImports({ inputs: { input: { imports: false } } }, "single-package", consumer, cwd)).toThrow();
});

test("finite package probes preserve both original inventories without merging the two modes", () => {
  const component = resolve(consumer, "node_modules/react-aria-components");
  const aria = resolve(consumer, "node_modules/react-aria");
  expect(diagnosticPackagePaths("single-package", consumer)).toEqual({
    roots: [component], paths: [component, resolve(component, "package.json"), resolve(component, "dist/package.json"),
      resolve(component, "dist/exports/package.json"), resolve(component, "dist/private/package.json"),
      resolve(component, "dist/exports/index.mjs"), resolve(component, "dist/private/Collection.mjs")],
  });
  expect(diagnosticPackagePaths("cross-package", consumer)).toEqual({
    roots: [component, aria], paths: [component, aria, resolve(component, "package.json"), resolve(aria, "package.json"),
      resolve(component, "dist/exports/index.mjs"), resolve(aria, "dist/exports/private/utils/openLink.mjs"),
      resolve(aria, "dist/private/utils/openLink.mjs")],
  });
});

test("injected observation preserves build options, plugin results, metadata, content hashes, and result identity", async () => {
  const observations: BuildObservation[] = [];
  const contents = ["source", new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]).buffer];
  const result = { success: true, metafile: { inputs: {} } } as Bun.BuildOutput;
  let builds = 0;
  const callbacks: Bun.OnLoadCallback[] = [];
  const fakeBuilder = {
    onLoad(_filter: unknown, callback: Bun.OnLoadCallback) { callbacks.push(callback); },
  } as Bun.PluginBuilder;
  const options: Bun.BuildConfig = {
    entrypoints: ["entry.ts"], target: "browser", minify: true, splitting: true,
    conditions: ["custom"], format: "esm", metafile: true,
    plugins: [{ name: "observed", setup(builder) {
      for (const value of contents) builder.onLoad({ filter: /source/u }, () => ({ contents: value, loader: "ts" }));
      builder.onLoad({ filter: /none/u }, () => undefined);
    } }],
  };
  const observed = createObservedBuild(async (received) => {
    builds += 1;
    expect({ ...received, plugins: options.plugins }).toEqual(options);
    expect(received.plugins?.[0]?.name).toBe("observed");
    expect(received.plugins?.[0]?.setup).not.toBe(options.plugins?.[0]?.setup);
    for (const plugin of received.plugins ?? []) await plugin.setup(fakeBuilder);
    for (const [index, callback] of callbacks.entries()) {
      const loaded = await callback({ path: resolve(consumer, `source-${index}.ts`), namespace: "file", loader: "ts" } as Bun.OnLoadArgs);
      if (index < contents.length) expect(loaded && "contents" in loaded ? loaded.contents : undefined).toBe(contents[index]);
      else expect(loaded).toBeUndefined();
    }
    return result;
  }, async (observation) => { observations.push(observation); }, () => consumer);
  // Plugin setup is deliberately wrapped; every other option stays identical.
  const originalSetup = options.plugins![0]!.setup;
  expect(await observed(options)).toBe(result);
  expect(options.plugins![0]!.setup).toBe(originalSetup);
  expect(builds).toBe(1);
  expect(observations[0]?.options).toBe(options);
  expect(observations[0]?.result).toBe(result);
  expect(observations[0]?.number).toBe(1);
  expect(observations[0]?.root).toBe(consumer);
  expect(observations[0]?.events).toHaveLength(4);
  for (const [index, value] of contents.entries()) {
    expect(observations[0]?.events[index]).toMatchObject({
      plugin: "observed", namespace: "file", logical: `source-${index}.ts`, state: "completed", loader: "ts", hasResult: true,
      bytes: typeof value === "string" ? Buffer.byteLength(value) : value.byteLength, sha256: diagnosticDigest(value),
    });
  }
  expect(observations[0]?.events[3]).toMatchObject({ state: "completed", hasResult: false });
});

test("failed onLoad callbacks retain their error identity and rejected observation", async () => {
  const failure = new Error("synthetic plugin failure");
  const observations: BuildObservation[] = [];
  let callback!: Bun.OnLoadCallback;
  const builder = { onLoad(_filter: unknown, value: Bun.OnLoadCallback) { callback = value; } } as Bun.PluginBuilder;
  const result = { success: false } as Bun.BuildOutput;
  const observed = createObservedBuild(async (options) => {
    await options.plugins![0]!.setup(builder);
    try { await callback({ path: resolve(consumer, "source.ts"), namespace: "file" } as Bun.OnLoadArgs); }
    catch (error) { expect(error).toBe(failure); }
    return result;
  }, async (observation) => { observations.push(observation); }, () => consumer);
  expect(await observed({ entrypoints: ["entry.ts"], plugins: [{ name: "failing", setup(value) {
    value.onLoad({ filter: /source/u }, () => { throw failure; });
  } }] })).toBe(result);
  expect(observations[0]?.events[0]).toMatchObject({ state: "rejected", error: String(failure) });
});

test("build and recording failures stay visible without inventing a completed observation", async () => {
  let records = 0;
  const failure = new Error("synthetic build failure");
  const failed = createObservedBuild(async () => { throw failure; }, async () => { records += 1; }, () => consumer);
  await expect(failed({ entrypoints: ["entry.ts"] })).rejects.toBe(failure);
  expect(records).toBe(0);
  const result = { success: true } as Bun.BuildOutput;
  const recordingFailure = createObservedBuild(async () => result, async () => { throw failure; }, () => consumer);
  await expect(recordingFailure({ entrypoints: ["entry.ts"] })).rejects.toBe(failure);
});

test("importing the CLI for syntax checking does not install an observer or change the working directory", async () => {
  const build = Bun.build;
  const before = process.cwd();
  await import("./run.ts");
  expect(Bun.build).toBe(build);
  expect(process.cwd()).toBe(before);
});
