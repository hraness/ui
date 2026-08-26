import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type {
  ReactElement,
  Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ThemedSurface,
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

test("ThemedSurface retains its legacy semantic contract", () => {
  const html = renderToStaticMarkup(
    <ThemedSurface
      as="article"
      className="consumer-surface"
      shape="rectangular"
      tone="inverse"
    >
      Content
    </ThemedSurface>,
  );

  expect(html).toStartWith('<article class="hraness-themed-surface consumer-surface"');
  expect(html).toContain('data-shape="rectangular"');
  expect(html).toContain('data-slot="themed-surface"');
  expect(html).toContain('data-tone="inverse"');
  expect(html).toContain(">Content</article>");
});
