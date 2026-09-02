import * as stylex from "@stylexjs/stylex";

const forcedColors = "@media(forced-colors: active)";

const hoveredBorder =
  "color-mix(in oklch, var(--ui-primary) 35%, var(--ui-border))";

export const cardStyles = stylex.create({
  accent: {
    backgroundColor: "var(--ui-accent)",
    borderColor: {
      default:
        "color-mix(in oklch, var(--ui-primary) 28%, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-accent-foreground)",
  },
  cardContent: {
    paddingInline: "var(--space-6)",
  },
  cardDescription: {
    color: "var(--hraness-card-description)",
    fontSize: "var(--text-label)",
    lineHeight: 1.5,
  },
  cardFooter: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    paddingInline: "var(--space-6)",
  },
  cardHeader: {
    display: "grid",
    gap: "var(--space-2)",
    paddingInline: "var(--space-6)",
  },
  cardRoot: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
    paddingBlock: "var(--space-6)",
  },
  cardTitle: {
    color: "inherit",
    fontSize: "var(--text-heading)",
    fontWeight: "var(--font-weight-bold)",
    lineHeight: 1.2,
  },
  focusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "3px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  hovered: {
    borderColor: {
      default: hoveredBorder,
      [forcedColors]: "CanvasText",
    },
    boxShadow: "var(--elevation-raised)",
  },
  inverse: {
    backgroundColor: "var(--ui-foreground)",
    borderColor: {
      default: "var(--ui-foreground)",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-background)",
  },
  neutral: {
    backgroundColor: "var(--ui-background)",
    color: "var(--ui-foreground)",
  },
  nativeInteractionFallbacks: {
    ":active": {
      transform: "translateY(1px)",
    },
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "3px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      borderColor: {
        default: hoveredBorder,
        [forcedColors]: "CanvasText",
      },
      boxShadow: "var(--elevation-raised)",
    },
  },
  pressableRoot: {
    display: "grid",
    gap: "var(--space-4)",
    minWidth: 0,
    outlineStyle: "none",
    paddingBlock: "var(--space-6)",
    paddingInline: "var(--space-6)",
    textAlign: "start",
    transitionDelay: "0s, 0s, 0s",
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty: "border-color, box-shadow, transform",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard)",
    width: "100%",
  },
  pressed: {
    transform: "translateY(1px)",
  },
  rectangular: {
    borderRadius: "var(--radius-sharp)",
  },
  surface: {
    backgroundColor: "var(--ui-card)",
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    boxShadow: "var(--elevation-low)",
    color: "var(--ui-card-foreground)",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
  },
});
