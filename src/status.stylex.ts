import * as stylex from "@stylexjs/stylex";

const forcedColors = "@media(forced-colors: active)";

export const statusStyles = stylex.create({
  badgeDanger: {
    backgroundColor:
      "color-mix(in oklch, var(--ui-destructive) 12%, var(--ui-card))",
    borderColor: {
      default:
        "color-mix(in oklch, var(--ui-destructive) 45%, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-destructive)",
  },
  badgeInfo: {
    backgroundColor: "var(--ui-info-soft)",
    borderColor: {
      default: "color-mix(in oklch, var(--ui-info) 45%, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-info)",
  },
  badgeNeutral: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-secondary-foreground)",
  },
  badgeSuccess: {
    backgroundColor: "var(--ui-success-soft)",
    borderColor: {
      default:
        "color-mix(in oklch, var(--ui-success) 45%, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-success)",
  },
  badgeWarning: {
    backgroundColor: "var(--ui-warning-soft)",
    borderColor: {
      default:
        "color-mix(in oklch, var(--ui-warning) 45%, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-warning)",
  },
  dotDanger: {
    backgroundColor: "var(--ui-destructive)",
  },
  dotInfo: {
    backgroundColor: "var(--ui-info)",
  },
  dotNeutral: {
    backgroundColor: "var(--ui-muted-foreground)",
  },
  dotRoot: {
    borderColor: "color-mix(in oklch, currentColor 35%, transparent)",
    borderRadius: "var(--radius-round)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "inline-block",
    flex: "0 0 auto",
    height: "0.625rem",
    width: "0.625rem",
  },
  dotSuccess: {
    backgroundColor: "var(--ui-success)",
  },
  dotWarning: {
    backgroundColor: "var(--ui-warning)",
  },
  pillRoot: {
    alignItems: "center",
    borderRadius: "var(--radius-round)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "inline-flex",
    fontSize: "var(--text-caption)",
    fontWeight: "var(--font-weight-medium)",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-1)",
    justifyContent: "center",
    lineHeight: 1,
    minHeight: "1.5rem",
    paddingInline: "var(--space-2)",
    whiteSpace: "nowrap",
    width: "fit-content",
  },
  tagDefault: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: {
      default: "transparent",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-secondary-foreground)",
  },
  tagIcon: {
    alignItems: "center",
    display: "inline-flex",
    flex: "0 0 auto",
    justifyContent: "center",
    lineHeight: 1,
  },
  tagLabel: {
    minWidth: 0,
  },
  tagMuted: {
    backgroundColor: "var(--ui-muted)",
    borderColor: {
      default: "transparent",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-muted-foreground)",
  },
  tagOutline: {
    backgroundColor: "transparent",
    borderColor: {
      default: "var(--hraness-tag-accent, var(--ui-border))",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-foreground)",
  },
});
