import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { SeparatorContext } from "react-aria-components";
import { renderToStaticMarkup } from "react-dom/server";

import { Separator } from "./collections.js";

const testStyles = stylex.create({
  dynamicOpacity: (opacity: number) => ({ opacity }),
  override: {
    backgroundColor: "var(--ui-primary)",
  },
});

function openingTag(markup: string): string {
  return markup.slice(0, markup.indexOf(">") + 1);
}

function classes(markup: string): string[] {
  return openingTag(markup).match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
}

test("Separator preserves React Aria's horizontal and vertical native elements", () => {
  const horizontal = openingTag(renderToStaticMarkup(
    <Separator aria-label="Sections" data-product="writer" />,
  ));
  const vertical = openingTag(renderToStaticMarkup(
    <Separator aria-label="Columns" orientation="vertical" />,
  ));
  const horizontalDiv = openingTag(renderToStaticMarkup(
    <Separator elementType="div" orientation="horizontal" />,
  ));

  expect(horizontal).toStartWith("<hr");
  expect(horizontal).toContain('aria-label="Sections"');
  expect(horizontal).toContain('data-product="writer"');
  expect(horizontal).toContain('data-slot="separator"');
  expect(horizontal).toContain('class="hraness-separator ');
  expect(horizontal).toContain('role="separator"');
  expect(horizontal).not.toContain("aria-orientation=");

  expect(vertical).toStartWith("<div");
  expect(vertical).toContain('aria-label="Columns"');
  expect(vertical).toContain('role="separator"');
  expect(vertical).toContain('aria-orientation="vertical"');
  expect(vertical).toContain('data-slot="separator"');

  expect(horizontalDiv).toStartWith("<div");
  expect(horizontalDiv).toContain('role="separator"');
  expect(horizontalDiv).not.toContain("aria-orientation=");
});

test("Separator resolves context orientation before composing caller presentation", () => {
  let contextRenderRetainedRef = false;
  const markup = renderToStaticMarkup(
    <SeparatorContext.Provider
      value={{
        className: "context-separator",
        elementType: "div",
        orientation: "vertical",
        render: (props) => {
          contextRenderRetainedRef = "ref" in props;
          return <div {...props} data-context-render="true" />;
        },
        style: { opacity: 0.25 },
      }}
    >
      <Separator
        className="consumer-separator"
        style={{ opacity: 0.75 }}
        xstyle={[
          testStyles.override,
          testStyles.dynamicOpacity(0.5),
        ]}
      />
    </SeparatorContext.Provider>,
  );
  const tag = openingTag(markup);
  const renderedClasses = classes(markup);

  expect(tag).toStartWith("<div");
  expect(tag).toContain('role="separator"');
  expect(tag).toContain('aria-orientation="vertical"');
  expect(tag).toContain('data-context-render="true"');
  expect(contextRenderRetainedRef).toBeTrue();
  expect(tag).toMatch(/style="--[^:]+:0\.5;opacity:0\.75"/u);
  expect(renderedClasses[0]).toBe("context-separator");
  expect(renderedClasses[1]).toBe("hraness-separator");
  expect(renderedClasses.at(-1)).toBe("consumer-separator");
  expect(renderedClasses.length).toBeGreaterThan(4);
});

test("Separator lets explicit orientation and slot opt-out override context", () => {
  const markup = renderToStaticMarkup(
    <SeparatorContext.Provider
      value={{
        className: "context-separator",
        elementType: "div",
        orientation: "vertical",
      }}
    >
      <Separator className="explicit-separator" orientation="horizontal" />
      <Separator className="local-separator" slot={null} />
    </SeparatorContext.Provider>,
  );
  const tags = markup.match(/<(?:div|hr)[^>]*data-slot="separator"[^>]*>/gu) ?? [];

  expect(tags).toHaveLength(2);
  expect(tags[0]).toStartWith("<div");
  expect(tags[0]).toContain('role="separator"');
  expect(tags[0]).not.toContain("aria-orientation=");
  expect(tags[0]).toContain("context-separator");
  expect(tags[0]).toContain("explicit-separator");

  expect(tags[1]).toStartWith("<hr");
  expect(tags[1]).toContain('role="separator"');
  expect(tags[1]).not.toContain("aria-orientation=");
  expect(tags[1]).not.toContain("context-separator");
  expect(tags[1]).toContain("local-separator");
});
