import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media (pointer: coarse)";
const forcedColors = "@media (forced-colors: active)";

export const checkboxFieldStyles = stylex.create({
  control: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "var(--radius-sm)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-foreground)",
    display: "grid",
    gap: "var(--space-3)",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    height: "auto",
    marginBlock: 0,
    marginInline: 0,
    minHeight: {
      default: "var(--interactive-target-compact)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingBlock: 0,
    paddingInline: 0,
    textAlign: "start",
    width: "auto",
  },
  disabled: {
    color: "var(--ui-muted-foreground)",
    cursor: "not-allowed",
    opacity: 0.62,
  },
  focusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "3px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  indicator: {
    alignItems: "center",
    backgroundColor: "var(--hraness-field-surface, var(--ui-background))",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-sm)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-primary-foreground)",
    display: "inline-grid",
    flex: "0 0 auto",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    height: "1.25rem",
    justifyItems: "center",
    lineHeight: 1,
    transitionDuration: "var(--motion-duration-fast)",
    transitionProperty: "background-color, border-color",
    transitionTimingFunction: "var(--motion-easing-standard)",
    width: "1.25rem",
  },
  invalidIndicator: {
    borderColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "CanvasText",
    },
  },
  label: {
    color: "var(--ui-foreground)",
    fontSize: "var(--text-label)",
    fontWeight: "var(--font-weight-medium)",
    lineHeight: 1.35,
    width: "fit-content",
  },
  root: {
    color: "var(--ui-foreground)",
    display: "grid",
    gap: "var(--space-2)",
    gridTemplateColumns: "minmax(0, 1fr)",
    minWidth: 0,
  },
  selectedIndicator: {
    backgroundColor: "var(--ui-primary)",
    borderColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "CanvasText",
    },
  },
});
