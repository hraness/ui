import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "./lib/utils.js";

export type QuietSitePageProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> & Readonly<{
  children: ReactNode;
}>;

/** A compact, centered main landmark for a quiet personal or project page. */
export const QuietSitePage = forwardRef<HTMLElement, QuietSitePageProps>(
  ({ children, className, ...props }, ref) => (
    <main
      {...props}
      className={cn("hraness-quiet-site-page", className)}
      data-slot="quiet-site-page"
      ref={ref}
    >
      {children}
    </main>
  ),
);

QuietSitePage.displayName = "QuietSitePage";

export type QuietSiteFooterProps = Omit<
  HTMLAttributes<HTMLElement>,
  "children"
> & Readonly<{
  children: ReactNode;
}>;

/** Bottom-aligned quiet-site chrome sharing the page measure and gutter. */
export const QuietSiteFooter = forwardRef<HTMLElement, QuietSiteFooterProps>(
  ({ children, className, ...props }, ref) => (
    <footer
      {...props}
      className={cn("hraness-quiet-site-footer", className)}
      data-slot="quiet-site-footer"
      ref={ref}
    >
      {children}
    </footer>
  ),
);

QuietSiteFooter.displayName = "QuietSiteFooter";
