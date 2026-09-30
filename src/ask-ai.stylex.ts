import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";

// Direct paint recipes stay in the package's CSS layers. StyleX emits static
// custom-property atoms outside those layers.
export const askAiProviderAccentStyles = stylex.create({
  chatgpt: {
    backgroundColor: {
      default: "color-mix(in srgb, #0f1014 14%, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: {
      default:
        "linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, #0f1014 26%, transparent), color-mix(in srgb, #0f1014 6%, transparent) 74%)",
      [forcedColors]: "none",
    },
    color:
      "light-dark(color-mix(in srgb, #0f1014 78%, black), color-mix(in srgb, #0f1014 55%, white))",
    outline: {
      default: "1px solid color-mix(in srgb, #0f1014 28%, transparent)",
      [forcedColors]: "1px solid ButtonBorder",
    },
  },
  claude: {
    backgroundColor: {
      default: "color-mix(in srgb, #d97757 14%, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: {
      default:
        "linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, #d97757 26%, transparent), color-mix(in srgb, #d97757 6%, transparent) 74%)",
      [forcedColors]: "none",
    },
    color:
      "light-dark(color-mix(in srgb, #d97757 78%, black), color-mix(in srgb, #d97757 55%, white))",
    outline: {
      default: "1px solid color-mix(in srgb, #d97757 28%, transparent)",
      [forcedColors]: "1px solid ButtonBorder",
    },
  },
  perplexity: {
    backgroundColor: {
      default: "color-mix(in srgb, #22b8cd 14%, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: {
      default:
        "linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, #22b8cd 26%, transparent), color-mix(in srgb, #22b8cd 6%, transparent) 74%)",
      [forcedColors]: "none",
    },
    color:
      "light-dark(color-mix(in srgb, #22b8cd 78%, black), color-mix(in srgb, #22b8cd 55%, white))",
    outline: {
      default: "1px solid color-mix(in srgb, #22b8cd 28%, transparent)",
      [forcedColors]: "1px solid ButtonBorder",
    },
  },
  grok: {
    backgroundColor: {
      default: "color-mix(in srgb, #1a1a1a 14%, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: {
      default:
        "linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, #1a1a1a 26%, transparent), color-mix(in srgb, #1a1a1a 6%, transparent) 74%)",
      [forcedColors]: "none",
    },
    color:
      "light-dark(color-mix(in srgb, #1a1a1a 78%, black), color-mix(in srgb, #1a1a1a 55%, white))",
    outline: {
      default: "1px solid color-mix(in srgb, #1a1a1a 28%, transparent)",
      [forcedColors]: "1px solid ButtonBorder",
    },
  },
});

export const askAiStyles = stylex.create({
  // A soft accent-tinted tile carrying the provider mark. The color art
  // overlays the currentColor glyph, so forced-colors mode hides the art and
  // keeps a system-colored glyph. Provider recipes supply the tile colors.
  icon: {
    alignItems: "center",
    aspectRatio: "1",
    borderRadius: "26%",
    boxSizing: "border-box",
    display: "inline-flex",
    flex: "0 0 auto",
    inlineSize: "1.125rem",
    justifyContent: "center",
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
