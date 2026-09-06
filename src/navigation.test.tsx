import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import * as stylex from "@stylexjs/stylex";
import { createRef, type ReactElement, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Breadcrumbs,
  type BreadcrumbsProps,
  Pagination,
  type PaginationProps,
} from "./navigation.js";
import { navigationStyles } from "./navigation.stylex.js";

const items = [
  { href: "/", id: "home", label: "Home" },
  { id: "library", label: "Library" },
  { href: "/library/current", id: "current", label: "Current project" },
] as const;

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  rootOverride: {
    alignItems: "start",
    display: "grid",
    justifyContent: "end",
    width: "14rem",
  },
});

const typedBreadcrumbsProps: BreadcrumbsProps = {
  items,
  xstyle: testStyles.rootOverride,
};
const typedPaginationProps: PaginationProps = {
  currentPage: 1,
  hrefForPage: (page) => `/projects?page=${String(page)}`,
  totalPages: 2,
  xstyle: testStyles.rootOverride,
};
void typedBreadcrumbsProps;
void typedPaginationProps;

const rawStyle = { display: "grid" };
const invalidBreadcrumbsProps: BreadcrumbsProps = {
  items,
  // @ts-expect-error Raw style objects are not compiled StyleX values.
  xstyle: rawStyle,
};
const invalidPaginationProps: PaginationProps = {
  currentPage: 1,
  hrefForPage: (page) => String(page),
  totalPages: 2,
  // @ts-expect-error Raw style objects are not compiled StyleX values.
  xstyle: rawStyle,
};
const invalidEmptyBreadcrumbs: BreadcrumbsProps = {
  // @ts-expect-error Breadcrumbs require a nonempty tuple.
  items: [],
};
void invalidBreadcrumbsProps;
void invalidPaginationProps;
void invalidEmptyBreadcrumbs;

function classTokens(presentation: ReturnType<typeof stylex.props>): string[] {
  return presentation.className?.split(" ") ?? [];
}

function tagClasses(tag: string): string[] {
  return tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
}

function renderForwardRefForTest<Props>(
  component: unknown,
  props: Props,
  ref: Ref<HTMLElement>,
): ReactElement<{ ref: Ref<HTMLElement> }> {
  return (component as Readonly<{
    render: (
      properties: Props,
      forwardedRef: Ref<HTMLElement>,
    ) => ReactElement<{ ref: Ref<HTMLElement> }>;
  }>).render(props, ref);
}

test("Breadcrumbs preserve native ancestry, current-page semantics, and exact recipes", () => {
  const html = renderToStaticMarkup(
    <Breadcrumbs data-product="library" items={items} />,
  );
  const nav = html.match(/<nav[^>]*data-slot="breadcrumbs"[^>]*>/u)?.[0] ?? "";
  const list = html.match(/<ol[^>]*data-slot="breadcrumbs-list"[^>]*>/u)?.[0] ?? "";
  const itemTags = html.match(/<li[^>]*data-slot="breadcrumbs-item"[^>]*>/gu) ?? [];
  const current = html.match(/<span[^>]*data-slot="breadcrumbs-current"[^>]*>/u)?.[0] ?? "";
  const separatorClasses = classTokens(stylex.props(navigationStyles.breadcrumbSeparator));
  const currentItemClasses = classTokens(stylex.props(navigationStyles.breadcrumbCurrentItem));
  const currentClasses = classTokens(stylex.props(navigationStyles.breadcrumbCurrent));

  expect(nav).toContain('aria-label="Breadcrumbs"');
  expect(nav).toContain('data-product="library"');
  expect(list).not.toBe("");
  expect(itemTags).toHaveLength(3);
  for (const [index, tag] of itemTags.entries()) {
    const expected = classTokens(stylex.props(
      navigationStyles.breadcrumbItem,
      index > 0 && navigationStyles.breadcrumbSeparator,
      index === itemTags.length - 1 && navigationStyles.breadcrumbCurrentItem,
    ));
    expect(tagClasses(tag).sort()).toEqual(expected.sort());
  }
  for (const token of separatorClasses) {
    expect(tagClasses(itemTags[0] ?? "")).not.toContain(token);
    expect(tagClasses(itemTags[1] ?? "")).toContain(token);
    expect(tagClasses(itemTags[2] ?? "")).toContain(token);
  }
  for (const token of currentItemClasses) {
    expect(tagClasses(itemTags[2] ?? "")).toContain(token);
  }
  for (const token of currentClasses) expect(tagClasses(current)).toContain(token);
  expect(html).toContain('<a data-slot="breadcrumbs-link" href="/">Home</a>');
  expect(html).toContain('<span data-slot="breadcrumbs-label">Library</span>');
  expect(current).toContain('aria-current="page"');
  expect(html).not.toContain('href="/library/current"');
});

test("Pagination preserves links, finite gaps, and disabled native boundaries", () => {
  const middle = renderToStaticMarkup(
    <Pagination
      aria-label="Project pages"
      currentPage={5}
      hrefForPage={(page) => `/projects?page=${String(page)}`}
      totalPages={10}
    />,
  );
  const edge = renderToStaticMarkup(
    <Pagination
      currentPage={1}
      hrefForPage={(page) => `/projects?page=${String(page)}`}
      totalPages={1}
    />,
  );
  const current = middle.match(/<a[^>]*aria-current="page"[^>]*>/u)?.[0] ?? "";
  const currentTokens = classTokens(stylex.props(
    navigationStyles.paginationLink,
    navigationStyles.paginationCurrent,
  ));
  const disabledTags = edge.match(/<span[^>]*aria-disabled="true"[^>]*>/gu) ?? [];
  const disabledTokens = classTokens(stylex.props(
    navigationStyles.paginationBoundary,
    navigationStyles.paginationDisabled,
  ));

  expect(middle).toContain('aria-label="Project pages"');
  expect(middle).toContain('href="/projects?page=4" rel="prev"');
  expect(middle).toContain('href="/projects?page=6" rel="next"');
  expect(middle.match(/data-slot="pagination-ellipsis"/gu)).toHaveLength(2);
  expect(current).toContain('href="/projects?page=5"');
  for (const token of currentTokens) expect(tagClasses(current)).toContain(token);
  expect(disabledTags).toHaveLength(2);
  for (const tag of disabledTags) {
    for (const token of disabledTokens) expect(tagClasses(tag)).toContain(token);
  }
  expect(edge).not.toContain("rel=\"prev\"");
  expect(edge).not.toContain("rel=\"next\"");
});

test("navigation roots compose semantic, generated, and caller presentation in order", () => {
  const breadcrumbRef = createRef<HTMLElement>();
  const paginationRef = createRef<HTMLElement>();
  const breadcrumbElement = renderForwardRefForTest(
    Breadcrumbs,
    { items },
    breadcrumbRef,
  );
  const paginationElement = renderForwardRefForTest(
    Pagination,
    {
      currentPage: 1,
      hrefForPage: (page: number) => String(page),
      totalPages: 1,
    },
    paginationRef,
  );
  const breadcrumbs = renderToStaticMarkup(
    <Breadcrumbs
      className="consumer-breadcrumbs"
      items={items}
      style={{ width: "15rem" }}
      xstyle={[testStyles.rootOverride, testStyles.dynamicWidth("14rem")]}
    />,
  );
  const pagination = renderToStaticMarkup(
    <Pagination
      className="consumer-pagination"
      currentPage={1}
      hrefForPage={(page) => String(page)}
      style={{ width: "15rem" }}
      totalPages={1}
      xstyle={[testStyles.rootOverride, testStyles.dynamicWidth("14rem")]}
    />,
  );

  for (const [html, semanticClass, callerClass] of [
    [breadcrumbs, "hraness-breadcrumbs", "consumer-breadcrumbs"],
    [pagination, "hraness-pagination", "consumer-pagination"],
  ] as const) {
    const root = html.slice(0, html.indexOf(">") + 1);
    const classes = tagClasses(root);
    expect(classes[0]).toBe(semanticClass);
    expect(classes.at(-1)).toBe(callerClass);
    expect(classes.length).toBeGreaterThan(2);
    expect(root).toMatch(/style="--[^:]+:14rem;width:15rem"/u);
  }

  expect(breadcrumbElement.type).toBe("nav");
  expect(breadcrumbElement.props.ref).toBe(breadcrumbRef);
  expect(paginationElement.type).toBe("nav");
  expect(paginationElement.props.ref).toBe(paginationRef);
});

test("navigation recipe ownership is complete and leaves no legacy selector", async () => {
  expect(Object.keys(navigationStyles).sort()).toEqual([
    "breadcrumbCurrent",
    "breadcrumbCurrentItem",
    "breadcrumbItem",
    "breadcrumbList",
    "breadcrumbRoot",
    "breadcrumbSeparator",
    "paginationBoundary",
    "paginationCurrent",
    "paginationDisabled",
    "paginationEllipsis",
    "paginationLink",
    "paginationList",
    "paginationRoot",
  ]);

  const [component, legacy, recipes] = await Promise.all([
    readFile(new URL("./navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("./components.css", import.meta.url), "utf8"),
    readFile(new URL("./navigation.stylex.ts", import.meta.url), "utf8"),
  ]);
  expect(component).not.toContain('"use client"');
  expect(recipes).toContain('"::before"');
  expect(recipes).toContain('const coarsePointer = "@media(pointer: coarse)"');
  expect(recipes).toContain('const compactViewport = "@media(max-width: 40rem)"');
  expect(legacy).not.toMatch(/\.hraness-(?:breadcrumbs|pagination)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u);
  expect(legacy).toContain("--hraness-pagination-coarse-min: var(--interactive-target-min);");
});
