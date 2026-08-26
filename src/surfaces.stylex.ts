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
