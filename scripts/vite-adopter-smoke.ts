import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";

import { chromium } from "playwright-core";

import { resolveFirstBrowserExecutable } from "./browser-executable.ts";

const BABEL_VERSION = "7.29.7";
const BUN_VERSION = "1.3.14";
const CLIENT_CSS_PROPERTY = "scroll-margin-bottom";
const CLIENT_SOURCE_PROPERTY = "scrollMarginBottom";
const CLIENT_VALUE = "314159px";
const FOCUS_IMPORTANT_VALUE = "rgb(24, 68, 112)";
const HOVER_IMPORTANT_VALUE = "rgb(120, 40, 60)";
const LAZY_CSS_PROPERTY = "scroll-padding-inline-start";
const LAZY_SOURCE_PROPERTY = "scrollPaddingInlineStart";
const LAZY_VALUE = "271828px";
const LIGHTNINGCSS_VERSION = "1.33.0";
const MULTI_CSS_PROPERTY = "margin-inline-end";
const MULTI_SOURCE_PROPERTY = "marginInlineEnd";
const MULTI_VALUE = "161803px";
const NESTED_MEDIA_VALUE = "rgb(65, 43, 21)";
const NESTED_SUPPORTS_VALUE = "rgb(12, 34, 56)";
const NODE_TYPES_VERSION = "24.13.3";
const NODE_VERSION_PREFIX = "24.";
const OVERLAP_MEDIA_VALUE = "rgb(44, 55, 66)";
const OVERLAP_SUPPORTS_VALUE = "rgb(77, 88, 99)";
const PSEUDO_COLOR_VALUE = "rgb(23, 45, 67)";
const PUBLIC_CSS_EXPORTS = {
  "./compiler-foundation.css": "./src/compiler-foundation.css",
  "./components.css": "./src/components.css",
  "./reset.css": "./src/reset.css",
  "./styles.css": "./src/styles.css",
  "./stylex.css": "./dist/stylex.css",
  "./tokens.css": "./src/tokens.css",
} as const;
const REACT_VERSION = "19.2.3";
const SSR_CSS_PROPERTY = "outline-offset";
const SSR_SOURCE_PROPERTY = "outlineOffset";
const SSR_VALUE = "141421px";
const STYLEX_VERSION = "0.19.0";
const STYLEX_UNION_POLICY_SHA256 = "1ceced1f1bf6359413ca6425ede61e1fdae272b897f4455c2347e2431d75caa1";
const TYPESCRIPT_VERSION = "6.0.3";
const VITE_VERSION = "7.3.6";

const clientSource = `import React, { useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { cascadeClassNames } from "./cascade.ts";
import "./styles/app.css";

const styles = stylex.create({
  client: { ${CLIENT_SOURCE_PROPERTY}: ${JSON.stringify(CLIENT_VALUE)} },
});

export const clientClassName = stylex.props(styles.client).className;
export const loadLazy = () => import("./lazy.ts");

const root = document.querySelector("#root");
const serverMain = root?.querySelector("main[data-vite-ssr='true']");
if (!(root instanceof HTMLElement) || !(serverMain instanceof HTMLElement)) {
  throw new Error("The finalized SSR hydration boundary is missing");
}
const serverClassName = serverMain.className;

function App() {
  const [hydrated, setHydrated] = useState(false);
  const [lazyClassName, setLazyClassName] = useState("");
  useEffect(() => {
    let active = true;
    setHydrated(true);
    void loadLazy().then((module) => {
      if (active) setLazyClassName(module.lazyClassName);
    });
    return () => { active = false; };
  }, []);
  const lazy = lazyClassName.length > 0;
  return React.createElement(
    "main",
    {
      className: [serverClassName, hydrated ? clientClassName : "", lazyClassName].filter(Boolean).join(" "),
      "data-vite-hydrated": String(hydrated),
      "data-vite-lazy": String(lazy),
      "data-vite-ssr": "true",
    },
    React.createElement("span", { "data-vite-content": "true" }, "Vite adopter"),
    React.createElement("span", { "data-vite-lazy-status": "true" }, lazy ? "ready" : "pending"),
    React.createElement(
      "section",
      { "data-vite-cascade": "true" },
      React.createElement("div", { className: cascadeClassNames.forward, "data-vite-overlap-forward": "true" }, "Forward"),
      React.createElement("div", { className: cascadeClassNames.reverse, "data-vite-overlap-reverse": "true" }, "Reverse"),
      React.createElement("div", { className: cascadeClassNames.nestedForward, "data-vite-nested-order": "forward" }, "Nested forward"),
      React.createElement("div", { className: cascadeClassNames.nestedReverse, "data-vite-nested-order": "reverse" }, "Nested reverse"),
      React.createElement("button", { className: cascadeClassNames.interactiveForward, "data-vite-focus-order": "forward", type: "button" }, "Focus forward"),
      React.createElement("button", { className: cascadeClassNames.interactiveReverse, "data-vite-focus-order": "reverse", type: "button" }, "Focus reverse"),
      React.createElement("button", { className: cascadeClassNames.interactiveForward, "data-vite-hover-order": "forward", type: "button" }, "Hover forward"),
      React.createElement("button", { className: cascadeClassNames.interactiveReverse, "data-vite-hover-order": "reverse", type: "button" }, "Hover reverse"),
      React.createElement("span", { className: cascadeClassNames.pseudoForward, "data-vite-pseudo-order": "forward" }, "Pseudo forward"),
      React.createElement("span", { className: cascadeClassNames.pseudoReverse, "data-vite-pseudo-order": "reverse" }, "Pseudo reverse"),
    ),
  );
}

hydrateRoot(root, React.createElement(App));
`;

const lazySource = `import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  lazy: { ${LAZY_SOURCE_PROPERTY}: ${JSON.stringify(LAZY_VALUE)} },
});

export const lazyClassName = stylex.props(styles.lazy).className;
`;

const secondarySource = `import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  secondary: { ${MULTI_SOURCE_PROPERTY}: ${JSON.stringify(MULTI_VALUE)} },
});

export const secondaryClassName = stylex.props(styles.secondary).className;

const boundary = document.querySelector("[data-vite-secondary]");
if (!(boundary instanceof HTMLElement)) throw new Error("The secondary entry boundary is missing");
boundary.className = secondaryClassName;
boundary.dataset.viteSecondary = "true";
`;

const cascadeSource = `import * as stylex from "@stylexjs/stylex";

const stillFrames = stylex.keyframes({
  from: { opacity: 0.314159 },
  to: { opacity: 0.314159 },
});

const baseStyles = stylex.create({
  overlap: {
    color: {
      default: "rgb(1, 2, 3)",
      "@supports (display: grid)": "rgb(11, 22, 33)",
      "@media (min-width: 1px)": ${JSON.stringify(OVERLAP_MEDIA_VALUE)},
    },
  },
  nested: {
    borderLeftColor: {
      default: "rgb(3, 2, 1)",
      "@supports (display: grid)": {
        default: "rgb(6, 5, 4)",
        "@supports (color: red)": {
          default: "rgb(9, 8, 7)",
          "@supports (gap: 1px)": ${JSON.stringify(NESTED_SUPPORTS_VALUE)},
        },
      },
      "@media (min-width: 1px)": ${JSON.stringify(NESTED_MEDIA_VALUE)},
    },
    borderLeftStyle: "solid",
    borderLeftWidth: "1px",
  },
  interactive: {
    backgroundColor: "rgb(2, 4, 8)",
    ":focus-visible": { backgroundColor: ${JSON.stringify(`${FOCUS_IMPORTANT_VALUE} !important`)} },
    ":hover": { backgroundColor: ${JSON.stringify(`${HOVER_IMPORTANT_VALUE} !important`)} },
  },
  pseudo: {
    animationDuration: "98765s",
    animationName: stillFrames,
    animationPlayState: "paused",
    "::before": {
      color: ${JSON.stringify(PSEUDO_COLOR_VALUE)},
      content: '\"vite-stylex-before\"',
    },
  },
});

const callerStyles = stylex.create({
  overlap: {
    color: {
      default: null,
      "@supports (display: grid)": ${JSON.stringify(OVERLAP_SUPPORTS_VALUE)},
    },
  },
  orderMarker: { scrollMarginTop: "123456px" },
});

const baseOverlap = stylex.props(baseStyles.overlap).className;
const callerOverlap = stylex.props(callerStyles.overlap).className;
const interactive = stylex.props(baseStyles.interactive).className;
const nested = stylex.props(baseStyles.nested).className;
const orderMarker = stylex.props(callerStyles.orderMarker).className;
const pseudo = stylex.props(baseStyles.pseudo).className;
const forward = (className) => [className, orderMarker].join(" ");
const reverse = (className) => [orderMarker, className].join(" ");

export const cascadeClassNames = {
  forward: [baseOverlap, callerOverlap].join(" "),
  interactiveForward: forward(interactive),
  interactiveReverse: reverse(interactive),
  nestedForward: forward(nested),
  nestedReverse: reverse(nested),
  pseudoForward: forward(pseudo),
  pseudoReverse: reverse(pseudo),
  reverse: [callerOverlap, baseOverlap].join(" "),
};
`;

const serverSource = `import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import * as stylex from "@stylexjs/stylex";
import { cascadeClassNames } from "./cascade.ts";

const styles = stylex.create({
  server: { ${SSR_SOURCE_PROPERTY}: ${JSON.stringify(SSR_VALUE)} },
});

export const serverClassName = stylex.props(styles.server).className;

function ServerApp() {
  return React.createElement(
    "main",
    {
      className: serverClassName,
      "data-vite-hydrated": "false",
      "data-vite-lazy": "false",
      "data-vite-ssr": "true",
    },
    React.createElement("span", { "data-vite-content": "true" }, "Vite adopter"),
    React.createElement("span", { "data-vite-lazy-status": "true" }, "pending"),
    React.createElement(
      "section",
      { "data-vite-cascade": "true" },
      React.createElement("div", { className: cascadeClassNames.forward, "data-vite-overlap-forward": "true" }, "Forward"),
      React.createElement("div", { className: cascadeClassNames.reverse, "data-vite-overlap-reverse": "true" }, "Reverse"),
      React.createElement("div", { className: cascadeClassNames.nestedForward, "data-vite-nested-order": "forward" }, "Nested forward"),
      React.createElement("div", { className: cascadeClassNames.nestedReverse, "data-vite-nested-order": "reverse" }, "Nested reverse"),
      React.createElement("button", { className: cascadeClassNames.interactiveForward, "data-vite-focus-order": "forward", type: "button" }, "Focus forward"),
      React.createElement("button", { className: cascadeClassNames.interactiveReverse, "data-vite-focus-order": "reverse", type: "button" }, "Focus reverse"),
      React.createElement("button", { className: cascadeClassNames.interactiveForward, "data-vite-hover-order": "forward", type: "button" }, "Hover forward"),
      React.createElement("button", { className: cascadeClassNames.interactiveReverse, "data-vite-hover-order": "reverse", type: "button" }, "Hover reverse"),
      React.createElement("span", { className: cascadeClassNames.pseudoForward, "data-vite-pseudo-order": "forward" }, "Pseudo forward"),
      React.createElement("span", { className: cascadeClassNames.pseudoReverse, "data-vite-pseudo-order": "reverse" }, "Pseudo reverse"),
    ),
  );
}

export function renderDocument(clientHref, secondaryHref, foundationHref, placeholder) {
  assert.ok(clientHref.startsWith("/graphs/client/"));
  assert.ok(secondaryHref.startsWith("/graphs/client/"));
  assert.notEqual(clientHref, secondaryHref);
  assert.ok(foundationHref.startsWith("/graphs/client/"));
  assert.equal(placeholder, "__HRANESS_STYLEX_CSS__");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Packed Vite adopter smoke</title>",
    '<link rel="stylesheet" href="' + foundationHref + '">',
    '<link rel="stylesheet" href="' + placeholder + '">',
    "</head>",
    "<body>",
    '<div id="root">' + renderToString(React.createElement(ServerApp)) + '</div>',
    '<aside data-vite-secondary="false">Secondary entry</aside>',
    '<script type="module" src="' + clientHref + '"></script>',
    '<script type="module" src="' + secondaryHref + '"></script>',
    "</body>",
    "</html>",
  ].join("");
}

const outputPath = process.argv[2];
if (outputPath !== undefined) {
  const clientHref = process.argv[3];
  const secondaryHref = process.argv[4];
  const foundationHref = process.argv[5];
  const placeholder = process.argv[6];
  assert.ok(clientHref !== undefined);
  assert.ok(secondaryHref !== undefined);
  assert.ok(foundationHref !== undefined);
  assert.ok(placeholder !== undefined);
  await writeFile(
    outputPath,
    renderDocument(clientHref, secondaryHref, foundationHref, placeholder),
    { flag: "wx" },
  );
}
`;

const applicationCss = `@import "./nested/foundation.css";

@layer components.fixture-product.legacy {
  [data-vite-ssr] {
    scroll-margin-bottom: 2px;
  }
}

.vite-adopter-client {
  display: block;
}
`;

const nestedFoundationCss = `@import "@hraness/ui/compiler-foundation.css";

.vite-adopter-nested {
  isolation: isolate;
}
`;

function buildSource(consumer: string): string {
  return `import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { build as viteBuild } from "vite";
import {
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
  auditCssWithoutStylexUnionNamespace,
  createStylexGeneration,
  finalizeStylexGeneration,
  prepareStylexProducedTemplate,
  sealStylexProducedTemplate,
  serializeStylexRuleUnionV1,
  stylexUnionPolicySha256,
} from "@hraness/ui/stylex-build";
import { stylexVite } from "@hraness/ui/stylex-build/vite";

const root = ${JSON.stringify(consumer)};
const expectedUnionPolicySha256 = ${JSON.stringify(STYLEX_UNION_POLICY_SHA256)};

assert.equal(stylexUnionPolicySha256, expectedUnionPolicySha256);
const unionProbe = serializeStylexRuleUnionV1(
  [["x-packed-vite-union-probe", { ltr: ".x-packed-vite-union-probe{color:red}" }, 1000]],
  [{ before: ["components.fixture-package.legacy"], prefix: "components.fixture-package" }],
);
assert.match(unionProbe, /@layer components\\.hraness-stylex\\.priority1/u);
assert.doesNotMatch(unionProbe, /components\\.fixture-package\\.priority/u);
auditCssWithoutStylexUnionNamespace(
  "@layer components.fixture-package.legacy { .fixture { display: block; } }",
  "packed Vite safe foundation probe",
);
assert.throws(
  () => auditCssWithoutStylexUnionNamespace(
    "@layer components.hraness-stylex.priority9 { .fixture { display: block; } }",
    "packed Vite reserved foundation probe",
  ),
  /reserved StyleX rule-union namespace/u,
);

async function readReceipt(generation, graphId) {
  return JSON.parse(await readFile(
    join(generation.directory, ".stylex-generation", "receipts", graphId + ".json"),
    "utf8",
  ));
}

function oneOutput(receipt, predicate, description) {
  const matches = receipt.outputs.filter(predicate);
  assert.equal(matches.length, 1, description + " must identify one output");
  return matches[0];
}

function namedJavaScript(receipt, name, description) {
  return oneOutput(
    receipt,
    ({ path }) => /\\.[cm]?js$/u.test(path) && (basename(path).startsWith(name + "-") || basename(path) === name + ".js" || basename(path) === name + ".mjs"),
    description,
  );
}

function hasRuleValue(receipt, value) {
  const serializedValue = value.replaceAll(/,\\s+/gu, ",");
  return receipt.rules.some(([, rule]) =>
    rule.ltr.includes(serializedValue) || (rule.rtl ?? "").includes(serializedValue));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runBounded(command, options, description) {
  const child = spawn(command[0], command.slice(1), {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = streamText(child.stdout);
  const stderr = streamText(child.stderr);
  const settlement = exit(child);
  let timeout;
  const outcome = await Promise.race([
    settlement,
    new Promise((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ kind: "timeout" }), 60_000);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (outcome.kind === "timeout") {
    child.kill("SIGTERM");
    let grace;
    const terminated = await Promise.race([
      settlement.then(() => true),
      new Promise((resolveGrace) => {
        grace = setTimeout(() => resolveGrace(false), 2_000);
      }),
    ]);
    if (grace !== undefined) clearTimeout(grace);
    if (!terminated) child.kill("SIGKILL");
  }
  const settled = await settlement;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (stdoutText.length > 0) process.stdout.write(stdoutText);
  if (stderrText.length > 0) process.stderr.write(stderrText);
  if (outcome.kind === "timeout") throw new Error(description + " timed out after 60000ms");
  if (settled.code !== 0 || settled.signal !== null) {
    throw new Error(description + " failed (code " + String(settled.code) + ", signal " + String(settled.signal) + ")");
  }
}

async function streamText(stream) {
  if (stream === null) return "";
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}

function exit(child) {
  return new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, kind: "exit", signal: child.signalCode });
      return;
    }
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, kind: "exit", signal }));
  });
}

process.env.NODE_ENV = "production";
const outputDirectory = resolve(root, "output");
const generation = await createStylexGeneration({
  expectedGraphs: [
    {
      adapter: "vite",
      entrypoints: ["src/client.ts", "src/secondary.ts"],
      id: "client",
      kind: "client",
    },
    {
      adapter: "vite",
      entrypoints: ["src/server.ts"],
      id: "ssr",
      kind: "ssr",
    },
  ],
  finalCssPath: "stylex.css",
  generationId: "packed-vite-adopter",
  outputDirectory,
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

await viteBuild({
  build: { minify: true },
  configFile: false,
  logLevel: "silent",
  plugins: [stylexVite({ generation, graphId: "client", rootDirectory: root })],
});
const clientReceipt = await readReceipt(generation, "client");
assert.equal(clientReceipt.adapter, "vite");
assert.equal(clientReceipt.target, "client");
assert.deepEqual(clientReceipt.entrypoints, ["src/client.ts", "src/secondary.ts"]);
for (const path of [
  "src/client.ts",
  "src/cascade.ts",
  "src/lazy.ts",
  "src/secondary.ts",
  "src/styles/app.css",
  "src/styles/nested/foundation.css",
  "node_modules/@hraness/ui/src/compiler-foundation.css",
  "node_modules/@hraness/ui/src/tokens.css",
  "node_modules/@hraness/ui/src/compiler-reset.css",
  "node_modules/@hraness/ui/src/components.css",
]) {
  assert.ok(clientReceipt.inputs.some((artifact) => artifact.path === path), "client receipt must bind " + path);
}
assert.ok(clientReceipt.edges.some((edge) => edge.from === "input:src/client.ts" && edge.kind === "dynamic-import" && edge.to === "input:src/lazy.ts"));
assert.ok(clientReceipt.edges.some((edge) => edge.from === "input:src/styles/app.css" && edge.kind === "css-import" && edge.to === "input:src/styles/nested/foundation.css"));
assert.ok(clientReceipt.edges.some((edge) => edge.from === "input:src/styles/nested/foundation.css" && edge.kind === "css-import" && edge.to === "input:node_modules/@hraness/ui/src/compiler-foundation.css"));
assert.ok(clientReceipt.edges.some((edge) => edge.from === "input:node_modules/@hraness/ui/src/compiler-foundation.css" && edge.kind === "css-import" && edge.to === "input:node_modules/@hraness/ui/src/compiler-reset.css"));
assert.ok(!clientReceipt.inputs.some((artifact) => artifact.path === "node_modules/@hraness/ui/src/reset.css"));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(CLIENT_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(LAZY_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(MULTI_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(OVERLAP_MEDIA_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(OVERLAP_SUPPORTS_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(NESTED_MEDIA_VALUE)}));
assert.ok(hasRuleValue(clientReceipt, ${JSON.stringify(NESTED_SUPPORTS_VALUE)}));
assert.ok(clientReceipt.rules.some(([, rule, priority]) => priority === 0 && rule.ltr.includes("@keyframes")));
const clientEntry = namedJavaScript(clientReceipt, "client", "client entry");
const secondaryEntry = namedJavaScript(clientReceipt, "secondary", "secondary entry");
namedJavaScript(clientReceipt, "lazy", "lazy chunk");
const foundation = oneOutput(clientReceipt, ({ path }) => path.endsWith(".css"), "client foundation CSS");
auditCssWithoutStylexUnionNamespace(
  await readFile(join(
    generation.directory,
    ...clientReceipt.outputRoot.split("/"),
    ...foundation.path.split("/"),
  ), "utf8"),
  "packed Vite client foundation graph",
);
assert.equal(await exists(join(generation.directory, "payload", "stylex.css")), false);

await viteBuild({
  build: { minify: true, ssr: resolve(root, "src/server.ts") },
  configFile: false,
  logLevel: "silent",
  plugins: [stylexVite({ generation, graphId: "ssr", rootDirectory: root })],
});
const ssrReceipt = await readReceipt(generation, "ssr");
assert.equal(ssrReceipt.adapter, "vite");
assert.equal(ssrReceipt.target, "ssr");
assert.deepEqual(ssrReceipt.entrypoints, ["src/server.ts"]);
assert.ok(ssrReceipt.inputs.some((artifact) => artifact.path === "src/server.ts"));
assert.ok(ssrReceipt.inputs.some((artifact) => artifact.path === "src/cascade.ts"));
assert.ok(hasRuleValue(ssrReceipt, ${JSON.stringify(SSR_VALUE)}));
assert.ok(hasRuleValue(ssrReceipt, ${JSON.stringify(OVERLAP_MEDIA_VALUE)}));
assert.ok(hasRuleValue(ssrReceipt, ${JSON.stringify(OVERLAP_SUPPORTS_VALUE)}));
assert.ok(hasRuleValue(ssrReceipt, ${JSON.stringify(NESTED_MEDIA_VALUE)}));
assert.ok(hasRuleValue(ssrReceipt, ${JSON.stringify(NESTED_SUPPORTS_VALUE)}));
assert.ok(ssrReceipt.rules.some(([, rule, priority]) => priority === 0 && rule.ltr.includes("@keyframes")));
assert.deepEqual(ssrReceipt.outputs.filter(({ path }) => path.endsWith(".css")), []);
const serverEntry = namedJavaScript(ssrReceipt, "server", "SSR entry");
assert.equal(await exists(join(generation.directory, "payload", "stylex.css")), false);

const prepared = await prepareStylexProducedTemplate(generation, "index.html");
const rendererPath = join(
  generation.directory,
  ...ssrReceipt.outputRoot.split("/"),
  ...serverEntry.path.split("/"),
);
await runBounded([
  process.execPath,
  rendererPath,
  prepared.sourcePath,
  "/graphs/client/" + clientEntry.path,
  "/graphs/client/" + secondaryEntry.path,
  "/graphs/client/" + foundation.path,
  STYLEX_TEMPLATE_CSS_PLACEHOLDER,
], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production" },
}, "emitted Vite SSR renderer");
await sealStylexProducedTemplate(generation, "index.html");
const finalDirectory = await finalizeStylexGeneration({
  generation,
  outputDirectory,
  rootDirectory: root,
});
assert.equal(finalDirectory, resolve(outputDirectory, "packed-vite-adopter"));
`;
}

const typeContractSource = `import {
  auditCssWithoutStylexUnionNamespace,
  createStylexGeneration,
  finalizeStylexGeneration,
  serializeStylexPackageRules,
  serializeStylexRuleUnionV1,
  stylexUnionPolicy,
  stylexUnionPolicySha256,
  type StylexCompleteRecordV2,
  type StylexGenerationHandleV1,
  type StylexGenerationPlanV2,
  type StylexRuleUnionPolicyV1,
  type StylexRuleV1,
  type StylexStandaloneSerializerV1,
} from "@hraness/ui/stylex-build";
import {
  stylexVite,
  type StylexViteOptions,
} from "@hraness/ui/stylex-build/vite";
import type { Plugin } from "vite";

const generation = null as unknown as StylexGenerationHandleV1;
const options = {
  generation,
  graphId: "client",
  rootDirectory: process.cwd(),
} satisfies StylexViteOptions;
const standaloneSerializer = {
  before: ["components.fixture-package.legacy"],
  prefix: "components.fixture-package",
} satisfies StylexStandaloneSerializerV1;
const standaloneCss: string = serializeStylexPackageRules([], standaloneSerializer);
const unionRules: readonly StylexRuleV1[] = [[
  "x-type-union-probe",
  { ltr: ".x-type-union-probe{color:red}" },
  1000,
]];
const unionCss: string = serializeStylexRuleUnionV1(unionRules, [standaloneSerializer]);
const unionPolicy: StylexRuleUnionPolicyV1 = stylexUnionPolicy;
const unionPolicyDigest: string = stylexUnionPolicySha256;
const complete = null as unknown as StylexCompleteRecordV2;
const plan = null as unknown as StylexGenerationPlanV2;
auditCssWithoutStylexUnionNamespace(
  "@layer components.fixture-package.legacy;",
  "packed Vite type-contract foundation",
);
const plugin: Plugin = stylexVite(options);
void createStylexGeneration;
void finalizeStylexGeneration;
void plugin;
void standaloneCss;
void unionCss;
void unionPolicy;
void unionPolicyDigest;
void complete;
void plan;

// @ts-expect-error Portable StyleX and Vite declarations must not expose Bun globals.
void Bun;
`;

function typeContractConfig(moduleResolution: "Bundler" | "NodeNext") {
  return {
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      module: moduleResolution === "Bundler" ? "Preserve" : "NodeNext",
      moduleResolution,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2023",
      types: ["node"],
      verbatimModuleSyntax: true,
    },
    files: ["type-contract.ts"],
  };
}

function resolveGenuineNodeExecutable(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const identityProbe = [
    "if (typeof Bun !== 'undefined'",
    "|| process.versions.bun !== undefined",
    `|| !process.versions.node?.startsWith('${NODE_VERSION_PREFIX}')) process.exit(1)`,
  ].join(" ");
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "--eval",
        identityProbe,
      ], {
        env: process.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent, inaccessible, or incompatible PATH candidates.
    }
  }
  throw new Error("Packed Vite adopter smoke requires a genuine Node 24 executable on PATH");
}

type RunOptions = Readonly<{
  echo?: boolean;
  readyReceipt?: Readonly<{
    path: string;
    startupTimeoutMs?: number;
    token: string;
  }>;
  terminationGraceMs?: number;
  timeoutMs?: number;
}>;

type ReadyReceiptOutcome =
  | Readonly<{ kind: "exit" }>
  | Readonly<{ error: Error; kind: "failure" }>
  | Readonly<{ kind: "ready" }>;

async function waitForReadyReceipt(
  receipt: NonNullable<RunOptions["readyReceipt"]>,
  pid: number,
  exited: Promise<number>,
): Promise<ReadyReceiptOutcome> {
  const startupTimeoutMs = receipt.startupTimeoutMs ?? 10_000;
  const deadline = Date.now() + startupTimeoutMs;
  const inspect = async (): Promise<ReadyReceiptOutcome | undefined> => {
    try {
      const candidate = JSON.parse(await readFile(receipt.path, "utf8")) as {
        pid?: unknown;
        token?: unknown;
      };
      if (candidate.pid === pid && candidate.token === receipt.token) {
        return { kind: "ready" };
      }
      return {
        error: new Error(`Ready receipt identity did not match spawned process ${String(pid)}`),
        kind: "failure",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return {
        error: new Error(`Failed to read ready receipt ${receipt.path}`, { cause: error }),
        kind: "failure",
      };
    }
  };
  while (true) {
    const observed = await inspect();
    if (observed !== undefined) return observed;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        error: new Error(`Command did not become ready after ${String(startupTimeoutMs)}ms`),
        kind: "failure",
      };
    }
    const outcome = await Promise.race([
      exited.then(() => ({ kind: "exit" as const })),
      new Promise<{ kind: "poll" }>((resolvePoll) => {
        setTimeout(() => resolvePoll({ kind: "poll" }), Math.min(25, remainingMs));
      }),
    ]);
    if (outcome.kind === "exit") return (await inspect()) ?? outcome;
  }
}

async function terminateAndReap(
  child: Readonly<{
    exited: Promise<number>;
    kill(signal?: number | NodeJS.Signals): void;
  }>,
  terminationGraceMs: number,
): Promise<void> {
  child.kill("SIGTERM");
  let grace: ReturnType<typeof setTimeout> | undefined;
  const terminated = await Promise.race([
    child.exited.then(() => true),
    new Promise<false>((resolveGrace) => {
      grace = setTimeout(() => resolveGrace(false), terminationGraceMs);
    }),
  ]);
  if (grace !== undefined) clearTimeout(grace);
  if (!terminated) child.kill("SIGKILL");
  await child.exited;
}

async function run(
  command: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  options: RunOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const terminationGraceMs = options.terminationGraceMs ?? 2_000;
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  assert.ok(Number.isSafeInteger(terminationGraceMs) && terminationGraceMs > 0);
  if (options.readyReceipt !== undefined) {
    const startupTimeoutMs = options.readyReceipt.startupTimeoutMs ?? 10_000;
    assert.ok(Number.isSafeInteger(startupTimeoutMs) && startupTimeoutMs > 0);
    assert.ok(options.readyReceipt.token.length > 0, "Ready receipt token must not be empty");
  }
  const child = Bun.spawn([...command], {
    cwd,
    env: environment,
    stdin: "ignore",
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const readyOutcome = options.readyReceipt === undefined
    ? { kind: "ready" as const }
    : await waitForReadyReceipt(options.readyReceipt, child.pid, child.exited);
  if (readyOutcome.kind !== "ready") {
    if (readyOutcome.kind === "exit") await child.exited;
    else await terminateAndReap(child, terminationGraceMs);
    const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
    if (options.echo !== false && stdoutText.length > 0) process.stdout.write(stdoutText);
    if (options.echo !== false && stderrText.length > 0) process.stderr.write(stderrText);
    if (readyOutcome.kind === "failure") throw readyOutcome.error;
    throw new Error(`Command exited before publishing its ready receipt: ${command.join(" ")}`);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, kind: "exit" as const })),
    new Promise<{ kind: "timeout" }>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  const timedOut = outcome.kind === "timeout";
  if (timedOut) await terminateAndReap(child, terminationGraceMs);
  const exitCode = await child.exited;
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr]);
  if (options.echo !== false && stdoutText.length > 0) process.stdout.write(stdoutText);
  if (options.echo !== false && stderrText.length > 0) process.stderr.write(stderrText);
  if (timedOut) {
    throw new Error(`Command timed out after ${String(timeoutMs)}ms: ${command.join(" ")}`);
  }
  assert.equal(
    child.signalCode,
    null,
    `Command exited by signal ${String(child.signalCode)}: ${command.join(" ")}`,
  );
  assert.equal(exitCode, 0, `Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function verifyBoundedRunner(
  nodeExecutable: string,
  directory: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const artifact = resolve(directory, "retained-handle-child.json");
  const token = `${String(process.pid)}-${String(Date.now())}`;
  const temporaryArtifact = `${artifact}.${token}.tmp`;
  const source = `
    import { renameSync, writeFileSync } from "node:fs";
    process.on("SIGTERM", () => {});
    setTimeout(() => {
      writeFileSync(
        ${JSON.stringify(temporaryArtifact)},
        JSON.stringify({ pid: process.pid, token: ${JSON.stringify(token)} }),
        { flag: "wx" },
      );
      renameSync(${JSON.stringify(temporaryArtifact)}, ${JSON.stringify(artifact)});
    }, 250);
    setInterval(() => {}, 1_000);
  `;
  await assert.rejects(
    run(
      [nodeExecutable, "--input-type=module", "--eval", source],
      directory,
      environment,
      {
        echo: false,
        readyReceipt: { path: artifact, startupTimeoutMs: 10_000, token },
        terminationGraceMs: 100,
        timeoutMs: 100,
      },
    ),
    /Command timed out after 100ms/u,
  );
  const receipt = JSON.parse(await readFile(artifact, "utf8")) as {
    pid?: unknown;
    token?: unknown;
  };
  assert.equal(typeof receipt.pid, "number");
  assert.equal(receipt.token, token);
  assert.equal(processExists(receipt.pid as number), false, "timed-out retained-handle child must not survive");
  await rm(artifact);
}

function startOutputServer(directory: string, requestedPaths: Set<string>) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      requestedPaths.add(pathname);
      if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
      const logical = pathname === "/" ? "index.html" : pathname.slice(1);
      if (
        logical.length === 0
        || logical.includes("\\")
        || logical.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ) return new Response("Not found", { status: 404 });
      const absolute = resolve(directory, logical);
      const contained = relative(directory, absolute);
      if (contained === ".." || contained.startsWith("../")) {
        return new Response("Not found", { status: 404 });
      }
      const file = Bun.file(absolute);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      const type = logical.endsWith(".css")
        ? "text/css"
        : /\.[cm]?js$/u.test(logical)
          ? "text/javascript"
          : logical.endsWith(".json")
            ? "application/json"
            : "text/html";
      return new Response(file, { headers: { "content-type": `${type}; charset=utf-8` } });
    },
  });
}

async function verifyBrowserOutput(
  finalDirectory: string,
  expectedRequests: readonly string[],
): Promise<void> {
  const requestedPaths = new Set<string>();
  const server = startOutputServer(finalDirectory, requestedPaths);
  try {
    const executablePath = await resolveFirstBrowserExecutable(
      [
        ...(process.env.CHROMIUM_EXECUTABLE_PATH === undefined
          ? []
          : [process.env.CHROMIUM_EXECUTABLE_PATH]),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        chromium.executablePath(),
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ],
      "No ordinary Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH to run the packed Vite browser smoke.",
    );
    const browser = await chromium.launch({
      args: ["--no-sandbox"],
      executablePath,
      headless: true,
    });
    try {
      assert.ok(browser.version().length > 0, "Chromium must report its browser identity");
      const context = await browser.newContext({
        colorScheme: "light",
        viewport: { height: 720, width: 1_280 },
      });
      try {
        const page = await context.newPage();
        const failures: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") failures.push(`console: ${message.text()}`);
        });
        page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
        page.on("requestfailed", (request) => {
          failures.push(`request: ${request.url()} (${request.failure()?.errorText ?? "unknown failure"})`);
        });
        const origin = `http://${server.hostname}:${String(server.port)}`;
        const response = await page.goto(origin, { waitUntil: "networkidle" });
        assert.equal(response?.status(), 200, "finalized Vite document must load successfully");
        await page.waitForFunction(() => {
          const main = document.querySelector("main[data-vite-ssr='true']");
          const secondary = document.querySelector("[data-vite-secondary]");
          return main instanceof HTMLElement
            && main.dataset.viteHydrated === "true"
            && main.dataset.viteLazy === "true"
            && main.querySelector("[data-vite-lazy-status]")?.textContent === "ready"
            && secondary instanceof HTMLElement
            && secondary.dataset.viteSecondary === "true";
        }, undefined, { polling: "raf", timeout: 10_000 });
        const settleInteraction = async (order: "forward" | "reverse") => {
          await page.keyboard.press("Tab");
          await page.waitForFunction((inputOrder) => {
            const focused = document.querySelector(`[data-vite-focus-order="${inputOrder}"]`);
            return focused instanceof HTMLButtonElement
              && document.activeElement === focused
              && focused.matches(":focus-visible");
          }, order, { polling: "raf", timeout: 10_000 });
          await page.locator(`[data-vite-hover-order="${order}"]`).hover();
          await page.waitForFunction((inputOrder) => {
            const hovered = document.querySelector(`[data-vite-hover-order="${inputOrder}"]`);
            return hovered instanceof HTMLButtonElement && hovered.matches(":hover");
          }, order, { polling: "raf", timeout: 10_000 });
          return page.evaluate((inputOrder) => {
            const focused = document.querySelector(`[data-vite-focus-order="${inputOrder}"]`);
            const hovered = document.querySelector(`[data-vite-hover-order="${inputOrder}"]`);
            if (!(focused instanceof HTMLButtonElement) || !(hovered instanceof HTMLButtonElement)) {
              throw new Error(`Missing ${inputOrder} interaction fixtures`);
            }
            return {
              focusColor: getComputedStyle(focused).backgroundColor,
              focusVisible: focused.matches(":focus-visible"),
              hoverColor: getComputedStyle(hovered).backgroundColor,
              hovered: hovered.matches(":hover"),
            };
          }, order);
        };
        const forwardInteraction = await settleInteraction("forward");
        const reverseInteraction = await settleInteraction("reverse");
        const evidence = await page.evaluate(() => {
          const main = document.querySelector("main[data-vite-ssr='true']");
          const secondary = document.querySelector("[data-vite-secondary]");
          const forward = document.querySelector("[data-vite-overlap-forward]");
          const reverse = document.querySelector("[data-vite-overlap-reverse]");
          const nestedForward = document.querySelector('[data-vite-nested-order="forward"]');
          const nestedReverse = document.querySelector('[data-vite-nested-order="reverse"]');
          const focusForward = document.querySelector('[data-vite-focus-order="forward"]');
          const focusReverse = document.querySelector('[data-vite-focus-order="reverse"]');
          const pseudoForward = document.querySelector('[data-vite-pseudo-order="forward"]');
          const pseudoReverse = document.querySelector('[data-vite-pseudo-order="reverse"]');
          if (
            !(main instanceof HTMLElement)
            || !(secondary instanceof HTMLElement)
            || !(forward instanceof HTMLElement)
            || !(reverse instanceof HTMLElement)
            || !(nestedForward instanceof HTMLElement)
            || !(nestedReverse instanceof HTMLElement)
            || !(focusForward instanceof HTMLButtonElement)
            || !(focusReverse instanceof HTMLButtonElement)
            || !(pseudoForward instanceof HTMLElement)
            || !(pseudoReverse instanceof HTMLElement)
          ) {
            throw new Error("Finalized Vite runtime boundaries are missing");
          }
          const mainStyle = getComputedStyle(main);
          const secondaryStyle = getComputedStyle(secondary);
          const pseudoForwardStyle = getComputedStyle(pseudoForward, "::before");
          const pseudoReverseStyle = getComputedStyle(pseudoReverse, "::before");
          return {
            animationNameForward: getComputedStyle(pseudoForward).animationName,
            animationNameReverse: getComputedStyle(pseudoReverse).animationName,
            client: mainStyle.scrollMarginBottom,
            content: main.querySelector("[data-vite-content]")?.textContent,
            focusForwardClassName: focusForward.className,
            focusReverseClassName: focusReverse.className,
            forwardClassName: forward.className,
            hydrated: main.dataset.viteHydrated,
            lazy: mainStyle.scrollPaddingInlineStart,
            mainClassName: main.className,
            multiEntry: secondaryStyle.marginInlineEnd,
            nestedColorForward: getComputedStyle(nestedForward).borderLeftColor,
            nestedColorReverse: getComputedStyle(nestedReverse).borderLeftColor,
            nestedForwardClassName: nestedForward.className,
            nestedReverseClassName: nestedReverse.className,
            overlapForward: getComputedStyle(forward).color,
            overlapReverse: getComputedStyle(reverse).color,
            pseudoColorForward: pseudoForwardStyle.color,
            pseudoColorReverse: pseudoReverseStyle.color,
            pseudoContentForward: pseudoForwardStyle.content,
            pseudoContentReverse: pseudoReverseStyle.content,
            pseudoForwardClassName: pseudoForward.className,
            pseudoReverseClassName: pseudoReverse.className,
            reverseClassName: reverse.className,
            secondaryClassName: secondary.className,
            ssr: mainStyle.outlineOffset,
            ssrMarker: main.dataset.viteSsr,
          };
        });
        assert.deepEqual(
          {
            client: evidence.client,
            content: evidence.content,
            hydrated: evidence.hydrated,
            lazy: evidence.lazy,
            multiEntry: evidence.multiEntry,
            nestedColorForward: evidence.nestedColorForward,
            nestedColorReverse: evidence.nestedColorReverse,
            overlapForward: evidence.overlapForward,
            overlapReverse: evidence.overlapReverse,
            pseudoColorForward: evidence.pseudoColorForward,
            pseudoColorReverse: evidence.pseudoColorReverse,
            pseudoContentForward: evidence.pseudoContentForward,
            pseudoContentReverse: evidence.pseudoContentReverse,
            ssr: evidence.ssr,
            ssrMarker: evidence.ssrMarker,
          },
          {
            client: CLIENT_VALUE,
            content: "Vite adopter",
            hydrated: "true",
            lazy: LAZY_VALUE,
            multiEntry: MULTI_VALUE,
            nestedColorForward: NESTED_SUPPORTS_VALUE,
            nestedColorReverse: NESTED_SUPPORTS_VALUE,
            overlapForward: OVERLAP_MEDIA_VALUE,
            overlapReverse: OVERLAP_MEDIA_VALUE,
            pseudoColorForward: PSEUDO_COLOR_VALUE,
            pseudoColorReverse: PSEUDO_COLOR_VALUE,
            pseudoContentForward: '"vite-stylex-before"',
            pseudoContentReverse: '"vite-stylex-before"',
            ssr: SSR_VALUE,
            ssrMarker: "true",
          },
          "Chromium must preserve the finalized client, SSR, overlap, specificity, important-state, and pseudo-element rules",
        );
        const finalStylesheetHref = new URL("/stylex.css", origin).href;
        const setFinalStylesheetDisabled = async (disabled: boolean): Promise<void> => {
          await page.evaluate(({ disabled: nextDisabled, expectedHref }) => {
            const matches = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
              .filter((link) => link.href === expectedHref);
            if (matches.length !== 1) {
              throw new Error(`Expected one finalized stylesheet at ${expectedHref}, received ${String(matches.length)}`);
            }
            matches[0]!.disabled = nextDisabled;
          }, { disabled, expectedHref: finalStylesheetHref });
        };
        const waitForClientValue = async (expected: string): Promise<void> => {
          await page.waitForFunction((value) => {
            const main = document.querySelector("main[data-vite-ssr='true']");
            return main instanceof HTMLElement
              && getComputedStyle(main).scrollMarginBottom === value;
          }, expected, { polling: "raf", timeout: 10_000 });
        };
        let canaryValue: string | undefined;
        let finalStylesheetDisabled = false;
        try {
          await setFinalStylesheetDisabled(true);
          finalStylesheetDisabled = true;
          await waitForClientValue("2px");
          canaryValue = await page.locator("main[data-vite-ssr='true']").evaluate(
            (main) => getComputedStyle(main).scrollMarginBottom,
          );
        } finally {
          if (finalStylesheetDisabled) {
            await setFinalStylesheetDisabled(false);
            await waitForClientValue(CLIENT_VALUE);
          }
        }
        assert.equal(
          canaryValue,
          "2px",
          "The later product legacy sibling must become authoritative only when the exact final union stylesheet is disabled",
        );
        assert.equal(
          await page.locator("main[data-vite-ssr='true']").evaluate(
            (main) => getComputedStyle(main).scrollMarginBottom,
          ),
          CLIENT_VALUE,
          "Restoring the exact final union stylesheet must restore the client StyleX atom",
        );
        for (const interaction of [forwardInteraction, reverseInteraction]) {
          assert.deepEqual(interaction, {
            focusColor: FOCUS_IMPORTANT_VALUE,
            focusVisible: true,
            hoverColor: HOVER_IMPORTANT_VALUE,
            hovered: true,
          });
        }
        for (const [forwardClassName, reverseClassName, description] of [
          [evidence.forwardClassName, evidence.reverseClassName, "overlap"],
          [evidence.nestedForwardClassName, evidence.nestedReverseClassName, "nested specificity"],
          [evidence.focusForwardClassName, evidence.focusReverseClassName, "important interaction"],
          [evidence.pseudoForwardClassName, evidence.pseudoReverseClassName, "pseudo-element and registration"],
        ] as const) {
          const forwardClasses = forwardClassName.trim().split(/\s+/u);
          const reverseClasses = reverseClassName.trim().split(/\s+/u);
          assert.ok(forwardClasses.length >= 2, `${description} fixture must compose two independently authored class groups`);
          assert.notEqual(forwardClassName, reverseClassName, `${description} fixture must exercise both class-input orders`);
          assert.deepEqual(
            [...reverseClasses].sort(),
            [...forwardClasses].sort(),
            `${description} input orders must retain the same class inventory`,
          );
        }
        assert.notEqual(evidence.animationNameForward, "none", "forward zero-priority keyframes must remain registered and applied");
        assert.equal(evidence.animationNameReverse, evidence.animationNameForward, "both input orders must apply the same zero-priority registration");
        assert.ok(evidence.mainClassName.split(/\s+/u).length >= 3);
        assert.ok(evidence.secondaryClassName.length > 0);
        assert.deepEqual(failures, [], "Chromium emitted runtime or network diagnostics");
        for (const path of expectedRequests) {
          assert.ok(requestedPaths.has(path), `Chromium did not request finalized output ${path}`);
        }
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    await server.stop(true);
  }
}

async function write(path: string, source: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, { flag: "wx" });
}

async function requireInstalledVersion(root: string, packageName: string, expected: string): Promise<void> {
  const source = await readFile(resolve(root, "node_modules", packageName, "package.json"), "utf8");
  const record = JSON.parse(source) as { version?: unknown };
  assert.equal(record.version, expected, `${packageName} must resolve to ${expected}`);
}

function logicalBelow(root: string, path: string): string {
  const logical = relative(root, path).split(sep).join("/");
  assert.ok(logical.length > 0 && logical !== ".." && !logical.startsWith("../"));
  return logical;
}

async function filesBelow(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Vite adopter output contains a symlink: ${logicalBelow(root, path)}`);
    if (entry.isDirectory()) output.push(...await filesBelow(root, path));
    else {
      assert.ok(entry.isFile(), `Vite adopter output contains a non-file: ${logicalBelow(root, path)}`);
      output.push(logicalBelow(root, path));
    }
  }
  return output.sort();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function count(source: string, expression: RegExp): number {
  return [...source.matchAll(expression)].length;
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function verifyArtifact(root: string, value: unknown): Promise<string> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  const artifact = value as { bytes?: unknown; path?: unknown; sha256?: unknown };
  assert.ok(Number.isSafeInteger(artifact.bytes) && (artifact.bytes as number) >= 0);
  assert.ok(typeof artifact.path === "string" && artifact.path.length > 0);
  assert.match(String(artifact.sha256), /^[a-f0-9]{64}$/u);
  const bytes = await readFile(resolve(root, artifact.path));
  assert.equal(bytes.byteLength, artifact.bytes);
  assert.equal(sha256(bytes), artifact.sha256);
  return artifact.path;
}

assert.equal(Bun.version, BUN_VERSION, `Vite adopter smoke requires Bun ${BUN_VERSION}`);
const repository = await realpath(process.cwd());
const fixtureRoot = resolve(repository, ".stylex-fixtures");
await mkdir(fixtureRoot, { recursive: true });
const fixtureStat = await lstat(fixtureRoot);
assert.ok(fixtureStat.isDirectory() && !fixtureStat.isSymbolicLink(), ".stylex-fixtures must be an ordinary directory");
assert.equal(await realpath(fixtureRoot), fixtureRoot, ".stylex-fixtures must not traverse a symlink");
const work = await realpath(await mkdtemp(join(fixtureRoot, "vite-adopter-smoke-")));
const consumer = resolve(work, "consumer");
const temporary = resolve(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  NODE_ENV: "production",
  TMPDIR: temporary,
};
let successful = false;

try {
  const nodeExecutable = resolveGenuineNodeExecutable();
  await run([
    nodeExecutable,
    "--input-type=module",
    "--eval",
    `import assert from "node:assert/strict"; assert.ok(process.versions.node.startsWith(${JSON.stringify(NODE_VERSION_PREFIX)})); assert.equal(globalThis.Bun, undefined);`,
  ], repository, environment);
  await verifyBoundedRunner(nodeExecutable, work, environment);
  await mkdir(consumer);
  await mkdir(temporary, { mode: 0o700 });
  const archive = resolve(work, "hraness-ui.tgz");
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository, environment);

  await write(resolve(consumer, "package.json"), `${JSON.stringify({
    dependencies: {
      "@babel/core": BABEL_VERSION,
      "@hraness/ui": `file:${archive}`,
      "@stylexjs/babel-plugin": STYLEX_VERSION,
      "@stylexjs/stylex": STYLEX_VERSION,
      "@types/node": NODE_TYPES_VERSION,
      lightningcss: LIGHTNINGCSS_VERSION,
      react: REACT_VERSION,
      "react-dom": REACT_VERSION,
      typescript: TYPESCRIPT_VERSION,
      vite: VITE_VERSION,
    },
    name: "hraness-packed-vite-adopter-smoke",
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await run([process.execPath, "install", "--ignore-scripts"], consumer, environment);
  await Promise.all([
    requireInstalledVersion(consumer, "@babel/core", BABEL_VERSION),
    requireInstalledVersion(consumer, "@stylexjs/babel-plugin", STYLEX_VERSION),
    requireInstalledVersion(consumer, "@stylexjs/stylex", STYLEX_VERSION),
    requireInstalledVersion(consumer, "@types/node", NODE_TYPES_VERSION),
    requireInstalledVersion(consumer, "lightningcss", LIGHTNINGCSS_VERSION),
    requireInstalledVersion(consumer, "react", REACT_VERSION),
    requireInstalledVersion(consumer, "react-dom", REACT_VERSION),
    requireInstalledVersion(consumer, "typescript", TYPESCRIPT_VERSION),
    requireInstalledVersion(consumer, "vite", VITE_VERSION),
  ]);
  const installedManifest = JSON.parse(
    await readFile(resolve(consumer, "node_modules/@hraness/ui/package.json"), "utf8"),
  ) as { exports?: Record<string, unknown> };
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(installedManifest.exports ?? {}).filter(([key]) => key.endsWith(".css")),
    ),
    PUBLIC_CSS_EXPORTS,
    "packed Vite adopter must receive exactly the six standards-based CSS entrypoints",
  );
  assert.doesNotMatch(
    JSON.stringify(installedManifest),
    /tailwind/iu,
    "packed Vite adopter must not receive a first-party Tailwind contract",
  );
  for (const path of [
    "node_modules/@hraness/ui/dist/build/index.js",
    "node_modules/@hraness/ui/dist/build/vite.js",
    "node_modules/@hraness/ui/dist/stylex.css",
    "node_modules/@hraness/ui/dist/stylex-manifest.json",
    "node_modules/@hraness/ui/src/compiler-foundation.css",
    "node_modules/@hraness/ui/src/compiler-reset.css",
    "node_modules/@hraness/ui/src/components.css",
    "node_modules/@hraness/ui/src/reset.css",
    "node_modules/@hraness/ui/src/styles.css",
    "node_modules/@hraness/ui/src/tokens.css",
  ]) {
    const stat = await lstat(resolve(consumer, path));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `packed public file must be ordinary: ${path}`);
  }

  await Promise.all([
    write(resolve(consumer, "src/client.ts"), clientSource),
    write(resolve(consumer, "src/cascade.ts"), cascadeSource),
    write(resolve(consumer, "src/lazy.ts"), lazySource),
    write(resolve(consumer, "src/secondary.ts"), secondarySource),
    write(resolve(consumer, "src/server.ts"), serverSource),
    write(resolve(consumer, "src/styles/app.css"), applicationCss),
    write(resolve(consumer, "src/styles/nested/foundation.css"), nestedFoundationCss),
    write(resolve(consumer, "build.mjs"), buildSource(consumer)),
    write(resolve(consumer, "type-contract.ts"), typeContractSource),
    ...(["Bundler", "NodeNext"] as const).map((moduleResolution) => write(
      resolve(consumer, `tsconfig.${moduleResolution.toLowerCase()}.json`),
      `${JSON.stringify(typeContractConfig(moduleResolution), null, 2)}\n`,
    )),
    write(resolve(consumer, "node-runtime-probe.mjs"), `import assert from "node:assert/strict";
const build = await import("@hraness/ui/stylex-build");
const vite = await import("@hraness/ui/stylex-build/vite");
assert.equal(typeof build.createStylexGeneration, "function");
assert.equal(typeof build.finalizeStylexGeneration, "function");
assert.equal(typeof build.serializeStylexRuleUnionV1, "function");
assert.equal(typeof build.auditCssWithoutStylexUnionNamespace, "function");
assert.equal(build.stylexUnionPolicy.prefix, "components.hraness-stylex");
assert.equal(build.stylexUnionPolicySha256, ${JSON.stringify(STYLEX_UNION_POLICY_SHA256)});
assert.equal(build.STYLEX_GENERATION_SCHEMA_VERSION, 2);
assert.equal(build.STYLEX_COMPLETE_RECORD_SCHEMA_VERSION, 2);
const unionCss = build.serializeStylexRuleUnionV1(
  [["x-node-union-probe", { ltr: ".x-node-union-probe{color:red}" }, 1000]],
  [{ before: ["components.fixture-package.legacy"], prefix: "components.fixture-package" }],
);
assert.match(unionCss, /@layer components\\.hraness-stylex\\.priority1/u);
build.auditCssWithoutStylexUnionNamespace(
  "@layer components.fixture-package.legacy;",
  "packed Node safe foundation probe",
);
assert.throws(
  () => build.auditCssWithoutStylexUnionNamespace(
    "@import './fixture.css' layer(components.hraness-stylex.priority8);",
    "packed Node reserved foundation probe",
  ),
  /reserved StyleX rule-union namespace/u,
);
assert.equal(typeof vite.stylexVite, "function");
assert.equal(globalThis.Bun, undefined);
`),
  ]);
  assert.doesNotMatch(await readFile(resolve(consumer, "build.mjs"), "utf8"), /\bBun\b/u);
  await run([nodeExecutable, "./node-runtime-probe.mjs"], consumer, environment);
  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    await run([
      nodeExecutable,
      "./node_modules/typescript/bin/tsc",
      "-p",
      `./tsconfig.${moduleResolution.toLowerCase()}.json`,
    ], consumer, environment);
  }
  await run([nodeExecutable, "./build.mjs"], consumer, environment);

  const finalDirectory = resolve(consumer, "output/packed-vite-adopter");
  const publishedFiles = await filesBelow(finalDirectory);
  const clientFiles = publishedFiles.filter((path) => path.startsWith("graphs/client/"));
  const ssrFiles = publishedFiles.filter((path) => path.startsWith("graphs/ssr/"));
  assert.ok(clientFiles.length >= 4, "client graph must publish two entries, one lazy chunk, and one foundation stylesheet");
  assert.ok(ssrFiles.length >= 1, "SSR graph must publish its server entry");
  assert.equal(clientFiles.filter((path) => path.endsWith(".css")).length, 1);
  assert.equal(ssrFiles.filter((path) => path.endsWith(".css")).length, 0);
  assert.ok(clientFiles.filter((path) => /\.[cm]?js$/u.test(path)).length >= 3);
  assert.ok(ssrFiles.filter((path) => /\.[cm]?js$/u.test(path)).length >= 1);
  const lazyJavaScript = clientFiles.find((path) =>
    /\.[cm]?js$/u.test(path) && basename(path).startsWith("lazy-")
  );
  assert.ok(lazyJavaScript !== undefined, "client graph must publish the registered lazy chunk");
  assert.equal(publishedFiles.filter((path) => path === "stylex.css").length, 1, "one finalized recipe CSS must be published");
  assert.equal(publishedFiles.filter((path) => /(?:^|\/)stylex\.css$/u.test(path)).length, 1, "no partial standalone recipe CSS may be published");

  const completePath = resolve(finalDirectory, "stylex-complete.json");
  const complete = JSON.parse(await readFile(completePath, "utf8")) as {
    artifacts?: unknown[];
    finalCss?: unknown;
    generationId?: unknown;
    graphs?: { id?: unknown; receiptSha256?: unknown }[];
    kind?: unknown;
    packages?: { manifestSha256?: unknown; name?: unknown; version?: unknown }[];
    schemaVersion?: unknown;
    state?: unknown;
    unionPolicySha256?: unknown;
  };
  assert.equal(complete.kind, "hraness-stylex-complete-generation");
  assert.equal(complete.schemaVersion, 2);
  assert.equal(complete.unionPolicySha256, STYLEX_UNION_POLICY_SHA256);
  assert.equal(complete.state, "complete");
  assert.equal(complete.generationId, "packed-vite-adopter");
  assert.deepEqual(complete.graphs?.map(({ id }) => id), ["client", "ssr"]);
  for (const graph of complete.graphs ?? []) assert.match(String(graph.receiptSha256), /^[a-f0-9]{64}$/u);
  assert.equal(complete.packages?.length, 1);
  assert.equal(complete.packages?.[0]?.name, "@hraness/ui");
  assert.match(String(complete.packages?.[0]?.version), /^\d+\.\d+\.\d+$/u);
  assert.match(String(complete.packages?.[0]?.manifestSha256), /^[a-f0-9]{64}$/u);
  const artifactPaths = await Promise.all((complete.artifacts ?? []).map((artifact) => verifyArtifact(finalDirectory, artifact)));
  assert.deepEqual(
    artifactPaths,
    publishedFiles.filter((path) => path !== "stylex-complete.json" && path !== "stylex.css"),
    "complete record must bind every graph output and produced template",
  );
  assert.equal(await verifyArtifact(finalDirectory, complete.finalCss), "stylex.css");

  const html = await readFile(resolve(finalDirectory, "index.html"), "utf8");
  const stylesheetHrefs = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/giu)].map((match) => match[1]!);
  assert.equal(stylesheetHrefs.length, 2, "produced template must link foundation and finalized CSS only");
  assert.ok(stylesheetHrefs[0]?.startsWith("/graphs/client/"));
  assert.equal(stylesheetHrefs[1], "/stylex.css");
  assert.ok(publishedFiles.includes(stylesheetHrefs[0]!.slice(1)), "template foundation link must identify a published client graph output");
  assert.equal(count(html, /href=["']\/stylex\.css["']/gu), 1);
  assert.doesNotMatch(html, /__HRANESS_STYLEX_CSS__/u);
  assert.match(html, /data-vite-ssr="true"/u);
  assert.match(html, /data-vite-hydrated="false"/u);
  assert.match(html, /data-vite-lazy="false"/u);
  assert.match(html, /data-vite-secondary="false"/u);
  assert.match(html, /data-vite-content="true">Vite adopter/u);
  const moduleSources = [...html.matchAll(
    /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/giu,
  )].map((match) => match[1]!);
  assert.equal(moduleSources.length, 2, "produced template must load both registered client entries");
  assert.ok(moduleSources.every((path) => path.startsWith("/graphs/client/")));
  assert.equal(new Set(moduleSources).size, moduleSources.length);
  for (const path of moduleSources) {
    assert.ok(publishedFiles.includes(path.slice(1)), `template script must identify a published client entry: ${path}`);
  }

  const finalCss = await readFile(resolve(finalDirectory, "stylex.css"), "utf8");
  for (const [property, value] of [
    [CLIENT_CSS_PROPERTY, CLIENT_VALUE],
    [LAZY_CSS_PROPERTY, LAZY_VALUE],
    [MULTI_CSS_PROPERTY, MULTI_VALUE],
    [SSR_CSS_PROPERTY, SSR_VALUE],
  ] as const) {
    const declaration = new RegExp(`${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}(?=\\s*[;}])`, "gu");
    assert.equal(count(finalCss, declaration), 1, `${property} must appear exactly once in the finalized union`);
  }
  const compactFinalCss = finalCss.replace(/\s+/gu, "");
  for (const value of ["#2c3742", "#4d5863", "#412b15", "#0c2238", "#184470", "#78283c", "#172d43"]) {
    assert.equal(
      count(compactFinalCss, new RegExp(escapeRegExp(value), "gu")),
      1,
      `${value} must appear exactly once after client/SSR rule deduplication`,
    );
  }
  assert.match(compactFinalCss, /@supports\(display:grid\)/u);
  assert.match(compactFinalCss, /@supports\(color:red\)/u);
  assert.match(compactFinalCss, /@supports\(gap:1px\)/u);
  assert.match(compactFinalCss, /@media\((?:min-width:1px|width>=1px)\)/u);
  assert.match(compactFinalCss, /:(?:focus-visible|hover)\{[^{}]*!important/u);
  assert.match(compactFinalCss, /:{1,2}before\{/u);
  assert.match(compactFinalCss, /@keyframes[^{}]+\{[^{}]*\{opacity:\.(?:314159|3142)/u);
  assert.match(finalCss, /@layer\s+components\.hraness-stylex\.priority[1-9]\d*/u);
  assert.doesNotMatch(finalCss, /@layer\s+components\.hraness-ui\.priority[1-9]\d*/u);
  assert.doesNotMatch(finalCss, /components\.fixture-product\.legacy/u);
  assert.doesNotMatch(finalCss, /@import\b|\.stylex-fixtures|\/private\//u);

  const manifest = JSON.parse(
    await readFile(resolve(consumer, "node_modules/@hraness/ui/dist/stylex-manifest.json"), "utf8"),
  ) as { rules?: [string, { ltr?: unknown; rtl?: unknown }, number][] };
  const packageRule = manifest.rules?.find(([key, value]) =>
    /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key)
      && [value.ltr, value.rtl].some((source) => typeof source === "string" && source.includes(`.${key}`))
  );
  assert.ok(packageRule !== undefined, "packed package manifest must expose a class rule marker");
  const packageSelector = new RegExp(`\\.${escapeRegExp(packageRule[0])}(?![A-Za-z0-9_-])`, "u");
  assert.match(finalCss, packageSelector, "finalized union must include package recipe metadata");

  const graphCssPaths = clientFiles.filter((path) => path.endsWith(".css"));
  const standaloneBytes = await readFile(resolve(consumer, "node_modules/@hraness/ui/dist/stylex.css"));
  const standaloneCss = standaloneBytes.toString("utf8");
  assert.match(standaloneCss, /@layer\s+components\.hraness-ui\.priority[1-9]\d*/u);
  assert.doesNotMatch(standaloneCss, /components\.hraness-stylex(?:\.|\b)/u);
  for (const path of graphCssPaths) {
    const bytes = await readFile(resolve(finalDirectory, path));
    const css = bytes.toString("utf8");
    assert.notEqual(sha256(bytes), sha256(standaloneBytes), "graph CSS must not copy the standalone package recipes");
    assert.equal(
      count(
        css,
        /@layer\s+components\.fixture-product\.legacy\s*\{\s*\[data-vite-ssr\]\s*\{[^{}]*scroll-margin-bottom\s*:\s*2px\s*(?:;|\})\s*\}/gu,
      ),
      1,
      "the emitted foundation graph must retain the exact canary inside one product legacy sibling layer",
    );
    const packageLegacyIndex = css.indexOf("components.hraness-ui.legacy");
    const productLegacyIndex = css.indexOf("components.fixture-product.legacy");
    assert.ok(
      packageLegacyIndex >= 0 && productLegacyIndex > packageLegacyIndex,
      "the emitted product legacy sibling must be registered after the UI foundation layer",
    );
    assert.doesNotMatch(css, /@layer\s+components\.hraness-ui\.priority(?:0|[1-9]\d*)/u);
    assert.doesNotMatch(css, /components\.hraness-stylex(?:\.|\b)/u);
    assert.doesNotMatch(css, packageSelector);
    for (const value of [CLIENT_VALUE, LAZY_VALUE, MULTI_VALUE, SSR_VALUE]) assert.ok(!css.includes(value));
    assert.ok(css.includes("--ui-background"), "client graph CSS must contain the recipe-free compiler foundation");
    assert.doesNotMatch(css, /@(?:source|custom-variant|theme)\b|--color-background\s*:/u, "client graph CSS must remain free of a first-party Tailwind bridge");
  }

  const javaScript = (
    await Promise.all([...clientFiles, ...ssrFiles]
      .filter((path) => /\.[cm]?js$/u.test(path))
      .map((path) => readFile(resolve(finalDirectory, path), "utf8")))
  ).join("\n");
  for (const sourceProperty of [CLIENT_SOURCE_PROPERTY, LAZY_SOURCE_PROPERTY, MULTI_SOURCE_PROPERTY, SSR_SOURCE_PROPERTY]) {
    assert.ok(!javaScript.includes(sourceProperty), `compiled JavaScript must not retain ${sourceProperty}`);
  }
  for (const value of [CLIENT_VALUE, LAZY_VALUE, MULTI_VALUE, SSR_VALUE]) {
    assert.ok(!javaScript.includes(value), `compiled JavaScript must not retain ${value}`);
  }
  assert.ok(!javaScript.includes(work), "published JavaScript must not expose private fixture provenance");
  await verifyBrowserOutput(finalDirectory, [
    "/",
    stylesheetHrefs[0]!,
    "/stylex.css",
    ...moduleSources,
    `/${lazyJavaScript}`,
  ]);
  successful = true;
} catch (error) {
  console.error(`Packed Vite adopter smoke retained bounded evidence at ${work}`);
  throw error;
} finally {
  if (successful) await rm(work, { force: true, recursive: true });
}
