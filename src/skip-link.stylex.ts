import * as stylex from "@stylexjs/stylex";

export const skipLinkStyles = stylex.create({
  root: {
    alignItems: "center",
    // Match `background: var(--ui-foreground)`, including its longhand resets.
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "var(--ui-foreground)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    borderRadius: "var(--radius-md)",
    color: "var(--ui-background)",
    display: "inline-flex",
    fontWeight: "var(--font-weight-medium)",
    "inset-block-start": "var(--space-3)",
    "inset-inline-start": "var(--space-3)",
    minHeight: "var(--interactive-target-min)",
    paddingInline: "var(--space-4)",
    position: "fixed",
    transform: "translateY(calc(-100% - var(--space-6)))",
    zIndex: "var(--z-skip-link)",
    ":focus": {
      transform: "translateY(0)",
    },
  },
});
