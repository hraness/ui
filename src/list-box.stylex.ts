import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";

export const listBoxStyles = stylex.create({
  header: {
    color: "var(--ui-muted-foreground)",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    paddingBottom: "var(--space-2)",
    paddingLeft: "var(--space-3)",
    paddingRight: "var(--space-3)",
    paddingTop: "var(--space-2)",
  },
  horizontalChild: {
    flex: "0 0 auto",
  },
  horizontalRoot: {
    alignItems: "stretch",
    display: "flex",
    maxHeight: "none",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
    overflowY: "hidden",
  },
  item: {
    alignContent: "center",
    borderRadius: "var(--radius-md)",
    color: "var(--ui-popover-foreground)",
    cursor: "default",
    display: "grid",
    gap: "0.125rem",
    minHeight: {
      default: "max(var(--interactive-target-compact), var(--hraness-list-box-coarse-min, 0px))",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineColor: "currentColor",
    outlineStyle: "none",
    outlineWidth: "medium",
    paddingBottom: "var(--space-2)",
    paddingLeft: "var(--space-3)",
    paddingRight: "var(--space-3)",
    paddingTop: "var(--space-2)",
    position: "relative",
    userSelect: "none",
  },
  itemDisabled: {
    opacity: 0.5,
  },
  itemHighlighted: {
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "var(--ui-accent)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    color: "var(--ui-accent-foreground)",
  },
  itemSelected: {
    fontWeight: "var(--font-weight-medium)",
  },
  root: {
    display: "grid",
    maxHeight: "min(24rem, var(--visual-viewport-height, 70vh))",
    minWidth: "12rem",
    outlineColor: "currentColor",
    outlineStyle: "none",
    outlineWidth: "medium",
    overflowX: "auto",
    overflowY: "auto",
    paddingBottom: "var(--space-1)",
    paddingLeft: "var(--space-1)",
    paddingRight: "var(--space-1)",
    paddingTop: "var(--space-1)",
  },
  section: {
    display: "grid",
  },
});
