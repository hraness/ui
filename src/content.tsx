import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { keyHintStyles } from "./key-hint.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import type { SurfaceShape } from "./surfaces.js";

export type ContentHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export type KeyHintProps = HTMLAttributes<HTMLElement> & Readonly<{
  children: ReactNode;
  /** Typed StyleX presentation applied after the KeyHint recipe. */
  xstyle?: StyleXStyles;
}>;

export const KeyHint = forwardRef<HTMLElement, KeyHintProps>(
  ({ children, className, style, xstyle, ...props }, ref) => {
    const presentation = stylex.props(keyHintStyles.root, xstyle);

    return (
      <kbd
        {...props}
        {...presentation}
        className={cn(
          "hraness-key-hint",
          presentation.className,
          className,
        )}
        data-slot="key-hint"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      >
        {children}
      </kbd>
    );
  },
);

KeyHint.displayName = "KeyHint";

export interface PageIntroProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly titleAs?: ContentHeadingLevel;
}

/** A page heading with optional context, supporting copy, and actions. */
export const PageIntro = forwardRef<HTMLElement, PageIntroProps>(
  (
    {
      actions,
      children,
      className,
      description,
      eyebrow,
      title,
      titleAs = "h1",
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;

    return (
      <section
        {...props}
        className={cn("hraness-page-intro", className)}
        data-slot="page-intro"
        ref={ref}
      >
        <div
          className="hraness-page-intro__copy"
          data-slot="page-intro-copy"
        >
          {eyebrow === undefined ? null : (
            <div
              className="hraness-page-intro__eyebrow"
              data-slot="page-intro-eyebrow"
            >
              {eyebrow}
            </div>
          )}
          <Heading
            className="hraness-page-intro__title"
            data-slot="page-intro-title"
          >
            {title}
          </Heading>
          {description === undefined ? null : (
            <div
              className="hraness-page-intro__description"
              data-slot="page-intro-description"
            >
              {description}
            </div>
          )}
        </div>
        {actions === undefined ? null : (
          <div
            className="hraness-page-intro__actions"
            data-slot="page-intro-actions"
          >
            {actions}
          </div>
        )}
        {children}
      </section>
    );
  },
);

PageIntro.displayName = "PageIntro";

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly titleAs?: ContentHeadingLevel;
}

/** A semantic empty result or first-use state with one optional recovery action. */
export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(
  (
    {
      action,
      className,
      description,
      icon,
      title,
      titleAs = "h2",
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;

    return (
      <section
        {...props}
        className={cn("hraness-empty-state", className)}
        data-slot="empty-state"
        ref={ref}
      >
        {icon === undefined ? null : (
          <div
            aria-hidden="true"
            className="hraness-empty-state__icon"
            data-slot="empty-state-icon"
          >
            {icon}
          </div>
        )}
        <Heading
          className="hraness-empty-state__title"
          data-slot="empty-state-title"
        >
          {title}
        </Heading>
        {description === undefined ? null : (
          <div
            className="hraness-empty-state__description"
            data-slot="empty-state-description"
          >
            {description}
          </div>
        )}
        {action === undefined ? null : (
          <div
            className="hraness-empty-state__action"
            data-slot="empty-state-action"
          >
            {action}
          </div>
        )}
      </section>
    );
  },
);

EmptyState.displayName = "EmptyState";

export type InlineAlertTone = "danger" | "info" | "success" | "warning";

export interface InlineAlertProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  readonly icon?: ReactNode;
  readonly isLive?: boolean;
  readonly title?: ReactNode;
  readonly tone?: InlineAlertTone;
}

/** Inline feedback that becomes a live region only when explicitly requested. */
export const InlineAlert = forwardRef<HTMLDivElement, InlineAlertProps>(
  (
    {
      "aria-live": ariaLive,
      children,
      className,
      icon,
      isLive = false,
      role,
      title,
      tone = "info",
      ...props
    },
    ref,
  ) => {
    const resolvedAriaLive = ariaLive
      ?? (isLive ? (tone === "danger" ? "assertive" : "polite") : undefined);
    const resolvedRole = role
      ?? (isLive ? (tone === "danger" ? "alert" : "status") : undefined);

    return (
      <div
        {...props}
        aria-live={resolvedAriaLive}
        className={cn("hraness-inline-alert", className)}
        data-slot="inline-alert"
        data-tone={tone}
        ref={ref}
        role={resolvedRole}
      >
        {icon === undefined ? null : (
          <div
            aria-hidden="true"
            className="hraness-inline-alert__icon"
            data-slot="inline-alert-icon"
          >
            {icon}
          </div>
        )}
        <div
          className="hraness-inline-alert__content"
          data-slot="inline-alert-content"
        >
          {title === undefined ? null : (
            <div
              className="hraness-inline-alert__title"
              data-slot="inline-alert-title"
            >
              {title}
            </div>
          )}
          <div
            className="hraness-inline-alert__body"
            data-slot="inline-alert-body"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);

InlineAlert.displayName = "InlineAlert";

export interface SettingsCardProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly shape?: SurfaceShape;
  readonly title: ReactNode;
  readonly titleAs?: ContentHeadingLevel;
}

/** A labelled settings group with optional summary actions. */
export const SettingsCard = forwardRef<HTMLElement, SettingsCardProps>(
  (
    {
      actions,
      children,
      className,
      description,
      shape = "rounded",
      title,
      titleAs = "h2",
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;

    return (
      <section
        {...props}
        className={cn("hraness-settings-card", className)}
        data-shape={shape}
        data-slot="settings-card"
        ref={ref}
      >
        <header
          className="hraness-settings-card__header"
          data-slot="settings-card-header"
        >
          <div data-slot="settings-card-heading">
            <Heading
              className="hraness-settings-card__title"
              data-slot="settings-card-title"
            >
              {title}
            </Heading>
            {description === undefined ? null : (
              <div
                className="hraness-settings-card__description"
                data-slot="settings-card-description"
              >
                {description}
              </div>
            )}
          </div>
          {actions === undefined ? null : (
            <div
              className="hraness-settings-card__actions"
              data-slot="settings-card-actions"
            >
              {actions}
            </div>
          )}
        </header>
        <div
          className="hraness-settings-card__body"
          data-slot="settings-card-body"
        >
          {children}
        </div>
      </section>
    );
  },
);

SettingsCard.displayName = "SettingsCard";
