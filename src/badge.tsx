import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { statusStyles } from "./status.stylex.js";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

export type TagVariant = "default" | "muted" | "outline";

type TagBaseProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  readonly children: ReactNode;
  /** A decorative glyph that complements the visible label. */
  readonly icon?: ReactNode;
  /** Typed StyleX presentation applied after the finite variant recipe. */
  readonly xstyle?: StyleXStyles;
};

export type TagProps = TagBaseProps & (
  | Readonly<{
    /** Optional authored color; outline tags otherwise use the muted border role. */
    accentColor?: NonNullable<CSSProperties["borderColor"]>;
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
    xstyle,
    ...props
  } = allProps;
  const hasIcon = icon !== undefined && icon !== null && icon !== false;
  const resolvedStyle: TagStyle | undefined = accentColor === undefined
    ? style
    : { ...style, "--hraness-tag-accent": accentColor };
  const presentation = stylex.props(
    statusStyles.pillRoot,
    tagVariantStyles[variant],
    xstyle,
  );
  const iconPresentation = stylex.props(statusStyles.tagIcon);
  const labelPresentation = stylex.props(statusStyles.tagLabel);

  return (
    <span
      {...props}
      {...presentation}
      className={cn("hraness-tag", presentation.className, className)}
      data-slot="tag"
      data-variant={variant}
      ref={ref}
      style={mergeStylexInlineStyles(presentation.style, resolvedStyle)}
    >
      {hasIcon
        ? (
            <span
              {...iconPresentation}
              aria-hidden="true"
              className={cn("hraness-tag__icon", iconPresentation.className)}
              data-slot="tag-icon"
            >
              {icon}
            </span>
          )
        : null}
      <span
        {...labelPresentation}
        className={cn("hraness-tag__label", labelPresentation.className)}
        data-slot="tag-label"
      >
        {children}
      </span>
    </span>
  );
});

Tag.displayName = "Tag";

const tagVariantStyles = {
  default: statusStyles.tagDefault,
  muted: statusStyles.tagMuted,
  outline: statusStyles.tagOutline,
} as const satisfies Readonly<Record<TagVariant, StyleXStyles>>;

export type StatusDotProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  readonly tone?: StatusTone;
  /** Typed StyleX presentation applied after the finite tone recipe. */
  readonly xstyle?: StyleXStyles;
};

const statusDotToneStyles = {
  danger: statusStyles.dotDanger,
  info: statusStyles.dotInfo,
  neutral: statusStyles.dotNeutral,
  success: statusStyles.dotSuccess,
  warning: statusStyles.dotWarning,
} as const satisfies Readonly<Record<StatusTone, StyleXStyles>>;

/** A decorative status marker. Pair it with visible text rather than color alone. */
export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, style, tone = "neutral", xstyle, ...props }, ref) => {
    const presentation = stylex.props(
      statusStyles.dotRoot,
      statusDotToneStyles[tone],
      xstyle,
    );

    return (
      <span
        {...props}
        {...presentation}
        aria-hidden="true"
        className={cn("hraness-status-dot", presentation.className, className)}
        data-slot="status-dot"
        data-tone={tone}
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      />
    );
  },
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
  /** Typed StyleX presentation applied after the finite tone recipe. */
  readonly xstyle?: StyleXStyles;
};

function badgeVariants({ tone = "neutral" }: { readonly tone?: StatusTone } = {}) {
  return cn("hraness-badge", `hraness-badge--${tone}`);
}

const badgeToneStyles = {
  danger: statusStyles.badgeDanger,
  info: statusStyles.badgeInfo,
  neutral: statusStyles.badgeNeutral,
  success: statusStyles.badgeSuccess,
  warning: statusStyles.badgeWarning,
} as const satisfies Readonly<Record<StatusTone, StyleXStyles>>;

/** A short status, count, or category label. It is not live by default. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      children,
      className,
      isLive = false,
      style,
      tone = "neutral",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const presentation = stylex.props(
      statusStyles.pillRoot,
      badgeToneStyles[tone],
      xstyle,
    );

    return (
      <span
        {...props}
        {...presentation}
        aria-live={isLive ? "polite" : undefined}
        className={cn(
          badgeVariants({ tone }),
          presentation.className,
          className,
        )}
        data-slot="badge"
        data-tone={tone}
        ref={ref}
        role={isLive ? "status" : undefined}
        style={mergeStylexInlineStyles(presentation.style, style)}
      >
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
