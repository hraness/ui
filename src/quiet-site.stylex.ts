import * as stylex from "@stylexjs/stylex";

// StyleX 0.19 lowers camel-case logical size aliases to physical properties.
// Its canonical dashed keys retain logical output and the matching conflict key
// required for caller-last xstyle resolution across writing modes.
export const quietSiteStyles = stylex.create({
  footer: {
    alignItems: "center",
    borderTopColor: "var(--ui-border)",
    borderTopStyle: "solid",
    borderTopWidth: "1px",
    boxSizing: "border-box",
    color: "var(--ui-muted-foreground)",
    display: "flex",
    flex: "0 0 auto",
    flexWrap: "wrap",
    gap: "var(--space-4, 1rem)",
    "inline-size": "100%",
    justifyContent: "space-between",
    marginInline: "auto",
    "max-inline-size": "var(--hraness-quiet-site-measure, 34rem)",
    "min-inline-size": 0,
    overflow: "clip",
    paddingBottom:
      "max(var(--space-5, 1.25rem), env(safe-area-inset-bottom))",
    paddingLeft:
      "max(var(--hraness-quiet-site-gutter, 1.25rem), env(safe-area-inset-left))",
    paddingRight:
      "max(var(--hraness-quiet-site-gutter, 1.25rem), env(safe-area-inset-right))",
    paddingTop: "var(--space-5, 1.25rem)",
  },
  page: {
    boxSizing: "border-box",
    flex: "1 0 auto",
    "inline-size": "100%",
    marginBlock: "clamp(2rem, 6vh, 4rem) clamp(3.5rem, 10vh, 6rem)",
    marginInline: "auto",
    "max-inline-size": "var(--hraness-quiet-site-measure, 34rem)",
    paddingInline: "var(--hraness-quiet-site-gutter, 1.25rem)",
  },
});
