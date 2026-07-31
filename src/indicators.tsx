"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import {
  Label,
  Meter as AriaMeter,
  type MeterProps as AriaMeterProps,
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps,
  Slider as AriaSlider,
  SliderFill,
  SliderOutput,
  type SliderProps as AriaSliderProps,
  SliderThumb,
  SliderTrack,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

type PercentageStyle = CSSProperties & {
  readonly "--hraness-percentage": `${number}%`;
};

function percentageStyle(percentage: number | undefined): PercentageStyle {
  const finitePercentage = percentage === undefined || !Number.isFinite(percentage)
    ? 0
    : percentage;
  const safe = Math.min(100, Math.max(0, finitePercentage));
  const width = `${safe}%` as const;
  return { "--hraness-percentage": width, width };
}

export type ProgressBarProps = Omit<AriaProgressBarProps, "children" | "className"> & {
  readonly className?: string;
  readonly label: ReactNode;
  readonly progressRef?: Ref<HTMLDivElement>;
  readonly showValue?: boolean;
};

export function ProgressBar({
  className,
  label,
  progressRef,
  showValue = false,
  ...props
}: ProgressBarProps) {
  return (
    <AriaProgressBar
      {...props}
      className={cn("hraness-progress-bar", className)}
      data-slot="progress-bar"
      ref={progressRef}
    >
      {({ percentage, valueText }) => (
        <>
          <div
            className="hraness-progress-bar__header hraness-progress-bar__label-row"
            data-slot="progress-bar-header"
          >
            <Label className="hraness-progress-bar__label" data-slot="progress-bar-label">
              {label}
            </Label>
            {showValue && valueText !== undefined ? (
              <span className="hraness-progress-bar__value" data-slot="progress-bar-value">
                {valueText}
              </span>
            ) : null}
          </div>
          <div className="hraness-progress-bar__track" data-slot="progress-bar-track">
            <span
              className="hraness-progress-bar__fill"
              data-indeterminate={percentage === undefined || undefined}
              data-slot="progress-bar-fill"
              style={percentageStyle(percentage)}
            />
          </div>
        </>
      )}
    </AriaProgressBar>
  );
}

export type MeterProps = Omit<AriaMeterProps, "children" | "className"> & {
  readonly className?: string;
  readonly label: ReactNode;
  readonly meterRef?: Ref<HTMLDivElement>;
  readonly showValue?: boolean;
  readonly tone?: "danger" | "default" | "success" | "warning";
};

export function Meter({
  className,
  label,
  meterRef,
  showValue = true,
  tone = "default",
  ...props
}: MeterProps) {
  return (
    <AriaMeter
      {...props}
      className={cn("hraness-meter", className)}
      data-slot="meter"
      data-tone={tone}
      ref={meterRef}
    >
      {({ percentage, valueText }) => (
        <>
          <div
            className="hraness-meter__header hraness-meter__label-row"
            data-slot="meter-header"
          >
            <Label className="hraness-meter__label" data-slot="meter-label">
              {label}
            </Label>
            {showValue && valueText !== undefined ? (
              <span className="hraness-meter__value" data-slot="meter-value">
                {valueText}
              </span>
            ) : null}
          </div>
          <div className="hraness-meter__track" data-slot="meter-track">
            <span
              className="hraness-meter__fill"
              data-slot="meter-fill"
              style={percentageStyle(percentage)}
            />
          </div>
        </>
      )}
    </AriaMeter>
  );
}

export type SliderProps = Omit<AriaSliderProps<number>, "children" | "className"> & {
  readonly className?: string;
  readonly label: ReactNode;
  readonly name?: string;
  readonly showValue?: boolean;
  readonly sliderRef?: Ref<HTMLDivElement>;
  readonly thumbLabel?: string;
};

/** A labelled single-value slider with native form and keyboard semantics. */
export function Slider({
  className,
  label,
  name,
  showValue = true,
  sliderRef,
  thumbLabel,
  ...props
}: SliderProps) {
  return (
    <AriaSlider
      {...props}
      className={cn("hraness-slider", className)}
      data-slot="slider"
      ref={sliderRef}
    >
      <div className="hraness-slider__label-row" data-slot="slider-header">
        <Label className="hraness-slider__label" data-slot="slider-label">
          {label}
        </Label>
        {showValue ? (
          <SliderOutput className="hraness-slider__value" data-slot="slider-value" />
        ) : null}
      </div>
      <SliderTrack className="hraness-slider__track" data-slot="slider-track">
        <SliderFill className="hraness-slider__fill" data-slot="slider-fill" />
        <SliderThumb
          {...(thumbLabel === undefined ? {} : { "aria-label": thumbLabel })}
          className="hraness-slider__thumb"
          data-slot="slider-thumb"
          {...(name === undefined ? {} : { name })}
        />
      </SliderTrack>
    </AriaSlider>
  );
}
