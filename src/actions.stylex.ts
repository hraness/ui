import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";
const reducedMotion = "@media(prefers-reduced-motion: reduce)";
const syntheticCoarseMinimum = "var(--hraness-action-coarse-min, 0px)";

export const actionStyles = stylex.create({
  compactControl: {
    minHeight: {
      default: `max(2rem, ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    paddingInline: "var(--space-3)",
  },
  compactIconControl: {
    minHeight: {
      default: `max(2rem, ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    minWidth: {
      default: `max(2rem, ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    width: {
      default: `max(2rem, ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  control: {
    alignItems: "center",
    borderColor: {
      default: "transparent",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-md)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "inline-flex",
    fontFamily: "inherit",
    fontSize: "var(--text-label)",
    fontStretch: "inherit",
    fontStyle: "inherit",
    fontVariant: "inherit",
    fontWeight: "var(--font-weight-medium)",
    gap: "var(--space-2)",
    justifyContent: "center",
    lineHeight: 1,
    minHeight: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    minWidth: {
      default: "var(--hraness-action-coarse-min)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingInline: "var(--space-4)",
    textDecoration: "none",
    transitionDelay: "0s, 0s, 0s, 0s, 0s, 0s",
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty:
      "background-color, border-color, box-shadow, color, opacity, transform",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard)",
    userSelect: "none",
    whiteSpace: "nowrap",
    width: "100%",
  },
  copyLabel: {
    gridColumn: "1",
    gridRow: "1",
  },
  copyLabels: {
    display: "inline-grid",
  },
  danger: {
    backgroundColor: "var(--ui-destructive)",
    color: "var(--ui-destructive-foreground)",
  },
  disabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  emptyLeading: {
    visibility: "hidden",
  },
  focusVisible: {
    boxShadow:
      "0 0 0 4px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
    outlineColor: "var(--ui-ring)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  hiddenCopyLabel: {
    visibility: "hidden",
  },
  hoveredDanger: {
    backgroundColor: "var(--ui-destructive)",
    color: "var(--ui-destructive-foreground)",
  },
  hoveredPrimary: {
    backgroundColor:
      "color-mix(in oklch, var(--ui-primary) 88%, var(--ui-background))",
  },
  hoveredQuiet: {
    backgroundColor: "var(--ui-accent)",
    color: "var(--ui-accent-foreground)",
  },
  hoveredSecondary: {
    backgroundColor:
      "color-mix(in oklch, var(--ui-secondary) 82%, var(--ui-foreground))",
  },
  hoveredLabeledDanger: {
    backgroundColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-destructive-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  hoveredLabeledPrimary: {
    backgroundColor: {
      default:
        "color-mix(in oklch, var(--ui-primary) 88%, var(--ui-background))",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-primary-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  hoveredLabeledQuiet: {
    backgroundColor: {
      default: "var(--ui-accent)",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-accent-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  hoveredLabeledSecondary: {
    backgroundColor: {
      default:
        "color-mix(in oklch, var(--ui-secondary) 82%, var(--ui-foreground))",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-secondary-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  iconContent: {
    alignItems: "center",
    display: "inline-grid",
    flex: "0 0 auto",
    justifyItems: "center",
  },
  iconControl: {
    minHeight: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    minWidth: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    paddingBlock: 0,
    paddingInline: 0,
    width: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  iconOnlyToggle: {
    minWidth: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    paddingBlock: 0,
    paddingInline: 0,
    width: {
      default: `max(var(--interactive-target-compact), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  inlineContent: {
    alignItems: "center",
    display: "inline-grid",
    height: "100%",
    justifyItems: "center",
    lineHeight: 0,
    width: "100%",
  },
  inlineControl: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: "var(--radius-sm)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-primary)",
    display: "inline-grid",
    height: "1.5rem",
    justifyItems: "center",
    lineHeight: 1,
    minHeight: "1.5rem",
    minWidth: "1.5rem",
    outlineStyle: "none",
    paddingBlock: 0,
    paddingInline: 0,
    alignItems: "center",
    textDecoration: "none",
    transitionDelay: "0s, 0s, 0s, 0s",
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty: "background-color, box-shadow, color, opacity",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard)",
    width: "1.5rem",
  },
  labeledDanger: {
    backgroundColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-destructive-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  labeledPrimary: {
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-primary-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  labeledQuiet: {
    backgroundColor: {
      default: "var(--ui-background)",
      [forcedColors]: "ButtonFace",
    },
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    color: {
      default: "var(--ui-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  labeledSecondary: {
    backgroundColor: {
      default: "var(--ui-secondary)",
      [forcedColors]: "ButtonFace",
    },
    color: {
      default: "var(--ui-secondary-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  largeControl: {
    minHeight: {
      default: `max(var(--control-height-primary), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-primary)",
    },
    paddingInline: "var(--space-6)",
  },
  largeIconControl: {
    minHeight: {
      default: `max(var(--control-height-primary), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-primary)",
    },
    minWidth: {
      default: `max(var(--control-height-primary), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-primary)",
    },
    width: {
      default: `max(var(--control-height-primary), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-primary)",
    },
  },
  leading: {
    alignItems: "center",
    display: "inline-grid",
    flex: "0 0 auto",
    justifyItems: "center",
  },
  nativeDangerHover: {
    ":hover": {
      backgroundColor: "var(--ui-destructive)",
      color: "var(--ui-destructive-foreground)",
    },
  },
  nativeInteractionFallbacks: {
    ":active": {
      transform: "translateY(1px)",
    },
    ":disabled": {
      cursor: "not-allowed",
      opacity: 0.5,
    },
    ":focus-visible": {
      boxShadow:
        "0 0 0 4px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  nativeLabeledDangerHover: {
    ":hover": {
      backgroundColor: {
        default: "var(--ui-destructive)",
        [forcedColors]: "ButtonFace",
      },
      color: {
        default: "var(--ui-destructive-foreground)",
        [forcedColors]: "ButtonText",
      },
    },
  },
  nativeLabeledPrimaryHover: {
    ":hover": {
      backgroundColor: {
        default:
          "color-mix(in oklch, var(--ui-primary) 88%, var(--ui-background))",
        [forcedColors]: "ButtonFace",
      },
      color: {
        default: "var(--ui-primary-foreground)",
        [forcedColors]: "ButtonText",
      },
    },
  },
  nativeLabeledQuietHover: {
    ":hover": {
      backgroundColor: {
        default: "var(--ui-accent)",
        [forcedColors]: "ButtonFace",
      },
      color: {
        default: "var(--ui-accent-foreground)",
        [forcedColors]: "ButtonText",
      },
    },
  },
  nativeLabeledSecondaryHover: {
    ":hover": {
      backgroundColor: {
        default:
          "color-mix(in oklch, var(--ui-secondary) 82%, var(--ui-foreground))",
        [forcedColors]: "ButtonFace",
      },
      color: {
        default: "var(--ui-secondary-foreground)",
        [forcedColors]: "ButtonText",
      },
    },
  },
  nativeInlineInteractionFallbacks: {
    ":focus-visible": {
      boxShadow:
        "0 0 0 4px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      color: "var(--ui-accent-foreground)",
    },
  },
  nativePrimaryHover: {
    ":hover": {
      backgroundColor:
        "color-mix(in oklch, var(--ui-primary) 88%, var(--ui-background))",
    },
  },
  nativeQuietHover: {
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      color: "var(--ui-accent-foreground)",
    },
  },
  nativeSecondaryHover: {
    ":hover": {
      backgroundColor:
        "color-mix(in oklch, var(--ui-secondary) 82%, var(--ui-foreground))",
    },
  },
  nativeSelectedHover: {
    ":hover": {
      backgroundColor: {
        default: "var(--ui-primary)",
        [forcedColors]: "ButtonFace",
      },
      borderColor: {
        default: "var(--ui-primary)",
        [forcedColors]: "CanvasText",
      },
      color: {
        default: "var(--ui-primary-foreground)",
        [forcedColors]: "ButtonText",
      },
    },
  },
  pressed: {
    transform: "translateY(1px)",
  },
  primary: {
    backgroundColor: "var(--ui-primary)",
    color: "var(--ui-primary-foreground)",
  },
  quiet: {
    backgroundColor: "var(--ui-background)",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    color: "var(--ui-foreground)",
  },
  root: {
    display: "inline-flex",
    maxWidth: "100%",
    verticalAlign: "middle",
  },
  secondary: {
    backgroundColor: "var(--ui-secondary)",
    color: "var(--ui-secondary-foreground)",
  },
  selected: {
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "ButtonFace",
    },
    borderColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "CanvasText",
    },
    color: {
      default: "var(--ui-primary-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  spinner: {
    animationDuration: "700ms",
    animationIterationCount: "infinite",
    animationName: {
      default: "hraness-spin",
      [reducedMotion]: "none",
    },
    animationTimingFunction: "linear",
    borderBlockEndColor:
      "color-mix(in oklch, currentColor 25%, transparent)",
    borderBlockEndStyle: "solid",
    borderBlockEndWidth: "0.125em",
    borderBlockStartColor: "currentColor",
    borderBlockStartStyle: "solid",
    borderBlockStartWidth: "0.125em",
    borderInlineEndColor:
      "color-mix(in oklch, currentColor 25%, transparent)",
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: "0.125em",
    borderInlineStartColor:
      "color-mix(in oklch, currentColor 25%, transparent)",
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: "0.125em",
    borderRadius: "var(--radius-round)",
    height: "1em",
    width: "1em",
  },
  transportControl: {
    minHeight: {
      default: `max(var(--control-height-transport), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-transport)",
    },
    paddingInline: "var(--space-8)",
  },
  transportIconControl: {
    minHeight: {
      default: `max(var(--control-height-transport), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-transport)",
    },
    minWidth: {
      default: `max(var(--control-height-transport), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-transport)",
    },
    width: {
      default: `max(var(--control-height-transport), ${syntheticCoarseMinimum})`,
      [coarsePointer]: "var(--control-height-transport)",
    },
  },
});

export const actionVariantStyles = {
  danger: actionStyles.danger,
  primary: actionStyles.primary,
  quiet: actionStyles.quiet,
  secondary: actionStyles.secondary,
} as const;

export const actionLabeledVariantStyles = {
  danger: actionStyles.labeledDanger,
  primary: actionStyles.labeledPrimary,
  quiet: actionStyles.labeledQuiet,
  secondary: actionStyles.labeledSecondary,
} as const;

export const actionHoverStyles = {
  danger: actionStyles.hoveredDanger,
  primary: actionStyles.hoveredPrimary,
  quiet: actionStyles.hoveredQuiet,
  secondary: actionStyles.hoveredSecondary,
} as const;

export const actionLabeledHoverStyles = {
  danger: actionStyles.hoveredLabeledDanger,
  primary: actionStyles.hoveredLabeledPrimary,
  quiet: actionStyles.hoveredLabeledQuiet,
  secondary: actionStyles.hoveredLabeledSecondary,
} as const;

export const actionNativeHoverStyles = {
  danger: actionStyles.nativeDangerHover,
  primary: actionStyles.nativePrimaryHover,
  quiet: actionStyles.nativeQuietHover,
  secondary: actionStyles.nativeSecondaryHover,
} as const;

export const actionNativeLabeledHoverStyles = {
  danger: actionStyles.nativeLabeledDangerHover,
  primary: actionStyles.nativeLabeledPrimaryHover,
  quiet: actionStyles.nativeLabeledQuietHover,
  secondary: actionStyles.nativeLabeledSecondaryHover,
} as const;

export const actionControlSizeStyles = {
  compact: actionStyles.compactControl,
  default: null,
  large: actionStyles.largeControl,
  transport: actionStyles.transportControl,
} as const;

export const actionIconSizeStyles = {
  compact: actionStyles.compactIconControl,
  default: null,
  large: actionStyles.largeIconControl,
  transport: actionStyles.transportIconControl,
} as const;

export const linkStyles = stylex.create({
  focusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  hovered: {
    textDecorationThickness: "2px",
  },
  nativeInteractionFallbacks: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      textDecorationThickness: "2px",
    },
  },
  root: {
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-primary)",
    textDecoration: "underline",
    textDecorationThickness: "1px",
    textUnderlineOffset: "0.2em",
  },
});
