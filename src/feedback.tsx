import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useId,
} from "react";

import { cn } from "./lib/utils.js";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  readonly label?: string;
  readonly size?: "default" | "large" | "small";
}

/** A decorative spinner unless a status label is supplied. */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ className, label, size = "default", ...props }, ref) => (
    <span
      {...props}
      aria-hidden={label === undefined ? "true" : undefined}
      className={cn("hraness-spinner", className)}
      data-size={size}
      data-slot="spinner"
      ref={ref}
      role={label === undefined ? undefined : "status"}
    >
      {label === undefined ? null : (
        <span
          className="hraness-visually-hidden"
          data-slot="spinner-label"
        >
          {label}
        </span>
      )}
    </span>
  ),
);

Spinner.displayName = "Spinner";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly height?: CSSProperties["height"];
  readonly isText?: boolean;
  readonly width?: CSSProperties["width"];
}

/** A presentation-only placeholder that is hidden from assistive technology. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      height,
      isText = false,
      style,
      width,
      ...props
    },
    ref,
  ) => (
    <div
      {...props}
      aria-hidden="true"
      className={cn("hraness-skeleton", className)}
      data-slot="skeleton"
      data-text={isText || undefined}
      ref={ref}
      style={{
        ...style,
        ...(height === undefined ? {} : { height }),
        ...(width === undefined ? {} : { width }),
      }}
    />
  ),
);

Skeleton.displayName = "Skeleton";

export interface NormalizedProgress {
  readonly maximum: number;
  readonly percent: number;
  readonly value: number;
}

/** Normalizes foreign progress numbers to a finite native progress range. */
export function normalizeProgress(
  value: number,
  maximum: number,
): NormalizedProgress {
  const safeMaximum = Number.isFinite(maximum) && maximum > 0
    ? maximum
    : 100;
  const finiteValue = Number.isFinite(value) ? value : 0;
  const safeValue = Math.min(safeMaximum, Math.max(0, finiteValue));

  return {
    maximum: safeMaximum,
    percent: (safeValue / safeMaximum) * 100,
    value: safeValue,
  };
}

export interface ProgressProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  readonly label: ReactNode;
  readonly max?: number;
  readonly showValue?: boolean;
  readonly value: number;
}

/** A labelled native progress indicator with an optional visible percentage. */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      label,
      max = 100,
      showValue = false,
      value,
      ...props
    },
    ref,
  ) => {
    const normalized = normalizeProgress(value, max);
    const labelId = `${useId()}-label`;

    return (
      <div
        {...props}
        className={cn("hraness-progress", className)}
        data-slot="progress"
        ref={ref}
      >
        <div
          className="hraness-progress__label-row"
          data-slot="progress-label-row"
        >
          <span data-slot="progress-label" id={labelId}>{label}</span>
          {showValue ? (
            <span data-slot="progress-value">
              {Math.round(normalized.percent)}%
            </span>
          ) : null}
        </div>
        <progress
          aria-labelledby={labelId}
          className="hraness-progress__control"
          data-slot="progress-control"
          max={normalized.maximum}
          value={normalized.value}
        />
      </div>
    );
  },
);

Progress.displayName = "Progress";
