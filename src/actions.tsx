"use client";

import {
  type AriaAttributes,
  forwardRef,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  type ButtonRenderProps,
  Link as AriaLink,
  type LinkProps as AriaLinkProps,
  type LinkRenderProps,
  ToggleButton as AriaToggleButton,
  type ToggleButtonProps as AriaToggleButtonProps,
  type ToggleButtonRenderProps,
} from "react-aria-components";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import {
  actionControlSizeStyles,
  actionHoverStyles,
  actionIconSizeStyles,
  actionLabeledHoverStyles,
  actionLabeledVariantStyles,
  actionNativeHoverStyles,
  actionNativeLabeledHoverStyles,
  actionStyles,
  actionVariantStyles,
  linkStyles,
} from "./actions.stylex.js";
import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { Tooltip } from "./overlays.js";
import { useLinkPrefetch } from "./router.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export type ActionVariant = "danger" | "primary" | "quiet" | "secondary";
export type ActionSize = "compact" | "default" | "large" | "transport";

type BusyAriaProps = Readonly<{
  "aria-busy"?: AriaAttributes["aria-busy"];
}>;

type AccessibleName =
  | Readonly<{
      "aria-label": string;
      "aria-labelledby"?: never;
    }>
  | Readonly<{
      "aria-label"?: never;
      "aria-labelledby": string;
    }>;

type AccessibleIconName =
  | Readonly<{
      "aria-label": string;
      "aria-labelledby"?: never;
      tooltip?: ReactNode;
    }>
  | Readonly<{
      "aria-label"?: never;
      "aria-labelledby": string;
      tooltip: ReactNode;
    }>;

type ButtonRenderValues = ButtonRenderProps & Readonly<{
  defaultChildren: ReactNode | undefined;
}>;

type LinkRenderValues = LinkRenderProps & Readonly<{
  defaultChildren: ReactNode | undefined;
}>;

type ToggleButtonRenderValues = ToggleButtonRenderProps & Readonly<{
  defaultChildren: ReactNode | undefined;
}>;

function isAriaTrue(value: AriaAttributes["aria-busy"]): boolean {
  return value === true || value === "true";
}

function requireNonBlank(value: unknown, component: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${component} ${field} must not be blank.`);
  }
}

function validateAccessibleName(
  props: Partial<Record<"aria-label" | "aria-labelledby", unknown>>,
  component: string,
): void {
  if (props["aria-label"] !== undefined) {
    requireNonBlank(props["aria-label"], component, "aria-label");
    return;
  }
  requireNonBlank(props["aria-labelledby"], component, "aria-labelledby");
}

function iconTooltip(
  props: AccessibleIconName,
  component: string,
): ReactNode {
  validateAccessibleName(props, component);
  const tooltip = props.tooltip ?? props["aria-label"];
  if (tooltip === undefined || tooltip === null || tooltip === false) {
    throw new Error(`${component} tooltip must be provided with aria-labelledby.`);
  }
  if (typeof tooltip === "string") requireNonBlank(tooltip, component, "tooltip");
  return tooltip;
}

function resolveButtonChildren(
  children: AriaButtonProps["children"],
  values: ButtonRenderValues,
): ReactNode {
  return typeof children === "function" ? children(values) : children;
}

function resolveLinkChildren(
  children: AriaLinkProps["children"],
  values: LinkRenderValues,
): ReactNode {
  return typeof children === "function" ? children(values) : children;
}

function resolveToggleButtonChildren(
  children: AriaToggleButtonProps["children"],
  values: ToggleButtonRenderValues,
): ReactNode {
  return typeof children === "function" ? children(values) : children;
}

type ActionControlState = Readonly<{
  isDisabled: boolean;
  isFocusVisible: boolean;
  isHovered: boolean;
  isPending?: boolean;
  isPressed: boolean;
  isSelected?: boolean;
}>;

export type ActionLabelPartXstyles = Readonly<{
  label?: StyleXStyles;
}>;

function actionRootPresentation(xstyle: StyleXStyles | undefined) {
  return stylex.props(actionStyles.root, xstyle);
}

function actionControlPresentation(
  state: ActionControlState,
  size: ActionSize,
  variant: ActionVariant,
  controlXstyle: StyleXStyles | undefined,
  options: Readonly<{
    icon?: boolean;
    iconOnly?: boolean;
    labeled?: boolean;
  }> = {},
) {
  const hasControlPresentation = hasStylexPresentation(controlXstyle);
  return stylex.props(
    actionStyles.control,
    options.icon && actionStyles.iconControl,
    options.icon
      ? actionIconSizeStyles[size]
      : actionControlSizeStyles[size],
    options.iconOnly && actionStyles.iconOnlyToggle,
    options.labeled
      ? actionLabeledVariantStyles[variant]
      : actionVariantStyles[variant],
    !hasControlPresentation && actionStyles.nativeInteractionFallbacks,
    !hasControlPresentation
      && (options.labeled
        ? actionNativeLabeledHoverStyles[variant]
        : actionNativeHoverStyles[variant]),
    state.isHovered
      && (options.labeled
        ? actionLabeledHoverStyles[variant]
        : actionHoverStyles[variant]),
    state.isPressed && actionStyles.pressed,
    state.isFocusVisible && actionStyles.focusVisible,
    (state.isDisabled || state.isPending) && actionStyles.disabled,
    state.isSelected && actionStyles.selected,
    !hasControlPresentation
      && state.isSelected
      && actionStyles.nativeSelectedHover,
    controlXstyle,
  );
}

function inlineIconControlPresentation(
  state: LinkRenderProps,
  controlXstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    actionStyles.inlineControl,
    !hasStylexPresentation(controlXstyle)
      && actionStyles.nativeInlineInteractionFallbacks,
    state.isHovered && actionStyles.hoveredQuiet,
    state.isFocusVisible && actionStyles.focusVisible,
    state.isDisabled && actionStyles.disabled,
    controlXstyle,
  );
}

function PendingIndicator({ className }: Readonly<{ className?: string }>) {
  const presentation = stylex.props(actionStyles.spinner);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "hraness-action__spinner",
        presentation.className,
        className,
      )}
      data-slot="action-spinner"
      style={presentation.style}
    />
  );
}

export type ButtonProps = Omit<AriaButtonProps, "className"> &
  BusyAriaProps &
  Readonly<{
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the nested semantic button. */
    controlXstyle?: StyleXStyles;
    leading?: ReactNode;
    /** Closed StyleX overrides for the action's documented parts. */
    partXstyles?: ActionLabelPartXstyles;
    size?: ActionSize;
    variant?: ActionVariant;
    /** Typed StyleX presentation for the non-semantic wrapper. */
    xstyle?: StyleXStyles;
  }>;

/** A labelled action that preserves focus while pending. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (allProps, ref) => {
    const reservesPendingSlot = Object.prototype.hasOwnProperty.call(
      allProps,
      "isPending",
    );
    const {
      "aria-busy": ariaBusy,
      children,
      className,
      controlClassName,
      controlXstyle,
      isDisabled = false,
      isPending = false,
      leading,
      partXstyles,
      size = "default",
      style,
      variant = "secondary",
      xstyle,
      ...props
    } = allProps;
    const isBusy = isPending || isAriaTrue(ariaBusy);
    const isNativelyDisabled = isDisabled && !isPending;
    const hasLeading = leading !== undefined && leading !== null && leading !== false;
    const hasLeadingSlot = hasLeading || reservesPendingSlot;
    const rootPresentation = actionRootPresentation(xstyle);
    const leadingPresentation = stylex.props(
      actionStyles.leading,
      !isPending && !hasLeading && actionStyles.emptyLeading,
    );
    const labelPresentation = stylex.props(partXstyles?.label);

    return (
      <span
        aria-busy={isBusy ? "true" : undefined}
        className={cn(
          "hraness-button",
          rootPresentation.className,
          className,
        )}
        data-disabled={isNativelyDisabled || undefined}
        data-pending={isPending || undefined}
        data-size={size}
        data-slot="button"
        data-variant={variant}
        style={rootPresentation.style}
      >
        <AriaButton
          {...props}
          aria-busy={isBusy ? "true" : undefined}
          className={(state) => {
            const presentation = actionControlPresentation(
              state,
              size,
              variant,
              controlXstyle,
              { labeled: true },
            );
            return cn(
              "hraness-button__control",
              presentation.className,
              controlClassName,
            );
          }}
          data-slot="button-control"
          isDisabled={isNativelyDisabled}
          isPending={isPending}
          ref={ref}
          style={(state) => {
            const presentation = actionControlPresentation(
              state,
              size,
              variant,
              controlXstyle,
              { labeled: true },
            );
            const callerStyle = typeof style === "function" ? style(state) : style;
            return mergeStylexInlineStyles(presentation.style, callerStyle);
          }}
        >
          {(values) => (
            <>
              {hasLeadingSlot ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "hraness-button__leading",
                    leadingPresentation.className,
                  )}
                  data-empty={!isPending && !hasLeading ? "true" : undefined}
                  data-slot="button-leading"
                  style={leadingPresentation.style}
                >
                  {isPending ? <PendingIndicator /> : leading}
                </span>
              ) : null}
              <span
                className={cn(
                  "hraness-button__label",
                  labelPresentation.className,
                )}
                data-slot="button-label"
                style={labelPresentation.style}
              >
                {resolveButtonChildren(children, values)}
              </span>
            </>
          )}
        </AriaButton>
      </span>
    );
  },
);

Button.displayName = "Button";

const defaultCopyFeedbackDuration = 2_000;
const maximumCopyFeedbackDuration = 60_000;

function validateCopyFeedbackDuration(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value <= 0
    || value > maximumCopyFeedbackDuration
  ) {
    throw new Error(
      `CopyButton feedbackDuration must be a positive safe integer no greater than ${maximumCopyFeedbackDuration}.`,
    );
  }
}

export type CopyButtonProps = Omit<ButtonProps, "children" | "onPress"> &
  Readonly<{
    copiedLabel?: string;
    copyLabel?: string;
    feedbackDuration?: number;
    onCopyError?: (error: unknown) => void;
    onCopySuccess?: () => void;
    value: string;
  }>;

/** Copies one string and shows width-stable, temporary success feedback. */
export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  (
    {
      className,
      copiedLabel = "Copied",
      copyLabel = "Copy",
      feedbackDuration = defaultCopyFeedbackDuration,
      onCopyError,
      onCopySuccess,
      value,
      ...props
    },
    ref,
  ) => {
    requireNonBlank(copyLabel, "CopyButton", "copyLabel");
    requireNonBlank(copiedLabel, "CopyButton", "copiedLabel");
    validateCopyFeedbackDuration(feedbackDuration);

    const [copiedValue, setCopiedValue] = useState<string | null>(null);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestSequence = useRef(0);
    const isCopied = copiedValue === value;
    const labelsPresentation = stylex.props(actionStyles.copyLabels);
    const idleLabelPresentation = stylex.props(
      actionStyles.copyLabel,
      isCopied && actionStyles.hiddenCopyLabel,
    );
    const successLabelPresentation = stylex.props(
      actionStyles.copyLabel,
      !isCopied && actionStyles.hiddenCopyLabel,
    );

    useEffect(() => () => {
      requestSequence.current += 1;
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    }, []);

    const copy = async () => {
      const request = ++requestSequence.current;
      try {
        if (
          typeof navigator === "undefined"
          || navigator.clipboard === undefined
          || typeof navigator.clipboard.writeText !== "function"
        ) {
          throw new Error("Clipboard writing is unavailable.");
        }
        await navigator.clipboard.writeText(value);
        if (request !== requestSequence.current) return;
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
        setCopiedValue(value);
        onCopySuccess?.();
        feedbackTimer.current = setTimeout(() => {
          if (request !== requestSequence.current) return;
          feedbackTimer.current = null;
          setCopiedValue(null);
        }, feedbackDuration);
      } catch (error) {
        if (request !== requestSequence.current) return;
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
        feedbackTimer.current = null;
        setCopiedValue(null);
        onCopyError?.(error);
      }
    };

    return (
      <>
        <Button
          {...props}
          className={cn("hraness-copy-button", className)}
          onPress={() => void copy()}
          ref={ref}
        >
          <span
            className={cn(
              "hraness-copy-button__labels",
              labelsPresentation.className,
            )}
            data-slot="copy-button-labels"
            style={labelsPresentation.style}
          >
            <span
              aria-hidden={isCopied ? "true" : undefined}
              className={cn(
                "hraness-copy-button__label",
                idleLabelPresentation.className,
              )}
              data-slot="copy-button-idle-label"
              style={idleLabelPresentation.style}
            >
              {copyLabel}
            </span>
            <span
              aria-hidden={isCopied ? undefined : "true"}
              className={cn(
                "hraness-copy-button__label",
                successLabelPresentation.className,
              )}
              data-slot="copy-button-success-label"
              style={successLabelPresentation.style}
            >
              {copiedLabel}
            </span>
          </span>
        </Button>
        <span
          aria-atomic="true"
          aria-live="polite"
          className={cn(
            "hraness-visually-hidden",
            visuallyHiddenClassName(),
          )}
          data-slot="copy-button-status"
          role="status"
        >
          {isCopied ? copiedLabel : ""}
        </span>
      </>
    );
  },
);

CopyButton.displayName = "CopyButton";

export type IconButtonProps = Omit<
  AriaButtonProps,
  "aria-label" | "aria-labelledby" | "className" | "title"
> &
  AccessibleIconName &
  BusyAriaProps &
  Readonly<{
    buttonRef?: Ref<HTMLButtonElement>;
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the nested semantic button. */
    controlXstyle?: StyleXStyles;
    size?: ActionSize;
    variant?: ActionVariant;
    /** Typed StyleX presentation for the non-semantic wrapper. */
    xstyle?: StyleXStyles;
  }>;

/** An icon-only action whose accessible name is required by its public type. */
export function IconButton(allProps: IconButtonProps) {
  const tooltipContent = iconTooltip(allProps, "IconButton");
  const {
    "aria-busy": ariaBusy,
    buttonRef,
    children,
    className,
    controlClassName,
    controlXstyle,
    isDisabled = false,
    isPending = false,
    size = "default",
    style,
    tooltip,
    variant = "quiet",
    xstyle,
    ...props
  } = allProps;
  const isBusy = isPending || isAriaTrue(ariaBusy);
  const isNativelyDisabled = isDisabled && !isPending;
  const rootPresentation = actionRootPresentation(xstyle);
  const contentPresentation = stylex.props(actionStyles.iconContent);

  return (
    <span
      aria-busy={isBusy ? "true" : undefined}
      className={cn(
        "hraness-icon-button",
        rootPresentation.className,
        className,
      )}
      data-disabled={isNativelyDisabled || undefined}
      data-pending={isPending || undefined}
      data-size={size}
      data-slot="icon-button"
      data-variant={variant}
      style={rootPresentation.style}
    >
      <Tooltip content={tooltip ?? tooltipContent}>
        <AriaButton
          {...props}
          aria-busy={isBusy ? "true" : undefined}
          className={(state) => {
            const presentation = actionControlPresentation(
              state,
              size,
              variant,
              controlXstyle,
              { icon: true },
            );
            return cn(
              "hraness-icon-button__control",
              presentation.className,
              controlClassName,
            );
          }}
          data-slot="icon-button-control"
          isDisabled={isNativelyDisabled}
          isPending={isPending}
          ref={buttonRef}
          style={(state) => {
            const presentation = actionControlPresentation(
              state,
              size,
              variant,
              controlXstyle,
              { icon: true },
            );
            const callerStyle = typeof style === "function" ? style(state) : style;
            return mergeStylexInlineStyles(presentation.style, callerStyle);
          }}
        >
          {(values) => (
            <span
              className={cn(
                "hraness-icon-button__content",
                contentPresentation.className,
              )}
              data-slot="icon-button-content"
              style={contentPresentation.style}
            >
              {isPending
                ? <PendingIndicator className="hraness-icon-button__spinner" />
                : resolveButtonChildren(children, values)}
            </span>
          )}
        </AriaButton>
      </Tooltip>
    </span>
  );
}

type ToggleButtonBaseProps = Omit<
  AriaToggleButtonProps,
  "aria-label" | "aria-labelledby" | "className"
> &
  Readonly<{
    buttonRef?: Ref<HTMLButtonElement>;
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the nested semantic toggle. */
    controlXstyle?: StyleXStyles;
    leading?: ReactNode;
    size?: ActionSize;
    variant?: ActionVariant;
    /** Typed StyleX presentation for the non-semantic wrapper. */
    xstyle?: StyleXStyles;
  }>;

type ToggleButtonNameProps =
  | (AccessibleName & Readonly<{ isIconOnly: true }>)
  | Readonly<{
      "aria-label"?: string;
      "aria-labelledby"?: string;
      isIconOnly?: false;
    }>;

export type ToggleButtonProps = ToggleButtonBaseProps & ToggleButtonNameProps;

/** A persistent on/off action backed by React Aria selection semantics. */
export function ToggleButton(allProps: ToggleButtonProps) {
  const {
    buttonRef,
    children,
    className,
    controlClassName,
    controlXstyle,
    isDisabled = false,
    isIconOnly = false,
    leading,
    size = "default",
    style,
    variant = "secondary",
    xstyle,
    ...props
  } = allProps;
  if (isIconOnly) validateAccessibleName(allProps, "ToggleButton");
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const rootPresentation = actionRootPresentation(xstyle);
  const leadingPresentation = stylex.props(actionStyles.leading);
  return (
    <span
      className={cn(
        "hraness-toggle-button",
        rootPresentation.className,
        className,
      )}
      data-disabled={isDisabled || undefined}
      data-icon-only={isIconOnly || undefined}
      data-size={size}
      data-slot="toggle-button"
      data-variant={variant}
      style={rootPresentation.style}
    >
      <AriaToggleButton
        {...props}
        className={(state) => {
          const presentation = actionControlPresentation(
            state,
            size,
            variant,
            controlXstyle,
            { iconOnly: isIconOnly, labeled: true },
          );
          return cn(
            "hraness-toggle-button__control",
            presentation.className,
            controlClassName,
          );
        }}
        data-slot="toggle-button-control"
        isDisabled={isDisabled}
        ref={buttonRef}
        style={(state) => {
          const presentation = actionControlPresentation(
            state,
            size,
            variant,
            controlXstyle,
            { iconOnly: isIconOnly, labeled: true },
          );
          const callerStyle = typeof style === "function" ? style(state) : style;
          return mergeStylexInlineStyles(presentation.style, callerStyle);
        }}
      >
        {(values) => (
          <>
            {hasLeading ? (
              <span
                aria-hidden="true"
                className={cn(
                  "hraness-toggle-button__leading",
                  leadingPresentation.className,
                )}
                data-slot="toggle-button-leading"
                style={leadingPresentation.style}
              >
                {leading}
              </span>
            ) : null}
            {resolveToggleButtonChildren(children, values)}
          </>
        )}
      </AriaToggleButton>
    </span>
  );
}

type RequiredHref = NonNullable<AriaLinkProps["href"]>;

type PrefetchingLinkProps = AriaLinkProps & Readonly<{ href: RequiredHref }>;

const PrefetchingLink = forwardRef<HTMLAnchorElement, PrefetchingLinkProps>(
  function PrefetchingLink(
    {
      href,
      isDisabled = false,
      onFocus,
      onHoverStart,
      ...props
    },
    ref,
  ) {
    const prefetch = useLinkPrefetch(isDisabled ? undefined : href);

    return (
      <AriaLink
        {...props}
        href={href}
        isDisabled={isDisabled}
        onFocus={(event) => {
          prefetch();
          onFocus?.(event);
        }}
        onHoverStart={(event) => {
          prefetch();
          onHoverStart?.(event);
        }}
        ref={ref}
      />
    );
  },
);

export type LinkProps = Omit<AriaLinkProps, "className" | "href"> &
  Readonly<{
    className?: string;
    href: RequiredHref;
    linkRef?: Ref<HTMLAnchorElement>;
    /** Typed StyleX presentation applied after the Link interaction recipes. */
    xstyle?: StyleXStyles;
  }>;

function linkPresentation(
  state: LinkRenderProps,
  xstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    linkStyles.root,
    !hasStylexPresentation(xstyle) && linkStyles.nativeInteractionFallbacks,
    state.isHovered && linkStyles.hovered,
    state.isFocusVisible && linkStyles.focusVisible,
    xstyle,
  );
}

/** An ordinary semantic destination. Use Button for actions. */
export function Link({
  className,
  href,
  linkRef,
  style,
  xstyle,
  ...props
}: LinkProps) {
  return (
    <PrefetchingLink
      {...props}
      className={(state) => {
        const presentation = linkPresentation(state, xstyle);
        return cn(
          "hraness-link",
          presentation.className,
          className,
        );
      }}
      data-slot="link"
      href={href}
      ref={linkRef}
      style={(state) => {
        const presentation = linkPresentation(state, xstyle);
        const callerStyle = typeof style === "function" ? style(state) : style;
        return mergeStylexInlineStyles(presentation.style, callerStyle);
      }}
    />
  );
}

export type LinkButtonProps = Omit<AriaLinkProps, "className" | "href"> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the nested semantic destination. */
    controlXstyle?: StyleXStyles;
    href: RequiredHref;
    leading?: ReactNode;
    linkRef?: Ref<HTMLAnchorElement>;
    /** Closed StyleX overrides for the action's documented parts. */
    partXstyles?: ActionLabelPartXstyles;
    size?: ActionSize;
    variant?: ActionVariant;
    /** Typed StyleX presentation for the non-semantic wrapper. */
    xstyle?: StyleXStyles;
  }>;

/** A semantic destination with action-control presentation. */
export function LinkButton({
  children,
  className,
  controlClassName,
  controlXstyle,
  href,
  isDisabled = false,
  leading,
  linkRef,
  partXstyles,
  size = "default",
  style,
  variant = "secondary",
  xstyle,
  ...props
}: LinkButtonProps) {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const rootPresentation = actionRootPresentation(xstyle);
  const leadingPresentation = stylex.props(actionStyles.leading);
  const labelPresentation = stylex.props(partXstyles?.label);
  return (
    <span
      className={cn(
        "hraness-link-button",
        rootPresentation.className,
        className,
      )}
      data-disabled={isDisabled || undefined}
      data-size={size}
      data-slot="link-button"
      data-variant={variant}
      style={rootPresentation.style}
    >
      <PrefetchingLink
        {...props}
        className={(state) => {
          const presentation = actionControlPresentation(
            state,
            size,
            variant,
            controlXstyle,
            { labeled: true },
          );
          return cn(
            "hraness-link-button__control",
            presentation.className,
            controlClassName,
          );
        }}
        data-slot="link-button-control"
        href={href}
        isDisabled={isDisabled}
        ref={linkRef}
        style={(state) => {
          const presentation = actionControlPresentation(
            state,
            size,
            variant,
            controlXstyle,
            { labeled: true },
          );
          const callerStyle = typeof style === "function" ? style(state) : style;
          return mergeStylexInlineStyles(presentation.style, callerStyle);
        }}
      >
        {(values) => (
          <>
            {hasLeading ? (
              <span
                aria-hidden="true"
                className={cn(
                  "hraness-link-button__leading",
                  leadingPresentation.className,
                )}
                data-slot="link-button-leading"
                style={leadingPresentation.style}
              >
                {leading}
              </span>
            ) : null}
            <span
              className={cn(
                "hraness-link-button__label",
                labelPresentation.className,
              )}
              data-slot="link-button-label"
              style={labelPresentation.style}
            >
              {resolveLinkChildren(children, values)}
            </span>
          </>
        )}
      </PrefetchingLink>
    </span>
  );
}

type IconLinkPresentation =
  | Readonly<{
      presentation?: "control";
      size?: ActionSize;
      variant?: ActionVariant;
    }>
  | Readonly<{
      presentation: "inline";
      size?: never;
      variant?: never;
    }>;

export type IconLinkProps = Omit<
  AriaLinkProps,
  "aria-label" | "aria-labelledby" | "className" | "href" | "title"
> &
  AccessibleIconName &
  Readonly<{
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the nested semantic destination. */
    controlXstyle?: StyleXStyles;
    href: RequiredHref;
    linkRef?: Ref<HTMLAnchorElement>;
    /** Typed StyleX presentation for the non-semantic wrapper. */
    xstyle?: StyleXStyles;
  }> &
  IconLinkPresentation;

/** An icon-only destination with a required accessible name and visible tooltip. */
export function IconLink(allProps: IconLinkProps) {
  const tooltipContent = iconTooltip(allProps, "IconLink");
  const {
    children,
    className,
    controlClassName,
    controlXstyle,
    href,
    isDisabled = false,
    linkRef,
    presentation = "control",
    size = "default",
    style,
    tooltip,
    variant = "quiet",
    xstyle,
    ...props
  } = allProps;
  const isInline = presentation === "inline";
  const rootPresentation = actionRootPresentation(xstyle);
  const contentPresentation = stylex.props(
    isInline ? actionStyles.inlineContent : actionStyles.iconContent,
  );

  return (
    <span
      className={cn(
        isInline
          ? "hraness-inline-icon-link"
          : "hraness-icon-button hraness-icon-link",
        rootPresentation.className,
        className,
      )}
      data-disabled={isDisabled || undefined}
      data-size={isInline ? undefined : size}
      data-slot={isInline ? "inline-icon-link" : "icon-link"}
      data-variant={isInline ? undefined : variant}
      style={rootPresentation.style}
    >
      <Tooltip content={tooltip ?? tooltipContent}>
        <PrefetchingLink
          {...props}
          className={(state) => {
            const controlPresentation = isInline
              ? inlineIconControlPresentation(state, controlXstyle)
              : actionControlPresentation(
                  state,
                  size,
                  variant,
                  controlXstyle,
                  { icon: true },
                );
            return cn(
              isInline
                ? "hraness-inline-icon-link__control"
                : "hraness-icon-button__control hraness-icon-link__control",
              controlPresentation.className,
              controlClassName,
            );
          }}
          data-slot={isInline ? "inline-icon-link-control" : "icon-link-control"}
          href={href}
          isDisabled={isDisabled}
          ref={linkRef}
          style={(state) => {
            const controlPresentation = isInline
              ? inlineIconControlPresentation(state, controlXstyle)
              : actionControlPresentation(
                  state,
                  size,
                  variant,
                  controlXstyle,
                  { icon: true },
                );
            const callerStyle = typeof style === "function" ? style(state) : style;
            return mergeStylexInlineStyles(
              controlPresentation.style,
              callerStyle,
            );
          }}
        >
          {(values) => (
            <span
              className={cn(
                isInline
                  ? "hraness-inline-icon-link__content"
                  : "hraness-icon-button__content hraness-icon-link__content",
                contentPresentation.className,
              )}
              data-slot={isInline ? "inline-icon-link-content" : "icon-link-content"}
              style={contentPresentation.style}
            >
              {resolveLinkChildren(children, values)}
            </span>
          )}
        </PrefetchingLink>
      </Tooltip>
    </span>
  );
}
