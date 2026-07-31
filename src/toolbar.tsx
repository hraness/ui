"use client";

import { forwardRef } from "react";
import {
  Toolbar as AriaToolbar,
  type ToolbarProps as AriaToolbarProps,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

type AccessibleName =
  | { readonly "aria-label": string; readonly "aria-labelledby"?: never }
  | { readonly "aria-label"?: never; readonly "aria-labelledby": string };

export type ToolbarProps = Omit<
  AriaToolbarProps,
  "aria-label" | "aria-labelledby" | "className"
> &
  AccessibleName & {
    readonly className?: string;
  };

/** Groups commands into one keyboard stop with arrow-key navigation. */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, ...props }, ref) => (
    <AriaToolbar
      {...props}
      className={cn("hraness-toolbar", className)}
      data-slot="toolbar"
      ref={ref}
    />
  ),
);

Toolbar.displayName = "Toolbar";
