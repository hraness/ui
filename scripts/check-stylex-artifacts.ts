import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function requireMatch(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(source)) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
}

function forbid(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (pattern.test(source)) {
    throw new Error(`StyleX artifact unexpectedly contains ${description}`);
  }
}

const repository = process.cwd();
const [compiledJavaScript, compiledCss, legacyComponents, orderedStylesheet] =
  await Promise.all([
    readFile(resolve(repository, "dist/index.js"), "utf8"),
    readFile(resolve(repository, "dist/stylex.css"), "utf8"),
    readFile(resolve(repository, "src/components.css"), "utf8"),
    readFile(resolve(repository, "src/styles.css"), "utf8"),
  ]);

if (compiledCss.trim().length === 0) {
  throw new Error("dist/stylex.css is empty");
}

requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority1\s*\{/u,
  "the package-owned priority1 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority2\s*\{/u,
  "the package-owned priority2 layer",
);
requireMatch(compiledCss, /flex:\s*none;/u, "the icon flex declaration");
requireMatch(
  compiledCss,
  /display:\s*inline-block;/u,
  "the icon display declaration",
);
requireMatch(
  compiledCss,
  /align-items:\s*center;/u,
  "the icon-wrapper alignment declaration",
);
requireMatch(
  compiledCss,
  /display:\s*inline-flex;/u,
  "the icon-wrapper display declaration",
);
requireMatch(
  compiledCss,
  /justify-content:\s*center;/u,
  "the icon-wrapper justification declaration",
);
forbid(
  legacyComponents,
  /\.hraness-(?:appearance|social)-icon(?![A-Za-z0-9_-])/u,
  "a legacy social- or appearance-icon recipe",
);

requireMatch(
  compiledJavaScript,
  /from["']react\/jsx-runtime["']/u,
  "the production React JSX runtime",
);
requireMatch(
  compiledJavaScript,
  /from["']@stylexjs\/stylex["']/u,
  "the typed xstyle merge runtime",
);
forbid(
  compiledJavaScript,
  /react\/jsx-dev-runtime/u,
  "the development React JSX runtime",
);
forbid(
  compiledJavaScript,
  /stylex\.create|stylexCreate|Unexpected ['"]stylex\.create/u,
  "an uncompiled StyleX authoring call",
);
forbid(
  compiledJavaScript,
  /stylex-inject|stylexInject|data-stylex|createElement\(["']style["']\)/u,
  "runtime CSS injection",
);

const stylexImport = '@import "../dist/stylex.css";';
const imports = orderedStylesheet
  .split("\n")
  .filter((line) => line.trim() === stylexImport);
if (imports.length !== 1) {
  throw new Error("src/styles.css must import dist/stylex.css exactly once");
}

const componentsIndex = orderedStylesheet.indexOf('@import "./components.css";');
const stylexIndex = orderedStylesheet.indexOf(stylexImport);
const tailwindIndex = orderedStylesheet.indexOf('@import "./tailwind.css";');
if (!(componentsIndex < stylexIndex && stylexIndex < tailwindIndex)) {
  throw new Error(
    "src/styles.css must place package StyleX after components and before Tailwind utilities",
  );
}

console.log("StyleX package artifacts match the compiler contract");
