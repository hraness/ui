import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "./lib/utils.js";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

export type StatusDotProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  readonly tone?: StatusTone;
};

/** A decorative status marker. Pair it with visible text rather than color alone. */
export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <span
      {...props}
      aria-hidden="true"
      className={cn("hraness-status-dot", className)}
      data-slot="status-dot"
      data-tone={tone}
      ref={ref}
    />
  ),
);

StatusDot.displayName = "StatusDot";

export type BadgeProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  "aria-live" | "children" | "role"
> & {
  readonly children: ReactNode;
  /** Opt in only when the badge itself is a meaningful status update. */
  readonly isLive?: boolean;
  readonly tone?: StatusTone;
};

function badgeVariants({ tone = "neutral" }: { readonly tone?: StatusTone } = {}) {
  return cn("hraness-badge", `hraness-badge--${tone}`);
}

/** A short status, count, or category label. It is not live by default. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ children, className, isLive = false, tone = "neutral", ...props }, ref) => (
    <span
      {...props}
      aria-live={isLive ? "polite" : undefined}
      className={cn(badgeVariants({ tone }), className)}
      data-slot="badge"
      data-tone={tone}
      ref={ref}
      role={isLive ? "status" : undefined}
    >
      {children}
    </span>
  ),
);

Badge.displayName = "Badge";
