"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Button as AriaButton,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text,
  type ToastOptions as AriaToastOptions,
  type ToastProps as AriaToastProps,
} from "react-aria-components";

import { hasStylexPresentation } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { toastStyles } from "./toast.stylex.js";

export type ToastTone = "danger" | "info" | "success" | "warning";

export interface ToastMessage {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
  readonly tone?: ToastTone;
}

export type ToastOptions = Omit<AriaToastOptions, "timeout"> & {
  /** Set to null for a persistent toast. */
  readonly duration?: number | null;
};

export interface ToastController {
  readonly dismiss: (key: string) => void;
  readonly dismissAll: () => void;
  readonly toast: (message: ToastMessage, options?: ToastOptions) => string;
}

const ToastContext = createContext<ToastController | null>(null);

const DEFAULT_DURATION = 5_000;
const DEFAULT_MAX_VISIBLE_TOASTS = 3;

function finiteDuration(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function visibleToastLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_VISIBLE_TOASTS;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

export interface ToastProviderProps {
  readonly children: ReactNode;
  readonly closeLabel?: string;
  readonly closeXstyle?: StyleXStyles;
  readonly defaultDuration?: number;
  readonly label?: string;
  readonly maxVisibleToasts?: number;
  readonly regionXstyle?: StyleXStyles;
  readonly toastXstyle?: StyleXStyles;
}

const toastToneStyles = {
  danger: toastStyles.toneDanger,
  info: toastStyles.toneInfo,
  success: toastStyles.toneSuccess,
  warning: toastStyles.toneWarning,
} satisfies Record<ToastTone, StyleXStyles>;

/** Owns an isolated toast queue; no state is shared between requests or roots. */
export function ToastProvider({
  children,
  closeLabel = "Dismiss notification",
  closeXstyle,
  defaultDuration = DEFAULT_DURATION,
  label = "Notifications",
  maxVisibleToasts = DEFAULT_MAX_VISIBLE_TOASTS,
  regionXstyle,
  toastXstyle,
}: ToastProviderProps) {
  const duration = finiteDuration(defaultDuration, DEFAULT_DURATION);
  const visibleLimit = visibleToastLimit(maxVisibleToasts);
  const queue = useMemo(
    () => new AriaToastQueue<ToastMessage>({ maxVisibleToasts: visibleLimit }),
    [visibleLimit],
  );
  const controller = useMemo<ToastController>(() => ({
    dismiss: (key) => queue.close(key),
    dismissAll: () => queue.clear(),
    toast: (message, options = {}) => queue.add(message, {
      ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
      ...(options.duration === null
        ? {}
        : {
            timeout: finiteDuration(options.duration ?? duration, duration),
          }),
    }),
  }), [duration, queue]);
  const regionPresentation = stylex.props(toastStyles.region, regionXstyle);
  const hasClosePresentation = hasStylexPresentation(closeXstyle);

  return (
    <ToastContext.Provider value={controller}>
      {children}
      <AriaToastRegion
        aria-label={label}
        className={cn("hraness-toast-region", regionPresentation.className)}
        data-slot="toast-region"
        queue={queue}
        style={regionPresentation.style}
      >
        {({ toast }) => {
          const tone = toast.content.tone ?? "info";
          const toastPresentation = stylex.props(
            toastStyles.root,
            toastStyles.entering,
            toastToneStyles[tone],
            toastXstyle,
          );
          const contentPresentation = stylex.props(toastStyles.content);
          const copyPresentation = stylex.props(toastStyles.copy);
          const titlePresentation = stylex.props(toastStyles.title);
          const descriptionPresentation = stylex.props(toastStyles.description);
          const actionPresentation = stylex.props(toastStyles.action);
          const closePresentation = (state: { isFocusVisible: boolean; isHovered: boolean }) => stylex.props(
            toastStyles.close,
            !hasClosePresentation && toastStyles.closeNativeInteractionFallbacks,
            state.isHovered && toastStyles.closeHovered,
            state.isFocusVisible && toastStyles.closeFocusVisible,
            closeXstyle,
          );
          return <AriaToast
            className={cn("hraness-toast", toastPresentation.className)}
            data-slot="toast"
            data-tone={tone}
            style={toastPresentation.style}
            toast={(
              // These props describe the same object. A duplicate react-stately
              // tree makes only their private Timer types nominal.
              toast as AriaToastProps<ToastMessage>["toast"]
            )}
          >
            <AriaToastContent
              {...contentPresentation}
              className={cn("hraness-toast__content", contentPresentation.className)}
              data-slot="toast-content"
            >
              <div {...copyPresentation} className={cn("hraness-toast__copy", copyPresentation.className)} data-slot="toast-copy">
                <Text {...titlePresentation} className={cn("hraness-toast__title", titlePresentation.className)} data-slot="toast-title" slot="title">
                  {toast.content.title}
                </Text>
                {toast.content.description === undefined ? null : (
                  <Text
                    {...descriptionPresentation}
                    className={cn("hraness-toast__description", descriptionPresentation.className)}
                    data-slot="toast-description"
                    slot="description"
                  >
                    {toast.content.description}
                  </Text>
                )}
              </div>
              {toast.content.action === undefined ? null : (
                <div {...actionPresentation} className={cn("hraness-toast__action", actionPresentation.className)} data-slot="toast-action">
                  {toast.content.action}
                </div>
              )}
            </AriaToastContent>
            <AriaButton
              aria-label={closeLabel}
              className={(state) => cn("hraness-toast__close", closePresentation(state).className)}
              data-slot="toast-close"
              slot="close"
              style={(state) => closePresentation(state).style}
            >
              <span aria-hidden="true">×</span>
            </AriaButton>
          </AriaToast>;
        }}
      </AriaToastRegion>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastController {
  const controller = useContext(ToastContext);
  if (controller === null) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return controller;
}
