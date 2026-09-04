import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import {
  createRef,
  type ReactElement,
  type Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "./data-display.js";
import { dataTableStyles } from "./data-table.stylex.js";

type ProjectRow = Readonly<{
  id: string;
  name: string;
  owner: string;
  runs: number;
}>;

const projectColumns = [
  {
    cell: (row) => row.name,
    header: "Project",
    id: "name",
  },
  {
    align: "center",
    cell: (row) => row.owner,
    header: "Owner",
    id: "owner",
  },
  {
    align: "end",
    cell: (row) => row.runs,
    header: "Runs",
    id: "runs",
  },
] as const satisfies readonly [
  DataTableColumn<ProjectRow>,
  ...DataTableColumn<ProjectRow>[],
];

const consumerStyles = stylex.create({
  dynamicTableWidth: (width: string) => ({ width }),
  dynamicWrapperWidth: (maxWidth: string) => ({ maxWidth }),
  tableOverride: {
    borderCollapse: "separate",
    color: "var(--ui-primary)",
    fontSize: "var(--text-body)",
  },
  wrapperOverride: {
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    overflowX: "scroll",
  },
});

const alignmentStyles = {
  center: dataTableStyles.alignCenter,
  end: dataTableStyles.alignEnd,
  start: dataTableStyles.alignStart,
} as const;

const typedTableProps: DataTableProps<ProjectRow> = {
  columns: projectColumns,
  getRowId: (row) => row.id,
  rows: [],
  wrapperXstyle: consumerStyles.wrapperOverride,
  xstyle: consumerStyles.tableOverride,
};
const typedTableRef = createRef<HTMLTableElement>();
const typedTable = <DataTable {...typedTableProps} ref={typedTableRef} />;
const rawTableXstyle: DataTableProps<ProjectRow> = {
  ...typedTableProps,
  // @ts-expect-error DataTable accepts compiled StyleX recipes, not raw table CSS.
  xstyle: { width: "80%" },
};
const rawWrapperXstyle: DataTableProps<ProjectRow> = {
  ...typedTableProps,
  // @ts-expect-error The wrapper seam also accepts compiled StyleX recipes only.
  wrapperXstyle: { overflowX: "scroll" },
};
const emptyColumns: DataTableProps<ProjectRow> = {
  // @ts-expect-error DataTable requires at least one typed column.
  columns: [],
  getRowId: (row) => row.id,
  rows: [],
};
const invalidAlignmentColumn: DataTableColumn<ProjectRow> = {
  // @ts-expect-error DataTable keeps its alignment set finite.
  align: "left",
  cell: (row) => row.name,
  header: "Project",
  id: "project",
};
void [
  emptyColumns,
  invalidAlignmentColumn,
  rawTableXstyle,
  rawWrapperXstyle,
  typedTable,
];

function openingTagsForSlot(html: string, slot: string): string[] {
  return html.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`, "gu")) ?? [];
}

function openingTagForSlot(html: string, slot: string): string {
  const [tag] = openingTagsForSlot(html, slot);
  if (tag === undefined) throw new Error(`Rendered markup has no ${slot} slot`);
  return tag;
}

function classes(tag: string): string[] {
  return tag.match(/class="([^"]+)"/u)?.[1]?.split(" ").filter(Boolean) ?? [];
}

function presentationClasses(
  presentation: ReturnType<typeof stylex.props>,
): string[] {
  return presentation.className?.split(" ").filter(Boolean) ?? [];
}

test("DataTable preserves generic native server semantics and stable hooks", () => {
  const html = renderToStaticMarkup(
    <DataTable
      {...{ "data-slot": "caller-table" }}
      aria-describedby="projects-description"
      caption={<span>Recent projects</span>}
      className="consumer-table"
      columns={projectColumns}
      data-product="writer"
      getRowId={(row) => row.id}
      id="projects"
      rows={[{ id: "ocean", name: "Ocean", owner: "Ada", runs: 3 }]}
      wrapperClassName="consumer-wrapper"
    />,
  );
  const wrapperTag = openingTagForSlot(html, "data-table-wrapper");
  const tableTag = openingTagForSlot(html, "data-table");
  const captionTag = openingTagForSlot(html, "data-table-caption");
  const headTag = openingTagForSlot(html, "data-table-head");
  const headerRowTag = openingTagForSlot(html, "data-table-header-row");
  const bodyTag = openingTagForSlot(html, "data-table-body");
  const rowTag = openingTagForSlot(html, "data-table-row");
  const headerTags = openingTagsForSlot(html, "data-table-header");
  const cellTags = openingTagsForSlot(html, "data-table-cell");

  expect(wrapperTag).toStartWith("<div");
  expect(tableTag).toStartWith("<table");
  expect(captionTag).toStartWith("<caption");
  expect(headTag).toStartWith("<thead");
  expect(headerRowTag).toStartWith("<tr");
  expect(bodyTag).toStartWith("<tbody");
  expect(rowTag).toStartWith("<tr");
  expect(headerTags).toHaveLength(3);
  expect(cellTags).toHaveLength(3);
  expect(headerTags.every((tag) => tag.startsWith("<th"))).toBe(true);
  expect(headerTags.every((tag) => tag.includes('scope="col"'))).toBe(true);
  expect(cellTags.every((tag) => tag.startsWith("<td"))).toBe(true);

  expect(tableTag).toContain('aria-describedby="projects-description"');
  expect(tableTag).toContain('data-product="writer"');
  expect(tableTag).toContain('data-slot="data-table"');
  expect(tableTag).not.toContain('data-slot="caller-table"');
  expect(tableTag).toContain('id="projects"');
  expect(html).toContain("Recent projects");
  expect(html).toContain("Ocean");
  expect(html).toContain("Ada");

  expect(classes(wrapperTag)).toEqual([
    "hraness-data-table",
    ...presentationClasses(stylex.props(dataTableStyles.wrapper)),
    "consumer-wrapper",
  ]);
  expect(classes(tableTag)).toEqual([
    "hraness-data-table__table",
    ...presentationClasses(stylex.props(dataTableStyles.table)),
    "consumer-table",
  ]);
  expect(classes(captionTag)).toEqual(
    presentationClasses(stylex.props(dataTableStyles.caption)),
  );
  expect((DataTable as Readonly<{ displayName?: string }>).displayName).toBe(
    "DataTable",
  );
});

test("DataTable attaches base and every finite alignment recipe to headers and cells", () => {
  const html = renderToStaticMarkup(
    <DataTable
      columns={projectColumns}
      getRowId={(row) => row.id}
      rows={[{ id: "ocean", name: "Ocean", owner: "Ada", runs: 3 }]}
    />,
  );
  const headerTags = openingTagsForSlot(html, "data-table-header");
  const cellTags = openingTagsForSlot(html, "data-table-cell");
  const alignments = ["start", "center", "end"] as const;

  for (const [index, alignment] of alignments.entries()) {
    const headerTag = headerTags[index] ?? "";
    const cellTag = cellTags[index] ?? "";

    expect(headerTag).toContain(`data-align="${alignment}"`);
    expect(cellTag).toContain(`data-align="${alignment}"`);
    expect(classes(headerTag)).toEqual(presentationClasses(stylex.props(
      dataTableStyles.cell,
      dataTableStyles.header,
      alignmentStyles[alignment],
    )));
    expect(classes(cellTag)).toEqual(presentationClasses(stylex.props(
      dataTableStyles.cell,
      alignmentStyles[alignment],
    )));
  }
});

test("DataTable applies root and wrapper caller recipes after their bases and native table styles last", () => {
  const tableXstyle = [
    consumerStyles.tableOverride,
    consumerStyles.dynamicTableWidth("41rem"),
  ] as const;
  const wrapperXstyle = [
    consumerStyles.wrapperOverride,
    consumerStyles.dynamicWrapperWidth("40rem"),
  ] as const;
  const html = renderToStaticMarkup(
    <DataTable
      className="consumer-table"
      columns={projectColumns}
      getRowId={(row) => row.id}
      rows={[]}
      style={{ color: "rgb(1, 2, 3)", width: "42rem" }}
      wrapperClassName="consumer-wrapper"
      wrapperXstyle={wrapperXstyle}
      xstyle={tableXstyle}
    />,
  );
  const wrapperTag = openingTagForSlot(html, "data-table-wrapper");
  const tableTag = openingTagForSlot(html, "data-table");
  const tableStyle = tableTag.match(/style="([^"]+)"/u)?.[1] ?? "";
  const wrapperStyle = wrapperTag.match(/style="([^"]+)"/u)?.[1] ?? "";

  expect(classes(wrapperTag)).toEqual([
    "hraness-data-table",
    ...presentationClasses(stylex.props(
      dataTableStyles.wrapper,
      consumerStyles.wrapperOverride,
      consumerStyles.dynamicWrapperWidth("40rem"),
    )),
    "consumer-wrapper",
  ]);
  expect(classes(tableTag)).toEqual([
    "hraness-data-table__table",
    ...presentationClasses(stylex.props(
      dataTableStyles.table,
      consumerStyles.tableOverride,
      consumerStyles.dynamicTableWidth("41rem"),
    )),
    "consumer-table",
  ]);
  expect(wrapperStyle).toMatch(/--[^:]+:40rem/u);
  expect(tableStyle).toMatch(/--[^:]+:41rem/u);
  expect(tableStyle).toContain("color:rgb(1, 2, 3)");
  expect(tableStyle).toContain("width:42rem");
  expect(tableStyle.indexOf("--")).toBeLessThan(tableStyle.indexOf("width:42rem"));
});

test("DataTable keeps its semantic empty row, spanning cell, and important centered recipe", () => {
  const custom = renderToStaticMarkup(
    <DataTable
      columns={projectColumns}
      empty={<strong>No projects yet.</strong>}
      getRowId={(row) => row.id}
      rows={[]}
    />,
  );
  const defaultEmpty = renderToStaticMarkup(
    <DataTable
      columns={projectColumns}
      getRowId={(row) => row.id}
      rows={[]}
    />,
  );
  const rowTag = openingTagForSlot(custom, "data-table-empty-row");
  const cellTag = openingTagForSlot(custom, "data-table-empty");

  expect(rowTag).toStartWith("<tr");
  expect(cellTag).toStartWith("<td");
  expect(cellTag).toContain('colSpan="3"');
  expect(cellTag).not.toContain("data-align=");
  expect(classes(cellTag)).toEqual([
    "hraness-data-table__empty",
    ...presentationClasses(stylex.props(
      dataTableStyles.cell,
      dataTableStyles.empty,
    )),
  ]);
  expect(custom).toContain("<strong>No projects yet.</strong>");
  expect(defaultEmpty).toContain("No results.");
});

type TestDataTableTree = ReactElement<{
  children: ReactElement<{
    ref?: Ref<HTMLTableElement>;
  }>;
}>;

function renderForwardRefForTest<Row>(
  props: DataTableProps<Row>,
  ref: Ref<HTMLTableElement>,
): TestDataTableTree {
  return (DataTable as unknown as Readonly<{
    render: (
      props: DataTableProps<Row>,
      ref: Ref<HTMLTableElement>,
    ) => TestDataTableTree;
  }>).render(props, ref);
}

test("DataTable forwards its native table ref through the wrapper", () => {
  const values: Array<HTMLTableElement | null> = [];
  const tree = renderForwardRefForTest<ProjectRow>(
    {
      columns: projectColumns,
      getRowId: (row) => row.id,
      rows: [],
    },
    (element) => {
      values.push(element);
    },
  );
  const table = tree.props.children;
  const forwardedRef = table.props.ref;
  if (typeof forwardedRef !== "function") {
    throw new Error("DataTable did not pass the callback ref to its table");
  }
  const element = { id: "projects" } as HTMLTableElement;

  forwardedRef(element);
  forwardedRef(null);

  expect(tree.type).toBe("div");
  expect(table.type).toBe("table");
  expect(values).toEqual([element, null]);
});

test("DataTable owns the exact StyleX recipe without becoming a client boundary", async () => {
  const [component, source] = await Promise.all([
    Bun.file(new URL("./data-display.tsx", import.meta.url)).text(),
    Bun.file(new URL("./data-table.stylex.ts", import.meta.url)).text(),
  ]);

  expect(Object.keys(dataTableStyles)).toEqual([
    "alignCenter",
    "alignEnd",
    "alignStart",
    "caption",
    "cell",
    "empty",
    "header",
    "table",
    "wrapper",
  ]);
  for (const declaration of [
    'borderColor: "var(--ui-border)"',
    "borderImageOutset: 0",
    'borderImageRepeat: "stretch"',
    'borderImageSlice: "100%"',
    'borderImageSource: "none"',
    "borderImageWidth: 1",
    'borderStyle: "solid"',
    'borderWidth: "1px"',
    '\"border-block-end-color\": "var(--ui-border)"',
    '\"border-block-end-style\": "solid"',
    '\"border-block-end-width\": "1px"',
    'backgroundAttachment: "scroll"',
    'backgroundClip: "border-box"',
    'backgroundColor: "var(--ui-muted)"',
    'backgroundImage: "none"',
    'backgroundOrigin: "padding-box"',
    'backgroundPosition: "0% 0%"',
    'backgroundRepeat: "repeat"',
    'backgroundSize: "auto auto"',
    'paddingBlock: "var(--space-3)"',
    'paddingInline: "var(--space-4)"',
    'textAlign: "center !important"',
  ]) {
    expect(source).toContain(declaration);
  }
  expect(source).not.toMatch(/borderBlockEnd|borderBottom/u);
  expect(component).toContain(
    'import { dataTableStyles } from "./data-table.stylex.js";',
  );
  expect(component.trimStart()).not.toStartWith('"use client"');
});
