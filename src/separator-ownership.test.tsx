import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import { Accordion, Disclosure } from "./collections.js";
import { collectionStyles } from "./collections.stylex.js";
import { DataTable, type DataTableColumn } from "./data-display.js";
import { dataTableStyles } from "./data-table.stylex.js";

// Separator ownership: a primitive draws a divider only between adjacent peers
// it owns. The container around it owns every outer edge, so a primitive's
// divider can never run parallel to a container border a few pixels away.

type CompiledRule = Readonly<{ condition: string; declarations: string }>;

const compiledCss = await Bun.file(
  new URL("../dist/stylex.css", import.meta.url),
).text();

function escapeClass(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compiledRules(className: string | undefined): readonly CompiledRule[] {
  expect(className).toBeDefined();
  return (className ?? "").split(/\s+/u).flatMap((name) =>
    [...compiledCss.matchAll(
      new RegExp(`\\.${escapeClass(name)}(?![A-Za-z0-9_-])([^{},]*)\\{([^}]*)\\}`, "gu"),
    )].map(([, condition = "", declarations = ""]) => ({
      condition: condition.trim(),
      declarations: declarations.replace(/\s+/gu, " ").trim(),
    }))
  );
}

function blockEndWidths(className: string | undefined) {
  return compiledRules(className)
    .map(({ condition, declarations }) => ({
      condition,
      width: /border-block-end-width:\s*([^;]+);/u.exec(declarations)?.[1],
    }))
    .filter((rule) => rule.width !== undefined);
}

function drawsEdge(className: string | undefined, side: "start" | "end" | "top" | "bottom") {
  const width = new RegExp(`border-(?:block-)?${side}(?:-width)?:\\s*([^;]+);`, "u");
  return compiledRules(className).some(({ condition, declarations }) => {
    const value = width.exec(declarations)?.[1]?.trim();
    return condition === "" && value !== undefined && !/^0(?:px)?$/u.test(value);
  });
}

test("a Disclosure draws its divider only toward an adjacent Disclosure", () => {
  const root = stylex.props(collectionStyles.disclosureRoot).className;

  expect(blockEndWidths(root)).toEqual([
    { condition: "", width: "0" },
    { condition: ':has( + [data-slot="disclosure"])', width: "1px" },
  ]);
  for (const side of ["start", "end", "top", "bottom"] as const) {
    expect(drawsEdge(root, side)).toBe(false);
  }
});

test("a standalone Disclosure and a whole Accordion leave outer edges to their container", () => {
  const html = renderToStaticMarkup(
    <>
      <Disclosure title="Standalone">Standalone body</Disclosure>
      <Accordion>
        <Disclosure id="one" title="One">First body</Disclosure>
        <Disclosure id="two" title="Two">Second body</Disclosure>
      </Accordion>
    </>,
  );
  const accordion = /<div data-slot="accordion" class="([^"]*)"/u.exec(html)?.[1];

  // The Accordion is a coordinator, not a surface: it has no compiled recipe
  // and so cannot add an edge after its final Disclosure.
  expect(accordion).toBe("hraness-accordion");
  expect(Object.keys(collectionStyles)).not.toContain("accordionRoot");
  // Every Disclosure shares one recipe; which one draws a divider is decided
  // only by an adjacent Disclosure sibling, never by its position alone.
  const disclosureClasses = [
    ...html.matchAll(/<div data-slot="disclosure"[^>]* class="([^"]*)"/gu),
  ].map(([, className]) => className);
  expect(disclosureClasses).toHaveLength(3);
  expect(new Set(disclosureClasses).size).toBe(1);
});

type Row = Readonly<{ id: string; name: string }>;
const columns = [
  { cell: (row) => row.name, header: "Name", id: "name" },
] as const satisfies readonly [DataTableColumn<Row>];

test("a DataTable leaves its final body divider to the bordered wrapper", () => {
  const cell = stylex.props(dataTableStyles.cell).className;
  const wrapper = stylex.props(dataTableStyles.wrapper).className;

  expect(blockEndWidths(cell)).toEqual([
    { condition: "", width: "1px" },
    { condition: ":is(tbody > tr:last-child > *)", width: "0" },
  ]);
  expect(compiledRules(wrapper).some(({ condition, declarations }) =>
    condition === "" && /border-width:\s*1px;/u.test(declarations)
  )).toBe(true);

  const html = renderToStaticMarkup(
    <DataTable
      caption="Projects"
      columns={columns}
      getRowId={(row) => row.id}
      rows={[{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]}
    />,
  );
  // Header cells sit in thead, so the final-body-row condition cannot remove
  // the divider between the header and the first row.
  expect(html).toMatch(/<thead[^>]*>[\s\S]*<\/thead><tbody/u);
});
