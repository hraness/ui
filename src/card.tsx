"use client";

import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  type ButtonRenderProps,
} from "react-aria-components";

import { cardStyles } from "./card.stylex.js";
import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";

export type SurfaceShape = "rectangular" | "rounded";
export type CardTone = "accent" | "card" | "inverse" | "neutral";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  readonly shape?: SurfaceShape;
  readonly tone?: CardTone;
  /** Typed StyleX presentation applied after the finite tone and shape recipes. */
  readonly xstyle?: StyleXStyles;
};

const cardToneStyles = {
  accent: cardStyles.accent,
  card: undefined,
  inverse: cardStyles.inverse,
  neutral: cardStyles.neutral,
} as const satisfies Readonly<Record<CardTone, StyleXStyles | undefined>>;

const CARD_DESCRIPTION_PRIVATE_PROPERTY = "--_hraness-card-description";

const cardDescriptionToneValues = {
  accent:
    "color-mix(in oklch, var(--ui-accent-foreground) 78%, var(--ui-accent))",
  card: "var(--ui-muted-foreground)",
  inverse:
    "color-mix(in oklch, var(--ui-background) 80%, var(--ui-foreground))",
  neutral: "var(--ui-muted-foreground)",
} as const satisfies Readonly<Record<CardTone, string>>;

function mergeCardRootInlineStyles(
  tone: CardTone,
  stylexStyle: Readonly<Record<string, number | string>> | undefined,
  callerStyle: CSSProperties | undefined,
): CSSProperties {
  return {
    [CARD_DESCRIPTION_PRIVATE_PROPERTY]: cardDescriptionToneValues[tone],
    ...stylexStyle,
    ...callerStyle,
  } as CSSProperties;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      shape = "rounded",
      style,
      tone = "card",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const presentation = stylex.props(
      cardStyles.surface,
      cardStyles.cardRoot,
      cardToneStyles[tone],
      shape === "rectangular" && cardStyles.rectangular,
      xstyle,
    );

    return (
      <div
        {...props}
        {...presentation}
        className={cn("hraness-card", presentation.className, className)}
        data-shape={shape}
        data-slot="card"
        data-tone={tone}
        ref={ref}
        style={mergeCardRootInlineStyles(tone, presentation.style, style)}
      />
    );
  },
);

Card.displayName = "Card";

type CardPartProps<Element extends HTMLElement> = HTMLAttributes<Element> &
  Readonly<{
    /** Typed StyleX presentation applied after the component recipe. */
    xstyle?: StyleXStyles;
  }>;

export type CardHeaderProps = CardPartProps<HTMLDivElement>;

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(cardStyles.cardHeader, xstyle);

    return (
      <div
        {...props}
        {...presentation}
        className={cn(
          "hraness-card__header",
          presentation.className,
          className,
        )}
        data-slot="card-header"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

CardHeader.displayName = "CardHeader";

export type CardTitleProps = CardPartProps<HTMLHeadingElement>;

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(cardStyles.cardTitle, xstyle);

    return (
      <h3
        {...props}
        {...presentation}
        className={cn(
          "hraness-card__title",
          presentation.className,
          className,
        )}
        data-slot="card-title"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = CardPartProps<HTMLParagraphElement>;

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(cardStyles.cardDescription, xstyle);

    return (
      <p
        {...props}
        {...presentation}
        className={cn(
          "hraness-card__description",
          presentation.className,
          className,
        )}
        data-slot="card-description"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

CardDescription.displayName = "CardDescription";

export type CardContentProps = CardPartProps<HTMLDivElement>;

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(cardStyles.cardContent, xstyle);

    return (
      <div
        {...props}
        {...presentation}
        className={cn(
          "hraness-card__content",
          presentation.className,
          className,
        )}
        data-slot="card-content"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

CardContent.displayName = "CardContent";

export type CardFooterProps = CardPartProps<HTMLDivElement>;

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(cardStyles.cardFooter, xstyle);

    return (
      <div
        {...props}
        {...presentation}
        className={cn(
          "hraness-card__footer",
          presentation.className,
          className,
        )}
        data-slot="card-footer"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

CardFooter.displayName = "CardFooter";

export type PressableCardProps = Omit<AriaButtonProps, "className"> & {
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly className?: string;
  readonly shape?: SurfaceShape;
  readonly tone?: CardTone;
  /** Typed StyleX presentation applied after finite interaction recipes. */
  readonly xstyle?: StyleXStyles;
};

function pressableCardPresentation(
  shape: SurfaceShape,
  tone: CardTone,
  state: ButtonRenderProps,
  xstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    cardStyles.surface,
    cardStyles.pressableRoot,
    !hasStylexPresentation(xstyle) && cardStyles.nativeInteractionFallbacks,
    cardToneStyles[tone],
    shape === "rectangular" && cardStyles.rectangular,
    state.isHovered && cardStyles.hovered,
    state.isPressed && cardStyles.pressed,
    state.isFocusVisible && cardStyles.focusVisible,
    xstyle,
  );
}

/** A whole-card action with one semantic button and no nested controls. */
export function PressableCard({
  buttonRef,
  className,
  shape = "rounded",
  style,
  tone = "card",
  xstyle,
  ...props
}: PressableCardProps) {
  return (
    <AriaButton
      {...props}
      className={(state) => {
        const presentation = pressableCardPresentation(
          shape,
          tone,
          state,
          xstyle,
        );
        return cn(
          "hraness-pressable-card",
          presentation.className,
          className,
        );
      }}
      data-shape={shape}
      data-slot="pressable-card"
      data-tone={tone}
      ref={buttonRef}
      style={(state) => {
        const presentation = pressableCardPresentation(
          shape,
          tone,
          state,
          xstyle,
        );
        const callerStyle = typeof style === "function" ? style(state) : style;

        return mergeCardRootInlineStyles(
          tone,
          presentation.style,
          callerStyle,
        );
      }}
    />
  );
}
