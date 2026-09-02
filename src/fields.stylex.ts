import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media(pointer: coarse)";
const forcedColors = "@media(forced-colors: active)";
const syntheticCoarseMinimum = "var(--hraness-field-coarse-min, 0px)";

const compactHeight = `max(var(--hraness-field-height, 2rem), ${syntheticCoarseMinimum})`;
const defaultHeight = `max(var(--hraness-field-height, var(--interactive-target-compact)), ${syntheticCoarseMinimum})`;
const largeHeight = `max(var(--hraness-field-height, var(--control-height-primary)), ${syntheticCoarseMinimum})`;

export const fieldStyles = stylex.create({
  control: {
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
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-2)",
    minWidth: 0,
    overflow: "clip",
  },
  controlCard: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-card))",
  },
  controlCompact: {
    minHeight: {
      default: compactHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  controlDefault: {
    minHeight: {
      default: defaultHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  controlFocusWithinFallback: {
    ":focus-within": {
      borderColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "CanvasText",
      },
      boxShadow: {
        default:
          "0 0 0 3px color-mix(in oklch, var(--ui-ring) 24%, transparent)",
        [forcedColors]: "none",
      },
      outlineColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "Highlight",
      },
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  controlInvalid: {
    borderColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "CanvasText",
    },
  },
  controlLarge: {
    minHeight: {
      default: largeHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  controlPane: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-muted))",
  },
  description: {
    color: "var(--ui-muted-foreground)",
    fontSize: "var(--text-caption)",
    lineHeight: 1.5,
  },
  disabled: {
    color: "var(--ui-muted-foreground)",
    cursor: "not-allowed",
    opacity: 0.62,
  },
  error: {
    color: "var(--ui-destructive)",
    fontSize: "var(--text-caption)",
    lineHeight: 1.5,
  },
  fileInput: {
    paddingInlineStart: 0,
  },
  input: {
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-foreground)",
    font: "inherit",
    minWidth: 0,
    outlineStyle: "none",
    outlineWidth: 0,
    paddingBlock: 0,
    paddingInline: "var(--space-3)",
    width: "100%",
  },
  inputCompact: {
    minHeight: {
      default: `calc(${compactHeight} - 2px)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 2px)",
    },
  },
  inputDefault: {
    minHeight: {
      default: `calc(${defaultHeight} - 2px)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 2px)",
    },
  },
  inputLarge: {
    minHeight: {
      default: `calc(${largeHeight} - 2px)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 2px)",
    },
  },
  label: {
    color: "var(--ui-foreground)",
    fontSize: "var(--text-label)",
    fontWeight: "var(--font-weight-medium)",
    lineHeight: 1.35,
    width: "fit-content",
  },
  nativeSelect: {
    ":dir(rtl)": {
      backgroundPosition: "0.75rem 50%, 1rem 50%",
    },
    appearance: {
      default: "none",
      [forcedColors]: "auto",
    },
    backgroundImage: {
      default:
        "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
      [forcedColors]: "none",
    },
    backgroundPosition:
      "calc(100% - 1rem) 50%, calc(100% - 0.75rem) 50%",
    backgroundRepeat: "no-repeat",
    backgroundSize: "0.25rem 0.25rem, 0.25rem 0.25rem",
    paddingInlineEnd: "2.5rem",
  },
  numberControl: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-background))",
    backgroundImage: "none",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-md)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "grid",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    minWidth: 0,
    overflow: "clip",
    paddingBlock: 0,
    paddingInline: 0,
  },
  numberControlCard: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-card))",
  },
  numberControlCompact: {
    gridTemplateColumns: {
      default: `${compactHeight} minmax(3rem, 1fr) ${compactHeight}`,
      [coarsePointer]: "var(--interactive-target-min) minmax(3rem, 1fr) var(--interactive-target-min)",
    },
    minHeight: {
      default: compactHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  numberControlDefault: {
    gridTemplateColumns: {
      default: `${defaultHeight} minmax(3rem, 1fr) ${defaultHeight}`,
      [coarsePointer]: "var(--interactive-target-min) minmax(3rem, 1fr) var(--interactive-target-min)",
    },
    minHeight: {
      default: defaultHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  numberControlLarge: {
    gridTemplateColumns: {
      default: `${largeHeight} minmax(3rem, 1fr) ${largeHeight}`,
      [coarsePointer]: "var(--interactive-target-min) minmax(3rem, 1fr) var(--interactive-target-min)",
    },
    minHeight: {
      default: largeHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
  },
  numberControlPane: {
    backgroundColor: "var(--hraness-field-surface, var(--ui-muted))",
  },
  numberStep: {
    alignItems: "center",
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-muted-foreground)",
    display: "grid",
    justifyItems: "center",
    minHeight: "100%",
    outlineStyle: "none",
  },
  numberStepFocusVisible: {
    boxShadow: {
      default: "inset 0 0 0 2px var(--ui-ring)",
      [forcedColors]: "none",
    },
    outlineColor: {
      default: "var(--ui-ring)",
      [forcedColors]: "Highlight",
    },
    outlineOffset: "-2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  numberStepHovered: {
    backgroundColor: "var(--ui-accent)",
    color: "var(--ui-accent-foreground)",
  },
  numberStepNativeInteractions: {
    ":focus-visible": {
      boxShadow: {
        default: "inset 0 0 0 2px var(--ui-ring)",
        [forcedColors]: "none",
      },
      outlineColor: {
        default: "var(--ui-ring)",
        [forcedColors]: "Highlight",
      },
      outlineOffset: "-2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      color: "var(--ui-accent-foreground)",
    },
  },
  options: {
    display: "grid",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  optionsHorizontal: {
    alignItems: "flex-start",
    display: "flex",
    flexWrap: "wrap",
  },
  radioDot: {
    backgroundColor: {
      default: "var(--ui-primary-foreground)",
      [forcedColors]: "HighlightText",
    },
    borderRadius: "var(--radius-round)",
    height: "0.5rem",
    width: "0.5rem",
  },
  radioIndicator: {
    alignItems: "center",
    backgroundColor: {
      default: "var(--hraness-field-surface, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: "none",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-round)",
    borderStyle: "solid",
    borderWidth: "1px",
    color: "var(--ui-primary-foreground)",
    display: "inline-grid",
    flex: "0 0 auto",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "none",
    },
    height: "1.25rem",
    justifyItems: "center",
    lineHeight: 1,
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty: "background-color, border-color",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-standard)",
    width: "1.25rem",
  },
  radioIndicatorInvalid: {
    borderColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "CanvasText",
    },
  },
  radioIndicatorSelected: {
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
    borderColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
  },
  radioSwitchControl: {
    alignItems: "center",
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderRadius: "var(--radius-sm)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-foreground)",
    display: "grid",
    gap: "var(--space-3)",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    height: "auto",
    marginBlock: 0,
    marginInline: 0,
    minHeight: {
      default: defaultHeight,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingBlock: 0,
    paddingInline: 0,
    textAlign: "start",
    width: "auto",
  },
  radioSwitchFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "3px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  radioSwitchNativeFocus: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "3px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  root: {
    color: "var(--ui-foreground)",
    display: "grid",
    gap: "var(--space-2)",
    gridTemplateColumns: "minmax(0, 1fr)",
    minWidth: 0,
  },
  searchClear: {
    alignItems: "center",
    backgroundColor: "transparent",
    backgroundImage: "none",
    borderRadius: "var(--radius-sm)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-muted-foreground)",
    display: "inline-grid",
    flex: "0 0 auto",
    justifyItems: "center",
    outlineStyle: "none",
  },
  searchClearCompact: {
    minHeight: {
      default: `calc(${compactHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
    minWidth: {
      default: `calc(${compactHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
  },
  searchClearDefault: {
    minHeight: {
      default: `calc(${defaultHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
    minWidth: {
      default: `calc(${defaultHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
  },
  searchClearFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "-2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  searchClearHovered: {
    backgroundColor: "var(--ui-accent)",
    color: "var(--ui-accent-foreground)",
  },
  searchClearLarge: {
    minHeight: {
      default: `calc(${largeHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
    minWidth: {
      default: `calc(${largeHeight} - 0.5rem)`,
      [coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)",
    },
  },
  searchClearNativeInteractions: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "-2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      color: "var(--ui-accent-foreground)",
    },
  },
  searchControl: {
    paddingInlineStart: "var(--space-3)",
  },
  searchInput: {
    paddingInline: 0,
  },
  switchThumb: {
    backgroundColor: {
      default: "var(--ui-muted-foreground)",
      [forcedColors]: "CanvasText",
    },
    backgroundImage: "none",
    borderRadius: "var(--radius-round)",
    boxShadow: {
      default: "var(--elevation-low)",
      [forcedColors]: "none",
    },
    height: "1rem",
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-standard)",
    transitionProperty: "background-color, transform",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-emphasized)",
    width: "1rem",
  },
  switchThumbSelected: {
    backgroundColor: {
      default: "var(--ui-primary-foreground)",
      [forcedColors]: "HighlightText",
    },
    transform: "translateX(1rem)",
    ":dir(rtl)": {
      transform: "translateX(-1rem)",
    },
  },
  switchTrack: {
    alignItems: "center",
    backgroundColor: {
      default: "var(--hraness-field-surface, var(--ui-background))",
      [forcedColors]: "Canvas",
    },
    backgroundImage: "none",
    borderColor: {
      default: "var(--ui-input)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-round)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "flex",
    flex: "0 0 auto",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "none",
    },
    height: "1.5rem",
    paddingBlock: "0.1875rem",
    paddingInline: "0.1875rem",
    transitionDuration:
      "var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty: "background-color, border-color",
    transitionTimingFunction:
      "var(--motion-easing-standard), var(--motion-easing-standard)",
    width: "2.5rem",
  },
  switchTrackInvalid: {
    borderColor: {
      default: "var(--ui-destructive)",
      [forcedColors]: "CanvasText",
    },
  },
  switchTrackSelected: {
    backgroundColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
    borderColor: {
      default: "var(--ui-primary)",
      [forcedColors]: "Highlight",
    },
  },
  textArea: {
    lineHeight: 1.5,
    minHeight: "7.5rem",
    paddingBlock: "var(--space-3)",
  },
  textAreaResizeNone: {
    resize: "none",
  },
  textAreaResizeVertical: {
    resize: "vertical",
  },
});

export const fieldControlSizeStyles = {
  compact: fieldStyles.controlCompact,
  default: fieldStyles.controlDefault,
  large: fieldStyles.controlLarge,
} as const;

export const fieldInputSizeStyles = {
  compact: fieldStyles.inputCompact,
  default: fieldStyles.inputDefault,
  large: fieldStyles.inputLarge,
} as const;

export const fieldSurfaceStyles = {
  card: fieldStyles.controlCard,
  default: null,
  pane: fieldStyles.controlPane,
} as const;

export const numberControlSizeStyles = {
  compact: fieldStyles.numberControlCompact,
  default: fieldStyles.numberControlDefault,
  large: fieldStyles.numberControlLarge,
} as const;

export const numberControlSurfaceStyles = {
  card: fieldStyles.numberControlCard,
  default: null,
  pane: fieldStyles.numberControlPane,
} as const;

export const searchClearSizeStyles = {
  compact: fieldStyles.searchClearCompact,
  default: fieldStyles.searchClearDefault,
  large: fieldStyles.searchClearLarge,
} as const;
