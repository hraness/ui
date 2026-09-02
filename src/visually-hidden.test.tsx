import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import { CopyButton, Spinner, TextField } from "./index.js";
import {
  visuallyHiddenClassName,
  visuallyHiddenStyles,
} from "./visually-hidden.stylex.js";

function openingTag(markup: string, slot: string): string {
  const tag = markup.match(
    new RegExp(`<[^>]+data-slot=["']${slot}["'][^>]*>`, "u"),
  )?.[0];
  if (tag === undefined) {
    throw new Error(`Rendered markup is missing data-slot=${slot}`);
  }
  return tag;
}

function classes(tag: string): string[] {
  return tag.match(/class="([^"]+)"/u)?.[1]?.split(" ").filter(Boolean) ?? [];
}

test("the shared visually-hidden helper is conditional and has no inline style", () => {
  const presentation = stylex.props(visuallyHiddenStyles.root);
  const generatedClasses = presentation.className?.split(" ").filter(Boolean) ?? [];

  expect(Object.keys(visuallyHiddenStyles)).toEqual(["root"]);
  expect(generatedClasses).toHaveLength(15);
  expect(generatedClasses.every((className) => className.startsWith("x"))).toBe(true);
  expect(presentation.style).toBeUndefined();
  expect(visuallyHiddenClassName()).toBe(presentation.className);
  expect(visuallyHiddenClassName(true)).toBe(presentation.className);
  expect(visuallyHiddenClassName(false)).toBeUndefined();
});

test("the shared visually-hidden recipe preserves the exact legacy declarations", async () => {
  const [components, recipe] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./visually-hidden.stylex.ts", import.meta.url)).text(),
  ]);

  expect(components).not.toContain(".hraness-visually-hidden");
  for (const declaration of [
    'borderColor: "currentColor !important"',
    'borderImageOutset: "0 !important"',
    'borderImageRepeat: "stretch !important"',
    'borderImageSlice: "100% !important"',
    'borderImageSource: "none !important"',
    'borderImageWidth: "1 !important"',
    'borderStyle: "none !important"',
    'borderWidth: "0 !important"',
    'clip: "rect(0, 0, 0, 0) !important"',
    'height: "1px !important"',
    'overflow: "hidden !important"',
    'padding: "0 !important"',
    'position: "absolute !important"',
    'whiteSpace: "nowrap !important"',
    'width: "1px !important"',
  ]) {
    expect(recipe).toContain(declaration);
  }
  expect(recipe.match(/!important/gu)).toHaveLength(15);
  expect(recipe).toContain(
    "stylex.props(hidden && visuallyHiddenStyles.root).className",
  );
});

test("representative hidden consumers preserve semantics and share the atomic recipe", () => {
  const expectedClasses = visuallyHiddenClassName()?.split(" ").filter(Boolean) ?? [];
  const markup = renderToStaticMarkup(
    <>
      <Spinner label="Checking delivery" />
      <TextField label="Project query" showLabel={false} />
      <CopyButton copyLabel="Copy project" value="project-id" />
    </>,
  );
  const consumers = [
    {
      semanticClasses: ["hraness-visually-hidden"],
      tag: openingTag(markup, "spinner-label"),
    },
    {
      semanticClasses: ["hraness-field__label"],
      tag: openingTag(markup, "field-label"),
    },
    {
      semanticClasses: ["hraness-visually-hidden"],
      tag: openingTag(markup, "copy-button-status"),
    },
  ];

  expect(expectedClasses).toHaveLength(15);
  for (const { semanticClasses, tag } of consumers) {
    const renderedClasses = classes(tag);
    const hiddenIndex = renderedClasses.indexOf("hraness-visually-hidden");
    expect(renderedClasses.slice(0, semanticClasses.length)).toEqual(semanticClasses);
    expect(hiddenIndex).toBeGreaterThanOrEqual(semanticClasses.length - 1);
    expect(expectedClasses.every((className) => renderedClasses.includes(className)))
      .toBe(true);
    expect(expectedClasses.every(
      (className) => renderedClasses.indexOf(className) > hiddenIndex,
    )).toBe(true);
    expect(tag).not.toContain("style=");
  }
  expect(consumers[0]?.tag).toStartWith("<span");
  expect(markup).toContain(">Checking delivery</span>");
  expect(consumers[1]?.tag).toStartWith("<label");
  expect(markup).toContain(">Project query</label>");
  expect(consumers[2]?.tag).toContain('aria-live="polite"');
  expect(consumers[2]?.tag).toContain('role="status"');
  expect(markup).not.toContain("project-id");
});
