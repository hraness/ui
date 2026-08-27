import * as stylex from "@stylexjs/stylex";

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
    borderColor: "var(--ui-border)",
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
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
