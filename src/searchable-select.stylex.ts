import * as stylex from "@stylexjs/stylex";

const coarse = "@media (pointer: coarse)";
const compact =
  "max(var(--hraness-field-height, var(--interactive-target-compact)), var(--hraness-field-coarse-min, 0px))";
const touchTarget = "var(--interactive-target-min)";

export const pickerStyles = stylex.create({
  control: { gap: 0 },
  disclosure: {
    minHeight: { default: compact, [coarse]: touchTarget },
    minWidth: { default: compact, [coarse]: touchTarget },
  },
  icon: {
    alignItems: "center",
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    flex: "0 0 auto",
    justifyContent: "center",
    pointerEvents: "none",
  },
  leading: { marginInlineStart: "var(--space-3)" },
  content: { alignItems: "center", display: "flex", gap: "var(--space-3)", minWidth: 0 },
  secondary: { overflowWrap: "anywhere" },
  empty: {
    color: "var(--ui-muted-foreground)",
    fontSize: "var(--text-body)",
    margin: 0,
    paddingBlock: "var(--space-3)",
    paddingInline: "var(--space-3)",
  },
  focused: {
    backgroundColor: { default: "var(--ui-accent)", "@media (forced-colors: active)": "Highlight" },
    color: {
      default: "var(--ui-accent-foreground)",
      "@media (forced-colors: active)": "HighlightText",
    },
    forcedColorAdjust: { default: "auto", "@media (forced-colors: active)": "none" },
  },
  focusText: { color: "inherit" },
  popup: {
    maxHeight: "var(--available-height, 70vh)",
    maxWidth: "calc(100vw - 1rem)",
    minWidth: 0,
  },
  list: { maxHeight: "min(22rem, var(--available-height, 70vh))", overscrollBehavior: "contain" },
});
