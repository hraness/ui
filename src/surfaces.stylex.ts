import * as stylex from "@stylexjs/stylex";

export const structuralSurfaceStyles = stylex.create({
  viewportFrame: {
    // The package build collapses firstThatWorks to one declaration. Nested
    // capability checks keep every fallback and give dvh precedence over svh.
    height: {
      default: "100vh",
      "@supports (height: 100svh)": {
        default: "100svh",
        "@supports (height: 100dvh)": "100dvh",
      },
    },
    "inline-size": "100%",
    "min-inline-size": 0,
    overflow: "hidden",
  },
  wrappingRow: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-3)",
    "min-inline-size": 0,
  },
});

export const themedSurfaceStyles = stylex.create({
  accent: {
    backgroundColor: "var(--ui-accent)",
    color: "var(--ui-accent-foreground)",
  },
  base: {
    backgroundColor: "var(--ui-card)",
    borderColor: "var(--ui-border)",
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-card-foreground)",
    "min-inline-size": 0,
    paddingBlock: "var(--space-6)",
    paddingInline: "var(--space-6)",
  },
  inverse: {
    backgroundColor: "var(--ui-foreground)",
    borderColor: "var(--ui-foreground)",
    color: "var(--ui-background)",
  },
  popover: {
    backgroundColor: "var(--ui-popover)",
    boxShadow: "var(--elevation-raised)",
    color: "var(--ui-popover-foreground)",
  },
  rectangular: {
    borderRadius: "var(--radius-sharp)",
  },
  secondary: {
    backgroundColor: "var(--ui-secondary)",
    color: "var(--ui-secondary-foreground)",
  },
});
