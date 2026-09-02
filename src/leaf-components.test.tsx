import { expect, test } from "bun:test";
import {
  createRef,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type Ref,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmptyState,
  InlineAlert,
  KeyHint,
  type KeyHintProps,
  PageIntro,
  SettingsCard,
} from "./content.js";
import {
  Avatar,
  avatarInitials,
  DataTable,
  type DataTableColumn,
} from "./data-display.js";
import {
  Progress,
  Skeleton,
  type SkeletonProps,
  Spinner,
  type SpinnerProps,
  normalizeProgress,
} from "./feedback.js";
import {
  ListBox,
  ListBoxItem,
  ListBoxSection,
} from "./list-box.js";
import {
  Breadcrumbs,
  Pagination,
  paginationRange,
} from "./navigation.js";
import { SkipLink, type SkipLinkProps } from "./skip-link.js";
import {
  ThemedSurface,
  ViewportFrame,
  WrappingRow,
} from "./surfaces.js";
import { Toolbar } from "./toolbar.js";

type SkipLinkTestElement = ReactElement<{
  onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}>;

function renderSkipLinkForTest(props: SkipLinkProps): SkipLinkTestElement {
  const component = SkipLink as unknown as Readonly<{
    render: (
      props: SkipLinkProps,
      ref: Ref<HTMLAnchorElement>,
    ) => SkipLinkTestElement;
  }>;
  return component.render(props, null);
}

const keyHintTestStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  override: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-lg)",
    color: "var(--ui-secondary-foreground)",
    fontFamily: "var(--ui-font-heading)",
    fontSize: "var(--text-body)",
    justifyContent: "flex-start",
    minHeight: "2rem",
    minWidth: "2rem",
    paddingInline: "var(--space-2)",
  },
});

const feedbackTestStyles = stylex.create({
  skeletonMinimum: (minimum: string) => ({ minHeight: minimum }),
  skeletonOverride: {
    backgroundColor: "var(--ui-primary)",
    borderRadius: "var(--radius-round)",
  },
  spinnerOverride: {
    display: "inline-flex",
    fontSize: "2rem",
  },
  spinnerWidth: (width: string) => ({ width }),
});

const typedSpinner: SpinnerProps = {
  label: "Loading preferences",
  xstyle: feedbackTestStyles.spinnerOverride,
};
const typedSkeleton: SkeletonProps = {
  isText: true,
  xstyle: feedbackTestStyles.skeletonOverride,
};
// @ts-expect-error Feedback primitives accept compiled StyleX recipes rather than raw CSS objects.
const rawSpinnerXstyle: SpinnerProps = { xstyle: { display: "flex" } };
// @ts-expect-error Feedback primitives accept compiled StyleX recipes rather than raw CSS objects.
const rawSkeletonXstyle: SkeletonProps = { xstyle: { minHeight: "2rem" } };
void [rawSkeletonXstyle, rawSpinnerXstyle, typedSkeleton, typedSpinner];

type KeyHintTestElement = ReactElement<{
  ref: Ref<HTMLElement>;
}>;

function renderKeyHintForTest(
  props: KeyHintProps,
  ref: Ref<HTMLElement>,
): KeyHintTestElement {
  const component = KeyHint as unknown as Readonly<{
    render: (props: KeyHintProps, ref: Ref<HTMLElement>) => KeyHintTestElement;
  }>;
  return component.render(props, ref);
}

test("normalizeProgress bounds non-finite and out-of-range values", () => {
  expect(normalizeProgress(40, 80)).toEqual({
    maximum: 80,
    percent: 50,
    value: 40,
  });
  expect(normalizeProgress(-10, 80).value).toBe(0);
  expect(normalizeProgress(90, 80).value).toBe(80);
  expect(normalizeProgress(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
    maximum: 100,
    percent: 0,
    value: 0,
  });
});

test("feedback components expose decorative and labelled semantics", () => {
  const html = renderToStaticMarkup(
    <>
      <Spinner />
      <Spinner label="Saving changes" size="small" />
      <Skeleton height="2rem" isText width="12rem" />
      <Progress label="Upload" max={8} showValue value={4} />
    </>,
  );

  expect(html).toContain('data-slot="spinner"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain("Saving changes");
  expect(html).toContain('data-slot="skeleton"');
  expect(html).toContain('height:2rem');
  expect(html).toContain('width:12rem');
  expect(html).toContain('<progress');
  expect(html).toContain('max="8"');
  expect(html).toContain('value="4"');
  expect(html).toContain("50%");
  expect(html).toMatch(/<span[^>]+id="([^"]+)-label"[^>]*>Upload<\/span>/u);
  expect(html).toMatch(/<progress[^>]+aria-labelledby="[^"]+-label"/u);
});

test("Spinner and Skeleton compile their recipes before caller presentation", async () => {
  const spinner = renderToStaticMarkup(
    <Spinner
      className="consumer-spinner"
      label="Checking settings"
      size="small"
      style={{ color: "rgb(1, 2, 3)", width: "3rem" }}
      xstyle={[
        feedbackTestStyles.spinnerOverride,
        feedbackTestStyles.spinnerWidth("2rem"),
      ]}
    />,
  );
  const skeleton = renderToStaticMarkup(
    <Skeleton
      className="consumer-skeleton"
      height="4rem"
      isText
      style={{ height: "2rem", minHeight: "3rem", width: "5rem" }}
      width="7rem"
      xstyle={[
        feedbackTestStyles.skeletonOverride,
        feedbackTestStyles.skeletonMinimum("2rem"),
      ]}
    />,
  );
  const spinnerTag = spinner.slice(0, spinner.indexOf(">") + 1);
  const skeletonTag = skeleton.slice(0, skeleton.indexOf(">") + 1);
  const spinnerClasses = spinnerTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
  const skeletonClasses = skeletonTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
  const [components, source] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./feedback.stylex.ts", import.meta.url)).text(),
  ]);

  expect(spinnerClasses[0]).toBe("hraness-spinner");
  expect(spinnerClasses.at(-1)).toBe("consumer-spinner");
  expect(spinnerClasses.slice(1, -1).some((name) => name.startsWith("x"))).toBe(true);
  expect(spinnerTag).toMatch(/style="--[^:]+:2rem;color:rgb\(1, 2, 3\);width:3rem"/u);
  expect(skeletonClasses[0]).toBe("hraness-skeleton");
  expect(skeletonClasses.at(-1)).toBe("consumer-skeleton");
  expect(skeletonClasses.slice(1, -1).some((name) => name.startsWith("x"))).toBe(true);
  expect(skeletonTag).toMatch(/style="--[^:]+:2rem;height:4rem;min-height:3rem;width:7rem"/u);
  expect(components).not.toMatch(/\.hraness-(?:spinner|skeleton)(?![A-Za-z0-9_-])/u);
  expect(components.match(/@keyframes hraness-spin/gu)).toHaveLength(1);
  expect(components.match(/@keyframes hraness-skeleton/gu)).toHaveLength(1);
  expect(source).toContain('default: "700ms"');
  expect(source).toContain('default: "1.4s"');
  expect(source).toContain('const forcedColors = "@media(forced-colors: active)"');
  expect(source).toContain('const reducedMotion = "@media(prefers-reduced-motion: reduce)"');
  expect(source).toContain('[forcedColors]: "Canvas"');
  expect(source).toContain('[reducedMotion]: "none"');
});

test("content primitives preserve heading levels, slots, and live-region intent", () => {
  const html = renderToStaticMarkup(
    <>
      <PageIntro
        actions={<button type="button">Create</button>}
        description="Local applications"
        eyebrow="Workspace"
        title="Projects"
        titleAs="h3"
      />
      <EmptyState
        action={<a href="/new">New project</a>}
        description="Create the first project."
        icon="∅"
        title="No projects"
      />
      <InlineAlert isLive title="Save failed" tone="danger">
        Try again.
      </InlineAlert>
      <SettingsCard
        actions={<button type="button">Edit</button>}
        description="Controls application access."
        shape="rectangular"
        title="Permissions"
      >
        Members
      </SettingsCard>
      <KeyHint>⌘K</KeyHint>
    </>,
  );

  expect(html).toContain('<h3 class="hraness-page-intro__title"');
  expect(html).toContain('data-slot="empty-state"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-live="assertive"');
  expect(html).toContain('data-shape="rectangular"');
  expect(html).toContain('data-slot="key-hint"');
});

test("KeyHint preserves its native element, ref, attributes, class order, and caller style precedence", () => {
  const ref = createRef<HTMLElement>();
  const element = renderKeyHintForTest({ children: "K" }, ref);
  const html = renderToStaticMarkup(
    <KeyHint
      aria-label="Command K"
      className="consumer-key-hint"
      data-product="writer"
      ref={ref}
      style={{ width: "3rem" }}
      title="Open command menu"
      xstyle={[
        keyHintTestStyles.override,
        keyHintTestStyles.dynamicWidth("2rem"),
      ]}
    >
      ⌘K
    </KeyHint>,
  );
  const openingTag = html.slice(0, html.indexOf(">") + 1);
  const classes = openingTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

  expect(element.type).toBe("kbd");
  expect(element.props.ref).toBe(ref);
  expect(openingTag).toStartWith("<kbd");
  expect(openingTag).toContain('aria-label="Command K"');
  expect(openingTag).toContain('data-product="writer"');
  expect(openingTag).toContain('data-slot="key-hint"');
  expect(openingTag).toContain('title="Open command menu"');
  expect(classes[0]).toBe("hraness-key-hint");
  expect(classes.at(-1)).toBe("consumer-key-hint");
  expect(classes.length).toBeGreaterThan(2);
  expect(openingTag).toMatch(/style="--[^:]+:2rem;width:3rem"/u);
  expect(html).toEndWith("⌘K</kbd>");
  expect(KeyHint.displayName).toBe("KeyHint");
});

test("Avatar has deterministic fallbacks and optional accessible copy", () => {
  expect(avatarInitials("Ada Lovelace")).toBe("AL");
  expect(avatarInitials("  Prince  ")).toBe("P");
  expect(avatarInitials("ß")).toBe("S");
  expect(avatarInitials("   ")).toBe("?");

  const fallback = renderToStaticMarkup(
    <Avatar alt="Ada Lovelace avatar" name="Ada Lovelace" />,
  );
  const image = renderToStaticMarkup(
    <Avatar alt="Grace Hopper" name="Grace Hopper" src="/grace.png" />,
  );

  expect(fallback).toContain('role="img"');
  expect(fallback).toContain('aria-label="Ada Lovelace avatar"');
  expect(fallback).toContain(">AL</span>");
  expect(image).toContain('<img alt="Grace Hopper"');
  expect(image).toContain('src="/grace.png"');
});

test("DataTable renders typed rows and a semantic empty row", () => {
  type Row = Readonly<{ id: string; name: string; runs: number }>;
  const columns: readonly [DataTableColumn<Row>, ...DataTableColumn<Row>[]] = [
    {
      cell: (row) => row.name,
      header: "Project",
      id: "name",
    },
    {
      align: "end",
      cell: (row) => row.runs,
      header: "Runs",
      id: "runs",
    },
  ];
  const filled = renderToStaticMarkup(
    <DataTable
      caption="Recent projects"
      columns={columns}
      getRowId={(row) => row.id}
      rows={[{ id: "ocean", name: "Ocean", runs: 3 }]}
    />,
  );
  const empty = renderToStaticMarkup(
    <DataTable
      columns={columns}
      empty="No projects yet."
      getRowId={(row) => row.id}
      rows={[]}
    />,
  );

  expect(filled).toContain('<caption data-slot="data-table-caption">');
  expect(filled).toContain('<th data-align="start"');
  expect(filled).toContain('scope="col"');
  expect(filled).toContain('<td data-align="end"');
  expect(filled).toContain("Ocean");
  expect(empty).toContain('colSpan="2"');
  expect(empty).toContain("No projects yet.");
});

test("paginationRange is bounded, deterministic, and gap-aware", () => {
  expect(paginationRange(5, 10, 1)).toEqual([
    1,
    "ellipsis",
    4,
    5,
    6,
    "ellipsis",
    10,
  ]);
  expect(paginationRange(-1, 0, -5)).toEqual([1]);
  expect(paginationRange(
    Number.POSITIVE_INFINITY,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  )).toEqual([1]);
  expect(paginationRange(5, Number.MAX_VALUE, Number.MAX_VALUE).length)
    .toBeLessThanOrEqual(204);
});

test("navigation marks current locations and finite page boundaries", () => {
  const html = renderToStaticMarkup(
    <>
      <Breadcrumbs
        aria-label="Breadcrumb"
        items={[
          { href: "/", id: "home", label: "Home" },
          { href: "/projects", id: "projects", label: "Projects" },
        ]}
      />
      <Pagination
        currentPage={2}
        hrefForPage={(page) => "/projects?page=" + String(page)}
        totalPages={3}
      />
    </>,
  );

  expect(html).toContain('aria-label="Breadcrumb"');
  expect(html).toContain('<a data-slot="breadcrumbs-link" href="/">Home</a>');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('href="/projects?page=1" rel="prev"');
  expect(html).toContain('href="/projects?page=3" rel="next"');
});

test("surface and skip-link primitives preserve chosen native elements", () => {
  const html = renderToStaticMarkup(
    <>
      <SkipLink href="#content" />
      <ViewportFrame as="main" id="content" tabIndex={-1} />
      <WrappingRow as="nav" aria-label="Project actions" />
      <ThemedSurface as="article" shape="rectangular" tone="inverse" />
    </>,
  );

  expect(html).toContain('href="#content"');
  expect(html).toContain('data-slot="skip-link"');
  expect(html).toContain('<main id="content"');
  expect(html).toContain('<nav aria-label="Project actions"');
  expect(html).toMatch(/<article class="hraness-themed-surface [^"]+"/u);
  expect(html).toContain('data-shape="rectangular"');
  expect(html).toContain('data-slot="themed-surface"');
  expect(html).toContain('data-tone="inverse"');
});

test("SkipLink temporarily focuses ordinary targets and preserves failed navigation", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const attributes = new Map<string, string>();
  let blurListener: EventListener | undefined;
  let scrollCount = 0;
  const documentState: { activeElement: Element | null } = { activeElement: null };
  const target = {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (type === "blur" && typeof listener === "function") blurListener = listener;
    },
    focus: () => {
      if (attributes.get("tabindex") === "-1") {
        documentState.activeElement = target;
      }
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => attributes.delete(name),
    scrollIntoView: () => {
      scrollCount += 1;
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  } as unknown as HTMLElement;
  const failedTarget = {
    focus: () => undefined,
    getAttribute: () => null,
    hasAttribute: () => false,
    removeAttribute: () => undefined,
    setAttribute: () => undefined,
  } as unknown as HTMLElement;
  const fakeDocument = {
    get activeElement() {
      return documentState.activeElement;
    },
    getElementById: (id: string) => (
      id === "content" ? target : id === "unfocusable" ? failedTarget : null
    ),
  } as unknown as Document;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  try {
    let successfulDefaultPrevented = false;
    renderSkipLinkForTest({ href: "#content" }).props.onClick({
      altKey: false,
      button: 0,
      ctrlKey: false,
      defaultPrevented: false,
      metaKey: false,
      preventDefault: () => {
        successfulDefaultPrevented = true;
      },
      shiftKey: false,
    } as unknown as ReactMouseEvent<HTMLAnchorElement>);

    expect(successfulDefaultPrevented).toBe(true);
    expect(documentState.activeElement).toBe(target);
    expect(attributes.get("tabindex")).toBe("-1");
    expect(scrollCount).toBe(1);
    expect(blurListener).toBeDefined();
    blurListener?.(new Event("blur"));
    expect(attributes.has("tabindex")).toBe(false);

    let failedDefaultPrevented = false;
    renderSkipLinkForTest({ href: "#unfocusable" }).props.onClick({
      altKey: false,
      button: 0,
      ctrlKey: false,
      defaultPrevented: false,
      metaKey: false,
      preventDefault: () => {
        failedDefaultPrevented = true;
      },
      shiftKey: false,
    } as unknown as ReactMouseEvent<HTMLAnchorElement>);
    expect(failedDefaultPrevented).toBe(false);
  } finally {
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", originalDocument);
    }
  }
});

test("React Aria collection leaves retain names and option semantics", () => {
  const html = renderToStaticMarkup(
    <>
      <Toolbar aria-label="Editor actions">
        <button type="button">Save</button>
      </Toolbar>
      <ListBox aria-label="Appearance" selectionMode="single">
        <ListBoxSection title="Available">
          <ListBoxItem id="calm" textValue="Calm">Calm</ListBoxItem>
          <ListBoxItem id="compact" textValue="Compact">
            Compact
          </ListBoxItem>
        </ListBoxSection>
      </ListBox>
    </>,
  );

  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Editor actions"');
  expect(html).toContain('role="listbox"');
  expect(html).toContain('aria-label="Appearance"');
  expect(html).toContain('role="option"');
  expect(html).toContain('data-slot="list-box-section"');
  expect(html).toContain("Available");
});
