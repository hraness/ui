"use client";

import { createElement, type ReactNode, type Ref } from "react";
import {
  Button as AriaButton,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  type DisclosureGroupProps as AriaDisclosureGroupProps,
  type DisclosureProps as AriaDisclosureProps,
  Heading,
  Radio as AriaRadio,
  RadioGroup,
  Separator as AriaSeparator,
  SeparatorContext,
  type SeparatorProps as AriaSeparatorProps,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs as AriaTabs,
  type TabsProps as AriaTabsProps,
  ToggleButton,
  ToggleButtonGroup,
  type ToggleButtonGroupProps,
  type Key,
  useSlottedContext,
} from "react-aria-components";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { collectionStyles } from "./collections.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { separatorStyles } from "./separator.stylex.js";

interface StringIdentified<Id extends string> {
  readonly id: Id;
}

function ownedStringIdForKey<Id extends string>(
  items: readonly StringIdentified<Id>[],
  key: Key,
): Id | null {
  const candidate = String(key);
  return items.find((item) => item.id === candidate)?.id ?? null;
}

function firstOwnedStringId<Id extends string>(
  items: readonly StringIdentified<Id>[],
  keys: Iterable<Key>,
): Id | null {
  const first = keys[Symbol.iterator]().next();
  return first.done ? null : ownedStringIdForKey(items, first.value);
}

function toIdList<Id extends string>(
  value: Id | readonly Id[] | null,
): readonly Id[] {
  if (value === null) return [];
  return typeof value === "string" ? [value] : value;
}

export interface TabItem<Id extends string> {
  readonly ariaLabel?: string;
  readonly badge?: ReactNode;
  readonly id: Id;
  readonly isDisabled?: boolean;
  readonly label: ReactNode;
  readonly leading?: ReactNode;
  readonly panel: ReactNode;
}

export type TabsProps<Id extends string> = Omit<
  AriaTabsProps,
  "children" | "className" | "defaultSelectedKey" | "onSelectionChange" | "selectedKey"
> & {
  readonly "aria-label": string;
  readonly className?: string;
  readonly defaultValue?: Id;
  readonly end?: ReactNode;
  readonly items: readonly [TabItem<Id>, ...TabItem<Id>[]];
  readonly onChange?: (id: Id) => void;
  readonly size?: "compact" | "default";
  readonly tabsRef?: Ref<HTMLDivElement>;
  readonly value?: Id;
};

/** A typed tab set whose labels and panels share the same source of truth. */
export function Tabs<Id extends string>({
  "aria-label": ariaLabel,
  className,
  defaultValue,
  end,
  items,
  onChange,
  orientation = "horizontal",
  size = "default",
  tabsRef,
  value,
  ...props
}: TabsProps<Id>) {
  return (
    <AriaTabs
      {...props}
      className={cn(
        "hraness-tabs",
        stylex.props(collectionStyles.tabsRoot).className,
        className,
      )}
      data-slot="tabs"
      data-size={size}
      {...(defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue })}
      onSelectionChange={(key) => {
        const next = ownedStringIdForKey(items, key);
        if (next !== null) onChange?.(next);
      }}
      orientation={orientation}
      ref={tabsRef}
      {...(value === undefined ? {} : { selectedKey: value })}
    >
      <div
        className={cn(
          "hraness-tabs__bar",
          stylex.props(
            collectionStyles.tabBar,
            orientation === "vertical" && collectionStyles.tabBarVertical,
          ).className,
        )}
        data-slot="tabs-bar"
      >
        <TabList
          aria-label={ariaLabel}
          className={cn(
            "hraness-tabs__list",
            stylex.props(
              collectionStyles.tabList,
              orientation === "vertical" && collectionStyles.tabListVertical,
            ).className,
          )}
          data-slot="tabs-list"
          items={items}
        >
          {(item) => (
            <Tab
              {...(item.ariaLabel === undefined ? {} : { "aria-label": item.ariaLabel })}
              className={(state) => cn(
                "hraness-tabs__tab",
                stylex.props(
                  collectionStyles.tab,
                  collectionStyles.tabNativeFocusFallback,
                  size === "compact" && collectionStyles.tabCompact,
                  orientation === "vertical" && collectionStyles.tabVertical,
                  state.isFocusVisible && collectionStyles.tabFocusVisible,
                  state.isSelected && collectionStyles.tabSelected,
                ).className,
              )}
              data-slot="tab"
              id={item.id}
              {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
            >
              {item.leading === undefined ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "hraness-tabs__leading",
                    stylex.props(collectionStyles.tabLeading).className,
                  )}
                  data-slot="tab-leading"
                >
                  {item.leading}
                </span>
              )}
              <span
                className={cn(
                  "hraness-tabs__label",
                  stylex.props(collectionStyles.tabLabel).className,
                )}
                data-slot="tab-label"
              >
                {item.label}
              </span>
              {item.badge}
            </Tab>
          )}
        </TabList>
        {end === undefined ? null : (
          <div
            className={cn(
              "hraness-tabs__end",
              stylex.props(collectionStyles.tabEnd).className,
            )}
            data-slot="tabs-end"
          >
            {end}
          </div>
        )}
      </div>
      <TabPanels
        className={cn(
          "hraness-tabs__panels",
          stylex.props(collectionStyles.tabPanels).className,
        )}
        data-slot="tab-panels"
        items={items}
      >
        {(item) => (
          <TabPanel
            className={(state) => cn(
              "hraness-tabs__panel",
              stylex.props(
                collectionStyles.tabPanel,
                collectionStyles.tabPanelNativeFocusFallback,
                state.isFocusVisible && collectionStyles.tabPanelFocusVisible,
              ).className,
            )}
            data-slot="tab-panel"
            id={item.id}
          >
            {item.panel}
          </TabPanel>
        )}
      </TabPanels>
    </AriaTabs>
  );
}

export type DisclosureProps = Omit<AriaDisclosureProps, "children" | "className"> & {
  readonly children: ReactNode;
  readonly className?: string;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  readonly indicator?: ReactNode;
  readonly size?: "compact" | "default" | "large";
  readonly title: ReactNode;
};

export function Disclosure({
  children,
  className,
  headingLevel = 3,
  indicator = "›",
  size = "default",
  title,
  ...props
}: DisclosureProps) {
  return (
    <AriaDisclosure
      {...props}
      className={cn(
        "hraness-disclosure",
        stylex.props(collectionStyles.disclosureRoot).className,
        className,
      )}
      data-slot="disclosure"
      data-size={size}
    >
      {({ isExpanded }) => (
        <>
          <Heading
            className={cn(
              "hraness-disclosure__heading",
              stylex.props(collectionStyles.disclosureHeading).className,
            )}
            data-slot="disclosure-heading"
            level={headingLevel}
          >
            <AriaButton
              className={(state) => cn(
                "hraness-disclosure__trigger",
                stylex.props(
                  collectionStyles.disclosureTrigger,
                  collectionStyles.disclosureTriggerNativeFocusFallback,
                  size === "compact" && collectionStyles.disclosureTriggerCompact,
                  size === "large" && collectionStyles.disclosureTriggerLarge,
                  state.isFocusVisible && collectionStyles.disclosureTriggerFocusVisible,
                ).className,
              )}
              data-slot="disclosure-trigger"
              slot="trigger"
            >
              <span
                className={cn(
                  "hraness-disclosure__title",
                  stylex.props(collectionStyles.disclosureTitle).className,
                )}
                data-slot="disclosure-title"
              >
                {title}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "hraness-disclosure__indicator",
                  stylex.props(
                    collectionStyles.disclosureIndicator,
                    isExpanded && collectionStyles.disclosureIndicatorExpanded,
                  ).className,
                )}
                data-slot="disclosure-indicator"
              >
                {indicator}
              </span>
            </AriaButton>
          </Heading>
          <AriaDisclosurePanel
            className={() => cn(
              "hraness-disclosure__panel",
              stylex.props(
                collectionStyles.disclosurePanel,
                !isExpanded && collectionStyles.disclosurePanelHidden,
              ).className,
            )}
            data-slot="disclosure-panel"
          >
            {children}
          </AriaDisclosurePanel>
        </>
      )}
    </AriaDisclosure>
  );
}

export type AccordionProps = Omit<AriaDisclosureGroupProps, "children" | "className"> & {
  readonly children: ReactNode;
  readonly className?: string;
};

/** Coordinates a set of Disclosure children with single or multiple expansion. */
export function Accordion({ children, className, ...props }: AccordionProps) {
  return (
    <AriaDisclosureGroup
      {...props}
      className={cn(
        "hraness-accordion",
        stylex.props(collectionStyles.accordionRoot).className,
        className,
      )}
      data-slot="accordion"
    >
      {children}
    </AriaDisclosureGroup>
  );
}

export interface ToggleItem<Id extends string> {
  readonly id: Id;
  readonly isDisabled?: boolean;
  readonly label: ReactNode;
  readonly leading?: ReactNode;
  readonly textValue?: string;
}

export interface ToggleGroupProps<Id extends string> {
  readonly "aria-label": string;
  readonly className?: string;
  readonly isDisabled?: boolean;
  readonly items: readonly [ToggleItem<Id>, ...ToggleItem<Id>[]];
  readonly onChange: (value: Id | readonly Id[] | null) => void;
  readonly orientation?: ToggleButtonGroupProps["orientation"];
  readonly selectionMode?: "multiple" | "single";
  readonly value: Id | readonly Id[] | null;
}

export function ToggleGroup<Id extends string>({
  "aria-label": ariaLabel,
  className,
  isDisabled = false,
  items,
  onChange,
  orientation = "horizontal",
  selectionMode = "single",
  value,
}: ToggleGroupProps<Id>) {
  const ownedSelectedKeys = toIdList(value).flatMap((candidate) => {
    const owned = ownedStringIdForKey(items, candidate);
    return owned === null ? [] : [owned];
  });
  const selectedKeys = selectionMode === "single"
    ? ownedSelectedKeys.slice(0, 1)
    : ownedSelectedKeys;
  return (
    <ToggleButtonGroup
      aria-label={ariaLabel}
      className={cn(
        "hraness-toggle-group",
        stylex.props(
          collectionStyles.toggleGroupRoot,
          orientation === "vertical" && collectionStyles.toggleGroupRootVertical,
        ).className,
        className,
      )}
      data-slot="toggle-group"
      isDisabled={isDisabled}
      onSelectionChange={(keys) => {
        if (selectionMode === "single") {
          onChange(firstOwnedStringId(items, keys));
          return;
        }
        const next = [...keys].flatMap((key) => {
          const owned = ownedStringIdForKey(items, key);
          return owned === null ? [] : [owned];
        });
        onChange(next);
      }}
      orientation={orientation}
      selectedKeys={selectedKeys}
      selectionMode={selectionMode}
    >
      {items.map((item) => (
        <ToggleButton
          key={item.id}
          {...(item.textValue === undefined ? {} : { "aria-label": item.textValue })}
          className={(state) => cn(
            "hraness-toggle-group__item",
            stylex.props(
              collectionStyles.toggleItem,
              collectionStyles.toggleItemNativeFocusFallback,
              orientation === "vertical" && collectionStyles.toggleItemVertical,
              state.isDisabled && collectionStyles.toggleItemDisabled,
              state.isFocusVisible && collectionStyles.toggleItemFocusVisible,
              state.isSelected && collectionStyles.toggleItemSelected,
            ).className,
          )}
          data-slot="toggle-group-item"
          id={item.id}
          {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
        >
          {item.leading === undefined ? null : (
            <span
              aria-hidden="true"
              className={cn(
                "hraness-toggle-group__leading",
                stylex.props(collectionStyles.toggleLeading).className,
              )}
              data-slot="toggle-group-leading"
            >
              {item.leading}
            </span>
          )}
          <span
            className={cn(
              "hraness-toggle-group__label",
              stylex.props(collectionStyles.toggleLabel).className,
            )}
            data-slot="toggle-group-label"
          >
            {item.label}
          </span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export interface SegmentedItem<Id extends string> {
  readonly ariaLabel?: string;
  readonly id: Id;
  readonly isDisabled?: boolean;
  readonly label: ReactNode;
  readonly leading?: ReactNode;
}

export interface SegmentedControlProps<Id extends string> {
  readonly "aria-label": string;
  readonly className?: string;
  readonly isDisabled?: boolean;
  readonly items: readonly [SegmentedItem<Id>, ...SegmentedItem<Id>[]];
  readonly onChange: (id: Id) => void;
  readonly size?: "compact" | "default";
  readonly value: Id;
}

export function SegmentedControl<Id extends string>({
  "aria-label": ariaLabel,
  className,
  isDisabled = false,
  items,
  onChange,
  size = "default",
  value,
}: SegmentedControlProps<Id>) {
  const fallbackValue = items.find((item) => item.isDisabled !== true)?.id ?? items[0].id;
  const normalizedValue = ownedStringIdForKey(items, value) ?? fallbackValue;
  return (
    <RadioGroup
      aria-label={ariaLabel}
      className={cn(
        "hraness-segmented-control",
        stylex.props(
          collectionStyles.segmentedControlRoot,
          size === "compact" && collectionStyles.segmentedControlRootCompact,
        ).className,
        className,
      )}
      data-slot="segmented-control"
      data-size={size}
      isDisabled={isDisabled}
      onChange={(key) => {
        const next = ownedStringIdForKey(items, key);
        if (next !== null) onChange(next);
      }}
      orientation="horizontal"
      value={normalizedValue}
    >
      {items.map((item) => (
        <AriaRadio
          key={item.id}
          {...(item.ariaLabel === undefined ? {} : { "aria-label": item.ariaLabel })}
          className={(state) => cn(
            "hraness-segmented-control__item",
            stylex.props(
              collectionStyles.segmentedItem,
              collectionStyles.segmentedItemNativeInteractionFallbacks,
              size === "compact" && collectionStyles.segmentedItemCompact,
              state.isDisabled && collectionStyles.segmentedItemDisabled,
              state.isFocusVisible && collectionStyles.segmentedItemFocusVisible,
              !state.isSelected && state.isHovered && collectionStyles.segmentedItemHovered,
              state.isSelected && collectionStyles.segmentedItemSelected,
            ).className,
          )}
          data-slot="segmented-control-item"
          {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
          value={item.id}
        >
          <span
            aria-hidden="true"
            className={cn(
              "hraness-segmented-control__indicator",
              stylex.props(collectionStyles.segmentedIndicator).className,
            )}
            data-slot="segmented-control-indicator"
          />
          {item.leading === undefined ? null : (
            <span
              aria-hidden="true"
              className={cn(
                "hraness-segmented-control__leading",
                stylex.props(collectionStyles.toggleLeading).className,
              )}
              data-slot="segmented-control-leading"
            >
              {item.leading}
            </span>
          )}
          <span
            className={cn(
              "hraness-segmented-control__label",
              stylex.props(collectionStyles.segmentedLabel).className,
            )}
            data-slot="segmented-control-label"
          >
            {item.label}
          </span>
        </AriaRadio>
      ))}
    </RadioGroup>
  );
}

export type SeparatorProps = Omit<AriaSeparatorProps, "className"> & Readonly<{
  readonly className?: string;
  /** Typed StyleX presentation applied after the orientation recipe. */
  readonly xstyle?: StyleXStyles;
}>;

export function Separator({
  className,
  elementType,
  orientation,
  render,
  style,
  xstyle,
  ...props
}: SeparatorProps) {
  const inheritedProps = useSlottedContext(SeparatorContext, props.slot);
  const resolvedOrientation = orientation
    ?? inheritedProps?.orientation
    ?? "horizontal";
  const resolvedElementType = elementType
    ?? inheritedProps?.elementType
    ?? "hr";
  const renderedElementType = resolvedElementType === "hr"
      && resolvedOrientation === "vertical"
    ? "div"
    : resolvedElementType;
  const resolvedRender = render ?? inheritedProps?.render;

  return (
    <AriaSeparator
      {...props}
      className=""
      data-slot="separator"
      render={(domProps) => {
        const presentation = stylex.props(
          separatorStyles.root,
          resolvedOrientation === "vertical" && separatorStyles.vertical,
          xstyle,
        );
        const composedProps = {
          ...domProps,
          className: cn(
            domProps.className,
            "hraness-separator",
            presentation.className,
            className,
          ),
          style: mergeStylexInlineStyles(
            presentation.style,
            domProps.style,
          ),
        };

        return resolvedRender === undefined
          ? createElement(renderedElementType, composedProps)
          : resolvedRender(composedProps, undefined);
      }}
      {...(elementType === undefined ? {} : { elementType })}
      {...(orientation === undefined ? {} : { orientation })}
      {...(style === undefined ? {} : { style })}
    />
  );
}
