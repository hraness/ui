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
  type EmptyStateProps,
  InlineAlert,
  type InlineAlertProps,
  KeyHint,
  type KeyHintProps,
  PageIntro,
  type PageIntroProps,
  SettingsCard,
  type SettingsCardProps,
} from "./content.js";
import { contentStyles } from "./content.stylex.js";
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
  href: `#${string}`;
  onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  ref: Ref<HTMLAnchorElement>;
}>;

function renderForwardRefForTest<Props, Element>(
  component: unknown,
  props: Props,
  ref: Ref<Element>,
): ReactElement<{ ref: Ref<Element> }> {
  return (component as Readonly<{
    render: (
      props: Props,
      ref: Ref<Element>,
    ) => ReactElement<{ ref: Ref<Element> }>;
  }>).render(props, ref);
}

function renderSkipLinkForTest(
  props: SkipLinkProps,
  ref: Ref<HTMLAnchorElement> = null,
): SkipLinkTestElement {
  const component = SkipLink as unknown as Readonly<{
    render: (
      props: SkipLinkProps,
      ref: Ref<HTMLAnchorElement>,
    ) => SkipLinkTestElement;
  }>;
  return component.render(props, ref);
}

const skipLinkTestStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  override: {
    backgroundColor: "var(--ui-secondary)",
    borderRadius: "var(--radius-lg)",
    ":focus": {
      transform: "translateY(0.5rem)",
    },
  },
});

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

const contentTestStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  override: {
    alignItems: "stretch",
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-secondary-foreground)",
    display: "flex",
    gap: "var(--space-2)",
    maxWidth: "44rem",
    minHeight: "13rem",
    overflow: "visible",
    padding: "var(--space-3)",
  },
});

const typedPageIntro: PageIntroProps = {
  title: "Projects",
  xstyle: contentTestStyles.override,
};
const typedEmptyState: EmptyStateProps = {
  title: "No projects",
  xstyle: contentTestStyles.override,
};
const typedInlineAlert: InlineAlertProps = {
  children: "Saved",
  xstyle: contentTestStyles.override,
};
const typedSettingsCard: SettingsCardProps = {
  title: "Permissions",
  xstyle: contentTestStyles.override,
};
const rawPageIntroXstyle: PageIntroProps = {
  title: "Projects",
  // @ts-expect-error Content roots accept compiled StyleX recipes rather than raw CSS objects.
  xstyle: { display: "flex" },
};
const rawEmptyStateXstyle: EmptyStateProps = {
  title: "Empty",
  // @ts-expect-error Content roots accept compiled StyleX recipes rather than raw CSS objects.
  xstyle: { display: "grid" },
};
const rawInlineAlertXstyle: InlineAlertProps = {
  children: "Saved",
  // @ts-expect-error Content roots accept compiled StyleX recipes rather than raw CSS objects.
  xstyle: { color: "red" },
};
const rawSettingsCardXstyle: SettingsCardProps = {
  title: "Settings",
  // @ts-expect-error Content roots accept compiled StyleX recipes rather than raw CSS objects.
  xstyle: { padding: 0 },
};
void typedPageIntro;
void typedEmptyState;
void typedInlineAlert;
void typedSettingsCard;
void rawPageIntroXstyle;
void rawEmptyStateXstyle;
void rawInlineAlertXstyle;
void rawSettingsCardXstyle;

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

  expect(html).toContain('<h3 class="hraness-page-intro__title ');
  expect(html).toContain('data-slot="empty-state"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-live="assertive"');
  expect(html).toContain('data-shape="rectangular"');
  expect(html).toContain('data-slot="key-hint"');
});

test("content roots compose base, finite, and caller StyleX recipes before native styles", () => {
  const callerXstyle = [
    contentTestStyles.override,
    contentTestStyles.dynamicWidth("2rem"),
  ];
  const html = renderToStaticMarkup(
    <>
      <PageIntro
        actions={<button type="button">Create</button>}
        className="consumer-page-intro"
        data-product="page"
        description="Local applications"
        eyebrow="Workspace"
        style={{ color: "rgb(1, 2, 3)", width: "3rem" }}
        title="Projects"
        xstyle={callerXstyle}
      />
      <EmptyState
        action={<a href="/new">New project</a>}
        className="consumer-empty-state"
        data-product="empty"
        description="Create the first project."
        icon="∅"
        style={{ color: "rgb(1, 2, 3)", width: "3rem" }}
        title="No projects"
        xstyle={callerXstyle}
      />
      <InlineAlert
        className="consumer-inline-alert"
        data-product="alert"
        icon="!"
        style={{ color: "rgb(1, 2, 3)", width: "3rem" }}
        title="Saved"
        tone="success"
        xstyle={callerXstyle}
      >
        Your changes are ready.
      </InlineAlert>
      <SettingsCard
        actions={<button type="button">Edit</button>}
        className="consumer-settings-card"
        data-product="settings"
        description="Controls application access."
        shape="rectangular"
        style={{ color: "rgb(1, 2, 3)", width: "3rem" }}
        title="Permissions"
        xstyle={callerXstyle}
      >
        Members
      </SettingsCard>
    </>,
  );
  const callerClasses = stylex.props(
    contentTestStyles.override,
    contentTestStyles.dynamicWidth("2rem"),
  ).className?.split(" ") ?? [];
  const rootContracts = [
    {
      hook: "hraness-page-intro",
      slot: "page-intro",
    },
    {
      hook: "hraness-empty-state",
      slot: "empty-state",
    },
    {
      hook: "hraness-inline-alert",
      slot: "inline-alert",
    },
    {
      hook: "hraness-settings-card",
      slot: "settings-card",
    },
  ] as const;

  for (const { hook, slot } of rootContracts) {
    const tag = html.match(
      new RegExp(`<[^>]*data-slot="${slot}"[^>]*>`, "u"),
    )?.[0];
    expect(tag).toBeDefined();
    const classes = tag?.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

    expect(classes[0]).toBe(hook);
    expect(callerClasses.every((name) => classes.includes(name))).toBe(true);
    expect(
      callerClasses.every((name) => classes.indexOf(name) < classes.length - 1),
    ).toBe(true);
    expect(classes.at(-1)).toBe(`consumer-${slot}`);
    expect(tag).toMatch(/style="--[^:]+:2rem;color:rgb\(1, 2, 3\);width:3rem"/u);
  }

  for (const [slot, hook] of [
    ["page-intro-copy", "hraness-page-intro__copy"],
    ["page-intro-eyebrow", "hraness-page-intro__eyebrow"],
    ["page-intro-title", "hraness-page-intro__title"],
    ["page-intro-description", "hraness-page-intro__description"],
    ["page-intro-actions", "hraness-page-intro__actions"],
    ["empty-state-icon", "hraness-empty-state__icon"],
    ["empty-state-title", "hraness-empty-state__title"],
    ["empty-state-description", "hraness-empty-state__description"],
    ["empty-state-action", "hraness-empty-state__action"],
    ["inline-alert-icon", "hraness-inline-alert__icon"],
    ["inline-alert-content", "hraness-inline-alert__content"],
    ["inline-alert-title", "hraness-inline-alert__title"],
    ["inline-alert-body", "hraness-inline-alert__body"],
    ["settings-card-header", "hraness-settings-card__header"],
    ["settings-card-title", "hraness-settings-card__title"],
    ["settings-card-description", "hraness-settings-card__description"],
    ["settings-card-actions", "hraness-settings-card__actions"],
    ["settings-card-body", "hraness-settings-card__body"],
  ] as const) {
    const tag = html.match(
      new RegExp(`<[^>]*data-slot="${slot}"[^>]*>`, "u"),
    )?.[0];
    const classes = tag?.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

    expect(tag).toBeDefined();
    expect(classes[0]).toBe(hook);
    expect(classes.slice(1).some((name) => name.startsWith("x"))).toBe(true);
  }
});

test("content defaults, optional slots, and explicit live-region attributes remain semantic", () => {
  const defaults = renderToStaticMarkup(
    <>
      <PageIntro title="Projects" />
      <EmptyState title="No projects" />
      <InlineAlert>Saved.</InlineAlert>
      <SettingsCard title="Permissions">Members</SettingsCard>
    </>,
  );
  const explicitLiveRegion = renderToStaticMarkup(
    <InlineAlert aria-live="off" isLive role="note" tone="danger">
      A caller controls this announcement.
    </InlineAlert>,
  );

  expect(defaults).toContain('<h1 class="hraness-page-intro__title');
  expect(defaults).toContain('<h2 class="hraness-empty-state__title');
  expect(defaults).toContain('<h2 class="hraness-settings-card__title');
  expect(defaults).toContain('data-tone="info"');
  expect(defaults).toContain('data-shape="rounded"');
  expect(defaults).not.toContain('data-slot="page-intro-eyebrow"');
  expect(defaults).not.toContain('data-slot="page-intro-description"');
  expect(defaults).not.toContain('data-slot="page-intro-actions"');
  expect(defaults).not.toContain('data-slot="empty-state-icon"');
  expect(defaults).not.toContain('data-slot="empty-state-description"');
  expect(defaults).not.toContain('data-slot="empty-state-action"');
  expect(defaults).not.toContain('data-slot="inline-alert-title"');
  expect(defaults).not.toContain('data-slot="settings-card-description"');
  expect(defaults).not.toContain('data-slot="settings-card-actions"');
  expect(defaults).not.toContain("aria-live=");
  expect(defaults).not.toContain(" role=");
  expect(explicitLiveRegion).toContain('aria-live="off"');
  expect(explicitLiveRegion).toContain('role="note"');
  expect(explicitLiveRegion).not.toContain('role="alert"');
  expect(explicitLiveRegion).not.toContain('aria-live="assertive"');
});

test("InlineAlert maps every finite tone to its compiled recipe", () => {
  const toneContracts = [
    [
      "danger",
      stylex.props(
        contentStyles.inlineAlertRoot,
        contentStyles.inlineAlertDanger,
      ).className,
    ],
    [
      "info",
      stylex.props(
        contentStyles.inlineAlertRoot,
        contentStyles.inlineAlertInfo,
      ).className,
    ],
    [
      "success",
      stylex.props(
        contentStyles.inlineAlertRoot,
        contentStyles.inlineAlertSuccess,
      ).className,
    ],
    [
      "warning",
      stylex.props(
        contentStyles.inlineAlertRoot,
        contentStyles.inlineAlertWarning,
      ).className,
    ],
  ] as const;

  for (const [tone, expectedClassName] of toneContracts) {
    const html = renderToStaticMarkup(
      <InlineAlert tone={tone}>Message</InlineAlert>,
    );
    const tag = html.slice(0, html.indexOf(">") + 1);
    const classes = tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
    const expected = expectedClassName?.split(" ") ?? [];

    expect(tag).toContain(`data-tone="${tone}"`);
    expect(classes[0]).toBe("hraness-inline-alert");
    expect(classes.slice(1)).toEqual(expected);
  }
});

test("content roots preserve their native elements and forwarded refs", () => {
  const pageIntroRef = createRef<HTMLElement>();
  const emptyStateRef = createRef<HTMLElement>();
  const inlineAlertRef = createRef<HTMLDivElement>();
  const settingsCardRef = createRef<HTMLElement>();
  const pageIntro = renderForwardRefForTest(
    PageIntro,
    { title: "Projects" },
    pageIntroRef,
  );
  const emptyState = renderForwardRefForTest(
    EmptyState,
    { title: "No projects" },
    emptyStateRef,
  );
  const inlineAlert = renderForwardRefForTest(
    InlineAlert,
    { children: "Saved" },
    inlineAlertRef,
  );
  const settingsCard = renderForwardRefForTest(
    SettingsCard,
    { children: "Members", title: "Permissions" },
    settingsCardRef,
  );

  expect(pageIntro.type).toBe("section");
  expect(pageIntro.props.ref).toBe(pageIntroRef);
  expect(emptyState.type).toBe("section");
  expect(emptyState.props.ref).toBe(emptyStateRef);
  expect(inlineAlert.type).toBe("div");
  expect(inlineAlert.props.ref).toBe(inlineAlertRef);
  expect(settingsCard.type).toBe("section");
  expect(settingsCard.props.ref).toBe(settingsCardRef);
  expect(PageIntro.displayName).toBe("PageIntro");
  expect(EmptyState.displayName).toBe("EmptyState");
  expect(InlineAlert.displayName).toBe("InlineAlert");
  expect(SettingsCard.displayName).toBe("SettingsCard");
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

  expect(filled).toMatch(
    /<caption[^>]*data-slot="data-table-caption"[^>]*>/u,
  );
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

test("SkipLink preserves its native anchor and composes caller presentation last", () => {
  const ref = createRef<HTMLAnchorElement>();
  const element = renderSkipLinkForTest({ children: "Jump" }, ref);
  const html = renderToStaticMarkup(
    <SkipLink
      aria-label="Jump to content"
      className="consumer-skip-link"
      data-product="writer"
      href="#content"
      ref={ref}
      style={{ insetInlineStart: "3rem", width: "3rem" }}
      title="Jump over navigation"
      xstyle={[
        skipLinkTestStyles.override,
        skipLinkTestStyles.dynamicWidth("2rem"),
      ]}
    >
      Jump
    </SkipLink>,
  );
  const openingTag = html.slice(0, html.indexOf(">") + 1);
  const classes = openingTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

  expect(element.type).toBe("a");
  expect(element.props.ref).toBe(ref);
  expect(element.props.href).toBe("#main-content");
  expect(openingTag).toStartWith("<a");
  expect(openingTag).toContain('aria-label="Jump to content"');
  expect(openingTag).toContain('data-product="writer"');
  expect(openingTag).toContain('data-slot="skip-link"');
  expect(openingTag).toContain('href="#content"');
  expect(openingTag).toContain('title="Jump over navigation"');
  expect(classes[0]).toBe("hraness-skip-link");
  expect(classes.at(-1)).toBe("consumer-skip-link");
  expect(classes.length).toBeGreaterThan(2);
  expect(openingTag).toMatch(
    /style="--[^:]+:2rem;inset-inline-start:3rem;width:3rem"/u,
  );
  expect(html).toEndWith("Jump</a>");
  expect(SkipLink.displayName).toBe("SkipLink");
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
