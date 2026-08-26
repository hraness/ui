import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Badge,
  type BadgeProps,
  StatusDot,
  type StatusDotProps,
  type StatusTone,
  Tag,
  type TagProps,
  type TagVariant,
} from "./badge.js";

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  pillOverride: {
    backgroundColor: "var(--ui-accent)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-accent-foreground)",
    minHeight: "2rem",
  },
  dotOverride: {
    backgroundColor: "var(--ui-primary)",
    height: "1rem",
    width: "1rem",
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
  const className = openingTagForSlot(html, slot).match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error(`Rendered ${slot} has no class`);
  return className.split(" ");
}

function hasGeneratedClass(
  classes: readonly string[],
  semanticClasses: readonly string[],
  callerClass?: string,
): boolean {
  return classes.some(
    (name) => !semanticClasses.includes(name) && name !== callerClass,
  );
}

const tones = [
  "danger",
  "info",
  "neutral",
  "success",
  "warning",
] as const satisfies readonly StatusTone[];

const tagVariants = [
  "default",
  "muted",
  "outline",
] as const satisfies readonly TagVariant[];

test("status primitives preserve native spans, accessibility, slots, and semantic classes", () => {
  const tag = renderToStaticMarkup(
    <Tag
      {...{ "data-slot": "caller-tag" }}
      accentColor="#D97706"
      className="consumer-tag"
      data-product="writer"
      icon="◆"
      id="project"
      style={{ marginInlineStart: "1rem" }}
      title="Project"
      variant="outline"
    >
      linked project
    </Tag>,
  );
  const badge = renderToStaticMarkup(
    <Badge
      {...{ "data-slot": "caller-badge" }}
      className="consumer-badge"
      data-product="writer"
      id="ready"
      isLive
      tone="success"
    >
      Ready
    </Badge>,
  );
  const quietBadge = renderToStaticMarkup(<Badge>Count</Badge>);
  const dot = renderToStaticMarkup(
    <StatusDot
      {...{ "aria-hidden": false, "data-slot": "caller-dot" }}
      className="consumer-dot"
      data-product="writer"
      id="dot"
      tone="warning"
    />,
  );
  const tagClasses = classesForSlot(tag, "tag");
  const badgeClasses = classesForSlot(badge, "badge");
  const dotClasses = classesForSlot(dot, "status-dot");

  expect(openingTagForSlot(tag, "tag")).toStartWith("<span");
  expect(openingTagForSlot(tag, "tag")).toContain('data-product="writer"');
  expect(openingTagForSlot(tag, "tag")).toContain('data-variant="outline"');
  expect(openingTagForSlot(tag, "tag")).toContain('id="project"');
  expect(openingTagForSlot(tag, "tag")).toContain('title="Project"');
  expect(openingTagForSlot(tag, "tag")).not.toContain("caller-tag");
  expect(openingTagForSlot(tag, "tag")).toContain(
    "--hraness-tag-accent:#D97706",
  );
  expect(openingTagForSlot(tag, "tag")).toContain(
    "margin-inline-start:1rem",
  );
  expect(tagClasses[0]).toBe("hraness-tag");
  expect(tagClasses.at(-1)).toBe("consumer-tag");
  expect(hasGeneratedClass(tagClasses, ["hraness-tag"], "consumer-tag")).toBe(true);
  expect(openingTagForSlot(tag, "tag-icon")).toContain('aria-hidden="true"');
  expect(classesForSlot(tag, "tag-icon")[0]).toBe("hraness-tag__icon");
  expect(classesForSlot(tag, "tag-label")[0]).toBe("hraness-tag__label");
  expect(tag).toContain("linked project");

  expect(openingTagForSlot(badge, "badge")).toStartWith("<span");
  expect(openingTagForSlot(badge, "badge")).toContain('aria-live="polite"');
  expect(openingTagForSlot(badge, "badge")).toContain('role="status"');
  expect(openingTagForSlot(badge, "badge")).not.toContain("caller-badge");
  expect(badgeClasses[0]).toBe("hraness-badge");
  expect(badgeClasses[1]).toBe("hraness-badge--success");
  expect(badgeClasses.at(-1)).toBe("consumer-badge");
  expect(hasGeneratedClass(
    badgeClasses,
    ["hraness-badge", "hraness-badge--success"],
    "consumer-badge",
  )).toBe(true);
  expect(openingTagForSlot(quietBadge, "badge")).not.toContain("aria-live=");
  expect(openingTagForSlot(quietBadge, "badge")).not.toContain("role=");

  expect(openingTagForSlot(dot, "status-dot")).toStartWith("<span");
  expect(openingTagForSlot(dot, "status-dot")).toContain('aria-hidden="true"');
  expect(openingTagForSlot(dot, "status-dot")).not.toContain("caller-dot");
  expect(dotClasses[0]).toBe("hraness-status-dot");
  expect(dotClasses.at(-1)).toBe("consumer-dot");
  expect(hasGeneratedClass(dotClasses, ["hraness-status-dot"], "consumer-dot"))
    .toBe(true);
});

test("status primitives render every finite tone and variant with stable aliases", () => {
  for (const tone of tones) {
    const badge = renderToStaticMarkup(<Badge tone={tone}>{tone}</Badge>);
    const dot = renderToStaticMarkup(<StatusDot tone={tone} />);
    const badgeClasses = classesForSlot(badge, "badge");

    expect(openingTagForSlot(badge, "badge")).toContain(`data-tone="${tone}"`);
    expect(badgeClasses[0]).toBe("hraness-badge");
    expect(badgeClasses[1]).toBe(`hraness-badge--${tone}`);
    expect(hasGeneratedClass(
      badgeClasses,
      ["hraness-badge", `hraness-badge--${tone}`],
    )).toBe(true);
    expect(openingTagForSlot(dot, "status-dot")).toContain(`data-tone="${tone}"`);
    expect(classesForSlot(dot, "status-dot")[0]).toBe("hraness-status-dot");
    expect(hasGeneratedClass(classesForSlot(dot, "status-dot"), ["hraness-status-dot"]))
      .toBe(true);
  }

  for (const variant of tagVariants) {
    const tag = renderToStaticMarkup(
      variant === "outline"
        ? <Tag variant={variant}>{variant}</Tag>
        : <Tag variant={variant}>{variant}</Tag>,
    );

    expect(openingTagForSlot(tag, "tag")).toContain(`data-variant="${variant}"`);
    expect(classesForSlot(tag, "tag")[0]).toBe("hraness-tag");
    expect(hasGeneratedClass(classesForSlot(tag, "tag"), ["hraness-tag"]))
      .toBe(true);
  }
});

test("status primitives apply caller StyleX recipes after finite variants", () => {
  const tagClasses = classesForSlot(
    renderToStaticMarkup(
      <Tag className="consumer-tag" variant="muted" xstyle={testStyles.pillOverride}>
        Override
      </Tag>,
    ),
    "tag",
  );
  const badgeClasses = classesForSlot(
    renderToStaticMarkup(
      <Badge className="consumer-badge" tone="danger" xstyle={testStyles.pillOverride}>
        Override
      </Badge>,
    ),
    "badge",
  );
  const dotClasses = classesForSlot(
    renderToStaticMarkup(
      <StatusDot className="consumer-dot" tone="danger" xstyle={testStyles.dotOverride} />,
    ),
    "status-dot",
  );

  expect(tagClasses[0]).toBe("hraness-tag");
  expect(tagClasses.at(-1)).toBe("consumer-tag");
  expect(badgeClasses.slice(0, 2)).toEqual([
    "hraness-badge",
    "hraness-badge--danger",
  ]);
  expect(badgeClasses.at(-1)).toBe("consumer-badge");
  expect(dotClasses[0]).toBe("hraness-status-dot");
  expect(dotClasses.at(-1)).toBe("consumer-dot");
});

test("dynamic StyleX values survive before caller native styles and the public Tag variable", () => {
  const tag = openingTagForSlot(
    renderToStaticMarkup(
      <Tag
        accentColor="#D97706"
        style={{ width: "7rem" }}
        variant="outline"
        xstyle={testStyles.dynamicWidth("6rem")}
      >
        Project
      </Tag>,
    ),
    "tag",
  );
  const badge = openingTagForSlot(
    renderToStaticMarkup(
      <Badge style={{ width: "7rem" }} xstyle={testStyles.dynamicWidth("6rem")}>
        Badge
      </Badge>,
    ),
    "badge",
  );
  const dot = openingTagForSlot(
    renderToStaticMarkup(
      <StatusDot style={{ width: "2rem" }} xstyle={testStyles.dynamicWidth("1rem")} />,
    ),
    "status-dot",
  );

  for (const tagSource of [tag, badge, dot]) {
    const inlineStyle = tagSource.match(/style="([^"]+)"/u)?.[1] ?? "";
    expect(inlineStyle).toMatch(/--[^:]+:/u);
    expect(inlineStyle.indexOf("--")).toBeLessThan(inlineStyle.indexOf("width:"));
  }
  expect(tag).toContain("--hraness-tag-accent:#D97706");
  expect(tag).toContain("width:7rem");
  expect(badge).toContain("width:7rem");
  expect(dot).toContain("width:2rem");
});

type ForwardRefElement = ReactElement<{
  ref?: (element: HTMLSpanElement | null) => void;
}>;

function renderForwardRefForTest<Props>(
  component: unknown,
  props: Props,
  ref: Ref<HTMLSpanElement>,
): ForwardRefElement {
  return (component as Readonly<{
    render: (componentProps: Props, componentRef: Ref<HTMLSpanElement>) =>
      ForwardRefElement;
  }>).render(props, ref);
}

test("status primitives forward their native spans", () => {
  const values: Array<HTMLSpanElement | null> = [];
  const ref = (element: HTMLSpanElement | null) => {
    values.push(element);
  };
  const elements = [
    renderForwardRefForTest<TagProps>(Tag, { children: "Tag" }, ref),
    renderForwardRefForTest<BadgeProps>(Badge, { children: "Badge" }, ref),
    renderForwardRefForTest<StatusDotProps>(StatusDot, {}, ref),
  ];
  const element = { id: "status" } as HTMLSpanElement;

  for (const rendered of elements) {
    expect(rendered.type).toBe("span");
    rendered.props.ref?.(element);
    rendered.props.ref?.(null);
  }
  expect(values).toEqual([element, null, element, null, element, null]);
});
