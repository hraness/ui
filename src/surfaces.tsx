import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import {
  type LogicalSizeStyleProperties,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { structuralSurfaceStyles } from "./surfaces.stylex.js";

function setForwardedRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null) {
    ref.current = value;
  }
}

export type SurfaceShape = "rectangular" | "rounded";
export type ThemedSurfaceTone =
  | "accent"
  | "card"
  | "inverse"
  | "popover"
  | "secondary";

type StructuralSurfaceProps = HTMLAttributes<HTMLElement> & Readonly<{
  /** Typed StyleX presentation applied after the shared structural recipe. */
  xstyle?: StyleXStyles<LogicalSizeStyleProperties>;
}>;

export interface ViewportFrameProps extends StructuralSurfaceProps {
  readonly as?: "div" | "main" | "section";
}

/** Owns exactly one visual viewport; descendants own intentional scrolling. */
export const ViewportFrame = forwardRef<HTMLElement, ViewportFrameProps>(
  ({ as = "div", className, style, xstyle, ...props }, ref) => {
    const Element = as;
    const presentation = stylex.props(
      structuralSurfaceStyles.viewportFrame,
      xstyle,
    );

    return (
      <Element
        {...props}
        {...presentation}
        className={cn(
          "hraness-viewport-frame",
          presentation.className,
          className,
        )}
        data-slot="viewport-frame"
        ref={(element) => {
          setForwardedRef(ref, element);
        }}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

ViewportFrame.displayName = "ViewportFrame";

export interface WrappingRowProps extends StructuralSurfaceProps {
  readonly as?: "div" | "footer" | "header" | "nav" | "section" | "span";
}

/** Wraps inline content before it can clip or force a wider viewport. */
export const WrappingRow = forwardRef<HTMLElement, WrappingRowProps>(
  ({ as = "div", className, style, xstyle, ...props }, ref) => {
    const Element = as;
    const presentation = stylex.props(
      structuralSurfaceStyles.wrappingRow,
      xstyle,
    );

    return (
      <Element
        {...props}
        {...presentation}
        className={cn(
          "hraness-wrapping-row",
          presentation.className,
          className,
        )}
        data-slot="wrapping-row"
        ref={(element) => {
          setForwardedRef(ref, element);
        }}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
);

WrappingRow.displayName = "WrappingRow";

export interface ThemedSurfaceProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "article" | "div" | "section";
  readonly shape?: SurfaceShape;
  readonly tone?: ThemedSurfaceTone;
}

/** A semantic surface whose appearance is selected entirely by public tokens. */
export const ThemedSurface = forwardRef<HTMLElement, ThemedSurfaceProps>(
  (
    {
      as = "div",
      className,
      shape = "rounded",
      tone = "card",
      ...props
    },
    ref,
  ) => {
    const Element = as;

    return (
      <Element
        {...props}
        className={cn("hraness-themed-surface", className)}
        data-shape={shape}
        data-slot="themed-surface"
        data-tone={tone}
        ref={(element) => {
          setForwardedRef(ref, element);
        }}
      />
    );
  },
);

ThemedSurface.displayName = "ThemedSurface";
