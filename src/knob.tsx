"use client";

import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useEffect,
  type RefObject,
  useRef,
} from "react";
import { useMove } from "react-aria";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Label,
  Slider as AriaSlider,
  SliderOutput,
  type SliderProps as AriaSliderProps,
  type SliderRenderProps,
  SliderThumb,
  SliderTrack,
  type SliderTrackRenderProps,
} from "react-aria-components";

import {
  beginKnobGesture,
  cancelKnobGesture,
  constrainKnobGestureMove,
  createKnobFrameQueue,
  endKnobGesture,
  type KnobGesture,
  type KnobTouchIntent,
  knobValuePercentage,
  moveKnobGesture,
  resolveKnobTouchIntent,
} from "./knob-model.js";
import { knobStyles } from "./knob.stylex.js";
import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export type KnobDensity = "compact" | "default";
export type KnobOutputVisibility = "visible" | "visually-hidden";
export type KnobTouchPan = "horizontal" | "none";

type KnobValueProps =
  | Readonly<{
      defaultValue?: never;
      value: number;
    }>
  | Readonly<{
      defaultValue: number;
      value?: never;
    }>;

type KnobBaseProps = Omit<
  AriaSliderProps<number>,
  | "aria-label"
  | "aria-labelledby"
  | "children"
  | "className"
  | "defaultValue"
  | "isDisabled"
  | "maxValue"
  | "minValue"
  | "orientation"
  | "value"
> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation for the 48-pixel control boundary. */
    controlXstyle?: StyleXStyles;
    density?: KnobDensity;
    disabled?: boolean;
    form?: string;
    inputRef?: RefObject<HTMLInputElement | null>;
    label: ReactNode;
    max?: number;
    min?: number;
    name?: string;
    /**
     * Keeps the output node and the native range value semantics while
     * allowing a compact composition to hide the output visually.
     *
     * @default "visible"
     */
    outputVisibility?: KnobOutputVisibility;
    /**
     * Overrides only the visible output. The native range keeps using
     * `formatOptions` for its accessible value text.
     */
    renderValue?: (value: number) => ReactNode;
    touchPan?: KnobTouchPan;
    /** Typed StyleX presentation applied after the root recipe. */
    xstyle?: StyleXStyles;
  }>;

export type KnobProps = KnobBaseProps & KnobValueProps;

type KnobSliderState = SliderRenderProps["state"];

const EMPTY_GESTURE: KnobGesture = {
  active: false,
  originValue: 0,
  pixelOffset: 0,
};

const KNOB_THUMB_GEOMETRY_STYLE = {
  height: "100%",
  left: 0,
  position: "absolute",
  top: 0,
  touchAction: "none",
  transform: "none",
  width: "100%",
} as const satisfies CSSProperties;

function knobThumbStyle(
  stylexStyle: Readonly<Record<string, number | string>> | undefined,
): CSSProperties {
  return {
    ...stylexStyle,
    ...KNOB_THUMB_GEOMETRY_STYLE,
  };
}

function knobControlPresentation(
  state: SliderTrackRenderProps,
  touchPan: KnobTouchPan,
  controlXstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    knobStyles.control,
    touchPan === "horizontal" && knobStyles.controlHorizontalTouchPan,
    state.state.isThumbDragging(0) && knobStyles.controlDragging,
    state.isDisabled && knobStyles.controlDisabled,
    !hasStylexPresentation(controlXstyle) && knobStyles.controlNativeFocus,
    controlXstyle,
  );
}

function knobControlStyle(
  state: SliderTrackRenderProps,
  touchPan: KnobTouchPan,
  controlXstyle: StyleXStyles | undefined,
): CSSProperties {
  const presentation = knobControlPresentation(state, touchPan, controlXstyle);

  // SliderTrack defaults to an inline `touch-action: none`. Keep the public
  // touch-pan contract last so horizontal rack scrolling remains available.
  return mergeStylexInlineStyles(presentation.style, {
    touchAction: touchPan === "horizontal" ? "pan-x" : "none",
  }) ?? {};
}

function validateKnobProps(
  label: ReactNode,
  min: number,
  max: number,
  step: number,
  value: number,
): void {
  if (
    label === undefined
    || label === null
    || typeof label === "boolean"
    || typeof label === "string" && label.trim().length === 0
  ) {
    throw new Error("Knob label must provide an accessible name.");
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new Error("Knob min and max must be finite, with max greater than min.");
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("Knob step must be a finite number greater than zero.");
  }
  if (!Number.isFinite(value)) {
    throw new Error("Knob value must be finite.");
  }
}

function KnobDial({
  density,
  percentage,
}: Readonly<{
  density: KnobDensity;
  percentage: number;
}>) {
  const valueArc = percentage * 75;
  const indicatorAngle = 135 + percentage * 270;
  const dialPresentation = stylex.props(
    knobStyles.dial,
    density === "compact" && knobStyles.dialCompact,
  );
  const facePresentation = stylex.props(knobStyles.face);
  const trackPresentation = stylex.props(knobStyles.arc, knobStyles.arcTrack);
  const valuePresentation = stylex.props(knobStyles.arc, knobStyles.arcValue);
  const indicatorPresentation = stylex.props(knobStyles.indicator);

  return (
    <svg
      aria-hidden="true"
      className={cn("hraness-knob__dial", dialPresentation.className)}
      data-slot="knob-dial"
      focusable="false"
      style={dialPresentation.style}
      viewBox="0 0 48 48"
    >
      <circle
        className={cn("hraness-knob__face", facePresentation.className)}
        cx="24"
        cy="24"
        data-slot="knob-face"
        r="15"
        style={facePresentation.style}
      />
      <circle
        className={cn(
          "hraness-knob__arc hraness-knob__arc--track",
          trackPresentation.className,
        )}
        cx="24"
        cy="24"
        data-slot="knob-arc-track"
        pathLength="100"
        r="19"
        strokeDasharray="75 25"
        style={trackPresentation.style}
        transform="rotate(135 24 24)"
      />
      <circle
        className={cn(
          "hraness-knob__arc hraness-knob__arc--value",
          valuePresentation.className,
        )}
        cx="24"
        cy="24"
        data-slot="knob-arc-value"
        pathLength="100"
        r="19"
        strokeDasharray={`${valueArc} 100`}
        style={valuePresentation.style}
        transform="rotate(135 24 24)"
      />
      <line
        className={cn(
          "hraness-knob__indicator",
          indicatorPresentation.className,
        )}
        data-slot="knob-indicator"
        style={indicatorPresentation.style}
        transform={`rotate(${indicatorAngle} 24 24)`}
        x1="24"
        x2="37"
        y1="24"
        y2="24"
      />
    </svg>
  );
}

function KnobGestureSurface({
  disabled,
  inputRef,
  max,
  min,
  state,
  step,
  touchPan,
}: Readonly<{
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  max: number;
  min: number;
  state: KnobSliderState;
  step: number;
  touchPan: KnobTouchPan;
}>) {
  const gestureRef = useRef<KnobGesture>(EMPTY_GESTURE);
  const canceledRef = useRef(false);
  const draggingStartedRef = useRef(false);
  const touchGestureRef = useRef<{
    deltaX: number;
    deltaY: number;
    intent: KnobTouchIntent;
  }>({
    deltaX: 0,
    deltaY: 0,
    intent: "pending",
  });
  const frameQueueRef = useRef(
    createKnobFrameQueue(
      callback => window.requestAnimationFrame(callback),
      frame => window.cancelAnimationFrame(frame),
    ),
  );
  const applyValue = (value: number): void => {
    if (value !== state.getThumbValue(0)) state.setThumbValue(0, value);
  };
  useEffect(
    () => () => frameQueueRef.current.cancel(),
    [],
  );
  const { moveProps } = useMove({
    onMoveStart({ pointerType }) {
      canceledRef.current = false;
      draggingStartedRef.current = false;
      touchGestureRef.current = {
        deltaX: 0,
        deltaY: 0,
        intent: "pending",
      };
      frameQueueRef.current.cancel();
      inputRef.current?.focus();
      gestureRef.current = beginKnobGesture(state.getThumbValue(0));
      if (!(pointerType === "touch" && touchPan === "horizontal")) {
        draggingStartedRef.current = true;
        state.setThumbDragging(0, true);
      }
    },
    onMove({ deltaX, deltaY, pointerType, shiftKey }) {
      let gestureMove = { deltaX, deltaY, isFine: shiftKey };
      if (pointerType === "touch" && touchPan === "horizontal") {
        const touchGesture = touchGestureRef.current;
        if (touchGesture.intent === "scroll") return;
        if (touchGesture.intent === "pending") {
          const totalX = touchGesture.deltaX + deltaX;
          const totalY = touchGesture.deltaY + deltaY;
          const intent = resolveKnobTouchIntent(totalX, totalY);
          touchGestureRef.current = {
            deltaX: totalX,
            deltaY: totalY,
            intent,
          };
          if (intent === "pending" || intent === "scroll") return;
          draggingStartedRef.current = true;
          state.setThumbDragging(0, true);
          gestureMove = { deltaX: totalX, deltaY: totalY, isFine: shiftKey };
        }
      }
      const update = moveKnobGesture(
        gestureRef.current,
        constrainKnobGestureMove(
          gestureMove,
          pointerType,
          touchPan,
        ),
        min,
        max,
        step,
      );
      gestureRef.current = update.gesture;
      frameQueueRef.current.enqueue(update.value, applyValue);
    },
    onMoveEnd() {
      if (!draggingStartedRef.current) {
        canceledRef.current = false;
        frameQueueRef.current.cancel();
        gestureRef.current = cancelKnobGesture(gestureRef.current).gesture;
        return;
      }
      draggingStartedRef.current = false;
      if (canceledRef.current) {
        canceledRef.current = false;
        frameQueueRef.current.cancel();
        const cancellation = cancelKnobGesture(gestureRef.current);
        gestureRef.current = cancellation.gesture;
        applyValue(cancellation.value);
        state.setThumbDragging(0, false);
        return;
      }
      frameQueueRef.current.flush(applyValue);
      const result = endKnobGesture(gestureRef.current);
      gestureRef.current = result.gesture;
      if (result.didEnd) state.setThumbDragging(0, false);
    },
  });
  const presentation = stylex.props(
    knobStyles.gesture,
    touchPan === "horizontal" && knobStyles.gestureHorizontalTouchPan,
    disabled && knobStyles.gestureDisabled,
  );

  return (
    <span
      {...(disabled ? {} : moveProps)}
      aria-hidden="true"
      className={cn("hraness-knob__gesture", presentation.className)}
      data-slot="knob-gesture"
      onPointerDownCapture={disabled ? undefined : () => inputRef.current?.focus()}
      onPointerCancelCapture={
        disabled ? undefined : () => {
          canceledRef.current = true;
        }
      }
      style={presentation.style}
    />
  );
}

/**
 * A circular single-value slider. Drag it right or up to increase, and left or
 * down to decrease. Shift-drag provides finer adjustment.
 */
export const Knob = forwardRef<HTMLDivElement, KnobProps>(
  (
    {
      className,
      controlClassName,
      controlXstyle,
      defaultValue,
      density = "default",
      disabled = false,
      form,
      inputRef: inputRefProp,
      label,
      max = 100,
      min = 0,
      name,
      outputVisibility = "visible",
      renderValue,
      step = 1,
      style,
      touchPan = "none",
      value,
      xstyle,
      ...props
    },
    ref,
  ) => {
    const fallbackInputRef = useRef<HTMLInputElement>(null);
    const inputRef = inputRefProp ?? fallbackInputRef;
    const suppliedValue = value ?? defaultValue;
    validateKnobProps(label, min, max, step, suppliedValue);
    const rootPresentation = stylex.props(knobStyles.root, xstyle);
    const thumbPresentation = stylex.props(knobStyles.thumb);

    return (
      <AriaSlider
        {...props}
        {...(defaultValue === undefined ? { value } : { defaultValue })}
        className={cn(
          "hraness-knob",
          rootPresentation.className,
          className,
        )}
        data-density={density}
        data-output-visibility={outputVisibility}
        data-slot="knob"
        data-touch-pan={touchPan}
        isDisabled={disabled}
        maxValue={max}
        minValue={min}
        orientation="horizontal"
        ref={ref}
        step={step}
        style={(state) => {
          const callerStyle = typeof style === "function" ? style(state) : style;
          return mergeStylexInlineStyles(rootPresentation.style, callerStyle);
        }}
      >
        {({ state }) => {
          const percentage = knobValuePercentage(state.getThumbValue(0), min, max);
          const labelPresentation = stylex.props(
            knobStyles.labelValue,
            knobStyles.label,
          );
          const valuePresentation = stylex.props(
            knobStyles.labelValue,
            knobStyles.value,
          );

          return (
            <>
              <SliderTrack
                className={(trackState) => {
                  const presentation = knobControlPresentation(
                    trackState,
                    touchPan,
                    controlXstyle,
                  );
                  return cn(
                    "hraness-knob__control",
                    presentation.className,
                    controlClassName,
                  );
                }}
                data-focus-indicator="true"
                data-slot="knob-control"
                style={(trackState) => knobControlStyle(
                  trackState,
                  touchPan,
                  controlXstyle,
                )}
              >
                <SliderThumb
                  className={cn(
                    "hraness-knob__thumb",
                    thumbPresentation.className,
                  )}
                  data-slot="knob-thumb"
                  inputRef={inputRef}
                  {...(form === undefined ? {} : { form })}
                  {...(name === undefined ? {} : { name })}
                  style={knobThumbStyle(thumbPresentation.style)}
                >
                  <KnobDial density={density} percentage={percentage} />
                </SliderThumb>
                <KnobGestureSurface
                  disabled={disabled}
                  inputRef={inputRef}
                  max={max}
                  min={min}
                  state={state}
                  step={step}
                  touchPan={touchPan}
                />
              </SliderTrack>
              <Label
                className={cn(
                  "hraness-knob__label",
                  labelPresentation.className,
                )}
                data-slot="knob-label"
                style={labelPresentation.style}
              >
                {label}
              </Label>
              {renderValue === undefined ? (
                <SliderOutput
                  className={cn(
                    "hraness-knob__value",
                    outputVisibility === "visually-hidden"
                      && "hraness-visually-hidden",
                    visuallyHiddenClassName(
                      outputVisibility === "visually-hidden",
                    ),
                    valuePresentation.className,
                  )}
                  data-slot="knob-value"
                />
              ) : (
                <output
                  aria-hidden="true"
                  aria-live="off"
                  className={cn(
                    "hraness-knob__value",
                    outputVisibility === "visually-hidden"
                      && "hraness-visually-hidden",
                    visuallyHiddenClassName(
                      outputVisibility === "visually-hidden",
                    ),
                    valuePresentation.className,
                  )}
                  data-slot="knob-value"
                  style={valuePresentation.style}
                >
                  {renderValue(state.getThumbValue(0))}
                </output>
              )}
            </>
          );
        }}
      </AriaSlider>
    );
  },
);

Knob.displayName = "Knob";
