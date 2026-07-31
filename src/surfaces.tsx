import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
} from "react";

import { cn } from "./lib/utils.js";

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

export interface ViewportFrameProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "main" | "section";
}

/** Owns exactly one visual viewport; descendants own intentional scrolling. */
export const ViewportFrame = forwardRef<HTMLElement, ViewportFrameProps>(
  ({ as = "div", className, ...props }, ref) => {
    const Element = as;

    return (
      <Element
        {...props}
        className={cn("hraness-viewport-frame", className)}
        data-slot="viewport-frame"
        ref={(element) => {
          setForwardedRef(ref, element);
        }}
      />
    );
  },
);

ViewportFrame.displayName = "ViewportFrame";

export interface WrappingRowProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "footer" | "header" | "nav" | "section" | "span";
}

/** Wraps inline content before it can clip or force a wider viewport. */
export const WrappingRow = forwardRef<HTMLElement, WrappingRowProps>(
  ({ as = "div", className, ...props }, ref) => {
    const Element = as;

    return (
      <Element
        {...props}
        className={cn("hraness-wrapping-row", className)}
        data-slot="wrapping-row"
        ref={(element) => {
          setForwardedRef(ref, element);
        }}
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
