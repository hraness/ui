import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import React from "react";
import { renderToString } from "react-dom/server";
import * as stylex from "@stylexjs/stylex";
import { View } from "./view.ts";

const styles = stylex.create({ server: { outlineOffset: "141421px" } });
const [destination, clientHref, secondaryHref, foundationHref, placeholder] = process.argv.slice(2);
assert.ok(destination !== undefined);
for (const href of [clientHref, secondaryHref, foundationHref]) {
  assert.ok(typeof href === "string" && /^\/graphs\/client\/[A-Za-z0-9_.\/-]+$/u.test(href));
}
assert.equal(placeholder, "__HRANESS_STYLEX_CSS__");
const body = renderToString(React.createElement("main", {
  ...stylex.props(styles.server), "data-shell": true, "data-lazy": "pending",
}, React.createElement("div", { id: "root" }, React.createElement(View)),
React.createElement("aside", { "data-secondary": "pending" }, "Second entry")));
await writeFile(destination, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Vite production compatibility</title><link rel="stylesheet" href="${foundationHref}"><link rel="stylesheet" href="${placeholder}"></head><body>${body}<script type="module" src="${clientHref}"></script><script type="module" src="${secondaryHref}"></script></body></html>`, { flag: "wx" });
