import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { stylexCompilerOptions } from "./stylex-config.js";

const BUN_VERSION = "1.3.14";
const LOCAL_STYLEX_CSS_PROPERTY = "scroll-margin-bottom";
const LOCAL_STYLEX_SOURCE_PROPERTY = "scrollMarginBottom";
const LOCAL_STYLEX_VALUE = "314159px";
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
`;

const callerCss = `@import "@hraness/ui/stylex.css";
@import "./dist/extracted/stylex.css";

.consumer-icon {
  display: block;
}
`;

const renderSource = `import { writeFile } from "node:fs/promises";
import { renderToString } from "react-dom/server";

import { App } from "./app.js";

const markup = renderToString(<App />);
const document = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>Packed Bun browser smoke</title>",
  '<link rel="stylesheet" href="/client.css">',
  "</head>",
  "<body>",
  '<div id="root">' + markup + "</div>",
  '<script type="module" src="/client.js"></script>',
  "</body>",
  "</html>",
].join("");

await writeFile("./dist/index.html", document);
`;

const negativeRenderSource = `import "./app.css";

${renderSource}`;

function buildSource(consumer: string): string {
  const compilerOptions = stylexCompilerOptions(consumer);
  return `import stylex from "@stylexjs/unplugin";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = ${JSON.stringify(consumer)};
const compilerOptions = ${JSON.stringify(compilerOptions)};

async function requireBuild(result, label) {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(label + " build failed");
}

await rm(resolve(root, "dist"), { force: true, recursive: true });
process.env.NODE_ENV = "production";

// Bun 1.3.14 invokes the esbuild adapter's onEnd hook before writing an
// imported CSS asset. Generate the adapter's supported fallback first, then
// feed that extracted CSS into the app CSS entry for the browser build.
const extracted = await Bun.build({
  conditions: ["production", "browser", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "app.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/extracted"),
  plugins: [stylex.esbuild(compilerOptions)],
  root,
  splitting: true,
  target: "browser",
});
await requireBuild(extracted, "StyleX extraction");

const browser = await Bun.build({
  conditions: ["production", "browser", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "client.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/browser"),
  plugins: [stylex.esbuild(compilerOptions)],
  root,
  splitting: true,
  target: "browser",
});
await requireBuild(browser, "Browser");

const negativeControl = await Bun.build({
  conditions: ["production", "browser", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "client.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/negative-control"),
  root,
  splitting: true,
  target: "browser",
});
await requireBuild(negativeControl, "Plugin-free negative control");

const server = await Bun.build({
  conditions: ["production", "module"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  entrypoints: [resolve(root, "render.tsx")],
  format: "esm",
  metafile: true,
  minify: true,
  outdir: resolve(root, "dist/server"),
  plugins: [stylex.esbuild(compilerOptions)],
  root,
  splitting: true,
  target: "bun",
});
await requireBuild(server, "SSR");

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
await rm(resolve(root, "dist/extracted"), { force: true, recursive: true });
`;
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
  }
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
const work = await mkdtemp(join(tmpdir(), "hraness-packed-bun-browser-smoke-"));
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
      "@hraness/ui": `file:${archive}`,
      "@hugeicons/core-free-icons": "4.2.2",
      "@stylexjs/stylex": STYLEX_VERSION,
      "@stylexjs/unplugin": STYLEX_VERSION,
      react: REACT_VERSION,
      "react-dom": REACT_VERSION,
      unplugin: "2.3.11",
    },
  }, null, 2)}\n`);
  await run([process.execPath, "install", "--ignore-scripts"], consumer);

  await Promise.all([
    requireInstalledVersion(consumer, "@stylexjs/stylex", STYLEX_VERSION),
    requireInstalledVersion(consumer, "@stylexjs/unplugin", STYLEX_VERSION),
    requireInstalledVersion(consumer, "react", REACT_VERSION),
    requireInstalledVersion(consumer, "react-dom", REACT_VERSION),
  ]);

  await Promise.all([
    writeFile(resolve(consumer, "app.tsx"), applicationSource),
    writeFile(resolve(consumer, "client.tsx"), clientSource),
    writeFile(resolve(consumer, "app.css"), callerCss),
    writeFile(resolve(consumer, "render.tsx"), renderSource),
    writeFile(resolve(consumer, "negative-render.tsx"), negativeRenderSource),
    writeFile(resolve(consumer, "build.ts"), buildSource(consumer)),
  ]);
  await run([process.execPath, "./build.ts"], consumer);

  const browserDirectory = resolve(consumer, "dist/browser");
  const negativeControlDirectory = resolve(consumer, "dist/negative-control");
  const negativeControlSsrDirectory = resolve(
    consumer,
    "dist/negative-control-ssr",
  );
  const serverDirectory = resolve(consumer, "dist/server");
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
  const browserJavaScriptPath = requireExactlyOne(
    browserFiles,
    ".js",
    "browser build",
  );
  const browserCssPath = requireExactlyOne(
    browserFiles,
    ".css",
    "browser build",
  );
  const serverJavaScriptPath = requireExactlyOne(
    serverFiles,
    ".js",
    "SSR build",
  );
  const serverCssPath = requireExactlyOne(
    serverFiles,
    ".css",
    "SSR build",
  );
  const negativeControlJavaScriptPath = requireExactlyOne(
    negativeControlFiles,
    ".js",
    "plugin-free negative-control build",
  );
  const negativeControlCssPath = requireExactlyOne(
    negativeControlFiles,
    ".css",
    "plugin-free negative-control build",
  );
  const negativeControlSsrJavaScriptPath = requireExactlyOne(
    negativeControlSsrFiles,
    ".js",
    "plugin-free SSR negative-control build",
  );
  const negativeControlSsrCssPath = requireExactlyOne(
    negativeControlSsrFiles,
    ".css",
    "plugin-free SSR negative-control build",
  );

  const [
    negativeControlJavaScript,
    negativeControlCss,
  ] = await Promise.all([
    readFile(negativeControlJavaScriptPath, "utf8"),
    readFile(negativeControlCssPath, "utf8"),
  ]);
  assert.match(
    negativeControlJavaScript,
    localStylexSourcePropertyPattern,
    "the plugin-free negative control must retain the local StyleX source property",
  );
  assert.ok(
    negativeControlJavaScript.includes(LOCAL_STYLEX_VALUE),
    "the plugin-free negative control must retain the local StyleX source value",
  );
  assert.equal(
    countMatches(negativeControlCss, localStylexCssPattern),
    1,
    "the plugin-free negative control must retain the masking extracted CSS sentinel",
  );
  assert.throws(
    () => requireLocalStylexTransform(
      negativeControlJavaScript,
      negativeControlCss,
      "plugin-free negative control",
    ),
    /must not retain the local StyleX source property/u,
    "the transform oracle must reject a browser build without the StyleX plugin",
  );

  const [
    negativeControlSsrJavaScript,
    negativeControlSsrCss,
  ] = await Promise.all([
    readFile(negativeControlSsrJavaScriptPath, "utf8"),
    readFile(negativeControlSsrCssPath, "utf8"),
  ]);
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
    1,
    "the plugin-free SSR negative control must retain the masking extracted CSS sentinel",
  );
  assert.throws(
    () => requireLocalStylexTransform(
      negativeControlSsrJavaScript,
      negativeControlSsrCss,
      "plugin-free SSR negative control",
    ),
    /must not retain the local StyleX source property/u,
    "the transform oracle must reject a Bun-target SSR build without the StyleX plugin even when extracted CSS masks the missing transform",
  );
  await rm(negativeControlDirectory, { force: true, recursive: true });
  await rm(negativeControlSsrDirectory, { force: true, recursive: true });
  assert.equal(
    await Bun.file(negativeControlJavaScriptPath).exists(),
    false,
    "negative-control artifacts must be removed after the oracle check",
  );
  assert.equal(
    await Bun.file(negativeControlSsrJavaScriptPath).exists(),
    false,
    "SSR negative-control artifacts must be removed after the oracle check",
  );

  await run([process.execPath, serverJavaScriptPath], consumer);

  const htmlPath = resolve(consumer, "dist/index.html");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/") {
        return new Response(Bun.file(htmlPath), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/client.js") {
        return new Response(Bun.file(browserJavaScriptPath), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (pathname === "/client.css") {
        return new Response(Bun.file(browserCssPath), {
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
      fetchArtifact(origin, "/client.js", /^text\/javascript(?:;|$)/iu),
      fetchArtifact(origin, "/client.css", /^text\/css(?:;|$)/iu),
    ]);
  } finally {
    await server.stop(true);
  }

  const html = artifacts[0]?.body ?? "";
  const browserJavaScript = artifacts[1]?.body ?? "";
  const browserCss = artifacts[2]?.body ?? "";
  const [serverJavaScript, serverCss] = await Promise.all([
    readFile(serverJavaScriptPath, "utf8"),
    readFile(serverCssPath, "utf8"),
  ]);
  const productionArtifactPaths = [...browserFiles, ...serverFiles].filter(
    (file) => file.endsWith(".css") || file.endsWith(".js"),
  );
  const productionArtifactSources = await Promise.all(
    productionArtifactPaths.map((file) => readFile(file, "utf8")),
  );
  assert.equal(
    productionArtifactPaths.length,
    browserFiles.length + serverFiles.length,
    "browser and SSR builds must emit only scanned CSS and JavaScript artifacts",
  );
  const productionArtifacts = `${html}\n${productionArtifactSources.join("\n")}`;

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
  assert.match(html, /href="\/client\.css"/u);
  assert.match(html, /src="\/client\.js"/u);

  assert.match(browserJavaScript, /onRecoverableError/u);
  assert.match(browserJavaScript, /__HRANESS_PACKED_RECOVERABLE_ERRORS__/u);
  assert.match(browserJavaScript, /__HRANESS_PACKED_HYDRATION_STARTED__/u);
  requireLocalStylexTransform(
    browserJavaScript,
    browserCss,
    "production browser build",
  );
  requireLocalStylexTransform(
    serverJavaScript,
    serverCss,
    "production SSR build",
  );
  forbid(
    browserJavaScript,
    /(?:from|import\()\s*["'](?:@hraness\/ui|@stylexjs\/stylex|react(?:-dom)?(?:\/[^"']*)?)["']/u,
    "browser dependencies must be bundled rather than left as bare imports",
  );

  assert.match(browserCss, /components\.hraness-ui\.priority1/u);
  assert.match(browserCss, /components\.hraness-ui\.priority2/u);
  assert.equal(
    countMatches(browserCss, /flex\s*:\s*none\s*(?=;|\})/gu),
    1,
    "the packed UI flex declaration must appear exactly once after retransform",
  );
  assert.equal(
    countMatches(browserCss, /display\s*:\s*inline-block\s*(?=;|\})/gu),
    1,
    "the packed UI display declaration must appear exactly once after retransform",
  );
  assert.match(
    browserCss,
    /\.consumer-icon\s*\{[^}]*display\s*:\s*block\s*(?:;|\})/su,
    "the unlayered caller override must be bundled",
  );
  forbid(
    browserCss,
    /@import\s+["']@hraness\/ui\/stylex\.css["']/u,
    "the packed UI stylesheet import must be bundled",
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
    `Packed Bun browser smoke passed with Bun ${BUN_VERSION}, StyleX ${STYLEX_VERSION}, and React ${REACT_VERSION}.`,
  );
  console.log(
    `Fetched SSR HTML (${String(html.length)} bytes), browser JS (${String(browserJavaScript.length)} bytes), and browser CSS (${String(browserCss.length)} bytes) with explicit production MIME types.`,
  );
  console.log(
    "Verified browser and Bun-target SSR plugin-free negative controls, SSR icon and Ask AI hooks, bundled dependencies, extracted UI and caller CSS, duplicate-free UI declarations, and all browser/SSR artifact exclusions.",
  );
  console.log(
    "Hydration boundary: hydrateRoot and onRecoverableError instrumentation were compiled and served, but no browser executed them; this smoke does not claim real hydration.",
  );
} finally {
  await rm(work, { force: true, recursive: true });
}
