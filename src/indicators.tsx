"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Label,
  Meter as AriaMeter,
  type MeterProps as AriaMeterProps,
  type MeterRenderProps,
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps,
  type ProgressBarRenderProps,
  Slider as AriaSlider,
  SliderFill,
  SliderOutput,
  type SliderProps as AriaSliderProps,
  type SliderRenderProps,
  SliderThumb,
  type SliderThumbRenderProps,
  SliderTrack,
} from "react-aria-components";

import { indicatorStyles } from "./indicators.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
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

type RenderStyleState<State> = State & Readonly<{ defaultStyle: CSSProperties }>;

function resolveRenderStyle<State>(
  style: CSSProperties
    | ((state: RenderStyleState<State>) => CSSProperties | undefined)
    | undefined,
  state: RenderStyleState<State>,
): CSSProperties | undefined {
  return typeof style === "function" ? style(state) : style;
}

export type ProgressBarProps = Omit<AriaProgressBarProps, "children" | "className"> & {
  readonly className?: string;
  readonly label: ReactNode;
  readonly progressRef?: Ref<HTMLDivElement>;
  readonly showValue?: boolean;
  /** Typed StyleX presentation applied after the ProgressBar recipe. */
  readonly xstyle?: StyleXStyles;
};

export function ProgressBar({
  className,
  label,
  progressRef,
  showValue = false,
  style,
  xstyle,
  ...props
}: ProgressBarProps) {
  const rootPresentation = stylex.props(indicatorStyles.root, xstyle);
  const labelRowPresentation = stylex.props(indicatorStyles.labelRow);
  const labelPresentation = stylex.props(indicatorStyles.label);
  const valuePresentation = stylex.props(indicatorStyles.value);
  const trackPresentation = stylex.props(indicatorStyles.track);

  return (
    <AriaProgressBar
      {...props}
      className={cn(
        "hraness-progress-bar",
        rootPresentation.className,
        className,
      )}
      data-slot="progress-bar"
      ref={progressRef}
      style={(state: RenderStyleState<ProgressBarRenderProps>) => mergeStylexInlineStyles(
        rootPresentation.style,
        resolveRenderStyle(style, state),
      )}
    >
      {({ percentage, valueText }) => (
        <>
          <div
            {...labelRowPresentation}
            className={cn(
              "hraness-progress-bar__header hraness-progress-bar__label-row",
              labelRowPresentation.className,
            )}
            data-slot="progress-bar-header"
          >
            <Label
              {...labelPresentation}
              className={cn(
                "hraness-progress-bar__label",
                labelPresentation.className,
              )}
              data-slot="progress-bar-label"
            >
              {label}
            </Label>
            {showValue && valueText !== undefined ? (
              <span
                {...valuePresentation}
                className={cn(
                  "hraness-progress-bar__value",
                  valuePresentation.className,
                )}
                data-slot="progress-bar-value"
              >
                {valueText}
              </span>
            ) : null}
          </div>
          <div
            {...trackPresentation}
            className={cn(
              "hraness-progress-bar__track",
              trackPresentation.className,
            )}
            data-slot="progress-bar-track"
          >
            {(() => {
              const fillPresentation = stylex.props(
                indicatorStyles.fill,
                percentage === undefined && indicatorStyles.indeterminateFill,
              );
              return (
                <span
                  {...fillPresentation}
                  className={cn(
                    "hraness-progress-bar__fill",
                    fillPresentation.className,
                  )}
                  data-indeterminate={percentage === undefined || undefined}
                  data-slot="progress-bar-fill"
                  style={mergeStylexInlineStyles(
                    fillPresentation.style,
                    percentageStyle(percentage),
                  )}
                />
              );
            })()}
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
  /** Typed StyleX presentation applied after the Meter recipe. */
  readonly xstyle?: StyleXStyles;
};

export function Meter({
  className,
  label,
  meterRef,
  showValue = true,
  style,
  tone = "default",
  xstyle,
  ...props
}: MeterProps) {
  const rootPresentation = stylex.props(indicatorStyles.root, xstyle);
  const labelRowPresentation = stylex.props(indicatorStyles.labelRow);
  const labelPresentation = stylex.props(indicatorStyles.label);
  const valuePresentation = stylex.props(indicatorStyles.value);
  const trackPresentation = stylex.props(indicatorStyles.track);
  const fillPresentation = stylex.props(
    indicatorStyles.fill,
    tone === "success" && indicatorStyles.meterSuccess,
    tone === "warning" && indicatorStyles.meterWarning,
    tone === "danger" && indicatorStyles.meterDanger,
  );

  return (
    <AriaMeter
      {...props}
      className={cn("hraness-meter", rootPresentation.className, className)}
      data-slot="meter"
      data-tone={tone}
      ref={meterRef}
      style={(state: RenderStyleState<MeterRenderProps>) => mergeStylexInlineStyles(
        rootPresentation.style,
        resolveRenderStyle(style, state),
      )}
    >
      {({ percentage, valueText }) => (
        <>
          <div
            {...labelRowPresentation}
            className={cn(
              "hraness-meter__header hraness-meter__label-row",
              labelRowPresentation.className,
            )}
            data-slot="meter-header"
          >
            <Label
              {...labelPresentation}
              className={cn("hraness-meter__label", labelPresentation.className)}
              data-slot="meter-label"
            >
              {label}
            </Label>
            {showValue && valueText !== undefined ? (
              <span
                {...valuePresentation}
                className={cn("hraness-meter__value", valuePresentation.className)}
                data-slot="meter-value"
              >
                {valueText}
              </span>
            ) : null}
          </div>
          <div
            {...trackPresentation}
            className={cn("hraness-meter__track", trackPresentation.className)}
            data-slot="meter-track"
          >
            <span
              {...fillPresentation}
              className={cn("hraness-meter__fill", fillPresentation.className)}
              data-slot="meter-fill"
              style={mergeStylexInlineStyles(
                fillPresentation.style,
                percentageStyle(percentage),
              )}
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
  /** Typed StyleX presentation applied after the Slider recipe. */
  readonly xstyle?: StyleXStyles;
};

/** A labelled single-value slider with native form and keyboard semantics. */
export function Slider({
  className,
  label,
  name,
  orientation = "horizontal",
  showValue = true,
  sliderRef,
  style,
  thumbLabel,
  xstyle,
  ...props
}: SliderProps) {
  const rootPresentation = stylex.props(
    indicatorStyles.root,
    orientation === "vertical" && indicatorStyles.sliderRootVertical,
    xstyle,
  );
  const labelRowPresentation = stylex.props(indicatorStyles.labelRow);
  const labelPresentation = stylex.props(indicatorStyles.label);
  const valuePresentation = stylex.props(indicatorStyles.value);
  const trackPresentation = stylex.props(
    indicatorStyles.sliderTrack,
    orientation === "vertical" && indicatorStyles.sliderTrackVertical,
  );
  const fillPresentation = stylex.props(indicatorStyles.sliderFill);

  return (
    <AriaSlider
      {...props}
      className={cn("hraness-slider", rootPresentation.className, className)}
      data-slot="slider"
      orientation={orientation}
      ref={sliderRef}
      style={(state: RenderStyleState<SliderRenderProps>) => mergeStylexInlineStyles(
        rootPresentation.style,
        resolveRenderStyle(style, state),
      )}
    >
      <div
        {...labelRowPresentation}
        className={cn(
          "hraness-slider__label-row",
          labelRowPresentation.className,
        )}
        data-slot="slider-header"
      >
        <Label
          {...labelPresentation}
          className={cn("hraness-slider__label", labelPresentation.className)}
          data-slot="slider-label"
        >
          {label}
        </Label>
        {showValue ? (
          <SliderOutput
            {...valuePresentation}
            className={cn("hraness-slider__value", valuePresentation.className)}
            data-slot="slider-value"
          />
        ) : null}
      </div>
      <SliderTrack
        {...trackPresentation}
        className={cn("hraness-slider__track", trackPresentation.className)}
        data-slot="slider-track"
      >
        <SliderFill
          {...fillPresentation}
          className={cn("hraness-slider__fill", fillPresentation.className)}
          data-slot="slider-fill"
        />
        <SliderThumb
          {...(thumbLabel === undefined ? {} : { "aria-label": thumbLabel })}
          className={(state: SliderThumbRenderProps) => {
            const thumbPresentation = stylex.props(
              indicatorStyles.sliderThumb,
              orientation === "horizontal"
                ? indicatorStyles.sliderThumbHorizontal
                : indicatorStyles.sliderThumbVertical,
              !state.isFocused && indicatorStyles.sliderThumbNativeFocusFallback,
              state.isFocusVisible && indicatorStyles.sliderThumbFocusVisible,
            );
            return cn("hraness-slider__thumb", thumbPresentation.className);
          }}
          data-slot="slider-thumb"
          {...(name === undefined ? {} : { name })}
        >
          {() => {
            const indicatorPresentation = stylex.props(
              indicatorStyles.sliderThumbIndicator,
            );
            return (
              <span
                {...indicatorPresentation}
                aria-hidden="true"
                className={cn(
                  "hraness-slider__thumb-indicator",
                  indicatorPresentation.className,
                )}
                data-slot="slider-thumb-indicator"
              />
            );
          }}
        </SliderThumb>
      </SliderTrack>
    </AriaSlider>
  );
}
