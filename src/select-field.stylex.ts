import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";
const reducedMotion = "@media(prefers-reduced-motion: reduce)";
const syntheticCoarseMinimum = "var(--hraness-field-coarse-min, 0px)";

const compactHeight = `max(var(--hraness-field-height, 2rem), ${syntheticCoarseMinimum})`;
const defaultHeight = `max(var(--hraness-field-height, var(--interactive-target-compact)), ${syntheticCoarseMinimum})`;
const largeHeight = `max(var(--hraness-field-height, var(--control-height-primary)), ${syntheticCoarseMinimum})`;

export const selectFieldStyles = stylex.create({
  indicator: {
    color: "var(--ui-muted-foreground)",
    display: "block",
    flex: "0 0 auto",
    height: "1em",
    overflow: "visible",
    transformOrigin: "center",
    transitionDuration: "var(--motion-duration-standard)",
    transitionProperty: "transform",
    transitionTimingFunction: "var(--motion-easing-emphasized)",
    width: "1em",
  },
  indicatorOpen: {
    transform: "rotate(180deg)",
  },
  listBox: {
    display: "grid",
    maxHeight: "min(24rem, var(--visual-viewport-height, 70vh))",
    outlineStyle: "none",
    overflow: "auto",
    paddingBlock: "var(--space-1)",
    paddingInline: "var(--space-1)",
  },
  option: {
    alignContent: "center",
    borderRadius: "var(--radius-md)",
    cursor: "default",
    display: "grid",
    gap: "var(--space-3)",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    minHeight: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingBlock: "var(--space-2)",
    paddingInline: "var(--space-3)",
    position: "relative",
    userSelect: "none",
  },
  optionCheck: {
    alignSelf: "center",
    color: "var(--ui-primary)",
    fontWeight: "var(--font-weight-bold)",
  },
  optionCopy: {
    display: "grid",
    gap: "0.125rem",
    minWidth: 0,
  },
  optionDescription: {
    color: "var(--ui-muted-foreground)",
    fontSize: "var(--text-caption)",
    lineHeight: 1.4,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionFocused: {
    backgroundColor: "var(--ui-accent)",
    backgroundImage: "none",
    color: "var(--ui-accent-foreground)",
  },
  optionLabel: {
    overflowWrap: "anywhere",
  },
  optionNativeInteraction: {
    ":focus": {
      backgroundColor: "var(--ui-accent)",
      backgroundImage: "none",
      color: "var(--ui-accent-foreground)",
    },
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      backgroundImage: "none",
      color: "var(--ui-accent-foreground)",
    },
  },
  placeholder: {
    color: "var(--ui-muted-foreground)",
  },
  popover: {
    backgroundColor: "var(--ui-popover)",
    backgroundImage: "none",
    borderColor: "var(--ui-border)",
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    boxShadow: "var(--elevation-overlay)",
    color: "var(--ui-popover-foreground)",
    maxWidth: "min(28rem, calc(100vw - 2rem))",
    minWidth: "min(12rem, calc(100vw - 2rem))",
    outlineStyle: "none",
    overflow: "hidden",
    width: "var(--trigger-width)",
    zIndex: "var(--z-tooltip)",
  },
  popoverEntering: {
    animationDuration: {
      default: "var(--motion-duration-standard)",
      [reducedMotion]: "0s",
    },
    animationName: {
      default: "hraness-overlay-enter",
      [reducedMotion]: "none",
    },
    animationTimingFunction: "var(--motion-easing-emphasized)",
  },
  popoverExiting: {
    animationDuration: {
      default: "var(--motion-duration-fast)",
      [reducedMotion]: "0s",
    },
    animationName: {
      default: "hraness-overlay-exit",
      [reducedMotion]: "none",
    },
    animationTimingFunction: "var(--motion-easing-standard)",
  },
  trigger: {
    alignItems: "center",
    backgroundColor: "var(--hraness-field-surface, var(--ui-background))",
    backgroundImage: "none",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-md)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-foreground)",
    display: "flex",
    font: "inherit",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-3)",
    justifyContent: "space-between",
    minWidth: 0,
    outlineStyle: "none",
    paddingInline: "var(--space-3)",
    textAlign: "start",
    width: "100%",
  },
  triggerCard: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-card))",
  },
  triggerCompact: {
    minHeight: {
      default: compactHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  triggerDefault: {
    minHeight: {
      default: defaultHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  triggerFocusVisible: {
    borderColor: {
      default: "var(--ui-ring)",
      [forcedColors]: "CanvasText",
    },
    boxShadow:
      "0 0 0 3px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
    outlineColor: "var(--ui-ring)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  triggerHovered: {
    borderColor: {
      default:
        "color-mix(in oklch, var(--ui-input) 65%, var(--ui-foreground))",
      [forcedColors]: "CanvasText",
    },
  },
  triggerInvalid: {
    borderColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "CanvasText",
    },
    ":focus-visible": {
      borderColor: {
        default: "var(--ui-destructive)",
        [forcedColors]: "CanvasText",
      },
    },
    ":hover": {
      borderColor: {
        default: "var(--ui-destructive)",
        [forcedColors]: "CanvasText",
      },
    },
  },
  triggerLarge: {
    minHeight: {
      default: largeHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  triggerNativeInteractions: {
    ":focus-visible": {
      borderColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "CanvasText",
      },
      boxShadow:
        "0 0 0 3px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      borderColor: {
        default:
          "color-mix(in oklch, var(--ui-input) 65%, var(--ui-foreground))",
        [forcedColors]: "CanvasText",
      },
    },
  },
  triggerPane: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-muted))",
  },
  value: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export const selectTriggerSizeStyles = {
  compact: selectFieldStyles.triggerCompact,
  default: selectFieldStyles.triggerDefault,
  large: selectFieldStyles.triggerLarge,
} as const;

export const selectTriggerSurfaceStyles = {
  card: selectFieldStyles.triggerCard,
  default: null,
  pane: selectFieldStyles.triggerPane,
} as const;
