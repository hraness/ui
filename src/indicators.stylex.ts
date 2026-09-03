import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";
const reducedMotion = "@media(prefers-reduced-motion: reduce)";

export const indicatorStyles = stylex.create({
  fill: {
    // Match the legacy background shorthand, including its reset semantics.
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderRadius: "inherit",
    display: "block",
    forcedColorAdjust: "none",
    height: "100%",
  },
  indeterminateFill: {
    animationComposition: { default: "replace", [reducedMotion]: "replace" },
    animationDelay: { default: "0s", [reducedMotion]: "0s" },
    animationDirection: { default: "normal", [reducedMotion]: "normal" },
    animationDuration: { default: "1.25s", [reducedMotion]: "0s" },
    animationFillMode: { default: "none", [reducedMotion]: "none" },
    animationIterationCount: { default: "infinite", [reducedMotion]: 1 },
    animationName: {
      default: "hraness-progress-indeterminate",
      [reducedMotion]: "none",
    },
    animationPlayState: { default: "running", [reducedMotion]: "running" },
    animationRangeEnd: { default: "normal", [reducedMotion]: "normal" },
    animationRangeStart: { default: "normal", [reducedMotion]: "normal" },
    animationTimeline: { default: "auto", [reducedMotion]: "auto" },
    animationTimingFunction: { default: "ease-in-out", [reducedMotion]: "ease" },
    width: "40% !important",
    ":dir(rtl)": {
      animationDirection: "reverse",
    },
  },
  label: {
    fontWeight: "var(--font-weight-medium)",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  labelRow: {
    alignItems: "baseline",
    display: "flex",
    fontSize: "var(--text-label)",
    gap: "var(--space-3)",
    justifyContent: "space-between",
  },
  meterDanger: {
    backgroundColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "Highlight",
    },
  },
  meterSuccess: {
    backgroundColor: {
      default: "var(--ui-success)",
      [forcedColors]: "Highlight",
    },
  },
  meterWarning: {
    backgroundColor: {
      default: "var(--ui-warning)",
      [forcedColors]: "Highlight",
    },
  },
  root: {
    display: "grid",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  sliderFill: {
    // Match the legacy background shorthand, including its reset semantics.
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderRadius: "inherit",
    forcedColorAdjust: "none",
    height: "100%",
    position: "absolute",
  },
  sliderRootVertical: {
    minHeight: "12rem",
    width: "fit-content",
  },
  sliderThumb: {
    alignItems: "center",
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "transparent",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderColor: "currentColor",
    borderImageOutset: 0,
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: 1,
    borderStyle: "none",
    borderWidth: 0,
    display: "flex",
    height: {
      default: "max(1.25rem, var(--hraness-slider-coarse-min, 0px))",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    justifyContent: "center",
    outlineStyle: "none",
    width: {
      default: "max(1.25rem, var(--hraness-slider-coarse-min, 0px))",
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  sliderThumbFocusVisible: {
    outlineColor: {
      default: "var(--ui-ring)",
      [forcedColors]: "Highlight",
    },
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  sliderThumbIndicator: {
    // Preserve the old solid background and border shorthand resets on the
    // visible 20-pixel affordance after splitting it from the hit boundary.
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: {
      default: "var(--ui-background)",
      [forcedColors]: "Canvas",
    },
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
    borderImageOutset: 0,
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: 1,
    borderRadius: "var(--radius-round)",
    borderStyle: "solid",
    borderWidth: "2px",
    boxShadow: {
      default: "var(--elevation-low)",
      [forcedColors]: "none",
    },
    boxSizing: "border-box",
    height: "1.25rem",
    pointerEvents: "none",
    width: "1.25rem",
  },
  sliderThumbHorizontal: {
    top: "50%",
  },
  sliderThumbNativeFocusFallback: {
    ":has(input:focus-visible)": {
      outlineColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "Highlight",
      },
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  sliderThumbVertical: {
    left: "50%",
  },
  sliderTrack: {
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    borderRadius: "var(--radius-round)",
    backgroundColor: "var(--ui-muted)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    height: "0.5rem",
    overflow: "visible",
    position: "relative",
  },
  sliderTrackVertical: {
    height: "10rem",
    justifySelf: "center",
    width: "0.5rem",
  },
  track: {
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "var(--ui-muted)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderRadius: "var(--radius-round)",
    height: "0.5rem",
    overflow: "hidden",
    position: "relative",
  },
  value: {
    color: "var(--ui-muted-foreground)",
    flex: "0 0 auto",
    fontVariantNumeric: "tabular-nums",
  },
});
