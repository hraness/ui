import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";

export const dialogStyles = stylex.create({
  body: {
    minWidth: 0, paddingTop: 0, paddingRight: "var(--space-6)",
    paddingBottom: "var(--space-6)", paddingLeft: "var(--space-6)", overflowY: "auto",
  },
  close: {
    position: "absolute", "inset-block-start": "var(--space-3)", insetInlineEnd: "var(--space-3)",
    display: "inline-grid", width: "var(--interactive-target-compact)", minWidth: "var(--interactive-target-compact)",
    minHeight: {
      default: "max(var(--interactive-target-compact), var(--hraness-dialog-coarse-min, 0px))",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    alignItems: "center", justifyItems: "center",
    borderWidth: 0, borderStyle: "none", borderColor: "currentColor",
    borderImageOutset: 0, borderImageRepeat: "stretch", borderImageSlice: "100%", borderImageSource: "none", borderImageWidth: 1,
    borderRadius: "var(--radius-md)", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "transparent",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    color: "var(--ui-muted-foreground)",
  },
  closeFocusVisible: { outlineColor: "var(--ui-ring)", outlineStyle: "solid", outlineWidth: "2px", outlineOffset: "2px" },
  closeHovered: {
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-accent)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    color: "var(--ui-accent-foreground)",
  },
  closeNativeInteraction: {
    backgroundAttachment: { default: null, ":hover": "scroll" },
    backgroundClip: { default: null, ":hover": "border-box" },
    backgroundColor: { default: null, ":hover": "var(--ui-accent)" },
    backgroundImage: { default: null, ":hover": "none" },
    backgroundOrigin: { default: null, ":hover": "padding-box" },
    backgroundPosition: { default: null, ":hover": "0% 0%" },
    backgroundRepeat: { default: null, ":hover": "repeat" },
    backgroundSize: { default: null, ":hover": "auto auto" },
    color: { default: null, ":hover": "var(--ui-accent-foreground)" },
    outlineColor: { default: null, ":focus-visible": "var(--ui-ring)" },
    outlineStyle: { default: null, ":focus-visible": "solid" },
    outlineWidth: { default: null, ":focus-visible": "2px" },
    outlineOffset: { default: null, ":focus-visible": "2px" },
  },
  content: {
    display: "grid", minWidth: 0, minHeight: 0, gridTemplateRows: "auto minmax(0, 1fr) auto",
    outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
  },
  description: { color: "var(--ui-muted-foreground)", fontSize: "var(--text-label)", lineHeight: 1.5 },
  footer: {
    display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "var(--space-2)",
    paddingTop: "var(--space-4)", paddingBottom: "var(--space-4)", paddingLeft: "var(--space-6)", paddingRight: "var(--space-6)",
    "border-block-start-width": "1px", "border-block-start-style": "solid", "border-block-start-color": "var(--ui-border)",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-muted)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
  },
  header: {
    display: "grid", gap: "var(--space-2)", paddingTop: "var(--space-6)", paddingBottom: "var(--space-4)",
    paddingLeft: "var(--space-6)", paddingRight: "var(--space-6)",
  },
  heading: { display: "grid", minWidth: 0, gap: "var(--space-2)", paddingInlineEnd: "var(--interactive-target-compact)" },
  overlay: {
    position: "fixed", zIndex: "var(--z-modal)", top: 0, right: 0, bottom: 0, left: 0,
    display: "grid", paddingTop: "var(--space-4)", paddingBottom: "var(--space-4)", paddingLeft: "var(--space-4)", paddingRight: "var(--space-4)",
    alignItems: "center", justifyItems: "center", overflowY: "auto",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "color-mix(in oklch, black 55%, transparent)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    overscrollBehaviorX: "contain", overscrollBehaviorY: "contain",
  },
  overlayEntering: {
    animationDuration: "var(--motion-duration-standard)", animationTimingFunction: "var(--motion-easing-standard)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  overlayExiting: {
    animationDuration: "var(--motion-duration-fast)", animationTimingFunction: "var(--motion-easing-standard)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  root: {
    position: "relative", display: "grid", width: "min(32rem, 100%)", maxHeight: "min(42rem, calc(100dvh - 2rem))",
    overflowX: "hidden", overflowY: "hidden", borderWidth: "1px", borderStyle: "solid",
    borderColor: { default: "var(--ui-border)", [forcedColors]: "CanvasText" },
    borderImageOutset: 0, borderImageRepeat: "stretch", borderImageSlice: "100%", borderImageSource: "none", borderImageWidth: 1,
    borderRadius: "var(--radius-lg)", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-card)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    color: "var(--ui-card-foreground)", boxShadow: "var(--elevation-overlay)", forcedColorAdjust: { default: null, [forcedColors]: "auto" },
  },
  rootLarge: { width: "min(48rem, 100%)" },
  rootSmall: { width: "min(24rem, 100%)" },
  title: { color: "var(--ui-card-foreground)", fontSize: "var(--text-heading)", fontWeight: "var(--font-weight-bold)", lineHeight: 1.2 },
});
