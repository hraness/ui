import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";
const reducedMotion = "@media(prefers-reduced-motion: reduce)";

export const knobStyles = stylex.create({
  arc: {
    fill: "none",
    strokeLinecap: "round",
    strokeWidth: 3,
  },
  arcTrack: {
    stroke: {
      default: "var(--ui-muted)",
      [forcedColors]: "GrayText",
    },
  },
  arcValue: {
    stroke: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
  },
  control: {
    cursor: "grab",
    height: {
      default: "3rem",
      [coarsePointer]: "max(3rem, var(--interactive-target-min))",
    },
    minHeight: {
      default: "3rem",
      [coarsePointer]: "max(3rem, var(--interactive-target-min))",
    },
    minWidth: {
      default: "3rem",
      [coarsePointer]: "max(3rem, var(--interactive-target-min))",
    },
    position: "relative",
    touchAction: "none",
    userSelect: "none",
    width: {
      default: "3rem",
      [coarsePointer]: "max(3rem, var(--interactive-target-min))",
    },
  },
  controlDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  controlDragging: {
    cursor: "grabbing",
  },
  controlHorizontalTouchPan: {
    touchAction: "pan-x",
  },
  controlNativeFocus: {
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
  dial: {
    borderRadius: "var(--radius-round)",
    display: "block",
    height: "2.5rem",
    overflow: "visible",
    transitionDuration: {
      default: null,
      [reducedMotion]: "0s",
    },
    transitionProperty: {
      default: null,
      [reducedMotion]: "none",
    },
    width: "2.5rem",
  },
  dialCompact: {
    height: "2rem",
    width: "2rem",
  },
  face: {
    fill: {
      default: "var(--ui-card)",
      [forcedColors]: "Canvas",
    },
    stroke: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    strokeWidth: 1.5,
  },
  gesture: {
    bottom: 0,
    borderRadius: "var(--radius-round)",
    cursor: "inherit",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    touchAction: "none",
    userSelect: "none",
    zIndex: 2,
  },
  gestureDisabled: {
    pointerEvents: "none",
  },
  gestureHorizontalTouchPan: {
    touchAction: "pan-x",
  },
  indicator: {
    stroke: {
      default: "var(--ui-foreground)",
      [forcedColors]: "Highlight",
    },
    strokeLinecap: "round",
    strokeWidth: 2.5,
  },
  label: {
    fontWeight: "var(--font-weight-medium)",
  },
  labelValue: {
    fontSize: "var(--text-label)",
    lineHeight: 1.2,
    maxWidth: "100%",
    overflowWrap: "anywhere",
    textAlign: "center",
  },
  root: {
    color: "var(--ui-foreground)",
    display: "inline-grid",
    gap: "var(--space-1)",
    justifyItems: "center",
    minWidth: "3rem",
    verticalAlign: "middle",
  },
  thumb: {
    alignItems: "center",
    display: "grid",
    justifyItems: "center",
    outlineStyle: "none",
    pointerEvents: "none",
    zIndex: 1,
  },
  value: {
    color: "var(--ui-muted-foreground)",
    fontVariantNumeric: "tabular-nums",
  },
});
