import * as stylex from "@stylexjs/stylex";

const forcedColors = "@media(forced-colors: active)";

export const overlayStyles = stylex.create({
  popover: { paddingTop: "var(--space-4)", paddingRight: "var(--space-4)", paddingBottom: "var(--space-4)", paddingLeft: "var(--space-4)" },
  popoverContent: { minWidth: 0, outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium" },
  popoverEntering: {
    animationDuration: "var(--motion-duration-standard)", animationTimingFunction: "var(--motion-easing-emphasized)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  popoverExiting: {
    animationDuration: "var(--motion-duration-fast)", animationTimingFunction: "var(--motion-easing-standard)",
    animationDelay: "0s", animationIterationCount: 1, animationDirection: "normal", animationFillMode: "none", animationPlayState: "running",
  },
  surface: {
    zIndex: "var(--z-tooltip)", maxWidth: "min(24rem, calc(100vw - 2rem))",
    borderWidth: "1px", borderStyle: "solid", borderColor: { default: "var(--ui-border)", [forcedColors]: "CanvasText" },
    borderImageOutset: 0, borderImageRepeat: "stretch", borderImageSlice: "100%", borderImageSource: "none", borderImageWidth: 1,
    borderRadius: "var(--radius-lg)", outlineColor: "currentColor", outlineStyle: "none", outlineWidth: "medium",
    backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-popover)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    color: "var(--ui-popover-foreground)", boxShadow: "var(--elevation-overlay)", forcedColorAdjust: { default: null, [forcedColors]: "auto" },
  },
  tooltip: {
    maxWidth: "20rem", paddingTop: "var(--space-2)", paddingRight: "var(--space-3)", paddingBottom: "var(--space-2)", paddingLeft: "var(--space-3)",
    borderRadius: "var(--radius-md)", backgroundAttachment: "scroll", backgroundClip: "border-box", backgroundColor: "var(--ui-foreground)",
    backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%", backgroundRepeat: "repeat", backgroundSize: "auto auto",
    color: "var(--ui-background)", fontSize: "var(--text-caption)", lineHeight: 1.4, pointerEvents: "none",
  },
});
