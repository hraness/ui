import { writeFile } from "node:fs/promises";

import { renderToString } from "react-dom/server";

import { PrimitiveGallery } from "./app.js";

const stylesheet = process.argv[2];
const client = process.argv[3];
if (stylesheet === undefined || client === undefined) {
  throw new Error("The gallery renderer requires stylesheet and client artifact names.");
}

const markup = renderToString(<PrimitiveGallery />);
const document = [
  "<!doctype html>",
  '<html data-theme="light" lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>@hraness/ui primitive harness</title>",
  `<link data-gallery-default-stylesheet="true" rel="stylesheet" href="/${stylesheet}">`,
  "</head>",
  "<body>",
  `<div data-gallery-hydration-root="true">${markup}</div>`,
  `<script type="module" src="/${client}"></script>`,
  "</body>",
  "</html>",
].join("");

await writeFile("./dist/index.html", document);
