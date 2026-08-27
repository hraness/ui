import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ToolbarContext,
  type ToolbarRenderProps,
} from "react-aria-components";

import { Toolbar } from "./toolbar.js";
import { toolbarStyles } from "./toolbar.stylex.js";

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  override: {
    alignItems: "end",
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    display: "grid",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    outlineColor: "var(--ui-warning)",
    outlineOffset: "7px",
    outlineStyle: "dashed",
    outlineWidth: "4px",
    paddingBlock: "var(--space-2)",
    paddingInline: "var(--space-2)",
    width: "14rem",
  },
});

function openingTag(html: string): string {
  const end = html.indexOf(">");
  if (end < 0) throw new Error("Rendered Toolbar tag is incomplete");
  return html.slice(0, end + 1);
}

function classes(html: string): string[] {
  const className = openingTag(html).match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error("Rendered Toolbar has no class");
  return className.split(" ");
}

test("Toolbar preserves its accessible name, semantic hook, orientation, and caller attributes", () => {
  const labelled = renderToStaticMarkup(
    <Toolbar
      aria-label="Editor actions"
      className="consumer-toolbar"
      data-product="writer"
    >
      <button type="button">Save</button>
    </Toolbar>,
  );
  const labelledBy = renderToStaticMarkup(
    <>
      <h2 id="format-actions">Format actions</h2>
      <Toolbar
        aria-labelledby="format-actions"
        className="consumer-toolbar-vertical"
        orientation="vertical"
      >
        <button type="button">Bold</button>
      </Toolbar>
    </>,
  );
  const labelledTag = openingTag(labelled);
  const labelledClasses = classes(labelled);
  const labelledByTag = labelledBy.match(/<div[^>]*data-slot="toolbar"[^>]*>/u)?.[0]
    ?? "";

  expect(labelledTag).toStartWith("<div");
  expect(labelledTag).toContain('role="toolbar"');
  expect(labelledTag).toContain('aria-label="Editor actions"');
  expect(labelledTag).toContain('aria-orientation="horizontal"');
  expect(labelledTag).toContain('data-orientation="horizontal"');
  expect(labelledTag).toContain('data-slot="toolbar"');
  expect(labelledTag).toContain('data-product="writer"');
  expect(labelledClasses[0]).toBe("hraness-toolbar");
  expect(labelledClasses.at(-1)).toBe("consumer-toolbar");
  expect(labelledClasses.length).toBeGreaterThan(2);

  expect(labelledByTag).toContain('role="toolbar"');
  expect(labelledByTag).toContain('aria-labelledby="format-actions"');
  expect(labelledByTag).not.toContain("aria-label=");
  expect(labelledByTag).toContain('aria-orientation="vertical"');
  expect(labelledByTag).toContain('data-orientation="vertical"');
  expect(labelledByTag).toContain(
    'class="hraness-toolbar ',
  );
  expect(labelledByTag).toContain(" consumer-toolbar-vertical\"");
});

test("Toolbar composes React Aria context classes before its stable and caller hooks", () => {
  const html = renderToStaticMarkup(
    <ToolbarContext.Provider
      value={{
        className: "context-toolbar",
        orientation: "vertical",
        render: (props, state) => (
          <div
            {...props}
            data-context-render={state.orientation}
          />
        ),
      }}
    >
      <Toolbar
        aria-label="Context toolbar"
        className="consumer-toolbar"
      >
        <button type="button">Save</button>
      </Toolbar>
    </ToolbarContext.Provider>,
  );
  const tag = openingTag(html);
  const renderedClasses = classes(html);

  expect(tag).toContain('data-orientation="vertical"');
  expect(tag).toContain('data-context-render="vertical"');
  expect(renderedClasses[0]).toBe("context-toolbar");
  expect(renderedClasses[1]).toBe("hraness-toolbar");
  expect(renderedClasses.at(-1)).toBe("consumer-toolbar");
  expect(renderedClasses.length).toBeGreaterThan(4);
});

test("Toolbar keeps slot opt-out presentation local and does not leak it to descendants", () => {
  const html = renderToStaticMarkup(
    <ToolbarContext.Provider value={{ className: "context-toolbar" }}>
      <Toolbar
        aria-label="Outer toolbar"
        className="outer-toolbar"
        xstyle={testStyles.override}
      >
        <Toolbar
          aria-label="Inner toolbar"
          className="inner-toolbar"
          slot={null}
        />
      </Toolbar>
    </ToolbarContext.Provider>,
  );
  const tags = html.match(/<div[^>]*role="toolbar"[^>]*>/gu) ?? [];

  expect(tags).toHaveLength(2);
  expect(tags[0]).toContain("context-toolbar");
  expect(tags[0]).toContain("hraness-toolbar");
  expect(tags[0]).toContain("outer-toolbar");
  expect(tags[1]).toContain("hraness-toolbar");
  expect(tags[1]).toContain("inner-toolbar");
  expect(tags[1]).not.toContain("context-toolbar");
  expect(tags[1]).not.toContain("outer-toolbar");
});

test("Toolbar composes presentation through a caller DOM render function", () => {
  const html = renderToStaticMarkup(
    <Toolbar
      aria-label="Rendered toolbar"
      className="consumer-toolbar"
      orientation="vertical"
      render={(props, state) => (
        <div
          {...props}
          data-caller-render={state.orientation}
        />
      )}
    />,
  );
  const tag = openingTag(html);

  expect(tag).toContain('data-caller-render="vertical"');
  expect(tag).toContain('data-orientation="vertical"');
  expect(classes(html)[0]).toBe("hraness-toolbar");
  expect(classes(html).at(-1)).toBe("consumer-toolbar");
});

type ToolbarState = ToolbarRenderProps & Readonly<{
  defaultClassName: string | undefined;
  defaultStyle: CSSProperties;
}>;

function toolbarState(orientation: "horizontal" | "vertical"): ToolbarState {
  return {
    defaultClassName: "react-aria-Toolbar",
    defaultStyle: { cursor: "default" },
    orientation,
  };
}

test("Toolbar applies caller StyleX last and omits its native focus fallback on that path", () => {
  const defaultClasses = classes(renderToStaticMarkup(
    <Toolbar aria-label="Default toolbar" orientation="vertical" />,
  ));
  const overrideClasses = classes(renderToStaticMarkup(
    <Toolbar
      aria-label="Override toolbar"
      className="consumer-toolbar"
      orientation="vertical"
      xstyle={testStyles.override}
    />,
  ));
  const fallbackClasses = stylex
    .props(toolbarStyles.nativeFocusFallback)
    .className?.split(" ") ?? [];
  const callerClasses = stylex.props(testStyles.override).className?.split(" ")
    ?? [];

  expect(defaultClasses[0]).toBe("hraness-toolbar");
  expect(overrideClasses[0]).toBe("hraness-toolbar");
  expect(overrideClasses.at(-1)).toBe("consumer-toolbar");
  expect(fallbackClasses).not.toHaveLength(0);
  for (const fallbackClass of fallbackClasses) {
    expect(defaultClasses).toContain(fallbackClass);
    expect(overrideClasses).not.toContain(fallbackClass);
  }
  expect(callerClasses).not.toHaveLength(0);
  for (const callerClass of callerClasses) {
    expect(overrideClasses).toContain(callerClass);
  }
});

test("Toolbar merges dynamic StyleX values before static and render-prop native styles", () => {
  const staticMarkup = openingTag(renderToStaticMarkup(
    <Toolbar
      aria-label="Static style toolbar"
      style={{ width: "15rem" }}
      xstyle={testStyles.dynamicWidth("14rem")}
    />,
  ));
  const seenStates: ToolbarState[] = [];
  const renderMarkup = openingTag(renderToStaticMarkup(
    <Toolbar
      aria-label="Render style toolbar"
      orientation="vertical"
      style={(state) => {
        seenStates.push(state as ToolbarState);
        return {
          backgroundColor: state.orientation === "vertical"
            ? "rgb(1, 2, 3)"
            : "rgb(4, 5, 6)",
          width: "15rem",
        };
      }}
      xstyle={testStyles.dynamicWidth("14rem")}
    />,
  ));
  const state = toolbarState("vertical");

  expect(staticMarkup).toMatch(/style="--[^:]+:14rem;width:15rem"/u);
  expect(seenStates).toHaveLength(1);
  expect(seenStates[0]?.orientation).toBe(state.orientation);
  expect(renderMarkup).toContain("background-color:rgb(1, 2, 3)");
  expect(renderMarkup).toMatch(/style="--[^:]+:14rem;[^"]*width:15rem/u);
});
