import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "./lib/utils.js";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

export type TagVariant = "default" | "muted" | "outline";

type TagBaseProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  readonly children: ReactNode;
  /** A decorative glyph that complements the visible label. */
  readonly icon?: ReactNode;
};

export type TagProps = TagBaseProps & (
  | Readonly<{
    /** The authored color used for the tag boundary. */
    accentColor: NonNullable<CSSProperties["borderColor"]>;
    variant: "outline";
  }>
  | Readonly<{
    accentColor?: never;
    variant?: Exclude<TagVariant, "outline">;
  }>
);

type TagStyle = CSSProperties & Readonly<{
  "--hraness-tag-accent"?: NonNullable<CSSProperties["borderColor"]>;
}>;

/** A compact, noninteractive label with one optional decorative icon. */
export const Tag = forwardRef<HTMLSpanElement, TagProps>((allProps, ref) => {
  const {
    accentColor,
    children,
    className,
    icon,
    style,
    variant = "default",
    ...props
  } = allProps;
  const hasIcon = icon !== undefined && icon !== null && icon !== false;
  const resolvedStyle: TagStyle | undefined = accentColor === undefined
    ? style
    : { ...style, "--hraness-tag-accent": accentColor };

  return (
    <span
      {...props}
      className={cn("hraness-tag", className)}
      data-slot="tag"
      data-variant={variant}
      ref={ref}
      style={resolvedStyle}
    >
      {hasIcon
        ? (
            <span
              aria-hidden="true"
              className="hraness-tag__icon"
              data-slot="tag-icon"
            >
              {icon}
            </span>
          )
        : null}
      <span className="hraness-tag__label" data-slot="tag-label">
        {children}
      </span>
    </span>
  );
});

Tag.displayName = "Tag";

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
