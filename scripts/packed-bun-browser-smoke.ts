import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const BABEL_VERSION = "7.29.7";
const BUN_VERSION = "1.3.14";
const LIGHTNINGCSS_VERSION = "1.33.0";
const TYPES_BABEL_VERSION = "7.20.5";
const TYPES_BUN_VERSION = "1.3.14";
const TYPESCRIPT_VERSION = "6.0.3";
const VITE_VERSION = "7.3.6";
const LAZY_STYLEX_CSS_PROPERTY = "padding-inline-start";
const LAZY_STYLEX_SOURCE_PROPERTY = "paddingInlineStart";
const LAZY_STYLEX_VALUE = "271828px";
const LOCAL_STYLEX_CSS_PROPERTY = "scroll-margin-bottom";
const LOCAL_STYLEX_SOURCE_PROPERTY = "scrollMarginBottom";
const LOCAL_STYLEX_VALUE = "314159px";
const MULTI_STYLEX_CSS_PROPERTY = "margin-inline-end";
const MULTI_STYLEX_SOURCE_PROPERTY = "marginInlineEnd";
const MULTI_STYLEX_VALUE = "161803px";
const REACT_VERSION = "19.2.3";
const STYLEX_VERSION = "0.19.0";

type Artifact = Readonly<{
  body: string;
  contentType: string;
  pathname: string;
}>;

const applicationSource = `import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { AskAiAboutThis, Icon } from "@hraness/ui";

const styles = stylex.create({
  icon: {
    ${LOCAL_STYLEX_SOURCE_PROPERTY}: ${JSON.stringify(LOCAL_STYLEX_VALUE)},
  },
});

export function App() {
  return (
    <main data-packed-consumer-root="true">
      <span>Visible packed consumer icon</span>
      <span data-visible-packed-icon="true">
        <Icon
          className="consumer-icon"
          icon={Search01Icon}
          size={24}
          strokeWidth={2}
          xstyle={styles.icon}
        />
      </span>
      <AskAiAboutThis url="https://hraness.com/stripe" />
    </main>
  );
}
`;

const clientSource = `import "./app.css";
import { hydrateRoot } from "react-dom/client";

import { App } from "./app.js";

declare global {
  interface Window {
    __HRANESS_PACKED_HYDRATION_STARTED__?: boolean;
    __HRANESS_PACKED_RECOVERABLE_ERRORS__?: string[];
  }
}

const container = document.getElementById("root");
if (container === null) throw new Error("Packed consumer root is missing");

const recoverableErrors: string[] = [];
window["__HRANESS_PACKED_RECOVERABLE_ERRORS__"] = recoverableErrors;
hydrateRoot(container, <App />, {
  onRecoverableError(error) {
    recoverableErrors.push(error instanceof Error ? error.message : String(error));
  },
});
window["__HRANESS_PACKED_HYDRATION_STARTED__"] = true;
void import("./lazy.js").then(({ lazyClassName }) => {
  document.documentElement.dataset["packedLazyClass"] = lazyClassName;
});
`;

const lazySource = `import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  lazy: {
    ${LAZY_STYLEX_SOURCE_PROPERTY}: ${JSON.stringify(LAZY_STYLEX_VALUE)},
  },
});

export const lazyClassName = stylex.props(styles.lazy).className;
`;

const secondarySource = `import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  secondary: {
    ${MULTI_STYLEX_SOURCE_PROPERTY}: ${JSON.stringify(MULTI_STYLEX_VALUE)},
  },
});

export const secondaryClassName = stylex.props(styles.secondary).className;
`;

const callerCss = `@import "@hraness/ui/compiler-foundation.css";

.consumer-icon {
  display: block;
}
`;

const renderSource = `import { writeFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";

import { App } from "./app.js";

export const markup = renderToString(<App />);

export function renderDocument(clientHref, foundationHref) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Packed Bun browser smoke</title>",
    '<link rel="stylesheet" href="' + foundationHref + '">',
    '<link rel="stylesheet" href="__HRANESS_STYLEX_CSS__">',
    "</head>",
    "<body>",
    '<div id="root">' + markup + "</div>",
    '<script type="module" src="' + clientHref + '"></script>',
    "</body>",
    "</html>",
  ].join("");
}

if (import.meta.main) {
  const outputPath = process.argv[2];
  const clientHref = process.argv[3];
  const foundationHref = process.argv[4];
  if (outputPath === undefined) throw new Error("SSR output path is required");
  if (clientHref === undefined || !clientHref.startsWith("/graphs/client/")) {
    throw new Error("Published client entry href is required");
  }
  if (
    foundationHref === undefined ||
    !foundationHref.startsWith("/graphs/client/")
  ) {
    throw new Error("Published compiler-foundation href is required");
  }
  await writeFile(
    outputPath,
    renderDocument(clientHref, foundationHref),
    { flag: "wx" },
  );
}
`;

const negativeRenderSource = `import "./app.css";

${renderSource}`;

const typeContractSource = `import {
  createStylexGeneration,
  finalizeStylexGeneration,
  type StylexGenerationHandleV1,
} from "@hraness/ui/stylex-build";
import {
  collectBunStylexGraph,
  type BunStylexBuildOptions,
} from "@hraness/ui/stylex-build/bun";
import { stylexVite } from "@hraness/ui/stylex-build/vite";

const generation = null as unknown as StylexGenerationHandleV1;
const bunOptions: BunStylexBuildOptions = { minify: true };
void createStylexGeneration;
void finalizeStylexGeneration;
void collectBunStylexGraph;
void stylexVite({ generation, graphId: "client", rootDirectory: process.cwd() });
void bunOptions;
`;

const typeContractConfig = `${JSON.stringify({
  compilerOptions: {
    exactOptionalPropertyTypes: true,
    module: "Preserve",
    moduleResolution: "Bundler",
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: "ES2023",
    types: ["bun"],
  },
  files: ["type-contract.ts"],
}, null, 2)}\n`;

function buildSource(consumer: string): string {
  return `import {
  createStylexGeneration,
  finalizeStylexGeneration,
  prepareStylexProducedTemplate,
  sealStylexProducedTemplate,
} from "@hraness/ui/stylex-build";
import { collectBunStylexGraph } from "@hraness/ui/stylex-build/bun";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = ${JSON.stringify(consumer)};

async function requireBuild(result, label) {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(label + " build failed");
}

async function runBounded(command, cwd, label) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, NODE_ENV: "production" },
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timeout;
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, kind: "exit" })),
    new Promise((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ kind: "timeout" }), 60_000);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome.kind === "timeout") {
    child.kill("SIGTERM");
    const terminated = await Promise.race([
      child.exited.then(() => true),
      new Promise((resolveGrace) => setTimeout(() => resolveGrace(false), 2_000)),
    ]);
    if (!terminated) child.kill("SIGKILL");
  }
  const exitCode = await child.exited;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (stdoutText.length > 0) process.stdout.write(stdoutText);
  if (stderrText.length > 0) process.stderr.write(stderrText);
  if (outcome.kind === "timeout") throw new Error(label + " timed out");
  assert.equal(child.signalCode, null, label + " exited by signal " + String(child.signalCode));
  assert.equal(exitCode, 0, label + " failed with exit code " + String(exitCode));
}

await rm(resolve(root, "dist"), { force: true, recursive: true });
process.env.NODE_ENV = "production";

const generation = await createStylexGeneration({
  expectedGraphs: [
    {
      adapter: "bun",
      entrypoints: ["client.tsx", "secondary.tsx"],
      id: "client",
      kind: "client",
    },
    {
      adapter: "bun",
      entrypoints: ["render.tsx"],
      id: "ssr",
      kind: "ssr",
    },
  ],
  finalCssPath: "stylex.css",
  generationId: "packed-consumer",
  outputDirectory: resolve(root, "dist"),
  packageManifests: [import.meta.resolve("@hraness/ui/stylex-manifest.json")],
  rootDirectory: root,
  templates: [
    {
      cssHref: "/stylex.css",
      graphId: "ssr",
      outputPath: "index.html",
      sourcePath: "index.html",
      stylesheetGraphId: "client",
    },
  ],
});
const clientReceipt = await collectBunStylexGraph({
  build: { minify: true },
  generation,
  graphId: "client",
  rootDirectory: root,
});
const clientEntries = clientReceipt.outputs.filter(
  ({ path }) => /(?:^|\\/)entries\\/client-[^/]+\\.js$/u.test(path),
);
const foundationOutputs = clientReceipt.outputs.filter(
  ({ path }) => path.endsWith(".css"),
);
assert.equal(clientEntries.length, 1, "client graph must emit one client entry");
assert.equal(
  foundationOutputs.length,
  1,
  "client graph must emit one compiler-foundation stylesheet",
);
const clientEntry = clientEntries[0];
const foundationOutput = foundationOutputs[0];
assert.ok(clientEntry !== undefined && foundationOutput !== undefined);
const ssrReceipt = await collectBunStylexGraph({
  build: { minify: true },
  generation,
  graphId: "ssr",
  rootDirectory: root,
});
const rendererOutputs = ssrReceipt.outputs.filter(
  ({ path }) => /(?:^|\\/)entries\\/render-[^/]+\\.js$/u.test(path),
);
assert.equal(rendererOutputs.length, 1, "SSR graph must emit one renderer entry");
const rendererOutput = rendererOutputs[0];
assert.ok(rendererOutput !== undefined);
const preparedTemplate = await prepareStylexProducedTemplate(
  generation,
  "index.html",
);
const rendererPath = join(
  generation.directory,
  ...ssrReceipt.outputRoot.split("/"),
  ...rendererOutput.path.split("/"),
);
await runBounded(
  [
    process.execPath,
    rendererPath,
    preparedTemplate.sourcePath,
    "/graphs/client/" + clientEntry.path,
    "/graphs/client/" + foundationOutput.path,
  ],
  root,
  "exact emitted SSR renderer",
);
await sealStylexProducedTemplate(generation, "index.html");
const finalDirectory = await finalizeStylexGeneration({
  generation,
  outputDirectory: resolve(root, "dist"),
  rootDirectory: root,
});
assert.equal(finalDirectory, resolve(root, "dist/packed-consumer"));

const negativeControl = await Bun.build({
  conditions: ["production", "browser", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "client.tsx"), resolve(root, "secondary.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/negative-control"),
  root,
  splitting: true,
  target: "browser",
});
await requireBuild(negativeControl, "Plugin-free negative control");

const negativeControlSsr = await Bun.build({
  conditions: ["production", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "negative-render.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/negative-control-ssr"),
  root,
  splitting: true,
  target: "bun",
});
await requireBuild(negativeControlSsr, "Plugin-free SSR negative control");
`;
}

type RunOptions = Readonly<{
  echo?: boolean;
  terminationGraceMs?: number;
  timeoutMs?: number;
}>;

async function run(
  command: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const terminationGraceMs = options.terminationGraceMs ?? 2_000;
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  assert.ok(Number.isSafeInteger(terminationGraceMs) && terminationGraceMs > 0);
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, kind: "exit" as const })),
    new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  const timedOut = outcome.kind === "timeout";
  if (timedOut) {
    child.kill("SIGTERM");
    const terminated = await Promise.race([
      child.exited.then(() => true),
      new Promise<false>((resolveGrace) => {
        setTimeout(() => resolveGrace(false), terminationGraceMs);
      }),
    ]);
    if (!terminated) child.kill("SIGKILL");
  }
  const exitCode = await child.exited;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (options.echo !== false && stdoutText.length > 0) process.stdout.write(stdoutText);
  if (options.echo !== false && stderrText.length > 0) process.stderr.write(stderrText);
  if (timedOut) throw new Error(`Command timed out after ${String(timeoutMs)}ms: ${command.join(" ")}`);
  assert.equal(child.signalCode, null, `Command exited by signal ${String(child.signalCode)}: ${command.join(" ")}`);
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

async function requireInstalledVersion(
  consumer: string,
  packageName: string,
  expected: string,
): Promise<void> {
  const manifestPath = resolve(
    consumer,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version?: unknown;
  };
  assert.equal(
    manifest.version,
    expected,
    `${packageName} must resolve to ${expected}`,
  );
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function requireExactlyOne(
  files: readonly string[],
  extension: string,
  description: string,
): string {
  const matches = files.filter((file) => file.endsWith(extension));
  assert.equal(
    matches.length,
    1,
    `${description} must emit exactly one ${extension} artifact; got ${matches.map((file) => relative(process.cwd(), file)).join(", ")}`,
  );
  const match = matches[0];
  assert.ok(match !== undefined);
  return match;
}

function requireNamedEntry(
  files: readonly string[],
  entryName: string,
  description: string,
): string {
  const pattern = new RegExp(
    `/entries/${escapeRegExp(entryName)}-[^/]+\\.js$`,
    "u",
  );
  const matches = files.filter((file) => pattern.test(file));
  assert.equal(
    matches.length,
    1,
    `${description} must emit exactly one ${entryName} JavaScript entry; got ${matches.map((file) => relative(process.cwd(), file)).join(", ")}`,
  );
  const match = matches[0];
  assert.ok(match !== undefined);
  return match;
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const localStylexCssPattern = new RegExp(
  `${escapeRegExp(LOCAL_STYLEX_CSS_PROPERTY)}\\s*:\\s*${escapeRegExp(LOCAL_STYLEX_VALUE)}\\s*(?=;|\\})`,
  "gu",
);
const localStylexSourcePropertyPattern = new RegExp(
  `["']?${escapeRegExp(LOCAL_STYLEX_SOURCE_PROPERTY)}["']?\\s*:`,
  "u",
);
const lazyStylexCssPattern = new RegExp(
  `${escapeRegExp(LAZY_STYLEX_CSS_PROPERTY)}\\s*:\\s*${escapeRegExp(LAZY_STYLEX_VALUE)}\\s*(?=;|\\})`,
  "gu",
);
const lazyStylexSourcePropertyPattern = new RegExp(
  `["']?${escapeRegExp(LAZY_STYLEX_SOURCE_PROPERTY)}["']?\\s*:`,
  "u",
);
const multiStylexCssPattern = new RegExp(
  `${escapeRegExp(MULTI_STYLEX_CSS_PROPERTY)}\\s*:\\s*${escapeRegExp(MULTI_STYLEX_VALUE)}\\s*(?=;|\\})`,
  "gu",
);
const multiStylexSourcePropertyPattern = new RegExp(
  `["']?${escapeRegExp(MULTI_STYLEX_SOURCE_PROPERTY)}["']?\\s*:`,
  "u",
);

function requireLocalStylexTransform(
  javaScript: string,
  css: string,
  description: string,
): void {
  assert.doesNotMatch(
    javaScript,
    localStylexSourcePropertyPattern,
    `${description} JavaScript must not retain the local StyleX source property`,
  );
  assert.ok(
    !javaScript.includes(LOCAL_STYLEX_VALUE),
    `${description} JavaScript must not retain the local StyleX source value`,
  );
  assert.equal(
    countMatches(css, localStylexCssPattern),
    1,
    `${description} CSS must contain the compiled local StyleX sentinel exactly once`,
  );
  assert.doesNotMatch(
    javaScript,
    lazyStylexSourcePropertyPattern,
    `${description} JavaScript must not retain the lazy StyleX source property`,
  );
  assert.ok(
    !javaScript.includes(LAZY_STYLEX_VALUE),
    `${description} JavaScript must not retain the lazy StyleX source value`,
  );
  assert.equal(
    countMatches(css, lazyStylexCssPattern),
    1,
    `${description} CSS must contain the compiled lazy StyleX sentinel exactly once`,
  );
  assert.doesNotMatch(
    javaScript,
    multiStylexSourcePropertyPattern,
    `${description} JavaScript must not retain the multi-entry StyleX source property`,
  );
  assert.ok(
    !javaScript.includes(MULTI_STYLEX_VALUE),
    `${description} JavaScript must not retain the multi-entry StyleX source value`,
  );
  assert.equal(
    countMatches(css, multiStylexCssPattern),
    1,
    `${description} CSS must contain the compiled multi-entry StyleX sentinel exactly once`,
  );
}

function forbid(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  assert.doesNotMatch(source, pattern, description);
}

async function fetchArtifact(
  origin: string,
  pathname: string,
  expectedContentType: RegExp,
): Promise<Artifact> {
  const response = await fetch(`${origin}${pathname}`);
  assert.equal(response.status, 200, `${pathname} must return HTTP 200`);
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(
    contentType,
    expectedContentType,
    `${pathname} must use the expected MIME type`,
  );
  const body = await response.text();
  assert.ok(body.trim().length > 0, `${pathname} must have a nonempty body`);
  return { body, contentType, pathname };
}

assert.equal(
  Bun.version,
  BUN_VERSION,
  `packed Bun browser smoke requires Bun ${BUN_VERSION}`,
);

const repository = process.cwd();
const work = await realpath(
  await mkdtemp(join(tmpdir(), "hraness-packed-bun-browser-smoke-")),
);
const temporary = resolve(work, "tmp");
const consumer = resolve(work, "consumer");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  NODE_ENV: "production",
  TMPDIR: temporary,
};

try {
  await mkdir(temporary, { mode: 0o700 });
  await mkdir(consumer);
  await assert.rejects(
    run(
      [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
      repository,
      { echo: false, terminationGraceMs: 100, timeoutMs: 100 },
    ),
    /timed out/u,
    "bounded command runner must terminate a child that retains an active handle",
  );
  const archive = resolve(work, "hraness-ui.tgz");
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);

  await writeFile(resolve(consumer, "package.json"), `${JSON.stringify({
    name: "hraness-packed-bun-browser-smoke",
    private: true,
    type: "module",
    dependencies: {
      "@babel/core": BABEL_VERSION,
      "@hraness/ui": `file:${archive}`,
      "@hugeicons/core-free-icons": "4.2.2",
      "@stylexjs/babel-plugin": STYLEX_VERSION,
      "@stylexjs/stylex": STYLEX_VERSION,
      "@types/babel__core": TYPES_BABEL_VERSION,
      "@types/bun": TYPES_BUN_VERSION,
      lightningcss: LIGHTNINGCSS_VERSION,
      react: REACT_VERSION,
      "react-dom": REACT_VERSION,
      typescript: TYPESCRIPT_VERSION,
      vite: VITE_VERSION,
    },
  }, null, 2)}\n`);
  await run([process.execPath, "install", "--ignore-scripts"], consumer);

  await Promise.all([
    requireInstalledVersion(consumer, "@babel/core", BABEL_VERSION),
    requireInstalledVersion(
      consumer,
      "@stylexjs/babel-plugin",
      STYLEX_VERSION,
    ),
    requireInstalledVersion(consumer, "@stylexjs/stylex", STYLEX_VERSION),
    requireInstalledVersion(consumer, "@types/babel__core", TYPES_BABEL_VERSION),
    requireInstalledVersion(consumer, "@types/bun", TYPES_BUN_VERSION),
    requireInstalledVersion(consumer, "lightningcss", LIGHTNINGCSS_VERSION),
    requireInstalledVersion(consumer, "react", REACT_VERSION),
    requireInstalledVersion(consumer, "react-dom", REACT_VERSION),
    requireInstalledVersion(consumer, "typescript", TYPESCRIPT_VERSION),
    requireInstalledVersion(consumer, "vite", VITE_VERSION),
  ]);

  await Promise.all([
    writeFile(resolve(consumer, "app.tsx"), applicationSource),
    writeFile(resolve(consumer, "client.tsx"), clientSource),
    writeFile(resolve(consumer, "app.css"), callerCss),
    writeFile(resolve(consumer, "lazy.tsx"), lazySource),
    writeFile(resolve(consumer, "secondary.tsx"), secondarySource),
    writeFile(resolve(consumer, "render.tsx"), renderSource),
    writeFile(resolve(consumer, "negative-render.tsx"), negativeRenderSource),
    writeFile(resolve(consumer, "build.ts"), buildSource(consumer)),
    writeFile(resolve(consumer, "type-contract.ts"), typeContractSource),
    writeFile(resolve(consumer, "tsconfig.json"), typeContractConfig),
  ]);
  await run([
    process.execPath,
    resolve(consumer, "node_modules/typescript/bin/tsc"),
    "--project",
    "tsconfig.json",
  ], consumer);
  await run([process.execPath, "./build.ts"], consumer);

  const finalDirectory = resolve(consumer, "dist/packed-consumer");
  const browserDirectory = resolve(finalDirectory, "graphs/client");
  const negativeControlDirectory = resolve(consumer, "dist/negative-control");
  const negativeControlSsrDirectory = resolve(
    consumer,
    "dist/negative-control-ssr",
  );
  const serverDirectory = resolve(finalDirectory, "graphs/ssr");
  const [
    browserFiles,
    negativeControlFiles,
    negativeControlSsrFiles,
    serverFiles,
  ] = await Promise.all([
    filesBelow(browserDirectory),
    filesBelow(negativeControlDirectory),
    filesBelow(negativeControlSsrDirectory),
    filesBelow(serverDirectory),
  ]);
  const browserJavaScriptPaths = browserFiles.filter((file) =>
    file.endsWith(".js"),
  );
  assert.ok(
    browserJavaScriptPaths.length >= 3,
    "browser graph must publish client and secondary entries plus a lazy chunk",
  );
  const browserJavaScriptPath = requireNamedEntry(
    browserFiles,
    "client",
    "browser graph",
  );
  requireNamedEntry(browserFiles, "secondary", "browser graph");
  assert.ok(
    browserJavaScriptPaths.some((file) => file.includes("/chunks/")),
    "browser graph must publish the lazy module as a complete split chunk",
  );
  const browserCssPath = requireExactlyOne(
    browserFiles,
    ".css",
    "browser graph",
  );
  const browserJavaScriptHref = `/graphs/client/${relative(
    browserDirectory,
    browserJavaScriptPath,
  )}`;
  const browserCssHref = `/graphs/client/${relative(
    browserDirectory,
    browserCssPath,
  )}`;
  const serverJavaScriptPath = requireNamedEntry(
    serverFiles,
    "render",
    "SSR graph",
  );
  assert.deepEqual(
    serverFiles.filter((file) => file.endsWith(".css")),
    [],
    "SSR graph must not publish a duplicate foundation stylesheet",
  );
  const negativeControlJavaScriptPaths = negativeControlFiles.filter((file) =>
    file.endsWith(".js"),
  );
  assert.ok(negativeControlJavaScriptPaths.length >= 3);
  const negativeControlCssPath = requireExactlyOne(
    negativeControlFiles,
    ".css",
    "plugin-free negative-control build",
  );
  const negativeControlSsrJavaScriptPaths = negativeControlSsrFiles.filter(
    (file) => file.endsWith(".js"),
  );
  assert.ok(negativeControlSsrJavaScriptPaths.length >= 1);
  const negativeControlSsrCssPath = requireExactlyOne(
    negativeControlSsrFiles,
    ".css",
    "plugin-free SSR negative-control build",
  );

  const [negativeControlJavaScripts, negativeControlCss] = await Promise.all([
    Promise.all(
      negativeControlJavaScriptPaths.map((file) => readFile(file, "utf8")),
    ),
    readFile(negativeControlCssPath, "utf8"),
  ]);
  const negativeControlJavaScript = negativeControlJavaScripts.join("\n");
  assert.match(
    negativeControlJavaScript,
    localStylexSourcePropertyPattern,
    "the plugin-free negative control must retain the local StyleX source property",
  );
  assert.ok(
    negativeControlJavaScript.includes(LOCAL_STYLEX_VALUE),
    "the plugin-free negative control must retain the local StyleX source value",
  );
  assert.match(
    negativeControlJavaScript,
    lazyStylexSourcePropertyPattern,
    "the plugin-free negative control must retain the lazy StyleX source property",
  );
  assert.ok(
    negativeControlJavaScript.includes(LAZY_STYLEX_VALUE),
    "the plugin-free negative control must retain the lazy StyleX source value",
  );
  assert.match(
    negativeControlJavaScript,
    multiStylexSourcePropertyPattern,
    "the plugin-free negative control must retain the multi-entry StyleX source property",
  );
  assert.ok(
    negativeControlJavaScript.includes(MULTI_STYLEX_VALUE),
    "the plugin-free negative control must retain the multi-entry StyleX source value",
  );
  assert.equal(
    countMatches(negativeControlCss, localStylexCssPattern),
    0,
    "the plugin-free negative control must not mask the missing transform with recipe CSS",
  );
  assert.equal(
    countMatches(negativeControlCss, lazyStylexCssPattern),
    0,
    "the plugin-free negative control must not mask the lazy transform with recipe CSS",
  );
  assert.equal(
    countMatches(negativeControlCss, multiStylexCssPattern),
    0,
    "the plugin-free negative control must not mask the multi-entry transform with recipe CSS",
  );
  assert.throws(
    () => requireLocalStylexTransform(
      negativeControlJavaScript,
      negativeControlCss,
      "plugin-free negative control",
    ),
    /must not retain the local StyleX source property/u,
    "the transform oracle must reject a browser build without the StyleX adapter",
  );

  const [negativeControlSsrJavaScripts, negativeControlSsrCss] =
    await Promise.all([
      Promise.all(
        negativeControlSsrJavaScriptPaths.map((file) =>
          readFile(file, "utf8"),
        ),
      ),
      readFile(negativeControlSsrCssPath, "utf8"),
    ]);
  const negativeControlSsrJavaScript = negativeControlSsrJavaScripts.join("\n");
  assert.match(
    negativeControlSsrJavaScript,
    localStylexSourcePropertyPattern,
    "the plugin-free SSR negative control must retain the local StyleX source property",
  );
  assert.ok(
    negativeControlSsrJavaScript.includes(LOCAL_STYLEX_VALUE),
    "the plugin-free SSR negative control must retain the local StyleX source value",
  );
  assert.equal(
    countMatches(negativeControlSsrCss, localStylexCssPattern),
    0,
    "the plugin-free SSR negative control must not mask the missing transform with recipe CSS",
  );
  assert.throws(
    () => requireLocalStylexTransform(
      negativeControlSsrJavaScript,
      negativeControlSsrCss,
      "plugin-free SSR negative control",
    ),
    /must not retain the local StyleX source property/u,
    "the transform oracle must reject a Bun-target SSR build without the StyleX adapter",
  );
  await rm(negativeControlDirectory, { force: true, recursive: true });
  await rm(negativeControlSsrDirectory, { force: true, recursive: true });
  assert.equal(
    await Bun.file(negativeControlDirectory).exists(),
    false,
    "negative-control artifacts must be removed after the oracle check",
  );
  assert.equal(
    await Bun.file(negativeControlSsrDirectory).exists(),
    false,
    "SSR negative-control artifacts must be removed after the oracle check",
  );

  const htmlPath = resolve(finalDirectory, "index.html");
  const finalCssPath = resolve(finalDirectory, "stylex.css");
  const completeRecordPath = resolve(finalDirectory, "stylex-complete.json");
  const completeRecord = JSON.parse(
    await readFile(completeRecordPath, "utf8"),
  ) as {
    artifacts?: { path?: unknown }[];
    finalCss?: { path?: unknown };
    generationId?: unknown;
    graphs?: { id?: unknown }[];
    packages?: {
      manifestSha256?: unknown;
      name?: unknown;
      version?: unknown;
    }[];
    state?: unknown;
  };
  assert.equal(completeRecord.state, "complete");
  assert.equal(completeRecord.generationId, "packed-consumer");
  assert.equal(completeRecord.finalCss?.path, "stylex.css");
  assert.deepEqual(
    completeRecord.graphs?.map(({ id }) => id),
    ["client", "ssr"],
  );
  assert.equal(completeRecord.packages?.length, 1);
  assert.equal(completeRecord.packages?.[0]?.name, "@hraness/ui");
  assert.match(
    String(completeRecord.packages?.[0]?.version),
    /^\d+\.\d+\.\d+$/u,
  );
  assert.match(
    String(completeRecord.packages?.[0]?.manifestSha256),
    /^[a-f0-9]{64}$/u,
  );
  const completeArtifactPaths = completeRecord.artifacts?.map(({ path }) =>
    String(path),
  ) ?? [];
  assert.ok(
    completeArtifactPaths.includes("index.html"),
    "the complete record must bind the published HTML template",
  );
  for (const file of [...browserFiles, ...serverFiles]) {
    const publishedPath = relative(finalDirectory, file)
      .split("\\")
      .join("/");
    assert.ok(
      completeArtifactPaths.includes(publishedPath),
      `the complete record must bind ${publishedPath}`,
    );
  }

  const publishedTemplate = await readFile(htmlPath, "utf8");
  assert.equal(
    countMatches(publishedTemplate, /__HRANESS_STYLEX_CSS__/gu),
    0,
    "the atomically published SSR HTML must not retain the final-CSS placeholder",
  );
  const publishedFiles = new Map(
    (await filesBelow(finalDirectory)).map((file) => [
      `/${relative(finalDirectory, file).split("\\").join("/")}`,
      file,
    ]),
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/") {
        return new Response(publishedTemplate, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/stylex.css") {
        return new Response(Bun.file(finalCssPath), {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      }
      const published = publishedFiles.get(pathname);
      if (published !== undefined && published.endsWith(".js")) {
        return new Response(Bun.file(published), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (published !== undefined && published.endsWith(".css")) {
        return new Response(Bun.file(published), {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  let artifacts: readonly Artifact[];
  try {
    const origin = `http://${server.hostname}:${String(server.port)}`;
    artifacts = await Promise.all([
      fetchArtifact(origin, "/", /^text\/html(?:;|$)/iu),
      fetchArtifact(
        origin,
        browserJavaScriptHref,
        /^text\/javascript(?:;|$)/iu,
      ),
      fetchArtifact(origin, browserCssHref, /^text\/css(?:;|$)/iu),
      fetchArtifact(origin, "/stylex.css", /^text\/css(?:;|$)/iu),
    ]);
  } finally {
    await server.stop(true);
  }

  const html = artifacts[0]?.body ?? "";
  const servedBrowserJavaScript = artifacts[1]?.body ?? "";
  const browserCss = artifacts[2]?.body ?? "";
  const finalCss = artifacts[3]?.body ?? "";
  const productionArtifactPaths = [...browserFiles, ...serverFiles].filter(
    (file) => file.endsWith(".css") || file.endsWith(".js"),
  );
  const productionArtifactSources = await Promise.all(
    productionArtifactPaths.map((file) => readFile(file, "utf8")),
  );
  assert.equal(
    productionArtifactPaths.length,
    browserFiles.length + serverFiles.length,
    "browser and SSR graphs must publish only scanned CSS and JavaScript artifacts",
  );
  const browserJavaScript = (
    await Promise.all(
      browserJavaScriptPaths.map((file) => readFile(file, "utf8")),
    )
  ).join("\n");
  const serverJavaScript = (
    await Promise.all(
      serverFiles
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFile(file, "utf8")),
    )
  ).join("\n");
  const productionJavaScript = `${browserJavaScript}\n${serverJavaScript}`;
  const productionArtifacts = [
    html,
    finalCss,
    ...productionArtifactSources,
  ].join("\n");

  assert.match(html, /data-packed-consumer-root="true"/u);
  assert.match(html, /data-visible-packed-icon="true"/u);
  assert.match(html, /<svg\b/u);
  assert.match(html, /aria-hidden="true"/u);
  assert.match(html, /class="[^"]*hraness-icon[^"]*consumer-icon[^"]*"/u);
  assert.match(html, /data-slot="icon"/u);
  assert.match(html, /Visible packed consumer icon/u);
  assert.match(html, /aria-label="Ask AI about this"/u);
  assert.equal(
    countMatches(html, /data-slot="ask-ai-about-this-link"/gu),
    4,
    "the packed consumer must SSR four real AI provider links",
  );
  assert.match(html, /https%3A%2F%2Fhraness\.com%2Fstripe/u);
  assert.ok(html.includes(`href="${browserCssHref}"`));
  assert.match(html, /href="\/stylex\.css"/u);
  assert.ok(html.includes(`src="${browserJavaScriptHref}"`));
  assert.ok(
    html.indexOf(`href="${browserCssHref}"`) <
      html.indexOf('href="/stylex.css"'),
    "the recipe-free compiler foundation must precede the finalized recipe stylesheet",
  );
  assert.equal(
    countMatches(html, /href="\/stylex\.css"/gu),
    1,
    "the HTML output must link exactly one finalized recipe stylesheet",
  );

  assert.match(servedBrowserJavaScript, /onRecoverableError/u);
  assert.match(
    servedBrowserJavaScript,
    /__HRANESS_PACKED_RECOVERABLE_ERRORS__/u,
  );
  assert.match(
    servedBrowserJavaScript,
    /__HRANESS_PACKED_HYDRATION_STARTED__/u,
  );
  requireLocalStylexTransform(
    productionJavaScript,
    finalCss,
    "unified production client, lazy, multi-entry, and SSR generation",
  );
  forbid(
    browserJavaScript,
    /(?:from|import\()\s*["'](?:@hraness\/ui|@stylexjs\/stylex|react(?:-dom)?(?:\/[^"']*)?)["']/u,
    "browser dependencies must be bundled rather than left as bare imports",
  );

  const priorityLayers = [
    ...finalCss.matchAll(/@layer\s+components\.hraness-ui\.priority([1-9]\d*)/gu),
  ].map((match) => Number(match[1]));
  assert.ok(priorityLayers.length > 0, "final CSS must contain recipe layers");
  assert.equal(
    new Set(priorityLayers).size,
    priorityLayers.length,
    "each finite priority layer must be serialized exactly once",
  );
  const iconElement = html.match(
    /<svg\b(?=[^>]*\bdata-slot="icon")(?=[^>]*\bclass="([^"]*)")[^>]*>/u,
  );
  assert.ok(iconElement !== null, "the packed icon element must be present");
  const iconClassNames = (iconElement[1] ?? "")
    .split(/\s+/u)
    .filter((className) => className.length > 0);
  const countIconRules = (declaration: string): number =>
    iconClassNames.reduce(
      (count, className) =>
        count + countMatches(
          finalCss,
          new RegExp(
            `\\.${escapeRegExp(className)}\\s*\\{[^{}]*${declaration}\\s*(?=;|\\})`,
            "gu",
          ),
        ),
      0,
    );
  assert.equal(
    countIconRules("flex\\s*:\\s*none"),
    1,
    "the packed icon flex declaration must appear exactly once after union",
  );
  assert.equal(
    countIconRules("display\\s*:\\s*inline-block"),
    1,
    "the packed icon display declaration must appear exactly once after union",
  );
  assert.match(
    browserCss,
    /\.consumer-icon\s*\{[^}]*display\s*:\s*block\s*(?:;|\})/su,
    "the unlayered caller override must be bundled",
  );
  forbid(
    browserCss,
    /@import\s+["']@hraness\/ui\/(?:styles|stylex)\.css["']/u,
    "the compiler foundation must not import a standalone recipe stylesheet",
  );
  assert.equal(
    countMatches(browserCss, localStylexCssPattern),
    0,
    "the foundation graph CSS must not contain local recipe output",
  );
  forbid(
    finalCss,
    /@import|\/private\/|hraness-packed-bun-browser-smoke-/u,
    "the finalized recipes must not contain imports or private build provenance",
  );

  forbid(
    productionArtifacts,
    /stylex\.create\s*\(|stylexCreate|Unexpected ["']stylex\.create/u,
    "production artifacts must not contain uncompiled StyleX authoring calls",
  );
  forbid(
    productionArtifacts,
    /virtual:stylex|\/virtual:stylex\.css/u,
    "production artifacts must not reference virtual development CSS",
  );
  forbid(
    productionArtifacts,
    /data-stylex|stylex-inject|stylesheet-group/u,
    "production artifacts must not contain StyleX runtime CSS injection",
  );
  forbid(
    productionArtifacts,
    /@hraness\/ui(?:\/|\\)src(?:\/|\\)|node_modules(?:\/|\\)@hraness(?:\/|\\)ui(?:\/|\\)src/u,
    "production artifacts must not leak @hraness/ui/src paths",
  );

  console.log(
    `Packed Bun browser smoke passed with Bun ${BUN_VERSION}, StyleX ${STYLEX_VERSION}, React ${REACT_VERSION}, and one complete client/SSR generation.`,
  );
  console.log(
    `Fetched SSR HTML (${String(html.length)} bytes), browser JS (${String(servedBrowserJavaScript.length)} bytes), foundation CSS (${String(browserCss.length)} bytes), and finalized CSS (${String(finalCss.length)} bytes) with explicit production MIME types.`,
  );
  console.log(
    "Verified packed public build-tool imports, a manifest-bound client/lazy/multi-entry/SSR union, atomic HTML/CSS/graph publication, plugin-free negative controls, SSR icon and Ask AI hooks, bundled dependencies, duplicate-free UI recipes, and all browser/SSR artifact exclusions.",
  );
  console.log(
    "Hydration boundary: hydrateRoot and onRecoverableError instrumentation were compiled and served, but no browser executed them; this smoke does not claim real hydration.",
  );
} finally {
  await rm(work, { force: true, recursive: true });
}
