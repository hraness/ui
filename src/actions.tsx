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

import { cn } from "./lib/utils.js";
import { Tooltip } from "./overlays.js";
import { useLinkPrefetch } from "./router.js";

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

function PendingIndicator({ className }: Readonly<{ className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={cn("hraness-action__spinner", className)}
      data-slot="action-spinner"
    />
  );
}

export type ButtonProps = Omit<AriaButtonProps, "className"> &
  BusyAriaProps &
  Readonly<{
    className?: string;
    controlClassName?: string;
    leading?: ReactNode;
    size?: ActionSize;
    variant?: ActionVariant;
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
      isDisabled = false,
      isPending = false,
      leading,
      size = "default",
      variant = "secondary",
      ...props
    } = allProps;
    const isBusy = isPending || isAriaTrue(ariaBusy);
    const isNativelyDisabled = isDisabled && !isPending;
    const hasLeading = leading !== undefined && leading !== null && leading !== false;
    const hasLeadingSlot = hasLeading || reservesPendingSlot;

    return (
      <span
        aria-busy={isBusy ? "true" : undefined}
        className={cn("hraness-button", className)}
        data-disabled={isNativelyDisabled || undefined}
        data-pending={isPending || undefined}
        data-size={size}
        data-slot="button"
        data-variant={variant}
      >
        <AriaButton
          {...props}
          aria-busy={isBusy ? "true" : undefined}
          className={cn("hraness-button__control", controlClassName)}
          data-slot="button-control"
          isDisabled={isNativelyDisabled}
          isPending={isPending}
          ref={ref}
        >
          {(values) => (
            <>
              {hasLeadingSlot ? (
                <span
                  aria-hidden="true"
                  className="hraness-button__leading"
                  data-empty={!isPending && !hasLeading ? "true" : undefined}
                  data-slot="button-leading"
                >
                  {isPending ? <PendingIndicator /> : leading}
                </span>
              ) : null}
              <span className="hraness-button__label" data-slot="button-label">
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
            className="hraness-copy-button__labels"
            data-slot="copy-button-labels"
          >
            <span
              aria-hidden={isCopied ? "true" : undefined}
              className="hraness-copy-button__label"
              data-slot="copy-button-idle-label"
            >
              {copyLabel}
            </span>
            <span
              aria-hidden={isCopied ? undefined : "true"}
              className="hraness-copy-button__label"
              data-slot="copy-button-success-label"
            >
              {copiedLabel}
            </span>
          </span>
        </Button>
        <span
          aria-atomic="true"
          aria-live="polite"
          className="hraness-visually-hidden"
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
    size?: ActionSize;
    variant?: ActionVariant;
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
    isDisabled = false,
    isPending = false,
    size = "default",
    tooltip,
    variant = "quiet",
    ...props
  } = allProps;
  const isBusy = isPending || isAriaTrue(ariaBusy);
  const isNativelyDisabled = isDisabled && !isPending;

  return (
    <span
      aria-busy={isBusy ? "true" : undefined}
      className={cn("hraness-icon-button", className)}
      data-disabled={isNativelyDisabled || undefined}
      data-pending={isPending || undefined}
      data-size={size}
      data-slot="icon-button"
      data-variant={variant}
    >
      <Tooltip content={tooltip ?? tooltipContent}>
        <AriaButton
          {...props}
          aria-busy={isBusy ? "true" : undefined}
          className={cn("hraness-icon-button__control", controlClassName)}
          data-slot="icon-button-control"
          isDisabled={isNativelyDisabled}
          isPending={isPending}
          ref={buttonRef}
        >
          {(values) => (
            <span
              className="hraness-icon-button__content"
              data-slot="icon-button-content"
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
    leading?: ReactNode;
    size?: ActionSize;
    variant?: ActionVariant;
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
    isDisabled = false,
    isIconOnly = false,
    leading,
    size = "default",
    variant = "secondary",
    ...props
  } = allProps;
  if (isIconOnly) validateAccessibleName(allProps, "ToggleButton");
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  return (
    <span
      className={cn("hraness-toggle-button", className)}
      data-disabled={isDisabled || undefined}
      data-icon-only={isIconOnly || undefined}
      data-size={size}
      data-slot="toggle-button"
      data-variant={variant}
    >
      <AriaToggleButton
        {...props}
        className={cn("hraness-toggle-button__control", controlClassName)}
        data-slot="toggle-button-control"
        isDisabled={isDisabled}
        ref={buttonRef}
      >
        {(values) => (
          <>
            {hasLeading ? (
              <span
                aria-hidden="true"
                className="hraness-toggle-button__leading"
                data-slot="toggle-button-leading"
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
  }>;

/** An ordinary semantic destination. Use Button for actions. */
export function Link({ className, href, linkRef, ...props }: LinkProps) {
  return (
    <PrefetchingLink
      {...props}
      className={cn("hraness-link", className)}
      data-slot="link"
      href={href}
      ref={linkRef}
    />
  );
}

export type LinkButtonProps = Omit<AriaLinkProps, "className" | "href"> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    href: RequiredHref;
    leading?: ReactNode;
    linkRef?: Ref<HTMLAnchorElement>;
    size?: ActionSize;
    variant?: ActionVariant;
  }>;

/** A semantic destination with action-control presentation. */
export function LinkButton({
  children,
  className,
  controlClassName,
  href,
  isDisabled = false,
  leading,
  linkRef,
  size = "default",
  variant = "secondary",
  ...props
}: LinkButtonProps) {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  return (
    <span
      className={cn("hraness-link-button", className)}
      data-disabled={isDisabled || undefined}
      data-size={size}
      data-slot="link-button"
      data-variant={variant}
    >
      <PrefetchingLink
        {...props}
        className={cn("hraness-link-button__control", controlClassName)}
        data-slot="link-button-control"
        href={href}
        isDisabled={isDisabled}
        ref={linkRef}
      >
        {(values) => (
          <>
            {hasLeading ? (
              <span
                aria-hidden="true"
                className="hraness-link-button__leading"
                data-slot="link-button-leading"
              >
                {leading}
              </span>
            ) : null}
            <span className="hraness-link-button__label" data-slot="link-button-label">
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
    href: RequiredHref;
    linkRef?: Ref<HTMLAnchorElement>;
  }> &
  IconLinkPresentation;

/** An icon-only destination with a required accessible name and visible tooltip. */
export function IconLink(allProps: IconLinkProps) {
  const tooltipContent = iconTooltip(allProps, "IconLink");
  const {
    children,
    className,
    controlClassName,
    href,
    isDisabled = false,
    linkRef,
    presentation = "control",
    size = "default",
    tooltip,
    variant = "quiet",
    ...props
  } = allProps;
  const isInline = presentation === "inline";

  return (
    <span
      className={cn(
        isInline
          ? "hraness-inline-icon-link"
          : "hraness-icon-button hraness-icon-link",
        className,
      )}
      data-disabled={isDisabled || undefined}
      data-size={isInline ? undefined : size}
      data-slot={isInline ? "inline-icon-link" : "icon-link"}
      data-variant={isInline ? undefined : variant}
    >
      <Tooltip content={tooltip ?? tooltipContent}>
        <PrefetchingLink
          {...props}
          className={cn(
            isInline
              ? "hraness-inline-icon-link__control"
              : "hraness-icon-button__control hraness-icon-link__control",
            controlClassName,
          )}
          data-slot={isInline ? "inline-icon-link-control" : "icon-link-control"}
          href={href}
          isDisabled={isDisabled}
          ref={linkRef}
        >
          {(values) => (
            <span
              className={isInline
                ? "hraness-inline-icon-link__content"
                : "hraness-icon-button__content hraness-icon-link__content"}
              data-slot={isInline ? "inline-icon-link-content" : "icon-link-content"}
            >
              {resolveLinkChildren(children, values)}
            </span>
          )}
        </PrefetchingLink>
      </Tooltip>
    </span>
  );
}
