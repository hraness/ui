import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { collectBunStylexGraph } from "../build/bun.js";
import {
  createStylexGeneration,
  finalizeStylexGeneration,
  prepareStylexProducedTemplate,
  sealStylexProducedTemplate,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
} from "../build/index.js";

const PREFIX = "components.hraness-ui";
const COMMAND_TIMEOUT_MS = 120_000;
const EVALUATOR_TIMEOUT_MS = 15_000;
const TERMINATION_GRACE_MS = 2_000;
const variants = [
  { dynamic: false, padding: false, name: "static-longhand" },
  { dynamic: false, padding: true, name: "static-shorthand" },
  { dynamic: true, padding: false, name: "dynamic-longhand" },
  { dynamic: true, padding: true, name: "dynamic-shorthand" },
] as const;
type Variant = (typeof variants)[number];
type Rule = Readonly<{ selector: string; body: string; layer: string; media: readonly string[]; order: number }>;
type Sheet = Readonly<{ layers: readonly string[]; rules: readonly Rule[] }>;
type Snapshot = Readonly<Record<"pageDefault" | "pageCaller" | "duplicate" | "exact" | "exactReverse" | "padding" | "paddingReverse" | "inventory", string>>;
type DirectoryIdentity = Readonly<{
  dev: number;
  ino: number;
  path: string;
}>;
type FixtureWorkspace = Readonly<{
  createdFixtureRoot: boolean;
  fixtureRoot: string;
  fixtureRootIdentity: DirectoryIdentity;
  work: string;
  workIdentity: DirectoryIdentity;
}>;

function parseSnapshot(value: unknown): Snapshot {
  assert.ok(typeof value === "object" && value !== null);
  const keys = ["pageDefault", "pageCaller", "duplicate", "exact", "exactReverse", "padding", "paddingReverse", "inventory"] as const;
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), "Snapshot keys must remain exact");
  for (const key of keys) assert.ok(typeof Reflect.get(value, key) === "string", `Missing snapshot ${key}`);
  return value as Snapshot;
}

function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function blockEnd(source: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote !== "") {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      assert.notEqual(end, -1, "CSS comment must terminate");
      index = end + 1;
    } else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  throw new Error("CSS block must terminate");
}

/** Parse complete layer names, including nested and previously unknown priorities. */
function parseCss(source: string): Sheet {
  const layers: string[] = [];
  const rules: Rule[] = [];
  const remember = (name: string): void => { if (!layers.includes(name)) layers.push(name); };
  function walk(css: string, layer = "", media: readonly string[] = []): void {
    let start = 0;
    let quote = "";
    for (let index = 0; index < css.length; index += 1) {
      const character = css[index]!;
      if (quote !== "") {
        if (character === "\\") index += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (css.startsWith("/*", index)) {
        const end = css.indexOf("*/", index + 2);
        assert.notEqual(end, -1);
        index = end + 1;
        continue;
      }
      if (character !== ";" && character !== "{") continue;
      const header = css.slice(start, index).replace(/\/\*[\s\S]*?\*\//gu, "").trim();
      const layerHeader = /^@layer\s+(.+)$/u.exec(header);
      if (character === ";") {
        if (layerHeader !== null) {
          for (const name of layerHeader[1]!.split(",").map((name) => name.trim())) remember(layer === "" ? name : `${layer}.${name}`);
        }
        start = index + 1;
        continue;
      }
      const end = blockEnd(css, index);
      const body = css.slice(index + 1, end);
      if (layerHeader !== null) {
        assert.ok(!layerHeader[1]!.includes(","), "A layer block must have one name");
        const name = layer === "" ? layerHeader[1]! : `${layer}.${layerHeader[1]!}`;
        remember(name);
        walk(body, name, media);
      } else if (/^@(?:media|supports|container)\b/u.test(header)) {
        walk(body, layer, [...media, header]);
      } else if (!header.startsWith("@")) {
        for (const selector of header.split(",")) rules.push({ selector: selector.trim(), body, layer, media, order: rules.length });
      }
      index = end;
      start = end + 1;
    }
  }
  walk(source);
  return { layers, rules };
}

function requireKnownLayers(sheet: Sheet): void {
  const names = sheet.layers.filter((name) => name === PREFIX || name.startsWith(`${PREFIX}.`));
  assert.ok(names.length > 0, "The fixture must contain namespaced package layers");
  assert.deepEqual(
    names.filter((name) => name !== PREFIX
      && !new RegExp(`^${PREFIX.replaceAll(".", "\\.")}\\.(?:legacy(?:\\.[A-Za-z0-9_-]+)*|priority[1-9]\\d*)$`, "u").test(name)),
    [],
    `Unexpected complete layer census: ${JSON.stringify(names)}`,
  );
  assert.ok(sheet.rules.every((rule) => rule.layer !== PREFIX), "Rules must not escape into the namespace parent layer");
}

function classes(markup: string): string[] {
  const values = /class="([^"]*)"/u.exec(markup)?.[1];
  assert.ok(values !== undefined, "Rendered fixture must expose class names");
  return values.split(/\s+/u).filter(Boolean);
}

function active(media: readonly string[], width: number): boolean {
  for (const condition of media) {
    const normalized = condition.replace(/\s+/gu, "");
    if (normalized === "@media(max-width:40rem)" || normalized === "@media(width<=40rem)") {
      if (width > 640) return false;
    } else {
      throw new Error(`Unmodeled condition on a target atom: ${condition}`);
    }
  }
  return true;
}

function winner(sheet: Sheet, names: readonly string[], property: string, width: number): string {
  const candidates: { value: string; rank: number; specificity: number; order: number }[] = [];
  for (const rule of sheet.rules) {
    const owners = [...rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/gu)].map((match) => match[1]!);
    if (!owners.some((name) => names.includes(name))) continue;
    assert.ok(/^(?:\.[A-Za-z_][\w-]*)+$/u.test(rule.selector), `Unmodeled selector on a target atom: ${rule.selector}`);
    if (!owners.every((name) => names.includes(name))) continue;
    const declarations = rule.body.split(";").flatMap((part) => {
      const colon = part.indexOf(":");
      if (colon < 0) return [];
      const name = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      if (name === property) return [value];
      if (property === "padding-left" && name === "padding") {
        const parts = value.split(/\s+/u);
        assert.ok(parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^\d+px$/u.test(part)), "Only the fixture's pixel padding shorthand is modeled");
        return [parts.length === 1 ? parts[0]! : parts.length === 4 ? parts[3]! : parts[1]!];
      }
      return [];
    });
    if (declarations.length === 0 || !active(rule.media, width)) continue;
    assert.ok(rule.layer.startsWith(`${PREFIX}.`), `Target atom escaped package namespace: ${rule.layer}`);
    assert.ok(declarations.every((value) => !value.includes("!important")), "The fixture does not model important declarations");
    for (const value of declarations) candidates.push({ value, rank: sheet.layers.indexOf(rule.layer), specificity: owners.length, order: rule.order });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.specificity - b.specificity || a.order - b.order);
  assert.ok(candidates.length > 0, `No owned ${property} declaration at ${String(width)}px`);
  return candidates.at(-1)!.value.replace(/\s+/gu, "");
}

function verify(sheet: Sheet, snapshot: Snapshot, variant: Variant): void {
  const defaultClasses = classes(snapshot.pageDefault);
  const duplicateClasses = classes(snapshot.duplicate);
  const callerClasses = classes(snapshot.pageCaller);
  assert.equal(duplicateClasses.length, 2, "Both PageIntro properties must retain exactly their default atoms");
  assert.equal(new Set(duplicateClasses).size, 2, "Duplicated PageIntro defaults must remain distinct");
  assert.ok(duplicateClasses.every((name) => defaultClasses.includes(name)), "Duplicated PageIntro defaults must use the package's exact class identities");
  for (const width of [390, 900]) {
    assert.equal(winner(sheet, defaultClasses, "align-items", width), width <= 640 ? "start" : "end", `PageIntro alignment at ${String(width)}px`);
    assert.equal(winner(sheet, defaultClasses, "grid-template-columns", width), width <= 640 ? "minmax(0,1fr)" : "minmax(0,1fr)auto", `PageIntro columns at ${String(width)}px`);
    assert.equal(winner(sheet, callerClasses, "align-items", width), "center", `Caller alignment at ${String(width)}px`);
    assert.equal(winner(sheet, callerClasses, "grid-template-columns", width), "1fr", `Caller columns at ${String(width)}px`);
    assert.equal(winner(sheet, classes(snapshot.exact), "padding-left", width), "11px", "Exact-property last caller must win");
    assert.equal(winner(sheet, classes(snapshot.exactReverse), "padding-left", width), "9px", "Exact-property reversed caller must win");
    if (variant.padding) {
      assert.equal(winner(sheet, classes(snapshot.padding), "padding-left", width), "7px", "Physical longhand must retain property specificity after a shorthand");
      assert.equal(winner(sheet, classes(snapshot.paddingReverse), "padding-left", width), "7px", "Physical longhand must retain property specificity before a shorthand");
    }
  }
}

function modelControls(): void {
  const positive = parseCss(`@layer ${PREFIX}.priority3; @layer ${PREFIX}.priority3 { .xBase { align-items: end; } @media(max-width:40rem) { .xCompact.xCompact { align-items: start; } } }`);
  assert.equal(winner(positive, ["xBase", "xCompact"], "align-items", 390), "start");
  const negative = parseCss(`@layer ${PREFIX}.priority3, ${PREFIX}.priority4; @layer ${PREFIX}.priority3 { .xBase { align-items: end; } @media(max-width:40rem) { .xCompact.xCompact { align-items: start; } } } @layer ${PREFIX}.priority4 { .xBase { align-items: end; } }`);
  assert.throws(() => assert.equal(winner(negative, ["xBase", "xCompact"], "align-items", 390), "start"), /end/u, "A late duplicate default atom must be detected");
  requireKnownLayers(parseCss(`@layer ${PREFIX}.priority5 { .xComplete { display: grid; } }`));
  assert.throws(() => requireKnownLayers(parseCss(`@layer ${PREFIX}.priority0 { .xHidden { display: grid; } }`)), /priority0/u, "An invalid ordinal cannot evade the census");
  assert.throws(() => winner(positive, [], "align-items", 390), /No owned/u, "Missing classes cannot pass the cascade model");
}

function fixture(variant: Variant): string {
  return `import * as stylex from "@stylexjs/stylex";
import { PageIntro } from "@hraness/ui";
import "@hraness/ui/compiler-foundation.css";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const styles = stylex.create({
  duplicate: {
    alignItems: "end",
    gridTemplateColumns: "minmax(0, 1fr) auto",
  },
  caller: { alignItems: "center", gridTemplateColumns: "1fr" },
  exactFirst: { paddingLeft: "9px" }, exactLast: { paddingLeft: "11px" },
  edge: { paddingLeft: "7px" },
  // Keep the intermediate shorthand bucket present without duplicating package
  // compact atoms. Optional padding and dynamic rules vary the lower buckets.
  inventory: { color: "rgb(1, 2, 3)", borderRadius: "13px" },
  ${variant.padding ? 'shorthand: { padding: "19px" },' : ""}
  ${variant.dynamic ? 'dynamic: (value: string) => ({ width: value }),' : ""}
});
const div = (value: ReturnType<typeof stylex.props>) => renderToStaticMarkup(React.createElement("div", value));
export const snapshot = {
  pageDefault: renderToStaticMarkup(React.createElement(PageIntro, { title: "Default", actions: "Actions" })),
  pageCaller: renderToStaticMarkup(React.createElement(PageIntro, { title: "Caller", xstyle: styles.caller })),
  duplicate: div(stylex.props(styles.duplicate)),
  exact: div(stylex.props(styles.exactFirst, styles.exactLast)),
  exactReverse: div(stylex.props(styles.exactLast, styles.exactFirst)),
  padding: div(stylex.props(${variant.padding ? "styles.edge, styles.shorthand" : "styles.edge"})),
  paddingReverse: div(stylex.props(${variant.padding ? "styles.shorthand, styles.edge" : "styles.edge"})),
  inventory: div(stylex.props(styles.inventory${variant.dynamic ? ', styles.dynamic("13px")' : ""})),
};
`;
}

async function filesBelow(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await filesBelow(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Unexpected compiler artifact type: ${path}`);
  }
  return paths.sort();
}

async function lstatIfPresent(path: string) {
  return lstat(path).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function requireDirectoryIdentity(
  path: string,
  expectedRealpath: string,
  description: string,
): Promise<DirectoryIdentity> {
  const stat = await lstat(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${description} must be an ordinary directory`);
  const resolved = await realpath(path);
  assert.equal(resolved, expectedRealpath, `${description} must not traverse a symlink`);
  return { dev: stat.dev, ino: stat.ino, path: resolved };
}

async function requireSameDirectory(
  path: string,
  identity: DirectoryIdentity,
  description: string,
): Promise<void> {
  const current = await requireDirectoryIdentity(path, identity.path, description);
  assert.deepEqual(
    { dev: current.dev, ino: current.ino },
    { dev: identity.dev, ino: identity.ino },
    `${description} identity changed during the gate`,
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function removeOwnedEmptyFixtureRoot(
  fixtureRoot: string,
  identity: DirectoryIdentity,
): Promise<void> {
  if (await lstatIfPresent(fixtureRoot) === undefined) return;
  await requireSameDirectory(fixtureRoot, identity, "The shared StyleX fixture root");
  try {
    await rmdir(fixtureRoot);
  } catch (error) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes(errorCode(error) ?? "")) return;
    throw error;
  }
}

async function createFixtureWorkspace(repository: string): Promise<FixtureWorkspace> {
  const repositoryRealpath = await realpath(repository);
  assert.equal(repositoryRealpath, repository, "The repository root must not traverse a symlink");
  const fixtureRoot = join(repository, ".stylex-fixtures");
  let createdFixtureRoot = false;
  let fixtureRootIdentity: DirectoryIdentity | undefined;
  try {
    if (await lstatIfPresent(fixtureRoot) === undefined) {
      try {
        await mkdir(fixtureRoot, { mode: 0o700 });
        createdFixtureRoot = true;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    fixtureRootIdentity = await requireDirectoryIdentity(
      fixtureRoot,
      join(repositoryRealpath, ".stylex-fixtures"),
      "The shared StyleX fixture root",
    );

    const work = join(fixtureRoot, "consumer-layers");
    assert.equal(
      await lstatIfPresent(work),
      undefined,
      "The fixed ignored consumer-layer fixture path must be absent before the gate",
    );
    await mkdir(work, { mode: 0o700 });
    const workIdentity = await requireDirectoryIdentity(
      work,
      join(repositoryRealpath, ".stylex-fixtures/consumer-layers"),
      "The consumer-layer fixture workspace",
    );
    return { createdFixtureRoot, fixtureRoot, fixtureRootIdentity, work, workIdentity };
  } catch (error) {
    if (createdFixtureRoot && fixtureRootIdentity !== undefined) {
      try {
        await removeOwnedEmptyFixtureRoot(fixtureRoot, fixtureRootIdentity);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Consumer-layer fixture setup failed and its owned empty root could not be removed",
        );
      }
    }
    throw error;
  }
}

function logical(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  assert.ok(value.length > 0 && value !== ".." && !value.startsWith("../"));
  return value;
}

async function compileConsumer(repository: string, root: string, variant: string): Promise<void> {
  const outputDirectory = join(root, "generations");
  await mkdir(outputDirectory);
  const entrypoint = logical(repository, join(root, "entry.tsx"));
  const manifest = logical(repository, join(root, "node_modules/@hraness/ui/dist/stylex-manifest.json"));
  const generation = await createStylexGeneration({
    expectedGraphs: [{ adapter: "bun", entrypoints: [entrypoint], id: "consumer", kind: "ssr" }],
    finalCssPath: "stylex.css",
    generationId: variant,
    outputDirectory,
    packageManifests: [manifest],
    rootDirectory: repository,
    templates: [{
      cssHref: "./stylex.css",
      graphId: "consumer",
      outputPath: "index.html",
      sourcePath: "index.html",
      stylesheetGraphId: "consumer",
    }],
  });
  const receipt = await collectBunStylexGraph({
    build: { conditions: ["module", "production"], minify: true },
    generation,
    graphId: "consumer",
    rootDirectory: repository,
  });
  const stylesheets = receipt.outputs.filter(({ path }) => path.endsWith(".css"));
  assert.equal(stylesheets.length, 1, "Consumer graph must emit exactly one compiler foundation stylesheet");
  const stylesheet = stylesheets[0];
  assert.ok(stylesheet !== undefined);
  const preparedTemplate = await prepareStylexProducedTemplate(generation, "index.html");
  await writeFile(
    preparedTemplate.sourcePath,
    `<!doctype html><link rel="stylesheet" href="/graphs/consumer/${stylesheet.path}"><link rel="stylesheet" href="${STYLEX_TEMPLATE_CSS_PLACEHOLDER}"><main></main>\n`,
    { flag: "wx" },
  );
  await sealStylexProducedTemplate(generation, "index.html");
  const output = await finalizeStylexGeneration({ generation, outputDirectory, rootDirectory: repository });
  const outputFiles = await filesBelow(output);
  assert.ok(outputFiles.some((path) => basename(path) === "stylex-complete.json"), "Finalization must publish one complete record");
  assert.equal(outputFiles.filter((path) => basename(path) === "stylex.css").length, 1, "Finalization must publish one combined recipe stylesheet");
  assert.equal(outputFiles.filter((path) => basename(path) === "index.html").length, 1, "Finalization must publish the registered template");
  const javaScript = outputFiles.filter((path) => path.endsWith(".js"));
  assert.equal(javaScript.length, 1, "One consumer runtime must be emitted");
  const runtimePath = javaScript[0]!;
  const runtimeDigest = digest(await readFile(runtimePath));
  const snapshotPath = join(root, "snapshot.json");
  const serialized = await run(
    [process.execPath, resolve(import.meta.dir, "check-stylex-consumer-layers.ts"), "--evaluate", runtimePath, snapshotPath],
    root,
    process.env,
    EVALUATOR_TIMEOUT_MS,
  );
  const snapshot = parseSnapshot(JSON.parse(serialized) as unknown);
  const expected = `${JSON.stringify(snapshot, null, 2)}\n`;
  assert.equal(await readFile(snapshotPath, "utf8"), expected, "Evaluator stdout and settled snapshot file must be byte-identical");
  assert.equal(digest(await readFile(runtimePath)), runtimeDigest, "Evaluation must not mutate the emitted runtime");
}

async function evaluateConsumer(javaScriptPath: string, snapshotPath: string): Promise<never> {
  const stat = await lstat(javaScriptPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "Evaluator input must be one ordinary emitted JavaScript file");
  assert.ok(snapshotPath.endsWith("/snapshot.json"), "Evaluator output must use the fixture snapshot path");
  const module: unknown = await import(pathToFileURL(javaScriptPath).href);
  assert.ok(typeof module === "object" && module !== null && "snapshot" in module);
  const snapshot: unknown = module.snapshot;
  const serialized = `${JSON.stringify(parseSnapshot(snapshot), null, 2)}\n`;
  await writeFile(snapshotPath, serialized, { flag: "wx" });
  await new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(serialized, (error) => {
      if (error === null || error === undefined) resolveWrite();
      else rejectWrite(error);
    });
  });
  process.exit(0);
}

async function run(
  command: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<string> {
  const child = Bun.spawn({ cmd: command, cwd, env: environment, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  let termination: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    if (child.exitCode !== null) return;
    timedOut = true;
    child.kill("SIGTERM");
    termination = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, TERMINATION_GRACE_MS);
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).finally(() => {
    clearTimeout(timeout);
    if (termination !== undefined) clearTimeout(termination);
  });
  assert.equal(timedOut, false, `Command timed out after ${String(timeoutMs)}ms: ${command.slice(0, 3).join(" ")}\n${stdout}\n${stderr}`);
  assert.equal(child.signalCode, null, `Command received ${String(child.signalCode)}: ${command.slice(0, 3).join(" ")}\n${stdout}\n${stderr}`);
  assert.equal(exitCode, 0, `Command failed: ${command.slice(0, 3).join(" ")}\n${stdout}\n${stderr}`);
  return stdout;
}

async function installPackedPackage(consumer: string, packed: string): Promise<void> {
  const modules = join(consumer, "node_modules/@hraness");
  await mkdir(modules, { recursive: true });
  await cp(packed, join(modules, "ui"), { recursive: true });
}

async function main(): Promise<void> {
  assert.equal(Bun.version, "1.3.14");
  const repository = process.cwd();
  const compiler = JSON.parse(await readFile(join(repository, "node_modules/@stylexjs/babel-plugin/package.json"), "utf8")) as { version?: unknown };
  assert.equal(compiler.version, "0.19.0", "Review this regression before changing the compiler version");
  modelControls();
  // Keep application sources below the repository root without placing them
  // below node_modules, where adapters correctly classify files as packages.
  const workspace = await createFixtureWorkspace(repository);
  const { work } = workspace;
  const evidence = join(work, "evidence");
  const temporary = join(work, "tmp");
  const environment = { ...process.env, NODE_ENV: "production", BUN_TMPDIR: temporary, TMPDIR: temporary };
  const report: { variant: string; layers: readonly string[]; snapshot: Snapshot; atoms: readonly Rule[]; failures: string[]; artifacts: Record<string, string> }[] = [];
  let passed = false;
  try {
    await mkdir(evidence, { mode: 0o700 });
    await mkdir(temporary, { mode: 0o700 });
    const archive = join(work, "package.tgz");
    await run([process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts", "--quiet"], repository, environment);
    const inventory = (await run(["/usr/bin/tar", "-tf", archive], repository, environment)).trim().split("\n");
    assert.ok(inventory.length > 0 && inventory.every((path) => path.startsWith("package/") && !path.split("/").includes("..")), "Packed archive paths must stay below package/");
    const metadata = await run(["/usr/bin/tar", "-tvf", archive], repository, environment);
    assert.ok(metadata.split("\n").filter(Boolean).every((line) => /^[d-]/u.test(line)), "The package archive must contain only ordinary files/directories");
    await run(["/usr/bin/tar", "-xf", archive, "-C", work], repository, environment);
    const packed = join(work, "package");
    await writeFile(join(evidence, "inputs.json"), `${JSON.stringify({
      bun: Bun.version, compiler: compiler.version,
      package: digest(await readFile(join(repository, "package.json"))),
      lock: digest(await readFile(join(repository, "bun.lock"))),
      manifest: digest(await readFile(join(packed, "dist/stylex-manifest.json"))),
      archive: digest(await readFile(archive)),
      packedJavaScript: digest(await readFile(join(packed, "dist/index.js"))),
      packedCss: digest(await readFile(join(packed, "dist/stylex.css"))),
    }, null, 2)}\n`);
    for (const variant of variants) {
      const consumer = join(work, variant.name);
      const destination = join(evidence, variant.name);
      await mkdir(consumer);
      await mkdir(destination);
      try {
        await writeFile(join(consumer, "package.json"), '{"name":"stylex-consumer-layers-fixture","private":true,"type":"module"}\n');
        await writeFile(join(consumer, "entry.tsx"), fixture(variant));
        await installPackedPackage(consumer, packed);
        await run([
          process.execPath,
          resolve(repository, "scripts/check-stylex-consumer-layers.ts"),
          "--compile",
          repository,
          consumer,
          variant.name,
        ], repository, environment);
        const outputFiles = await filesBelow(join(consumer, "generations", variant.name));
        const cssFiles = outputFiles.filter((path) => path.endsWith(".css"));
        const combinedCss = cssFiles.filter((path) => basename(path) === "stylex.css");
        const foundationCss = cssFiles.filter((path) => basename(path) !== "stylex.css");
        assert.equal(combinedCss.length, 1, "Finalization must emit exactly one combined StyleX stylesheet");
        assert.equal(foundationCss.length, 1, "The graph must emit exactly one recipe-free foundation stylesheet");
        cssFiles.splice(0, cssFiles.length, ...foundationCss, ...combinedCss);
        const [foundationSource, combinedSource] = await Promise.all([
          readFile(foundationCss[0]!, "utf8"),
          readFile(combinedCss[0]!, "utf8"),
        ]);
        const css = `${foundationSource}\n${combinedSource}`;
        const reverseCss = `${combinedSource}\n${foundationSource}`;
        const sheet = parseCss(css);
        const reverseSheet = parseCss(reverseCss);
        const snapshot = parseSnapshot(JSON.parse(await readFile(join(consumer, "snapshot.json"), "utf8")) as unknown);
        const failures: string[] = [];
        for (const check of [
          () => requireKnownLayers(sheet),
          () => requireKnownLayers(reverseSheet),
          () => verify(sheet, snapshot, variant),
          () => verify(reverseSheet, snapshot, variant),
          () => assert.deepEqual(
            reverseSheet.layers,
            sheet.layers,
            "Foundation and finalized stylesheet arrival order must register the same package layer order",
          ),
          () => assert.equal(winner(sheet, classes(snapshot.inventory), "border-radius", 900), "13px", "The intermediate inventory bucket must retain its own rendered atom"),
          () => assert.equal(/@property\s+--/u.test(css), variant.dynamic, "Dynamic inventory must add its priority-zero custom-property registration"),
          () => assert.equal(/(?:^|[;{])\s*padding:\s*19px\s*[;}]/u.test(css), variant.padding, "Shorthand inventory must add its own padding atom"),
          () => assert.equal(sheet.layers.includes(`${PREFIX}.priority5`), variant.dynamic && variant.padding, "The complete union must retain exactly the legitimate priority5 case"),
        ]) {
          try { check(); } catch (error) { failures.push(String(error)); }
        }
        const outputRoot = join(consumer, "generations", variant.name);
        const artifacts = Object.fromEntries(await Promise.all(outputFiles.map(async (path) => [logical(outputRoot, path), digest(await readFile(path))])));
        const duplicates = classes(snapshot.duplicate);
        const atoms = sheet.rules.filter((rule) => duplicates.some((name) => new RegExp(`\\.${name}(?![\\w-])`, "u").test(rule.selector)));
        report.push({ variant: variant.name, layers: sheet.layers, snapshot, atoms, failures, artifacts });
        console.log(JSON.stringify({ variant: variant.name, layers: sheet.layers, failures }));
        await writeFile(join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      } finally {
        for (const name of ["entry.tsx", "snapshot.json", "output"]) {
          const source = join(consumer, name === "output" ? "generations" : name);
          const stat = await lstat(source).catch(() => undefined);
          if (stat?.isFile() || stat?.isDirectory()) await cp(source, join(destination, name), { recursive: true });
        }
        await rm(consumer, { recursive: true, force: true });
      }
    }
    assert.ok(report.every((entry) => entry.failures.length === 0), "Consumer layer inventory changed cascade semantics; inspect the retained reports");
    passed = true;
    console.log("Four isolated packed StyleX consumer inventories preserve layer, PageIntro, caller-last, and padding contracts");
  } catch (error) {
    await writeFile(join(evidence, "failure.txt"), `${String(error)}\n`).catch(() => undefined);
    throw error;
  } finally {
    await requireSameDirectory(
      work,
      workspace.workIdentity,
      "The consumer-layer fixture workspace",
    );
    // Failure evidence contains only generated fixture/output/report files, never dependency links.
    for (const entry of await readdir(work)) {
      if (!passed && entry === "evidence") continue;
      await rm(join(work, entry), { recursive: true, force: true });
    }
    if (passed) {
      await rm(work, { recursive: true, force: true });
      if (workspace.createdFixtureRoot) {
        await removeOwnedEmptyFixtureRoot(
          workspace.fixtureRoot,
          workspace.fixtureRootIdentity,
        );
      }
    } else {
      console.error(`Consumer layer failure evidence retained at ${evidence}`);
    }
  }
}

if (process.argv[2] === "--compile") {
  const repository = process.argv[3];
  const root = process.argv[4];
  const variant = process.argv[5];
  assert.ok(repository !== undefined && root !== undefined && variant !== undefined && process.argv.length === 6, "Internal compile mode requires repository, fixture root, and variant");
  await compileConsumer(resolve(repository), resolve(root), variant);
} else if (process.argv[2] === "--evaluate") {
  const javaScriptPath = process.argv[3];
  const snapshotPath = process.argv[4];
  assert.ok(javaScriptPath !== undefined && snapshotPath !== undefined && process.argv.length === 5, "Internal evaluator mode requires one runtime and snapshot path");
  await evaluateConsumer(resolve(javaScriptPath), resolve(snapshotPath));
} else {
  assert.equal(process.argv.length, 2, "This gate accepts no public flags");
  await main();
}
