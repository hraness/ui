import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";

export const askAiStyles = stylex.create({
  // A soft accent-tinted tile carrying the provider mark. The color art
  // overlays the currentColor glyph, so forced-colors mode hides the art and
  // keeps a system-colored glyph. `--_ask-ai-accent` is set per provider.
  icon: {
    alignItems: "center",
    aspectRatio: "1",
    backgroundColor: {
      default:
        "color-mix(in srgb, var(--_ask-ai-accent) 14%, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: {
      default:
        "linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, var(--_ask-ai-accent) 26%, transparent), color-mix(in srgb, var(--_ask-ai-accent) 6%, transparent) 74%)",
      [forcedColors]: "none",
    },
    borderRadius: "26%",
    boxSizing: "border-box",
    color:
      "light-dark(color-mix(in srgb, var(--_ask-ai-accent) 78%, black), color-mix(in srgb, var(--_ask-ai-accent) 55%, white))",
    display: "inline-flex",
    flex: "0 0 auto",
    inlineSize: "1.125rem",
    justifyContent: "center",
    outline: {
      default:
        "1px solid color-mix(in srgb, var(--_ask-ai-accent) 28%, transparent)",
      [forcedColors]: "1px solid ButtonBorder",
    },
    outlineOffset: "-1px",
    position: "relative",
  },
  iconGlyph: {
    blockSize: "64%",
    display: "inline-flex",
    inlineSize: "64%",
  },
  iconArt: {
    blockSize: "68%",
    display: {
      default: "inline-flex",
      [forcedColors]: "none",
    },
    inlineSize: "68%",
    inset: "0",
    margin: "auto",
    position: "absolute",
  },
  label: {
    color: "var(--ui-muted-foreground)",
    flex: "0 0 auto",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    letterSpacing: "0.08em",
    lineHeight: 1.25,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  link: {
    ":active": {
      transform: "translateY(1px)",
    },
    ":focus-visible": {
      outlineColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "Highlight",
      },
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      backgroundColor: "var(--ui-muted)",
      borderColor: {
        default:
          "color-mix(in oklch, var(--ui-primary) 35%, var(--ui-border))",
        [forcedColors]: "CanvasText",
      },
      color: "var(--ui-foreground)",
    },
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-sm)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    fontFamily: "var(--ui-font-mono)",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-1)",
    justifyContent: "center",
    lineHeight: 1,
    minHeight: {
      default: "1.875rem",
      [coarsePointer]: "var(--interactive-target-min, 3rem)",
    },
    paddingInline: "0.625rem",
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  links: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  },
  root: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
  },
});
