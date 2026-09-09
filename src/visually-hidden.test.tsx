import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { parseFragment } from "parse5";
import { createRef, type ReactElement, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CopyButton,
  Spinner,
  TextField,
  VisuallyHidden,
  type VisuallyHiddenElement,
  type VisuallyHiddenProps,
} from "./index.js";
import { VisuallyHidden as NativeVisuallyHidden } from "./visually-hidden.js";
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

const elementNames = [
  "span", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6",
] as const satisfies readonly VisuallyHiddenElement[];

const validProps: VisuallyHiddenProps = {
  as: "h1",
  children: "Project library",
  className: "library-title",
  id: "library-title",
  lang: "en",
};
const invalidButton: VisuallyHiddenProps = {
  // @ts-expect-error Interactive elements are outside the finite text boundary.
  as: "button",
};
const invalidLink: VisuallyHiddenProps = {
  // @ts-expect-error Navigation belongs to a visible or focus-revealed control.
  as: "a",
};
const invalidCustomElement: VisuallyHiddenProps = {
  // @ts-expect-error The semantic element set does not accept arbitrary strings.
  as: "project-title",
};
const invalidComponent: VisuallyHiddenProps = {
  // @ts-expect-error The element option accepts only native text and heading tags.
  as: () => <h1>Project library</h1>,
};
const invalidLinkProps: VisuallyHiddenProps = {
  // @ts-expect-error Anchor-only attributes are not native text attributes.
  href: "/projects",
};
const invalidFocusable: VisuallyHiddenProps = {
  // @ts-expect-error This primitive has no focus-reveal behavior.
  isFocusable: true,
};
const invalidRecipe: VisuallyHiddenProps = {
  // @ts-expect-error Hiding uses the shared recipe without a caller recipe seam.
  xstyle: visuallyHiddenStyles.root,
};
// @ts-expect-error Refs must target a native HTML element, not an SVG element.
const invalidRef = <VisuallyHidden ref={createRef<SVGSVGElement>()} />;
void [
  validProps,
  invalidButton,
  invalidLink,
  invalidCustomElement,
  invalidComponent,
  invalidLinkProps,
  invalidFocusable,
  invalidRecipe,
  invalidRef,
];

function singleNativeElement(markup: string) {
  const fragment = parseFragment(markup);
  expect(fragment.childNodes).toHaveLength(1);
  const element = fragment.childNodes[0];
  if (element === undefined || !("tagName" in element)) {
    throw new Error("Expected one native element");
  }
  return element;
}

test("public VisuallyHidden defaults to one styled native span without hiding semantics", () => {
  expect(VisuallyHidden).toBe(NativeVisuallyHidden);
  const element = singleNativeElement(renderToStaticMarkup(
    <VisuallyHidden>Project label</VisuallyHidden>,
  ));

  expect(element.tagName).toBe("span");
  expect(element.attrs).toEqual([
    { name: "class", value: `hraness-visually-hidden ${visuallyHiddenClassName()}` },
    { name: "data-slot", value: "visually-hidden" },
  ]);
  expect(element.childNodes).toHaveLength(1);
  expect(element.childNodes[0]).toMatchObject({
    nodeName: "#text",
    value: "Project label",
  });
  const bareHook = singleNativeElement(renderToStaticMarkup(
    <span className="hraness-visually-hidden">Project label</span>,
  ));
  expect(bareHook.attrs).toEqual([
    { name: "class", value: "hraness-visually-hidden" },
  ]);
  expect(bareHook.attrs).not.toEqual(element.attrs);
});

test("every finite element preserves text and native semantics on the compiled root", () => {
  const expectedClasses = visuallyHiddenClassName()?.split(" ") ?? [];
  const texts = ["", "Project library", "<&\"'>", "Showing 12\nprojects", "项目 café 👩‍💻"];
  for (const as of elementNames) {
    for (const text of texts) {
      for (const isLive of [false, true]) {
        const element = singleNativeElement(renderToStaticMarkup(
          <VisuallyHidden
            {...(isLive ? { "aria-live": "polite" as const, role: "status" } : {})}
            {...{ "data-slot": "caller-slot" }}
            as={as}
            className="caller-label secondary-label"
            data-consumer="library"
            dir="rtl"
            id="library-label"
            lang="en"
            title="Library label"
          >
            {text}
          </VisuallyHidden>,
        ));
        const attrs = new Map(element.attrs.map(({ name, value }) => [name, value]));
        expect(element.tagName).toBe(as);
        expect(attrs.get("class")?.split(" ")).toEqual([
          "hraness-visually-hidden", ...expectedClasses, "caller-label", "secondary-label",
        ]);
        expect(attrs.get("data-slot")).toBe("visually-hidden");
        expect(attrs.get("data-consumer")).toBe("library");
        expect(attrs.get("id")).toBe("library-label");
        expect(attrs.get("dir")).toBe("rtl");
        expect(attrs.get("lang")).toBe("en");
        expect(attrs.get("title")).toBe("Library label");
        expect(attrs.get("role")).toBe(isLive ? "status" : undefined);
        expect(attrs.get("aria-live")).toBe(isLive ? "polite" : undefined);
        for (const forbidden of ["aria-hidden", "hidden", "inert", "tabindex", "style", "as"]) {
          expect(attrs.has(forbidden)).toBe(false);
        }
        expect(element.childNodes.every((child) => child.nodeName === "#text")).toBe(true);
        expect(element.childNodes.map((child) => "value" in child ? child.value : "").join(""))
          .toBe(text);
      }
    }
  }
});

test("VisuallyHidden forwards refs and caller attributes to the chosen native element", () => {
  const objectRef = createRef<HTMLElement>();
  const callbackRef: Ref<HTMLElement> = () => {};
  const onClick = () => {};
  const style = { color: "tomato" };
  const render = (VisuallyHidden as unknown as Readonly<{
    render: (
      props: VisuallyHiddenProps,
      ref: Ref<HTMLElement>,
    ) => ReactElement<VisuallyHiddenProps & { ref: Ref<HTMLElement> }>;
  }>).render;

  for (const as of elementNames) {
    for (const ref of [objectRef, callbackRef]) {
      const element = render({ as, children: <strong>Project</strong>, onClick, style }, ref);
      expect(element.type).toBe(as);
      expect(element.props.ref).toBe(ref);
      expect(element.props.onClick).toBe(onClick);
      expect(element.props.style).toBe(style);
      expect(element.props.as).toBeUndefined();
      const markup = renderToStaticMarkup(element);
      expect(markup).toContain('style="color:tomato"');
      expect(markup).toContain("><strong>Project</strong></");
    }
  }

  const callerSemantics = singleNativeElement(renderToStaticMarkup(
    <VisuallyHidden aria-atomic="true" aria-live="assertive" role="alert">
      Project unavailable
    </VisuallyHidden>,
  ));
  expect(callerSemantics.attrs).toContainEqual({ name: "aria-atomic", value: "true" });
  expect(callerSemantics.attrs).toContainEqual({ name: "aria-live", value: "assertive" });
  expect(callerSemantics.attrs).toContainEqual({ name: "role", value: "alert" });
});

test("VisuallyHidden source keeps the shared compiled recipe and package client protocol", async () => {
  const source = await Bun.file(new URL("./visually-hidden.tsx", import.meta.url)).text();
  expect(source).not.toMatch(/["']use client["']/u);
  expect(source).toContain('from "./visually-hidden.stylex.js"');
  expect(source).toContain("visuallyHiddenClassName()");
  expect(source).not.toContain("stylex.create");
  expect(source).not.toContain("useVisuallyHidden");
  expect(source).not.toContain("useState");
});

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
