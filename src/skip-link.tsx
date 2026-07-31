"use client";

import {
  type AnchorHTMLAttributes,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { cn } from "./lib/utils.js";

export type SkipLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "href"
> & {
  readonly children?: ReactNode;
  readonly href?: `#${string}`;
};

function attemptFocus(target: HTMLElement, ownerDocument: Document): boolean {
  try {
    target.focus({ preventScroll: true });
  } catch {
    try {
      target.focus();
    } catch {
      return false;
    }
  }
  return ownerDocument.activeElement === target;
}

function scrollTargetIntoView(target: HTMLElement): void {
  try {
    target.scrollIntoView({ block: "start" });
  } catch {
    try {
      target.scrollIntoView();
    } catch {
      return;
    }
  }
}

function focusHashTarget(href: `#${string}`): boolean {
  if (href.length === 1 || typeof document === "undefined") return false;

  const target = document.getElementById(href.slice(1));
  if (target === null) return false;

  let hasTemporaryTabIndex = false;
  let didFocus = attemptFocus(target, document);
  if (!didFocus && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    hasTemporaryTabIndex = true;
    didFocus = attemptFocus(target, document);
  }

  if (!didFocus) {
    if (hasTemporaryTabIndex) target.removeAttribute("tabindex");
    return false;
  }

  if (hasTemporaryTabIndex) {
    target.addEventListener("blur", () => {
      if (target.getAttribute("tabindex") === "-1") {
        target.removeAttribute("tabindex");
      }
    }, { once: true });
  }

  scrollTargetIntoView(target);
  return true;
}

/** Moves keyboard focus to an in-page landmark, including ordinary elements. */
export const SkipLink = forwardRef<HTMLAnchorElement, SkipLinkProps>(
  (
    {
      children = "Skip to main content",
      className,
      href = "#main-content",
      onClick,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>): void => {
      onClick?.(event);
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) {
        return;
      }

      if (focusHashTarget(href)) event.preventDefault();
    };

    const handleKeyDown = (
      event: ReactKeyboardEvent<HTMLAnchorElement>,
    ): void => {
      onKeyDown?.(event);
      if (
        event.defaultPrevented
        || event.key !== "Enter"
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) {
        return;
      }

      if (focusHashTarget(href)) event.preventDefault();
    };

    return (
      <a
        {...props}
        className={cn("hraness-skip-link", className)}
        data-slot="skip-link"
        href={href}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        ref={ref}
      >
        {children}
      </a>
    );
  },
);

SkipLink.displayName = "SkipLink";
