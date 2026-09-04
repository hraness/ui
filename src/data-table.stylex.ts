import * as stylex from "@stylexjs/stylex";

export const dataTableStyles = stylex.create({
  alignCenter: {
    textAlign: "center",
  },
  alignEnd: {
    textAlign: "end",
  },
  alignStart: {
    textAlign: "start",
  },
  caption: {
    color: "var(--ui-muted-foreground)",
    paddingBlock: "var(--space-3)",
    paddingInline: "var(--space-4)",
    textAlign: "start",
  },
  cell: {
    "border-block-end-color": "var(--ui-border)",
    "border-block-end-style": "solid",
    "border-block-end-width": "1px",
    paddingBlock: "var(--space-3)",
    paddingInline: "var(--space-4)",
    verticalAlign: "top",
  },
  empty: {
    color: "var(--ui-muted-foreground)",
    height: "6rem",
    textAlign: "center !important",
  },
  header: {
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "var(--ui-muted)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    color: "var(--ui-muted-foreground)",
    fontWeight: "var(--font-weight-medium)",
  },
  table: {
    borderCollapse: "collapse",
    color: "var(--ui-foreground)",
    fontSize: "var(--text-label)",
    width: "100%",
  },
  wrapper: {
    borderColor: "var(--ui-border)",
    borderImageOutset: 0,
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: 1,
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    maxWidth: "100%",
    overflowX: "auto",
  },
});
