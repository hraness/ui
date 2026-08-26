import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Avatar, type AvatarProps } from "./data-display.js";

const testStyles = stylex.create({
  dynamicSize: (size: string) => ({ height: size, width: size }),
  override: {
    backgroundColor: "var(--ui-accent)",
    borderRadius: "var(--radius-sm)",
    height: "3rem",
    width: "3rem",
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

test("Avatar preserves native fallback and image accessibility contracts", () => {
  const unlabelled = renderToStaticMarkup(<Avatar name="Prince" />);
  const fallback = renderToStaticMarkup(
    <Avatar
      {...{ "data-slot": "caller-avatar" }}
      alt="Ada Lovelace avatar"
      className="consumer-avatar"
      data-product="writer"
      id="ada"
      name="Ada Lovelace"
    />,
  );
  const image = renderToStaticMarkup(
    <Avatar
      aria-label="Grace profile"
      alt="Grace Hopper"
      name="Grace Hopper"
      src="/grace.png"
      title="Rear Admiral Grace Hopper"
    />,
  );
  const fallbackTag = openingTagForSlot(fallback, "avatar");
  const fallbackClasses = classesForSlot(fallback, "avatar");
  const fallbackChildClasses = classesForSlot(fallback, "avatar-fallback");
  const imageChildClasses = classesForSlot(image, "avatar-image");

  expect(openingTagForSlot(unlabelled, "avatar")).not.toContain("role=");
  expect(openingTagForSlot(unlabelled, "avatar")).not.toContain("aria-label=");
  expect(unlabelled).toContain('title="Prince"');
  expect(unlabelled).toContain(">P</span>");
  expect(fallbackTag).toStartWith("<span");
  expect(fallbackTag).toContain('aria-label="Ada Lovelace avatar"');
  expect(fallbackTag).toContain('data-product="writer"');
  expect(fallbackTag).toContain('data-size="default"');
  expect(fallbackTag).toContain('data-slot="avatar"');
  expect(fallbackTag).not.toContain('data-slot="caller-avatar"');
  expect(fallbackTag).toContain('id="ada"');
  expect(fallbackTag).toContain('role="img"');
  expect(fallbackTag).toContain('title="Ada Lovelace"');
  expect(fallbackClasses[0]).toBe("hraness-avatar");
  expect(fallbackClasses.at(-1)).toBe("consumer-avatar");
  expect(generatedClasses(fallbackClasses, "hraness-avatar", "consumer-avatar"))
    .not.toHaveLength(0);
  expect(openingTagForSlot(fallback, "avatar-fallback")).toContain(
    'aria-hidden="true"',
  );
  expect(fallbackChildClasses[0]).toBe("hraness-avatar__fallback");
  expect(generatedClasses(fallbackChildClasses, "hraness-avatar__fallback"))
    .not.toHaveLength(0);
  expect(fallback).toContain(">AL</span>");
  expect(openingTagForSlot(image, "avatar")).toContain(
    'aria-label="Grace profile"',
  );
  expect(openingTagForSlot(image, "avatar")).not.toContain('role="img"');
  expect(image).toContain('<img alt="Grace Hopper"');
  expect(image).toContain('src="/grace.png"');
  expect(image).toContain('title="Rear Admiral Grace Hopper"');
  expect(imageChildClasses[0]).toBe("hraness-avatar__image");
  expect(generatedClasses(imageChildClasses, "hraness-avatar__image"))
    .not.toHaveLength(0);
});

test("Avatar keeps its three finite physical square sizes", () => {
  const sizes = ["small", "default", "large"] as const;

  for (const size of sizes) {
    const html = renderToStaticMarkup(<Avatar name={size} size={size} />);
    const tag = openingTagForSlot(html, "avatar");

    expect(tag).toContain(`data-size="${size}"`);
    expect(classesForSlot(html, "avatar")[0]).toBe("hraness-avatar");
    expect(generatedClasses(classesForSlot(html, "avatar"), "hraness-avatar"))
      .not.toHaveLength(0);
  }
});

test("Avatar applies its finite size before the typed caller StyleX recipe", () => {
  const baseClasses = classesForSlot(
    renderToStaticMarkup(<Avatar name="Base" size="large" />),
    "avatar",
  );
  const overrideClasses = classesForSlot(
    renderToStaticMarkup(
      <Avatar
        className="consumer-avatar"
        name="Override"
        size="large"
        xstyle={testStyles.override}
      />,
    ),
    "avatar",
  );
  const baseGenerated = generatedClasses(baseClasses, "hraness-avatar");
  const overrideGenerated = generatedClasses(
    overrideClasses,
    "hraness-avatar",
    "consumer-avatar",
  );

  expect(overrideGenerated).toHaveLength(baseGenerated.length);
  expect(
    baseGenerated.filter((name) => overrideGenerated.includes(name)),
  ).toHaveLength(baseGenerated.length - 4);
  expect(overrideClasses[0]).toBe("hraness-avatar");
  expect(overrideClasses.at(-1)).toBe("consumer-avatar");
});

test("Avatar keeps dynamic StyleX values before caller-owned native styles", () => {
  const tag = openingTagForSlot(
    renderToStaticMarkup(
      <Avatar
        name="Dynamic"
        style={{ backgroundColor: "rgb(1, 2, 3)", height: "4rem", width: "4rem" }}
        xstyle={testStyles.dynamicSize("3rem")}
      />,
    ),
    "avatar",
  );
  const inlineStyle = tag.match(/style="([^"]+)"/u)?.[1] ?? "";

  expect(inlineStyle.match(/--[^:]+:3rem/gu)).toHaveLength(2);
  expect(inlineStyle).toContain("background-color:rgb(1, 2, 3)");
  expect(inlineStyle).toContain("height:4rem");
  expect(inlineStyle).toContain("width:4rem");
  expect(inlineStyle.indexOf("--")).toBeLessThan(inlineStyle.indexOf("height:4rem"));
});

type TestAvatarElement = ReactElement<{
  ref?: (element: HTMLSpanElement | null) => void;
}>;

function renderForwardRefForTest(
  props: AvatarProps,
  ref: Ref<HTMLSpanElement>,
): TestAvatarElement {
  return (Avatar as unknown as Readonly<{
    render: (props: AvatarProps, ref: Ref<HTMLSpanElement>) => TestAvatarElement;
  }>).render(props, ref);
}

test("Avatar forwards its native span", () => {
  const values: Array<HTMLSpanElement | null> = [];
  const avatar = renderForwardRefForTest(
    { name: "Ada" },
    (element) => {
      values.push(element);
    },
  );
  const element = { id: "avatar" } as HTMLSpanElement;

  avatar.props.ref?.(element);
  avatar.props.ref?.(null);

  expect(avatar.type).toBe("span");
  expect(values).toEqual([element, null]);
});
