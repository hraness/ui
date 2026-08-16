"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
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
  readonly defaultDuration?: number;
  readonly label?: string;
  readonly maxVisibleToasts?: number;
}

/** Owns an isolated toast queue; no state is shared between requests or roots. */
export function ToastProvider({
  children,
  closeLabel = "Dismiss notification",
  defaultDuration = DEFAULT_DURATION,
  label = "Notifications",
  maxVisibleToasts = DEFAULT_MAX_VISIBLE_TOASTS,
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

  return (
    <ToastContext.Provider value={controller}>
      {children}
      <AriaToastRegion
        aria-label={label}
        className="hraness-toast-region"
        data-slot="toast-region"
        queue={queue}
      >
        {({ toast }) => (
          <AriaToast
            className="hraness-toast"
            data-slot="toast"
            data-tone={toast.content.tone ?? "info"}
            toast={(
              // These props describe the same object. A duplicate react-stately
              // tree makes only their private Timer types nominal.
              toast as AriaToastProps<ToastMessage>["toast"]
            )}
          >
            <AriaToastContent
              className="hraness-toast__content"
              data-slot="toast-content"
            >
              <div className="hraness-toast__copy" data-slot="toast-copy">
                <Text className="hraness-toast__title" data-slot="toast-title" slot="title">
                  {toast.content.title}
                </Text>
                {toast.content.description === undefined ? null : (
                  <Text
                    className="hraness-toast__description"
                    data-slot="toast-description"
                    slot="description"
                  >
                    {toast.content.description}
                  </Text>
                )}
              </div>
              {toast.content.action === undefined ? null : (
                <div className="hraness-toast__action" data-slot="toast-action">
                  {toast.content.action}
                </div>
              )}
            </AriaToastContent>
            <AriaButton
              aria-label={closeLabel}
              className="hraness-toast__close"
              data-slot="toast-close"
              slot="close"
            >
              <span aria-hidden="true">×</span>
            </AriaButton>
          </AriaToast>
        )}
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
