import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";

export const askAiStyles = stylex.create({
  icon: {
    display: "block",
    flex: "0 0 auto",
  },
  label: {
    color: "var(--ui-muted-foreground)",
    flex: "0 0 auto",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    letterSpacing: "0.08em",
    lineHeight: 1.25,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  link: {
    ":active": {
      transform: "translateY(1px)",
    },
    ":focus-visible": {
      outlineColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "Highlight",
      },
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      backgroundColor: "var(--ui-muted)",
      borderColor: {
        default:
          "color-mix(in oklch, var(--ui-primary) 35%, var(--ui-border))",
        [forcedColors]: "CanvasText",
      },
      color: "var(--ui-foreground)",
    },
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-sm)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-1)",
    justifyContent: "center",
    lineHeight: 1,
    minHeight: {
      default: "1.875rem",
      [coarsePointer]: "var(--interactive-target-min, 3rem)",
    },
    paddingInline: "0.625rem",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  links: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  },
  root: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  },
});
