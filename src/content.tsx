import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { contentStyles } from "./content.stylex.js";
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
  /** Typed StyleX presentation applied after the PageIntro recipe. */
  readonly xstyle?: StyleXStyles;
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
      style,
      title,
      titleAs = "h1",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;
    const rootPresentation = stylex.props(contentStyles.pageIntroRoot, xstyle);
    const copyPresentation = stylex.props(contentStyles.pageIntroCopy);
    const eyebrowPresentation = stylex.props(contentStyles.pageIntroEyebrow);
    const titlePresentation = stylex.props(contentStyles.pageIntroTitle);
    const descriptionPresentation = stylex.props(
      contentStyles.pageIntroDescription,
    );
    const actionsPresentation = stylex.props(contentStyles.actions);

    return (
      <section
        {...props}
        {...rootPresentation}
        className={cn(
          "hraness-page-intro",
          rootPresentation.className,
          className,
        )}
        data-slot="page-intro"
        ref={ref}
        style={mergeStylexInlineStyles(rootPresentation.style, style)}
      >
        <div
          {...copyPresentation}
          className={cn(
            "hraness-page-intro__copy",
            copyPresentation.className,
          )}
          data-slot="page-intro-copy"
        >
          {eyebrow === undefined ? null : (
            <div
              {...eyebrowPresentation}
              className={cn(
                "hraness-page-intro__eyebrow",
                eyebrowPresentation.className,
              )}
              data-slot="page-intro-eyebrow"
            >
              {eyebrow}
            </div>
          )}
          <Heading
            {...titlePresentation}
            className={cn(
              "hraness-page-intro__title",
              titlePresentation.className,
            )}
            data-slot="page-intro-title"
          >
            {title}
          </Heading>
          {description === undefined ? null : (
            <div
              {...descriptionPresentation}
              className={cn(
                "hraness-page-intro__description",
                descriptionPresentation.className,
              )}
              data-slot="page-intro-description"
            >
              {description}
            </div>
          )}
        </div>
        {actions === undefined ? null : (
          <div
            {...actionsPresentation}
            className={cn(
              "hraness-page-intro__actions",
              actionsPresentation.className,
            )}
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
  /** Typed StyleX presentation applied after the EmptyState recipe. */
  readonly xstyle?: StyleXStyles;
}

/** A semantic empty result or first-use state with one optional recovery action. */
export const EmptyState = forwardRef<HTMLElement, EmptyStateProps>(
  (
    {
      action,
      className,
      description,
      icon,
      style,
      title,
      titleAs = "h2",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;
    const rootPresentation = stylex.props(contentStyles.emptyStateRoot, xstyle);
    const iconPresentation = stylex.props(contentStyles.emptyStateIcon);
    const titlePresentation = stylex.props(contentStyles.emptyStateTitle);
    const descriptionPresentation = stylex.props(
      contentStyles.emptyStateDescription,
    );
    const actionsPresentation = stylex.props(contentStyles.actions);

    return (
      <section
        {...props}
        {...rootPresentation}
        className={cn(
          "hraness-empty-state",
          rootPresentation.className,
          className,
        )}
        data-slot="empty-state"
        ref={ref}
        style={mergeStylexInlineStyles(rootPresentation.style, style)}
      >
        {icon === undefined ? null : (
          <div
            {...iconPresentation}
            aria-hidden="true"
            className={cn(
              "hraness-empty-state__icon",
              iconPresentation.className,
            )}
            data-slot="empty-state-icon"
          >
            {icon}
          </div>
        )}
        <Heading
          {...titlePresentation}
          className={cn(
            "hraness-empty-state__title",
            titlePresentation.className,
          )}
          data-slot="empty-state-title"
        >
          {title}
        </Heading>
        {description === undefined ? null : (
          <div
            {...descriptionPresentation}
            className={cn(
              "hraness-empty-state__description",
              descriptionPresentation.className,
            )}
            data-slot="empty-state-description"
          >
            {description}
          </div>
        )}
        {action === undefined ? null : (
          <div
            {...actionsPresentation}
            className={cn(
              "hraness-empty-state__action",
              actionsPresentation.className,
            )}
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
  /** Typed StyleX presentation applied after the finite tone recipe. */
  readonly xstyle?: StyleXStyles;
}

const inlineAlertToneStyles = {
  danger: contentStyles.inlineAlertDanger,
  info: contentStyles.inlineAlertInfo,
  success: contentStyles.inlineAlertSuccess,
  warning: contentStyles.inlineAlertWarning,
} as const satisfies Readonly<Record<InlineAlertTone, StyleXStyles>>;

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
      style,
      title,
      tone = "info",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const resolvedAriaLive = ariaLive
      ?? (isLive ? (tone === "danger" ? "assertive" : "polite") : undefined);
    const resolvedRole = role
      ?? (isLive ? (tone === "danger" ? "alert" : "status") : undefined);
    const rootPresentation = stylex.props(
      contentStyles.inlineAlertRoot,
      inlineAlertToneStyles[tone],
      xstyle,
    );
    const iconPresentation = stylex.props(contentStyles.inlineAlertIcon);
    const contentPresentation = stylex.props(contentStyles.inlineAlertContent);
    const titlePresentation = stylex.props(contentStyles.inlineAlertTitle);
    const bodyPresentation = stylex.props(contentStyles.inlineAlertBody);

    return (
      <div
        {...props}
        {...rootPresentation}
        aria-live={resolvedAriaLive}
        className={cn(
          "hraness-inline-alert",
          rootPresentation.className,
          className,
        )}
        data-slot="inline-alert"
        data-tone={tone}
        ref={ref}
        role={resolvedRole}
        style={mergeStylexInlineStyles(rootPresentation.style, style)}
      >
        {icon === undefined ? null : (
          <div
            {...iconPresentation}
            aria-hidden="true"
            className={cn(
              "hraness-inline-alert__icon",
              iconPresentation.className,
            )}
            data-slot="inline-alert-icon"
          >
            {icon}
          </div>
        )}
        <div
          {...contentPresentation}
          className={cn(
            "hraness-inline-alert__content",
            contentPresentation.className,
          )}
          data-slot="inline-alert-content"
        >
          {title === undefined ? null : (
            <div
              {...titlePresentation}
              className={cn(
                "hraness-inline-alert__title",
                titlePresentation.className,
              )}
              data-slot="inline-alert-title"
            >
              {title}
            </div>
          )}
          <div
            {...bodyPresentation}
            className={cn(
              "hraness-inline-alert__body",
              bodyPresentation.className,
            )}
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
  /** Typed StyleX presentation applied after the finite shape recipe. */
  readonly xstyle?: StyleXStyles;
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
      style,
      title,
      titleAs = "h2",
      xstyle,
      ...props
    },
    ref,
  ) => {
    const Heading = titleAs;
    const rootPresentation = stylex.props(
      contentStyles.settingsCardRoot,
      shape === "rectangular" && contentStyles.settingsCardRectangular,
      xstyle,
    );
    const headerPresentation = stylex.props(contentStyles.settingsCardHeader);
    const titlePresentation = stylex.props(contentStyles.settingsCardTitle);
    const descriptionPresentation = stylex.props(
      contentStyles.settingsCardDescription,
    );
    const actionsPresentation = stylex.props(contentStyles.actions);
    const bodyPresentation = stylex.props(contentStyles.settingsCardBody);

    return (
      <section
        {...props}
        {...rootPresentation}
        className={cn(
          "hraness-settings-card",
          rootPresentation.className,
          className,
        )}
        data-shape={shape}
        data-slot="settings-card"
        ref={ref}
        style={mergeStylexInlineStyles(rootPresentation.style, style)}
      >
        <header
          {...headerPresentation}
          className={cn(
            "hraness-settings-card__header",
            headerPresentation.className,
          )}
          data-slot="settings-card-header"
        >
          <div data-slot="settings-card-heading">
            <Heading
              {...titlePresentation}
              className={cn(
                "hraness-settings-card__title",
                titlePresentation.className,
              )}
              data-slot="settings-card-title"
            >
              {title}
            </Heading>
            {description === undefined ? null : (
              <div
                {...descriptionPresentation}
                className={cn(
                  "hraness-settings-card__description",
                  descriptionPresentation.className,
                )}
                data-slot="settings-card-description"
              >
                {description}
              </div>
            )}
          </div>
          {actions === undefined ? null : (
            <div
              {...actionsPresentation}
              className={cn(
                "hraness-settings-card__actions",
                actionsPresentation.className,
              )}
              data-slot="settings-card-actions"
            >
              {actions}
            </div>
          )}
        </header>
        <div
          {...bodyPresentation}
          className={cn(
            "hraness-settings-card__body",
            bodyPresentation.className,
          )}
          data-slot="settings-card-body"
        >
          {children}
        </div>
      </section>
    );
  },
);

SettingsCard.displayName = "SettingsCard";
