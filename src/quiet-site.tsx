import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type {
  CSSProperties as StyleXCSSProperties,
  StyleXStyles,
} from "@stylexjs/stylex";

import { cn } from "./lib/utils.js";
import { quietSiteStyles } from "./quiet-site.stylex.js";

type QuietSiteStyleProperties = Omit<
  StyleXCSSProperties,
  "inlineSize" | "maxInlineSize" | "minInlineSize"
> & Readonly<{
  "inline-size"?: StyleXCSSProperties["inlineSize"];
  "max-inline-size"?: StyleXCSSProperties["maxInlineSize"];
  "min-inline-size"?: StyleXCSSProperties["minInlineSize"];
}>;

type QuietSiteLandmarkProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> & Readonly<{
  children: ReactNode;
  /** Typed StyleX presentation applied after the shared landmark recipe. */
  xstyle?: StyleXStyles<QuietSiteStyleProperties>;
}>;

function mergeInlineStyles(
  stylexStyle: Readonly<Record<string, number | string>> | undefined,
  callerStyle: CSSProperties | undefined,
): CSSProperties | undefined {
  if (stylexStyle === undefined) return callerStyle;
  return { ...stylexStyle, ...callerStyle };
}

export type QuietSitePageProps = QuietSiteLandmarkProps;

/** A compact, centered main landmark for a quiet personal or project page. */
export const QuietSitePage = forwardRef<HTMLElement, QuietSitePageProps>(
  ({ children, className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(quietSiteStyles.page, xstyle);

    return (
      <main
        {...props}
        {...presentation}
        className={cn(
          "hraness-quiet-site-page",
          presentation.className,
          className,
        )}
        data-slot="quiet-site-page"
        ref={ref}
        style={mergeInlineStyles(presentation.style, style)}
      >
        {children}
      </main>
    );
  },
);

QuietSitePage.displayName = "QuietSitePage";

export type QuietSiteFooterProps = QuietSiteLandmarkProps;

/** Bottom-aligned quiet-site chrome sharing the page measure and gutter. */
export const QuietSiteFooter = forwardRef<HTMLElement, QuietSiteFooterProps>(
  ({ children, className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(quietSiteStyles.footer, xstyle);

    return (
      <footer
        {...props}
        {...presentation}
        className={cn(
          "hraness-quiet-site-footer",
          presentation.className,
          className,
        )}
        data-slot="quiet-site-footer"
        ref={ref}
        style={mergeInlineStyles(presentation.style, style)}
      >
        {children}
      </footer>
    );
  },
);

QuietSiteFooter.displayName = "QuietSiteFooter";
