import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { createRef, isValidElement } from "react";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LinkRenderProps } from "react-aria-components";

import { Link, type LinkProps } from "./actions.js";
import { linkStyles } from "./actions.stylex.js";

const consumerStyles = stylex.create({
  override: {
    color: "purple",
    ":focus-visible": {
      outlineColor: "orange",
      outlineWidth: "3px",
    },
    ":hover": {
      textDecorationThickness: "4px",
    },
  },
});

const linkWithXstyle: LinkProps = {
  children: "Reference",
  href: "/reference",
  xstyle: consumerStyles.override,
};
// @ts-expect-error Link accepts compiled StyleX recipes rather than raw CSS objects.
const linkWithRawXstyle: LinkProps = { children: "Reference", href: "/", xstyle: { color: "red" } };
void [linkWithRawXstyle, linkWithXstyle];

type LinkElementProps = Readonly<{
  className?: unknown;
  "data-slot"?: unknown;
  href?: unknown;
  ref?: unknown;
  style?: unknown;
}>;

function linkElement(props: LinkProps) {
  const element = Link(props);
  if (!isValidElement<LinkElementProps>(element)) {
    throw new Error("Link did not return its prefetching React Aria boundary");
  }
  return element;
}

function linkState(
  values: Partial<Pick<LinkRenderProps, "isFocusVisible" | "isHovered">> = {},
): LinkRenderProps {
  return {
    isFocusVisible: false,
    isHovered: false,
    ...values,
  } as LinkRenderProps;
}

test("Link preserves its destination, ref, stable hook, slot, and caller class", () => {
  const linkRef = createRef<HTMLAnchorElement>();
  const element = linkElement({
    children: "Reference",
    className: "consumer-link",
    href: "/reference",
    linkRef,
  });
  const className = element.props.className;
  if (typeof className !== "function") {
    throw new Error("Link did not derive presentation from React Aria state");
  }
  const expected = stylex.props(
    linkStyles.root,
    linkStyles.nativeInteractionFallbacks,
  ).className;

  expect(element.props.href).toBe("/reference");
  expect(element.props.ref).toBe(linkRef);
  expect(element.props["data-slot"]).toBe("link");
  expect(className(linkState())).toBe(
    `hraness-link ${expected} consumer-link`,
  );
});

test("Link applies explicit interaction recipes before caller StyleX", () => {
  const defaultElement = linkElement({ children: "Default", href: "/default" });
  const defaultClassName = defaultElement.props.className;
  const overrideElement = linkElement({
    children: "Override",
    href: "/override",
    xstyle: consumerStyles.override,
  });
  const overrideClassName = overrideElement.props.className;
  if (typeof defaultClassName !== "function" || typeof overrideClassName !== "function") {
    throw new Error("Link did not expose state-aware class composition");
  }

  expect(defaultClassName(linkState({ isHovered: true }))).toBe(
    `hraness-link ${stylex.props(
      linkStyles.root,
      linkStyles.nativeInteractionFallbacks,
      linkStyles.hovered,
    ).className}`,
  );
  expect(defaultClassName(linkState({ isFocusVisible: true }))).toBe(
    `hraness-link ${stylex.props(
      linkStyles.root,
      linkStyles.nativeInteractionFallbacks,
      linkStyles.focusVisible,
    ).className}`,
  );
  expect(overrideClassName(linkState({ isFocusVisible: true, isHovered: true }))).toBe(
    `hraness-link ${stylex.props(
      linkStyles.root,
      linkStyles.hovered,
      linkStyles.focusVisible,
      consumerStyles.override,
    ).className}`,
  );
  expect(overrideClassName(linkState())).not.toContain(
    stylex.props(linkStyles.nativeInteractionFallbacks).className
      ?? "missing-native-fallback-class",
  );
});

test("Link keeps native interaction fallbacks for empty conditional StyleX", () => {
  const emptyOverrides: readonly StyleXStyles[] = [
    false,
    null,
    undefined,
    [],
    [false, null, undefined],
  ];
  const expectedFallback = stylex.props(
    linkStyles.root,
    linkStyles.nativeInteractionFallbacks,
  ).className;

  for (const xstyle of emptyOverrides) {
    const element = linkElement({
      children: "Conditional reference",
      href: "/conditional",
      xstyle,
    });
    const className = element.props.className;
    if (typeof className !== "function") {
      throw new Error("Link did not retain state-aware class composition");
    }
    expect(className(linkState())).toBe(`hraness-link ${expectedFallback}`);
  }
});

test("Link merges dynamic StyleX values before caller-owned native style", () => {
  const element = linkElement({
    children: "Reference",
    href: "/reference",
    style: ({ isHovered }) => ({ color: isHovered ? "red" : "blue" }),
    xstyle: consumerStyles.override,
  });
  const style = element.props.style;
  if (typeof style !== "function") {
    throw new Error("Link did not preserve its React Aria style render prop");
  }

  expect(style(linkState({ isHovered: true }))).toEqual({ color: "red" });
  expect(style(linkState())).toEqual({ color: "blue" });

  const html = renderToStaticMarkup(
    <Link
      className="consumer-link"
      href="/reference"
      style={{ color: "red" } as CSSProperties}
      xstyle={consumerStyles.override}
    >
      Reference
    </Link>,
  );
  expect(html).toContain('href="/reference"');
  expect(html).toContain('data-slot="link"');
  expect(html).toContain("hraness-link");
  expect(html).toContain("consumer-link");
  expect(html).toContain('style="color:red"');
});

test("Link owns no remaining legacy visual selector", async () => {
  const [components, source] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./actions.stylex.ts", import.meta.url)).text(),
  ]);

  expect(components).not.toMatch(/\.hraness-link(?=\s|:|\{)/u);
  expect(source).toContain('textDecorationThickness: "1px"');
  expect(source).toContain('textDecorationThickness: "2px"');
  expect(source).toContain('outlineColor: "var(--ui-ring)"');
});
