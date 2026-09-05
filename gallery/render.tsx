import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { renderToString } from "react-dom/server";

import { PrimitiveGallery } from "./app.js";

const STYLEX_CSS_PLACEHOLDER = "__HRANESS_STYLEX_CSS__";
const output = process.argv[2];
const compilerFoundation = process.argv[3];
const stylesheet = process.argv[4];
const client = process.argv[5];
if (
  output === undefined
  || compilerFoundation === undefined
  || stylesheet === undefined
  || client === undefined
) {
  throw new Error(
    "The gallery renderer requires output, compiler-foundation, finalized-stylesheet, and client paths.",
  );
}
if (!isAbsolute(output)) throw new Error("The gallery renderer output must be absolute.");
for (const [description, href] of [
  ["compiler foundation", compilerFoundation],
  ["client", client],
] as const) {
  if (!/^\/[A-Za-z0-9_./-]+$/u.test(href) || href.includes("..")) {
    throw new Error(`The gallery ${description} path is not a safe root-relative asset.`);
  }
}
if (stylesheet !== STYLEX_CSS_PLACEHOLDER) {
  throw new Error("The gallery renderer requires the registered finalized-stylesheet placeholder.");
}

const markup = renderToString(<PrimitiveGallery />);
const document = [
  "<!doctype html>",
  '<html data-theme="light" lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>@hraness/ui primitive harness</title>",
  `<link data-gallery-compiler-foundation="true" rel="stylesheet" href="${compilerFoundation}">`,
  `<link data-gallery-default-stylesheet="true" rel="stylesheet" href="${stylesheet}">`,
  "</head>",
  "<body>",
  `<div data-gallery-hydration-root="true">${markup}</div>`,
  `<script type="module" src="${client}"></script>`,
  "</body>",
  "</html>",
].join("");

await writeFile(output, document, { flag: "wx" });
