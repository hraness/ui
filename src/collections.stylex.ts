import * as stylex from "@stylexjs/stylex";

const coarsePointer = "@media (pointer: coarse)";
const forcedColors = "@media (forced-colors: active)";

export const collectionStyles = stylex.create({
  accordionRoot: {
    "border-block-end-color": "var(--ui-border)",
    "border-block-end-style": "solid",
    "border-block-end-width": "1px",
  },
  disclosureHeading: {
    fontFamily: "inherit",
    fontSize: "inherit",
    fontStretch: "inherit",
    fontStyle: "inherit",
    fontVariant: "inherit",
    fontWeight: "inherit",
    lineHeight: "inherit",
    marginBlock: 0,
    marginInline: 0,
  },
  disclosureIndicator: {
    flex: "0 0 auto",
    transitionProperty: "transform",
    transitionDuration: "var(--motion-duration-standard)",
    transitionTimingFunction: "var(--motion-easing-emphasized)",
  },
  disclosureIndicatorExpanded: {
    transform: "rotate(90deg)",
  },
  disclosurePanel: {
    color: "var(--ui-muted-foreground)",
    paddingBlockEnd: "var(--space-4)",
    paddingBlockStart: 0,
  },
  disclosurePanelHidden: {
    paddingBlockEnd: 0,
  },
  disclosureRoot: {
    "border-block-end-color": "var(--ui-border)",
    "border-block-end-style": "solid",
    "border-block-end-width": "1px",
  },
  disclosureTitle: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  disclosureTrigger: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-foreground)",
    display: "flex",
    fontWeight: "var(--font-weight-medium)",
    gap: "var(--space-4)",
    justifyContent: "space-between",
    minHeight: {
      default: "var(--interactive-target-min)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingBlock: "var(--space-3)",
    textAlign: "start",
    width: "100%",
  },
  disclosureTriggerCompact: {
    minHeight: "var(--interactive-target-compact)",
    paddingBlock: "var(--space-2)",
  },
  disclosureTriggerFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  disclosureTriggerLarge: {
    fontSize: "var(--text-body)",
    minHeight: "var(--control-height-primary)",
  },
  disclosureTriggerNativeFocusFallback: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  segmentedControlRoot: {
    backgroundColor: "var(--ui-muted)",
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "inline-flex",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "0.125rem",
    maxWidth: "100%",
    overflowX: "auto",
    paddingBlock: "var(--space-1)",
    paddingInline: "var(--space-1)",
    scrollbarWidth: "none",
    width: "fit-content",
  },
  segmentedControlRootCompact: {
    borderRadius: "var(--radius-md)",
    paddingBlock: "0.125rem",
    paddingInline: "0.125rem",
  },
  segmentedIndicator: {
    display: "none",
  },
  segmentedItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderStyle: "none",
    borderWidth: 0,
    borderRadius: "var(--radius-md)",
    color: "var(--ui-muted-foreground)",
    cursor: "pointer",
    display: "inline-flex",
    justifyContent: "center",
    minHeight: {
      default: "var(--interactive-target-compact)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    minWidth: {
      default: null,
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingInline: "var(--space-3)",
    transitionDuration: "var(--motion-duration-fast), var(--motion-duration-fast), var(--motion-duration-fast)",
    transitionProperty: "background-color, box-shadow, color",
    transitionTimingFunction: "var(--motion-easing-standard), var(--motion-easing-standard), var(--motion-easing-standard)",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  segmentedItemCompact: {
    borderRadius: "var(--radius-sm)",
    minHeight: "2rem",
    paddingInline: "var(--space-2)",
  },
  segmentedItemDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  segmentedItemFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "-2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  segmentedItemHovered: {
    backgroundColor: "var(--ui-accent)",
    color: "var(--ui-accent-foreground)",
  },
  segmentedItemNativeInteractionFallbacks: {
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
  segmentedItemSelected: {
    backgroundColor: {
      default: "var(--ui-background)",
      [forcedColors]: "ButtonFace",
    },
    boxShadow: "var(--elevation-low)",
    color: {
      default: "var(--ui-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  segmentedLabel: {
    alignItems: "center",
    display: "inline-grid",
    justifyItems: "center",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  tab: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "var(--radius-md)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    fontSize: "var(--text-label)",
    fontWeight: "var(--font-weight-medium)",
    justifyContent: "center",
    minHeight: {
      default: "var(--interactive-target-compact)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingInline: "var(--space-3)",
    whiteSpace: "nowrap",
  },
  tabCompact: {
    minHeight: "2rem",
    paddingInline: "var(--space-2)",
  },
  tabFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "-2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  tabNativeFocusFallback: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "-2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  tabSelected: {
    backgroundColor: {
      default: "var(--ui-background)",
      [forcedColors]: "ButtonFace",
    },
    boxShadow: "var(--elevation-low)",
    color: {
      default: "var(--ui-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  tabVertical: {
    justifyContent: "flex-start",
    textAlign: "start",
    width: "100%",
  },
  tabBar: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-3)",
    justifyContent: "space-between",
    minWidth: 0,
  },
  tabBarVertical: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  tabEnd: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  tabLabel: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  tabLeading: {
    alignItems: "center",
    display: "inline-grid",
    flex: "0 0 auto",
    justifyItems: "center",
  },
  tabList: {
    backgroundColor: {
      default: "var(--ui-muted)",
      [forcedColors]: "Canvas",
    },
    borderColor: {
      default: null,
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-lg)",
    borderStyle: {
      default: null,
      [forcedColors]: "solid",
    },
    borderWidth: {
      default: null,
      [forcedColors]: "1px",
    },
    display: "flex",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    gap: "var(--space-1)",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
    paddingBlock: "var(--space-1)",
    paddingInline: "var(--space-1)",
    width: "fit-content",
  },
  tabListVertical: {
    flexDirection: "column",
    overflowX: "visible",
    overflowY: "auto",
    width: "100%",
  },
  tabPanel: {
    minWidth: 0,
    outlineStyle: "none",
  },
  tabPanelFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "4px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  tabPanelNativeFocusFallback: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "4px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  tabPanels: {
    minWidth: 0,
  },
  tabsRoot: {
    display: "grid",
    gap: "var(--space-4)",
    minWidth: 0,
  },
  toggleGroupRoot: {
    backgroundColor: {
      default: "var(--ui-muted)",
      [forcedColors]: "Canvas",
    },
    borderColor: {
      default: "var(--ui-border)",
      [forcedColors]: "CanvasText",
    },
    borderRadius: "var(--radius-lg)",
    borderStyle: "solid",
    borderWidth: "1px",
    display: "inline-flex",
    forcedColorAdjust: {
      default: null,
      [forcedColors]: "auto",
    },
    maxWidth: "100%",
    overflowX: "auto",
    paddingBlock: "var(--space-1)",
    paddingInline: "var(--space-1)",
    width: "fit-content",
  },
  toggleGroupRootVertical: {
    flexDirection: "column",
    overflowX: "visible",
    width: "100%",
  },
  toggleItem: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: "var(--radius-md)",
    borderStyle: "none",
    borderWidth: 0,
    color: "var(--ui-muted-foreground)",
    display: "inline-flex",
    justifyContent: "center",
    minHeight: {
      default: "var(--interactive-target-compact)",
      [coarsePointer]: "var(--interactive-target-min)",
    },
    outlineStyle: "none",
    paddingInline: "var(--space-3)",
    whiteSpace: "nowrap",
  },
  toggleItemDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  toggleItemFocusVisible: {
    outlineColor: "var(--ui-ring)",
    outlineOffset: "-2px",
    outlineStyle: "solid",
    outlineWidth: "2px",
  },
  toggleItemNativeFocusFallback: {
    ":focus-visible": {
      outlineColor: "var(--ui-ring)",
      outlineOffset: "-2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    },
  },
  toggleItemSelected: {
    backgroundColor: {
      default: "var(--ui-background)",
      [forcedColors]: "ButtonFace",
    },
    boxShadow: "var(--elevation-low)",
    color: {
      default: "var(--ui-foreground)",
      [forcedColors]: "ButtonText",
    },
  },
  toggleItemVertical: {
    justifyContent: "flex-start",
    textAlign: "start",
    width: "100%",
  },
  toggleLabel: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  toggleLeading: {
    alignItems: "center",
    display: "inline-grid",
    flex: "0 0 auto",
    justifyItems: "center",
  },
});
