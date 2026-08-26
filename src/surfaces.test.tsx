import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type {
  ReactElement,
  Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ThemedSurface,
  type ThemedSurfaceProps,
  type ThemedSurfaceTone,
  type ViewportFrameProps,
  ViewportFrame,
  type WrappingRowProps,
  WrappingRow,
} from "./surfaces.js";

const testStyles = stylex.create({
  dynamicFrame: (inlineSize: string) => ({ "inline-size": inlineSize }),
  dynamicRow: (gap: string) => ({ gap }),
  frameOverride: {
    overflow: "clip",
  },
  rowOverride: {
    display: "grid",
  },
  surfaceOverride: {
    backgroundColor: "var(--ui-secondary)",
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)",
    backgroundPosition: "0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "4px 4px",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-secondary-foreground)",
    paddingInline: "var(--space-2)",
  },
  dynamicSurface: (backgroundSize: string) => ({ backgroundSize }),
});

function openingTagForSlot(html: string, slot: string): string {
  const marker = `data-slot="${slot}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Rendered markup has no ${slot} slot`);
  const start = html.lastIndexOf("<", markerIndex);
  const end = html.indexOf(">", markerIndex);
  if (start < 0 || end < 0) throw new Error(`Rendered ${slot} tag is incomplete`);
  return html.slice(start, end + 1);
}

function classesForSlot(html: string, slot: string): string[] {
  const tag = openingTagForSlot(html, slot);
  const className = tag.match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error(`Rendered ${slot} has no class`);
  return className.split(" ");
}

function generatedClasses(
  classes: readonly string[],
  semanticClass: string,
  callerClass?: string,
): string[] {
  return classes.filter(
    (name) => name !== semanticClass && name !== callerClass,
  );
}

test("structural surfaces preserve native elements, attributes, children, slots, and classes", () => {
  const defaultFrameTag = openingTagForSlot(
    renderToStaticMarkup(<ViewportFrame />),
    "viewport-frame",
  );
  const defaultRowTag = openingTagForSlot(
    renderToStaticMarkup(<WrappingRow />),
    "wrapping-row",
  );
  const html = renderToStaticMarkup(
    <>
      <ViewportFrame
        {...{ "data-slot": "caller-frame" }}
        aria-label="Application viewport"
        as="main"
        className="application-frame"
        data-product="writer"
        id="application"
        lang="en"
        title="Application"
      >
        <p>Viewport content</p>
      </ViewportFrame>
      <WrappingRow
        {...{ "data-slot": "caller-row" }}
        aria-label="Project actions"
        as="nav"
        className="project-actions"
        data-product="writer"
        id="actions"
        title="Actions"
      >
        <button type="button">Create</button>
      </WrappingRow>
    </>,
  );
  const frameTag = openingTagForSlot(html, "viewport-frame");
  const rowTag = openingTagForSlot(html, "wrapping-row");
  const frameClasses = classesForSlot(html, "viewport-frame");
  const rowClasses = classesForSlot(html, "wrapping-row");

  expect(defaultFrameTag).toStartWith("<div");
  expect(defaultRowTag).toStartWith("<div");
  expect(frameTag).toStartWith("<main");
  expect(rowTag).toStartWith("<nav");
  expect(frameClasses[0]).toBe("hraness-viewport-frame");
  expect(frameClasses.at(-1)).toBe("application-frame");
  expect(rowClasses[0]).toBe("hraness-wrapping-row");
  expect(rowClasses.at(-1)).toBe("project-actions");
  expect(generatedClasses(frameClasses, "hraness-viewport-frame", "application-frame"))
    .not.toHaveLength(0);
  expect(generatedClasses(rowClasses, "hraness-wrapping-row", "project-actions"))
    .not.toHaveLength(0);
  expect(frameTag).toContain('aria-label="Application viewport"');
  expect(frameTag).toContain('data-product="writer"');
  expect(frameTag).toContain('data-slot="viewport-frame"');
  expect(frameTag).not.toContain('data-slot="caller-frame"');
  expect(frameTag).toContain('id="application"');
  expect(frameTag).toContain('lang="en"');
  expect(frameTag).toContain('title="Application"');
  expect(rowTag).toContain('aria-label="Project actions"');
  expect(rowTag).toContain('data-product="writer"');
  expect(rowTag).toContain('data-slot="wrapping-row"');
  expect(rowTag).not.toContain('data-slot="caller-row"');
  expect(rowTag).toContain('id="actions"');
  expect(rowTag).toContain('title="Actions"');
  expect(html).toContain("Viewport content");
  expect(html).toContain("Create");
});

test("structural surfaces apply typed caller StyleX recipes last", () => {
  const frameBase = classesForSlot(
    renderToStaticMarkup(<ViewportFrame />),
    "viewport-frame",
  );
  const frameOverride = classesForSlot(
    renderToStaticMarkup(
      <ViewportFrame
        className="consumer-frame"
        xstyle={testStyles.frameOverride}
      />,
    ),
    "viewport-frame",
  );
  const rowBase = classesForSlot(
    renderToStaticMarkup(<WrappingRow />),
    "wrapping-row",
  );
  const rowOverride = classesForSlot(
    renderToStaticMarkup(
      <WrappingRow className="consumer-row" xstyle={testStyles.rowOverride} />,
    ),
    "wrapping-row",
  );
  const frameBaseGenerated = generatedClasses(
    frameBase,
    "hraness-viewport-frame",
  );
  const frameOverrideGenerated = generatedClasses(
    frameOverride,
    "hraness-viewport-frame",
    "consumer-frame",
  );
  const rowBaseGenerated = generatedClasses(rowBase, "hraness-wrapping-row");
  const rowOverrideGenerated = generatedClasses(
    rowOverride,
    "hraness-wrapping-row",
    "consumer-row",
  );

  expect(frameOverrideGenerated).toHaveLength(frameBaseGenerated.length);
  expect(
    frameOverrideGenerated.filter((name) => frameBaseGenerated.includes(name)),
  ).toHaveLength(frameBaseGenerated.length - 1);
  expect(rowOverrideGenerated).toHaveLength(rowBaseGenerated.length);
  expect(
    rowOverrideGenerated.filter((name) => rowBaseGenerated.includes(name)),
  ).toHaveLength(rowBaseGenerated.length - 1);
  expect(frameOverride[0]).toBe("hraness-viewport-frame");
  expect(frameOverride.at(-1)).toBe("consumer-frame");
  expect(rowOverride[0]).toBe("hraness-wrapping-row");
  expect(rowOverride.at(-1)).toBe("consumer-row");
});

test("caller native styles win while dynamic StyleX values survive the shared merge", () => {
  const frameTag = openingTagForSlot(
    renderToStaticMarkup(
      <ViewportFrame
        style={{ backgroundColor: "rgb(1, 2, 3)", inlineSize: "29rem" }}
        xstyle={testStyles.dynamicFrame("28rem")}
      />,
    ),
    "viewport-frame",
  );
  const rowTag = openingTagForSlot(
    renderToStaticMarkup(
      <WrappingRow
        style={{ color: "rgb(4, 5, 6)", gap: "3rem" }}
        xstyle={testStyles.dynamicRow("2rem")}
      />,
    ),
    "wrapping-row",
  );
  const frameStyle = frameTag.match(/style="([^"]+)"/u)?.[1] ?? "";
  const rowStyle = rowTag.match(/style="([^"]+)"/u)?.[1] ?? "";

  expect(frameStyle).toMatch(/--[^:]+:28rem/u);
  expect(frameStyle).toContain("background-color:rgb(1, 2, 3)");
  expect(frameStyle).toContain("inline-size:29rem");
  expect(frameStyle.indexOf("--")).toBeLessThan(frameStyle.indexOf("inline-size:29rem"));
  expect(rowStyle).toMatch(/--[^:]+:2rem/u);
  expect(rowStyle).toContain("color:rgb(4, 5, 6)");
  expect(rowStyle).toContain("gap:3rem");
  expect(rowStyle.indexOf("--")).toBeLessThan(rowStyle.indexOf("gap:3rem"));
});

type TestSurfaceElement = ReactElement<{
  ref?: (element: HTMLElement | null) => void;
}>;

function renderForwardRefForTest<Props>(
  component: unknown,
  props: Props,
  ref: Ref<HTMLElement>,
): TestSurfaceElement {
  return (component as Readonly<{
    render: (props: Props, ref: Ref<HTMLElement>) => TestSurfaceElement;
  }>).render(props, ref);
}

test("structural surfaces forward their chosen native element", () => {
  const frameValues: Array<HTMLElement | null> = [];
  const rowValues: Array<HTMLElement | null> = [];
  const frame = renderForwardRefForTest<ViewportFrameProps>(
    ViewportFrame,
    { as: "section" },
    (element) => {
      frameValues.push(element);
    },
  );
  const row = renderForwardRefForTest<WrappingRowProps>(
    WrappingRow,
    { as: "header" },
    (element) => {
      rowValues.push(element);
    },
  );
  const frameElement = { id: "frame" } as HTMLElement;
  const rowElement = { id: "row" } as HTMLElement;

  frame.props.ref?.(frameElement);
  frame.props.ref?.(null);
  row.props.ref?.(rowElement);
  row.props.ref?.(null);

  expect(frame.type).toBe("section");
  expect(row.type).toBe("header");
  expect(frameValues).toEqual([frameElement, null]);
  expect(rowValues).toEqual([rowElement, null]);
});

const themedSurfaceTones = [
  "accent",
  "card",
  "inverse",
  "popover",
  "secondary",
] as const satisfies readonly ThemedSurfaceTone[];

test("ThemedSurface preserves its native element, finite variants, semantic hooks, and caller class", () => {
  const defaultTag = openingTagForSlot(
    renderToStaticMarkup(<ThemedSurface />),
    "themed-surface",
  );
  const html = renderToStaticMarkup(
    <ThemedSurface
      {...{ "data-slot": "caller-surface" }}
      aria-label="Preview surface"
      as="article"
      className="consumer-surface"
      data-product="writer"
      id="preview"
      shape="rectangular"
      tone="inverse"
    >
      Content
    </ThemedSurface>,
  );
  const tag = openingTagForSlot(html, "themed-surface");
  const classes = classesForSlot(html, "themed-surface");

  expect(defaultTag).toStartWith("<div");
  expect(defaultTag).toContain('data-shape="rounded"');
  expect(defaultTag).toContain('data-tone="card"');
  expect(tag).toStartWith("<article");
  expect(classes[0]).toBe("hraness-themed-surface");
  expect(classes.at(-1)).toBe("consumer-surface");
  expect(generatedClasses(classes, "hraness-themed-surface", "consumer-surface"))
    .not.toHaveLength(0);
  expect(tag).toContain('aria-label="Preview surface"');
  expect(tag).toContain('data-product="writer"');
  expect(tag).toContain('data-shape="rectangular"');
  expect(tag).toContain('data-slot="themed-surface"');
  expect(tag).not.toContain('data-slot="caller-surface"');
  expect(tag).toContain('data-tone="inverse"');
  expect(tag).toContain('id="preview"');
  expect(html).toContain(">Content</article>");
});

test("ThemedSurface renders every public tone as a stable semantic variant", () => {
  for (const tone of themedSurfaceTones) {
    const html = renderToStaticMarkup(<ThemedSurface tone={tone}>{tone}</ThemedSurface>);
    const classes = classesForSlot(html, "themed-surface");

    expect(openingTagForSlot(html, "themed-surface")).toContain(`data-tone="${tone}"`);
    expect(classes[0]).toBe("hraness-themed-surface");
    expect(generatedClasses(classes, "hraness-themed-surface")).not.toHaveLength(0);
    expect(html).toContain(`>${tone}</div>`);
  }
});

test("ThemedSurface applies its tone and shape before the typed caller StyleX recipe", () => {
  const baseClasses = classesForSlot(
    renderToStaticMarkup(<ThemedSurface shape="rectangular" tone="accent" />),
    "themed-surface",
  );
  const overrideClasses = classesForSlot(
    renderToStaticMarkup(
      <ThemedSurface
        className="consumer-surface"
        shape="rectangular"
        tone="accent"
        xstyle={testStyles.surfaceOverride}
      />,
    ),
    "themed-surface",
  );
  const baseGenerated = generatedClasses(baseClasses, "hraness-themed-surface");
  const overrideGenerated = generatedClasses(
    overrideClasses,
    "hraness-themed-surface",
    "consumer-surface",
  );

  expect(overrideGenerated.length).toBeGreaterThan(baseGenerated.length);
  expect(
    baseGenerated.filter((name) => overrideGenerated.includes(name)),
  ).toHaveLength(baseGenerated.length - 4);
  expect(overrideClasses[0]).toBe("hraness-themed-surface");
  expect(overrideClasses.at(-1)).toBe("consumer-surface");
});

test("ThemedSurface keeps the downstream texture seam while native styles win dynamic values", () => {
  const tag = openingTagForSlot(
    renderToStaticMarkup(
      <ThemedSurface
        style={{ backgroundPosition: "2px 3px", backgroundSize: "8px 8px" }}
        xstyle={[
          testStyles.surfaceOverride,
          testStyles.dynamicSurface("6px 6px"),
        ]}
      />,
    ),
    "themed-surface",
  );
  const inlineStyle = tag.match(/style="([^"]+)"/u)?.[1] ?? "";

  expect(inlineStyle).toMatch(/--[^:]+:6px 6px/u);
  expect(inlineStyle).toContain("background-position:2px 3px");
  expect(inlineStyle).toContain("background-size:8px 8px");
  expect(inlineStyle.indexOf("--")).toBeLessThan(
    inlineStyle.indexOf("background-size:8px 8px"),
  );
});

test("ThemedSurface forwards its chosen native element", () => {
  const values: Array<HTMLElement | null> = [];
  const surface = renderForwardRefForTest<ThemedSurfaceProps>(
    ThemedSurface,
    { as: "section" },
    (element) => {
      values.push(element);
    },
  );
  const element = { id: "surface" } as HTMLElement;

  surface.props.ref?.(element);
  surface.props.ref?.(null);

  expect(surface.type).toBe("section");
  expect(values).toEqual([element, null]);
});
