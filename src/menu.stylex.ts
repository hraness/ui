import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";

export const menuStyles = stylex.create({
  copy: { display: "grid", minWidth: 0, gap: "0.125rem" },
  description: {
    color: "var(--ui-muted-foreground)", fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-regular)", lineHeight: 1.4,
  },
  footer: {
    paddingBottom: "var(--space-2)", paddingTop: "var(--space-2)",
    paddingLeft: "var(--space-3)", paddingRight: "var(--space-3)",
    "border-block-start-width": "1px", "border-block-start-style": "solid",
    "border-block-start-color": "var(--ui-border)",
    color: "var(--ui-muted-foreground)", fontSize: "var(--text-caption)",
  },
  header: {
    paddingBottom: "var(--space-2)", paddingTop: "var(--space-2)",
    paddingLeft: "var(--space-3)", paddingRight: "var(--space-3)",
    color: "var(--ui-muted-foreground)", fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
  },
  item: {
    position: "relative", display: "grid",
    minHeight: {
      default: "max(var(--interactive-target-compact), var(--hraness-menu-coarse-min, 0px))",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", gap: "var(--space-3)",
    paddingBottom: "var(--space-2)", paddingTop: "var(--space-2)",
    paddingLeft: "var(--space-3)", paddingRight: "var(--space-3)",
    borderRadius: "var(--radius-md)", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
    color: "var(--ui-popover-foreground)", cursor: "default", userSelect: "none",
  },
  itemDanger: { color: "var(--ui-destructive)" },
  itemDangerHighlighted: {
    backgroundAttachment: "scroll", backgroundClip: "border-box",
    backgroundColor: "color-mix(in oklch, var(--ui-destructive) 12%, var(--ui-popover))",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat", backgroundSize: "auto auto",
  },
  itemDisabled: { opacity: 0.5 },
  itemHighlighted: {
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-accent)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat", backgroundSize: "auto auto", color: "var(--ui-accent-foreground)",
  },
  itemSelected: { fontWeight: "var(--font-weight-medium)" },
  label: { overflowWrap: "anywhere" },
  leading: { display: "inline-grid", alignItems: "center", justifyItems: "center" },
  popover: {
    zIndex: "var(--z-tooltip)", maxWidth: "min(24rem, calc(100vw - 2rem))",
    borderWidth: "1px", borderStyle: "solid",
    borderImageOutset: 0, borderImageRepeat: "stretch", borderImageSlice: "100%", borderImageSource: "none", borderImageWidth: 1,
    borderColor: { default: "var(--ui-border)", [forcedColors]: "CanvasText" },
    borderRadius: "var(--radius-lg)", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-popover)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat", backgroundSize: "auto auto", color: "var(--ui-popover-foreground)",
    boxShadow: "var(--elevation-overlay)", forcedColorAdjust: { default: null, [forcedColors]: "auto" },
  },
  popoverEntering: {
    animationDuration: "var(--motion-duration-standard)", animationTimingFunction: "var(--motion-easing-emphasized)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  popoverExiting: {
    animationDuration: "var(--motion-duration-fast)", animationTimingFunction: "var(--motion-easing-standard)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  root: {
    display: "grid", minWidth: "12rem", maxHeight: "min(24rem, var(--visual-viewport-height, 70vh))",
    paddingBottom: "var(--space-1)", paddingTop: "var(--space-1)", paddingLeft: "var(--space-1)", paddingRight: "var(--space-1)",
    overflowX: "auto", overflowY: "auto", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
  },
  section: { display: "grid" },
  separator: {
    height: "1px", marginBlockStart: "var(--space-1)", marginBlockEnd: "var(--space-1)",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-border)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat", backgroundSize: "auto auto",
  },
  shortcut: { color: "var(--ui-muted-foreground)", fontFamily: "var(--ui-font-mono)", fontSize: "var(--text-caption)" },
});
