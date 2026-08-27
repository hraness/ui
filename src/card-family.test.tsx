import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type {
  CSSProperties,
  ReactElement,
  Ref,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ButtonRenderProps } from "react-aria-components";

import {
  Card,
  CardContent,
  type CardContentProps,
  CardDescription,
  type CardDescriptionProps,
  CardFooter,
  type CardFooterProps,
  CardHeader,
  type CardHeaderProps,
  type CardProps,
  CardTitle,
  type CardTitleProps,
  type CardTone,
  PressableCard,
  type PressableCardProps,
  type SurfaceShape,
} from "./card.js";
import { cardStyles } from "./card.stylex.js";

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  partOverride: {
    gap: "var(--space-8)",
    paddingInline: "var(--space-1)",
  },
  surfaceOverride: {
    backgroundColor: "var(--ui-primary)",
    borderColor: "var(--ui-destructive)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "none",
    color: "var(--ui-primary-foreground)",
    outlineColor: "var(--ui-warning)",
    outlineOffset: "7px",
    outlineWidth: "4px",
    transform: "none",
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

function generatedClasses(
  classes: readonly string[],
  semanticClass: string,
  callerClass?: string,
): string[] {
  return classes.filter(
    (name) => name !== semanticClass && name !== callerClass,
  );
}

const tones = [
  "accent",
  "card",
  "inverse",
  "neutral",
] as const satisfies readonly CardTone[];

const CARD_DESCRIPTION_PRIVATE_PROPERTY = "--_hraness-card-description";

const cardDescriptionToneValues = {
  accent:
    "color-mix(in oklch, var(--ui-accent-foreground) 78%, var(--ui-accent))",
  card: "var(--ui-muted-foreground)",
  inverse:
    "color-mix(in oklch, var(--ui-background) 80%, var(--ui-foreground))",
  neutral: "var(--ui-muted-foreground)",
} as const satisfies Readonly<Record<CardTone, string>>;

const shapes = [
  "rectangular",
  "rounded",
] as const satisfies readonly SurfaceShape[];

test("Card family preserves native elements, slots, hooks, and caller attributes", () => {
  const card = renderToStaticMarkup(
    <Card
      {...{ "data-slot": "caller-card" }}
      aria-label="Project summary"
      className="consumer-card"
      data-product="writer"
      id="project"
      shape="rectangular"
      title="Project"
      tone="accent"
    >
      <CardHeader className="consumer-header">
        <CardTitle className="consumer-title">Local server</CardTitle>
        <CardDescription className="consumer-description">
          Listening on port 3000.
        </CardDescription>
      </CardHeader>
      <CardContent className="consumer-content">Ready</CardContent>
      <CardFooter className="consumer-footer">Open application</CardFooter>
    </Card>,
  );
  const expectedParts = [
    ["card", "div", "hraness-card", "consumer-card"],
    ["card-header", "div", "hraness-card__header", "consumer-header"],
    ["card-title", "h3", "hraness-card__title", "consumer-title"],
    [
      "card-description",
      "p",
      "hraness-card__description",
      "consumer-description",
    ],
    ["card-content", "div", "hraness-card__content", "consumer-content"],
    ["card-footer", "div", "hraness-card__footer", "consumer-footer"],
  ] as const;

  for (const [slot, element, semanticClass, callerClass] of expectedParts) {
    const tag = openingTagForSlot(card, slot);
    const classes = classesForSlot(card, slot);

    expect(tag).toStartWith(`<${element}`);
    expect(classes[0]).toBe(semanticClass);
    expect(classes.at(-1)).toBe(callerClass);
    expect(generatedClasses(classes, semanticClass, callerClass)).not.toHaveLength(0);
  }

  const cardTag = openingTagForSlot(card, "card");
  expect(cardTag).not.toContain("caller-card");
  expect(cardTag).toContain('aria-label="Project summary"');
  expect(cardTag).toContain('data-product="writer"');
  expect(cardTag).toContain('data-shape="rectangular"');
  expect(cardTag).toContain('data-tone="accent"');
  expect(cardTag).toContain('id="project"');
  expect(cardTag).toContain('title="Project"');
  expect(cardTag).toContain(
    `${CARD_DESCRIPTION_PRIVATE_PROPERTY}:${cardDescriptionToneValues.accent}`,
  );
  expect(cardTag).not.toContain("--hraness-card-description:");

  const pressable = renderToStaticMarkup(
    <PressableCard
      {...{ "data-slot": "caller-pressable" }}
      aria-label="Open project"
      className="consumer-pressable"
      data-product="writer"
      id="open-project"
      shape="rectangular"
      tone="inverse"
    >
      Open project
    </PressableCard>,
  );
  const pressableTag = openingTagForSlot(pressable, "pressable-card");
  const pressableClasses = classesForSlot(pressable, "pressable-card");

  expect(pressableTag).toStartWith("<button");
  expect(pressableTag).not.toContain("caller-pressable");
  expect(pressableTag).toContain('aria-label="Open project"');
  expect(pressableTag).toContain('data-product="writer"');
  expect(pressableTag).toContain('data-shape="rectangular"');
  expect(pressableTag).toContain('data-tone="inverse"');
  expect(pressableTag).toContain('id="open-project"');
  expect(pressableTag).toContain(
    `${CARD_DESCRIPTION_PRIVATE_PROPERTY}:${cardDescriptionToneValues.inverse}`,
  );
  expect(pressableTag).not.toContain("--hraness-card-description:");
  expect(pressableClasses[0]).toBe("hraness-pressable-card");
  expect(pressableClasses.at(-1)).toBe("consumer-pressable");
  expect(generatedClasses(
    pressableClasses,
    "hraness-pressable-card",
    "consumer-pressable",
  )).not.toHaveLength(0);
});

test("Card and PressableCard expose every finite tone and shape", () => {
  for (const tone of tones) {
    for (const shape of shapes) {
      const card = renderToStaticMarkup(
        <Card shape={shape} tone={tone}>{tone}</Card>,
      );
      const pressable = renderToStaticMarkup(
        <PressableCard shape={shape} tone={tone}>{tone}</PressableCard>,
      );

      for (const [html, slot, semanticClass] of [
        [card, "card", "hraness-card"],
        [pressable, "pressable-card", "hraness-pressable-card"],
      ] as const) {
        const tag = openingTagForSlot(html, slot);
        expect(tag).toContain(`data-shape="${shape}"`);
        expect(tag).toContain(`data-tone="${tone}"`);
        expect(tag).toContain(
          `${CARD_DESCRIPTION_PRIVATE_PROPERTY}:${cardDescriptionToneValues[tone]}`,
        );
        expect(tag).not.toContain("--hraness-card-description:");
        expect(classesForSlot(html, slot)[0]).toBe(semanticClass);
        expect(generatedClasses(classesForSlot(html, slot), semanticClass))
          .not.toHaveLength(0);
      }
    }
  }
});

test("Card family applies caller StyleX after finite and structural recipes", () => {
  const cardClasses = classesForSlot(
    renderToStaticMarkup(
      <Card
        className="consumer-card"
        shape="rectangular"
        tone="accent"
        xstyle={testStyles.surfaceOverride}
      />,
    ),
    "card",
  );
  const headerClasses = classesForSlot(
    renderToStaticMarkup(
      <CardHeader
        className="consumer-header"
        xstyle={testStyles.partOverride}
      />,
    ),
    "card-header",
  );
  const pressableClasses = classesForSlot(
    renderToStaticMarkup(
      <PressableCard
        className="consumer-pressable"
        shape="rectangular"
        tone="accent"
        xstyle={testStyles.surfaceOverride}
      >
        Override
      </PressableCard>,
    ),
    "pressable-card",
  );

  expect(cardClasses[0]).toBe("hraness-card");
  expect(cardClasses.at(-1)).toBe("consumer-card");
  expect(headerClasses[0]).toBe("hraness-card__header");
  expect(headerClasses.at(-1)).toBe("consumer-header");
  expect(pressableClasses[0]).toBe("hraness-pressable-card");
  expect(pressableClasses.at(-1)).toBe("consumer-pressable");
});

test("Card family keeps dynamic StyleX values before strictly caller-owned native styles", () => {
  const card = openingTagForSlot(
    renderToStaticMarkup(
      <Card
        style={{
          "--hraness-card-description": "rgb(11, 12, 13)",
          width: "8rem",
        } as CSSProperties}
        xstyle={testStyles.dynamicWidth("7rem")}
      />,
    ),
    "card",
  );
  const title = openingTagForSlot(
    renderToStaticMarkup(
      <CardTitle
        style={{ width: "8rem" }}
        xstyle={testStyles.dynamicWidth("7rem")}
      />,
    ),
    "card-title",
  );
  const pressable = openingTagForSlot(
    renderToStaticMarkup(
      <PressableCard
        style={{
          "--hraness-card-description": "rgb(14, 15, 16)",
          width: "8rem",
        } as CSSProperties}
        xstyle={testStyles.dynamicWidth("7rem")}
      >
        Dynamic
      </PressableCard>,
    ),
    "pressable-card",
  );

  for (const tag of [card, title, pressable]) {
    const inlineStyle = tag.match(/style="([^"]+)"/u)?.[1] ?? "";
    expect(inlineStyle).toMatch(/--[^:]+:7rem/u);
    expect(inlineStyle).toContain("width:8rem");
    expect(inlineStyle.indexOf("--")).toBeLessThan(inlineStyle.indexOf("width:"));
  }
  expect(card).toContain(
    `${CARD_DESCRIPTION_PRIVATE_PROPERTY}:${cardDescriptionToneValues.card}`,
  );
  expect(title).not.toContain(`${CARD_DESCRIPTION_PRIVATE_PROPERTY}:`);
  expect(pressable).toContain(
    `${CARD_DESCRIPTION_PRIVATE_PROPERTY}:${cardDescriptionToneValues.card}`,
  );
  expect(card.indexOf(`${CARD_DESCRIPTION_PRIVATE_PROPERTY}:`)).toBeLessThan(
    card.indexOf("--hraness-card-description:"),
  );
  expect(pressable.indexOf(`${CARD_DESCRIPTION_PRIVATE_PROPERTY}:`)).toBeLessThan(
    pressable.indexOf("--hraness-card-description:"),
  );
  expect(card).toContain("--hraness-card-description:rgb(11, 12, 13)");
  expect(pressable).toContain("--hraness-card-description:rgb(14, 15, 16)");
});

type PressableState = ButtonRenderProps & Readonly<{
  defaultClassName: string | undefined;
  defaultStyle: CSSProperties;
}>;

function buttonState(overrides: Partial<PressableState> = {}): PressableState {
  return {
    defaultClassName: "react-aria-Button",
    defaultStyle: { cursor: "pointer" },
    isDisabled: false,
    isFocusVisible: false,
    isFocused: false,
    isHovered: false,
    isPending: false,
    isPressed: false,
    ...overrides,
  };
}

type PressableElement = ReactElement<{
  className: (state: PressableState) => string;
  onPress?: () => void;
  ref?: Ref<HTMLButtonElement>;
  style: (state: PressableState) => CSSProperties | undefined;
}>;

function renderPressableForTest(props: PressableCardProps): PressableElement {
  return PressableCard(props) as PressableElement;
}

test("PressableCard composes React Aria state recipes and caller style callbacks", () => {
  const seenStates: PressableState[] = [];
  const onPress = () => {};
  const rendered = renderPressableForTest({
    children: ({ isDisabled, isPending }) =>
      `${isDisabled ? "disabled" : "enabled"}:${isPending ? "pending" : "idle"}`,
    className: "consumer-pressable",
    onPress,
    shape: "rectangular",
    style: (state) => {
      seenStates.push(state as PressableState);
      return {
        backgroundColor: "rgb(1, 2, 3)",
        transform: "none",
        width: "8rem",
      };
    },
    tone: "accent",
    xstyle: testStyles.surfaceOverride,
  });
  const idle = buttonState();
  const hovered = buttonState({ isHovered: true });
  const pressed = buttonState({ isPressed: true });
  const focused = buttonState({ isFocusVisible: true, isFocused: true });
  const idleClasses = rendered.props.className(idle).split(" ");
  const hoveredClasses = rendered.props.className(hovered).split(" ");
  const pressedClasses = rendered.props.className(pressed).split(" ");
  const focusedClasses = rendered.props.className(focused).split(" ");
  const stateRendered = renderPressableForTest({ children: "State" });
  const stateIdleClasses = stateRendered.props.className(idle).split(" ");
  const stateHoveredClasses = stateRendered.props.className(hovered).split(" ");
  const statePressedClasses = stateRendered.props.className(pressed).split(" ");
  const stateFocusedClasses = stateRendered.props.className(focused).split(" ");
  const resolvedStyle = rendered.props.style(pressed);
  const nativeFallbackClasses = stylex
    .props(cardStyles.nativeInteractionFallbacks)
    .className?.split(" ") ?? [];

  expect(rendered.props.onPress).toBe(onPress);
  expect(idleClasses[0]).toBe("hraness-pressable-card");
  expect(idleClasses.at(-1)).toBe("consumer-pressable");
  expect(hoveredClasses).toEqual(idleClasses);
  expect(pressedClasses).toEqual(idleClasses);
  expect(focusedClasses).not.toEqual(idleClasses);
  expect(stateHoveredClasses).not.toEqual(stateIdleClasses);
  expect(statePressedClasses).not.toEqual(stateIdleClasses);
  expect(stateFocusedClasses).not.toEqual(stateIdleClasses);
  expect(nativeFallbackClasses).not.toHaveLength(0);
  for (const nativeFallbackClass of nativeFallbackClasses) {
    expect(stateIdleClasses).toContain(nativeFallbackClass);
    expect(idleClasses).not.toContain(nativeFallbackClass);
  }
  expect(seenStates).toEqual([pressed]);
  expect(resolvedStyle).toMatchObject({
    [CARD_DESCRIPTION_PRIVATE_PROPERTY]: cardDescriptionToneValues.accent,
    backgroundColor: "rgb(1, 2, 3)",
    transform: "none",
    width: "8rem",
  });
});

test("PressableCard preserves disabled and pending React Aria semantics", () => {
  const disabled = renderToStaticMarkup(
    <PressableCard isDisabled>Disabled</PressableCard>,
  );
  const pending = renderToStaticMarkup(
    <PressableCard isPending>
      {({ isDisabled, isPending }) =>
        `${isDisabled ? "disabled" : "enabled"}:${isPending ? "pending" : "idle"}`}
    </PressableCard>,
  );

  expect(openingTagForSlot(disabled, "pressable-card")).toContain('disabled=""');
  expect(openingTagForSlot(disabled, "pressable-card")).toContain(
    'data-disabled="true"',
  );
  expect(openingTagForSlot(pending, "pressable-card")).toContain(
    'data-pending="true"',
  );
  expect(openingTagForSlot(pending, "pressable-card")).toContain(
    'aria-disabled="true"',
  );
  expect(openingTagForSlot(pending, "pressable-card")).not.toContain(
    'disabled=""',
  );
  expect(pending).toContain("enabled:pending");
});

type ForwardRefElement<Element extends HTMLElement> = ReactElement<{
  ref?: (element: Element | null) => void;
}>;

function renderForwardRefForTest<Props, Element extends HTMLElement>(
  component: unknown,
  props: Props,
  ref: Ref<Element>,
): ForwardRefElement<Element> {
  return (component as Readonly<{
    render: (
      componentProps: Props,
      componentRef: Ref<Element>,
    ) => ForwardRefElement<Element>;
  }>).render(props, ref);
}

test("Card family keeps all seven native ref seams", () => {
  const divValues: Array<HTMLDivElement | null> = [];
  const headingValues: Array<HTMLHeadingElement | null> = [];
  const paragraphValues: Array<HTMLParagraphElement | null> = [];
  const buttonValues: Array<HTMLButtonElement | null> = [];
  const divRef = (element: HTMLDivElement | null) => {
    divValues.push(element);
  };
  const headingRef = (element: HTMLHeadingElement | null) => {
    headingValues.push(element);
  };
  const paragraphRef = (element: HTMLParagraphElement | null) => {
    paragraphValues.push(element);
  };
  const buttonRef = (element: HTMLButtonElement | null) => {
    buttonValues.push(element);
  };
  const div = { id: "card-div" } as HTMLDivElement;
  const heading = { id: "card-title" } as HTMLHeadingElement;
  const paragraph = { id: "card-description" } as HTMLParagraphElement;
  const button = { id: "pressable-card" } as HTMLButtonElement;
  const card = renderForwardRefForTest<CardProps, HTMLDivElement>(
    Card,
    {},
    divRef,
  );
  const header = renderForwardRefForTest<CardHeaderProps, HTMLDivElement>(
    CardHeader,
    {},
    divRef,
  );
  const title = renderForwardRefForTest<CardTitleProps, HTMLHeadingElement>(
    CardTitle,
    {},
    headingRef,
  );
  const description = renderForwardRefForTest<
    CardDescriptionProps,
    HTMLParagraphElement
  >(CardDescription, {}, paragraphRef);
  const content = renderForwardRefForTest<CardContentProps, HTMLDivElement>(
    CardContent,
    {},
    divRef,
  );
  const footer = renderForwardRefForTest<CardFooterProps, HTMLDivElement>(
    CardFooter,
    {},
    divRef,
  );
  const pressable = renderPressableForTest({
    buttonRef,
    children: "Open",
  });

  for (const rendered of [card, header, content, footer]) {
    expect(rendered.type).toBe("div");
    rendered.props.ref?.(div);
    rendered.props.ref?.(null);
  }
  expect(title.type).toBe("h3");
  title.props.ref?.(heading);
  title.props.ref?.(null);
  expect(description.type).toBe("p");
  description.props.ref?.(paragraph);
  description.props.ref?.(null);
  expect(pressable.props.ref).toBe(buttonRef);
  const pressableRef = pressable.props.ref;
  if (typeof pressableRef === "function") {
    pressableRef(button);
    pressableRef(null);
  }

  expect(divValues).toEqual([
    div,
    null,
    div,
    null,
    div,
    null,
    div,
    null,
  ]);
  expect(headingValues).toEqual([heading, null]);
  expect(paragraphValues).toEqual([paragraph, null]);
  expect(buttonValues).toEqual([button, null]);
});
