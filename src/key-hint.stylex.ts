import * as stylex from "@stylexjs/stylex";

export const keyHintStyles = stylex.create({
  root: {
    alignItems: "center",
    backgroundColor: "var(--ui-muted)",
    "border-block-end-width": "2px",
    borderColor: "var(--ui-border)",
    borderRadius: "var(--radius-sm)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "var(--text-caption)",
    justifyContent: "center",
    "min-block-size": "1.5rem",
    "min-inline-size": "1.5rem",
    paddingInline: "var(--space-1)",
  },
});
