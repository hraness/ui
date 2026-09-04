import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListBoxContext, type ListBoxRenderProps } from "react-aria-components";

import { ListBox, ListBoxItem, ListBoxSection } from "./list-box.js";
import { listBoxStyles } from "./list-box.stylex.js";

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  header: {
    color: "var(--ui-warning)",
    fontSize: "1rem",
    fontWeight: 700,
    paddingLeft: "1rem",
  },
  item: {
    backgroundColor: "var(--ui-secondary)",
    color: "var(--ui-primary)",
    fontWeight: 400,
    minHeight: "3.25rem",
    opacity: 0.75,
    paddingLeft: "1rem",
  },
  root: {
    alignItems: "center",
    display: "grid",
    maxHeight: "18rem",
    minWidth: "7rem",
    overflowY: "auto",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
  },
});

function tags(html: string, slot: string): string[] {
  return html.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`, "gu")) ?? [];
}

function tag(html: string, slot: string): string {
  const result = tags(html, slot)[0];
  if (result === undefined) throw new Error(`Missing ${slot} element`);
  return result;
}

function classes(openingTag: string): string[] {
  const className = openingTag.match(/\bclass="([^"]*)"/u)?.[1];
  if (className === undefined) throw new Error("Missing element classes");
  return className.split(" ").filter(Boolean);
}

function recipeClasses(presentation: ReturnType<typeof stylex.props>): string[] {
  return presentation.className?.split(" ") ?? [];
}

function expectInlineValues(openingTag: string, presentation: ReturnType<typeof stylex.props>) {
  for (const [name, value] of Object.entries(presentation.style ?? {})) {
    expect(openingTag).toContain(`${name}:${String(value)}`);
  }
}

test("ListBox preserves generic dynamic collection semantics and stable class order", () => {
  const choices = [
    { id: "calm", label: "Calm" },
    { id: "compact", label: "Compact" },
  ];
  const html = renderToStaticMarkup(
    <ListBox
      aria-label="Appearance"
      className="consumer-list"
      data-product="preferences"
      items={choices}
      selectionMode="single"
    >
      {(choice) => (
        <ListBoxItem className="consumer-item" id={choice.id} textValue={choice.label}>
          {choice.label}
        </ListBoxItem>
      )}
    </ListBox>,
  );
  const root = tag(html, "list-box");
  const items = tags(html, "list-box-item");

  expect(root).toStartWith("<div");
  expect(root).toContain('role="listbox"');
  expect(root).toContain('aria-label="Appearance"');
  expect(root).toContain('data-orientation="vertical"');
  expect(root).toContain('data-product="preferences"');
  expect(classes(root)).toEqual([
    "hraness-list-box",
    ...recipeClasses(stylex.props(listBoxStyles.root)),
    "consumer-list",
  ]);
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item).toContain('role="option"');
    expect(classes(item)).toEqual([
      "hraness-list-box__item",
      ...recipeClasses(stylex.props(listBoxStyles.item)),
      "consumer-item",
    ]);
  }
  expect(html).toContain(">Calm</div>");
  expect(html).toContain(">Compact</div>");
  expect(html.match(/<div\b/gu)).toHaveLength(3);
  expect(html).not.toContain("xstyle=");
});

test("horizontal ListBox applies flex only to direct items and sections", () => {
  const html = renderToStaticMarkup(
    <ListBox aria-label="Horizontal choices" orientation="horizontal">
      <ListBoxItem id="first">First</ListBoxItem>
      <ListBoxSection title="Grouped" className="consumer-section">
        <ListBoxItem id="second">Second</ListBoxItem>
      </ListBoxSection>
    </ListBox>,
  );
  const root = tag(html, "list-box");
  const items = tags(html, "list-box-item");
  const section = tag(html, "list-box-section");

  expect(root).toContain('data-orientation="horizontal"');
  expect(classes(root)).toEqual([
    "hraness-list-box",
    ...recipeClasses(stylex.props(listBoxStyles.root, listBoxStyles.horizontalRoot)),
  ]);
  expect(classes(items[0] ?? "")).toEqual([
    "hraness-list-box__item",
    ...recipeClasses(stylex.props(listBoxStyles.item, listBoxStyles.horizontalChild)),
  ]);
  expect(classes(section)).toEqual([
    "hraness-list-box__section",
    ...recipeClasses(stylex.props(listBoxStyles.section, listBoxStyles.horizontalChild)),
    "consumer-section",
  ]);
  expect(classes(items[1] ?? "")).toEqual([
    "hraness-list-box__item",
    ...recipeClasses(stylex.props(listBoxStyles.item)),
  ]);
  expect(html.match(/<div\b/gu)).toHaveLength(3);
  expect(html.match(/<section\b/gu)).toHaveLength(1);
  expect(html).toContain("Grouped");
});

test("ListBox uses inherited orientation and renderer while preserving native style state", () => {
  const renderedStates: ListBoxRenderProps[] = [];
  const styleStates: string[] = [];
  const html = renderToStaticMarkup(
    <ListBoxContext.Provider value={{
      className: "context-list",
      orientation: "horizontal",
      render: (props, state) => {
        renderedStates.push(state);
        expect(props.ref).toBeDefined();
        return <div {...props} data-context-render={state.orientation} />;
      },
      style: { marginLeft: 9 },
    }}>
      <ListBox
        aria-label="Context choices"
        className="consumer-list"
        style={(state) => {
          styleStates.push(state.orientation);
          return { ...state.defaultStyle, width: 512 };
        }}
        xstyle={testStyles.dynamicWidth("20rem")}
      >
        <ListBoxItem id="choice">Choice</ListBoxItem>
      </ListBox>
    </ListBoxContext.Provider>,
  );
  const root = tag(html, "list-box");

  expect(root).toContain('data-context-render="horizontal"');
  expect(root).toContain('data-orientation="horizontal"');
  expect(classes(root).slice(0, 2)).toEqual(["context-list", "hraness-list-box"]);
  expect(classes(root).at(-1)).toBe("consumer-list");
  expect(root).toContain("width:512px");
  expectInlineValues(root, stylex.props(testStyles.dynamicWidth("20rem")));
  expect(renderedStates.length).toBeGreaterThan(0);
  expect(styleStates).toContain("horizontal");
  for (const name of recipeClasses(stylex.props(listBoxStyles.horizontalChild))) {
    expect(classes(tag(html, "list-box-item"))).toContain(name);
  }
});

test("ListBox explicit props and slot opt-out retain local presentation", () => {
  const html = renderToStaticMarkup(
    <ListBoxContext.Provider value={{
      className: "context-list",
      orientation: "horizontal",
      render: (props) => <div {...props} data-context-render="yes" />,
      style: { width: 999 },
    }}>
      <ListBox
        aria-label="Local choices"
        orientation="vertical"
        render={(props, state) => <div {...props} data-local-render={state.orientation} />}
        slot={null}
        style={{ width: 123 }}
      >
        <ListBoxItem id="choice">Choice</ListBoxItem>
      </ListBox>
    </ListBoxContext.Provider>,
  );
  const root = tag(html, "list-box");
  expect(root).toContain('data-local-render="vertical"');
  expect(root).toContain('data-orientation="vertical"');
  expect(root).toContain("width:123px");
  expect(root).not.toContain("context-list");
  expect(root).not.toContain("data-context-render");
  expect(classes(tag(html, "list-box-item"))).toEqual([
    "hraness-list-box__item",
    ...recipeClasses(stylex.props(listBoxStyles.item)),
  ]);
});

test("caller recipes override root orientation and independent selected and disabled item recipes", () => {
  const html = renderToStaticMarkup(
    <ListBox
      aria-label="Styled choices"
      defaultSelectedKeys={["choice"]}
      disabledKeys={["choice"]}
      orientation="horizontal"
      selectionMode="multiple"
      xstyle={testStyles.root}
    >
      <ListBoxItem id="choice" xstyle={testStyles.item}>Choice</ListBoxItem>
    </ListBox>,
  );
  expect(classes(tag(html, "list-box"))).toEqual([
    "hraness-list-box",
    ...recipeClasses(stylex.props(listBoxStyles.root, listBoxStyles.horizontalRoot, testStyles.root)),
  ]);
  const item = tag(html, "list-box-item");
  expect(item).toContain("data-selected");
  expect(item).toContain("data-disabled");
  expect(classes(item)).toEqual([
    "hraness-list-box__item",
    ...recipeClasses(stylex.props(
      listBoxStyles.item,
      listBoxStyles.horizontalChild,
      listBoxStyles.itemSelected,
      listBoxStyles.itemDisabled,
      testStyles.item,
    )),
  ]);
});

test("item render props and native styles remain final on anchor and div options", () => {
  const childStates: string[] = [];
  const html = renderToStaticMarkup(
    <ListBox aria-label="Destinations" defaultSelectedKeys={["link"]} selectionMode="single">
      <ListBoxItem
        href="/guide"
        id="link"
        render={(props, state) => {
          expect(props.ref).toBeDefined();
          return "href" in props
            ? <a {...props} data-custom-option={String(state.isSelected)} />
            : <div {...props} data-custom-option={String(state.isSelected)} />;
        }}
        style={(state) => ({
          ...state.defaultStyle,
          opacity: state.isSelected ? 0.9 : 0.7,
          width: 111,
        })}
        textValue="Guide"
        xstyle={[testStyles.item, testStyles.dynamicWidth("8rem")]}
      >
        {(state) => {
          childStates.push(String(state.isSelected));
          return <span>{state.isSelected ? "Selected guide" : "Guide"}</span>;
        }}
      </ListBoxItem>
      <ListBoxItem id="plain" render={(props) => "href" in props
        ? <a {...props} data-custom-option="plain" />
        : <div {...props} data-custom-option="plain" />}>
        Plain
      </ListBoxItem>
      <ListBoxItem href="/reference" id="reference">Reference</ListBoxItem>
    </ListBox>,
  );
  const items = tags(html, "list-box-item");
  const anchor = items[0] ?? "";
  expect(anchor).toStartWith("<a");
  expect(anchor).toContain('href="/guide"');
  expect(anchor).toContain('data-custom-option="true"');
  expect(anchor).toContain("width:111px");
  expect(anchor).toContain("opacity:0.9");
  expectInlineValues(anchor, stylex.props(testStyles.dynamicWidth("8rem")));
  expect(html).toContain("Selected guide");
  expect(childStates).toContain("true");
  expect(items[1]).toStartWith("<div");
  expect(items[1]).toContain('data-custom-option="plain"');
  expect(items[2]).toStartWith("<a");
  expect(items[2]).toContain('href="/reference"');
});

test("an empty item href preserves the non-navigating div element", () => {
  const html = renderToStaticMarkup(
    <ListBox aria-label="Optional destinations">
      <ListBoxItem href="" id="empty">No destination</ListBoxItem>
      <ListBoxItem id="absent">No href</ListBoxItem>
    </ListBox>,
  );
  const items = tags(html, "list-box-item");
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item).toStartWith("<div");
    expect(item).toContain('role="option"');
  }
  expect(html).not.toContain("<a ");
});

test("section and header overrides preserve custom rendering and nested item layout", () => {
  const html = renderToStaticMarkup(
    <ListBox aria-label="Groups" orientation="horizontal">
      <ListBoxSection
        headerXstyle={[testStyles.header, testStyles.dynamicWidth("9rem")]}
        render={(props, state) => {
          expect(state).toBeUndefined();
          expect(props.ref).toBeDefined();
          return <section {...props} data-custom-section="yes" />;
        }}
        style={{ display: "grid", width: 222 }}
        title="Options"
        xstyle={[testStyles.section, testStyles.dynamicWidth("10rem")]}
      >
        <ListBoxItem id="choice">Choice</ListBoxItem>
      </ListBoxSection>
    </ListBox>,
  );
  const section = tag(html, "list-box-section");
  const header = tag(html, "list-box-header");
  expect(section).toContain('role="group"');
  expect(section).toContain('data-custom-section="yes"');
  expect(section).toContain("display:grid");
  expect(section).toContain("width:222px");
  expectInlineValues(section, stylex.props(testStyles.dynamicWidth("10rem")));
  expect(classes(section)).toEqual([
    "hraness-list-box__section",
    ...recipeClasses(stylex.props(
      listBoxStyles.section,
      listBoxStyles.horizontalChild,
      testStyles.section,
      testStyles.dynamicWidth("10rem"),
    )),
  ]);
  expect(classes(header)).toEqual([
    "hraness-list-box__header",
    ...recipeClasses(stylex.props(listBoxStyles.header, testStyles.header, testStyles.dynamicWidth("9rem"))),
  ]);
  expectInlineValues(header, stylex.props(testStyles.dynamicWidth("9rem")));
  expect(classes(tag(html, "list-box-item"))).toEqual([
    "hraness-list-box__item",
    ...recipeClasses(stylex.props(listBoxStyles.item)),
  ]);
});

const sectionTitles: ReactNode[] = [undefined, null, ""];

test.each(sectionTitles)(
  "section header presence preserves the title boundary for %p",
  (title) => {
    const html = renderToStaticMarkup(
      <ListBox aria-label="Title variants">
        <ListBoxSection aria-label="Group" title={title}>
          <ListBoxItem id="choice">Choice</ListBoxItem>
        </ListBoxSection>
      </ListBox>,
    );
    expect(tags(html, "list-box-header")).toHaveLength(title === undefined ? 0 : 1);
  },
);

test("ListBox empty-state renderer retains state and creates no wrapper outside the list", () => {
  const html = renderToStaticMarkup(
    <ListBox
      aria-label="Empty choices"
      items={[] as readonly { id: string }[]}
      renderEmptyState={(state) => <span data-empty-state={String(state.isEmpty)}>No choices</span>}
      style={(state) => ({ opacity: state.isEmpty ? 0.8 : 1 })}
    >
      {(item) => <ListBoxItem id={item.id}>{item.id}</ListBoxItem>}
    </ListBox>,
  );
  const divs = html.match(/<div\b[^>]*>/gu) ?? [];
  expect(divs[0]).toBe(tag(html, "list-box"));
  expect(divs).toHaveLength(2);
  expect(html).toContain('data-empty-state="true"');
  expect(tag(html, "list-box")).toContain("opacity:0.8");
  expect(tags(html, "list-box-item")).toHaveLength(0);
});

test("ListBox preserves inherited native styles when no local style is supplied", () => {
  const nativeStyle = { width: 317, "--consumer-color": "tomato" } as CSSProperties;
  const html = renderToStaticMarkup(
    <ListBoxContext.Provider value={{ style: nativeStyle }}>
      <ListBox aria-label="Inherited styles" xstyle={testStyles.dynamicWidth("12rem")}>
        <ListBoxItem id="choice">Choice</ListBoxItem>
      </ListBox>
    </ListBoxContext.Provider>,
  );
  const root = tag(html, "list-box");
  expect(root).toContain("width:317px");
  expect(root).toContain("--consumer-color:tomato");
  expectInlineValues(root, stylex.props(testStyles.dynamicWidth("12rem")));
});
