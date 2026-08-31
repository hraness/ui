import * as stylex from "@stylexjs/stylex";

export const linkStyles = stylex.create({
  focusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  hovered: {
    textDecorationThickness: "2px",
  },
  nativeInteractionFallbacks: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      textDecorationThickness: "2px",
    },
  },
  root: {
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-primary)",
    textDecoration: "underline",
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.2em",
  },
});
