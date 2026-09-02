"use client";

import { forwardRef } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Toolbar as AriaToolbar,
  ToolbarContext,
  type ToolbarProps as AriaToolbarProps,
  type ToolbarRenderProps,
  useSlottedContext,
} from "react-aria-components";

import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { toolbarStyles } from "./toolbar.stylex.js";

type AccessibleName =
  | { readonly "aria-label": string; readonly "aria-labelledby"?: never }
  | { readonly "aria-label"?: never; readonly "aria-labelledby": string };

export type ToolbarProps = Omit<
  AriaToolbarProps,
  "aria-label" | "aria-labelledby" | "className"
> &
  AccessibleName & {
    readonly className?: string;
    /** Typed StyleX presentation applied after the orientation recipe. */
    readonly xstyle?: StyleXStyles;
  };

function toolbarPresentation(
  state: ToolbarRenderProps,
  xstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    toolbarStyles.root,
    state.orientation === "vertical" && toolbarStyles.vertical,
    !hasStylexPresentation(xstyle) && toolbarStyles.nativeFocusFallback,
    xstyle,
  );
}

/** Groups commands into one keyboard stop with arrow-key navigation. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, render, style, xstyle, ...props }, ref) => {
    const inheritedRender = useSlottedContext(ToolbarContext, props.slot)?.render;
    const resolvedRender = render ?? inheritedRender;

    return (
      <AriaToolbar
        {...props}
        className=""
        data-slot="toolbar"
        ref={ref}
        render={(domProps, state) => {
          const presentation = toolbarPresentation(state, xstyle);
          const composedProps = {
            ...domProps,
            className: cn(
              domProps.className,
              "hraness-toolbar",
              presentation.className,
              className,
            ),
            style: mergeStylexInlineStyles(presentation.style, domProps.style),
          };

          return resolvedRender === undefined
            ? <div {...composedProps} />
            : resolvedRender(composedProps, state);
        }}
        {...(style === undefined ? {} : { style })}
      />
    );
  },
);

Toolbar.displayName = "Toolbar";
