import * as stylex from "@stylexjs/stylex";

const forcedColors = "@media(forced-colors: active)";

export const toolbarStyles = stylex.create({
  nativeFocusFallback: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  root: {
    alignItems: "center",
    backgroundColor: "var(--ui-card)",
    borderColor: {
      default: "var(--ui-surface-edge)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    boxShadow: "var(--elevation-low)",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-1)",
    minWidth: 0,
    paddingBlock: "var(--space-1)",
    paddingInline: "var(--space-1)",
  },
  vertical: {
    alignItems: "stretch",
    flexDirection: "column",
    flexWrap: "nowrap",
    width: "fit-content",
  },
});
