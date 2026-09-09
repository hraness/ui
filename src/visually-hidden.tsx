import {
  createElement,
  forwardRef,
  type HTMLAttributes,
} from "react";

import { cn } from "./lib/utils.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export type VisuallyHiddenElement =
  | "span"
  | "div"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6";

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLElement> {
  /** Native text or heading element. Defaults to span. */
  readonly as?: VisuallyHiddenElement;
}

/** Hides nonfocusable content visually while retaining its native semantics. */
export const VisuallyHidden = forwardRef<HTMLElement, VisuallyHiddenProps>(
  ({ as = "span", className, ...props }, ref) => createElement(as, {
    ...props,
    className: cn(
      "hraness-visually-hidden",
      visuallyHiddenClassName(),
      className,
    ),
    "data-slot": "visually-hidden",
    ref,
  }),
);

VisuallyHidden.displayName = "VisuallyHidden";
