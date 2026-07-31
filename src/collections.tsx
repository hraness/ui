"use client";

import type { ReactNode, Ref } from "react";
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
} from "react-aria-components";

import { cn } from "./lib/utils.js";

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
  size = "default",
  tabsRef,
  value,
  ...props
}: TabsProps<Id>) {
  return (
    <AriaTabs
      {...props}
      className={cn("hraness-tabs", className)}
      data-slot="tabs"
      data-size={size}
      {...(defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue })}
      onSelectionChange={(key) => {
        const next = ownedStringIdForKey(items, key);
        if (next !== null) onChange?.(next);
      }}
      ref={tabsRef}
      {...(value === undefined ? {} : { selectedKey: value })}
    >
      <div className="hraness-tabs__bar" data-slot="tabs-bar">
        <TabList
          aria-label={ariaLabel}
          className="hraness-tabs__list"
          data-slot="tabs-list"
          items={items}
        >
          {(item) => (
            <Tab
              {...(item.ariaLabel === undefined ? {} : { "aria-label": item.ariaLabel })}
              className="hraness-tabs__tab"
              data-slot="tab"
              id={item.id}
              {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
            >
              {item.leading === undefined ? null : (
                <span
                  aria-hidden="true"
                  className="hraness-tabs__leading"
                  data-slot="tab-leading"
                >
                  {item.leading}
                </span>
              )}
              <span className="hraness-tabs__label" data-slot="tab-label">
                {item.label}
              </span>
              {item.badge}
            </Tab>
          )}
        </TabList>
        {end === undefined ? null : (
          <div className="hraness-tabs__end" data-slot="tabs-end">{end}</div>
        )}
      </div>
      <TabPanels
        className="hraness-tabs__panels"
        data-slot="tab-panels"
        items={items}
      >
        {(item) => (
          <TabPanel
            className="hraness-tabs__panel"
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
      className={cn("hraness-disclosure", className)}
      data-slot="disclosure"
      data-size={size}
    >
      <Heading
        className="hraness-disclosure__heading"
        data-slot="disclosure-heading"
        level={headingLevel}
      >
        <AriaButton
          className="hraness-disclosure__trigger"
          data-slot="disclosure-trigger"
          slot="trigger"
        >
          <span className="hraness-disclosure__title" data-slot="disclosure-title">
            {title}
          </span>
          <span
            aria-hidden="true"
            className="hraness-disclosure__indicator"
            data-slot="disclosure-indicator"
          >
            {indicator}
          </span>
        </AriaButton>
      </Heading>
      <AriaDisclosurePanel
        className="hraness-disclosure__panel"
        data-slot="disclosure-panel"
      >
        {children}
      </AriaDisclosurePanel>
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
      className={cn("hraness-accordion", className)}
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
      className={cn("hraness-toggle-group", className)}
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
          className="hraness-toggle-group__item"
          data-slot="toggle-group-item"
          id={item.id}
          {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
        >
          {item.leading === undefined ? null : (
            <span
              aria-hidden="true"
              className="hraness-toggle-group__leading"
              data-slot="toggle-group-leading"
            >
              {item.leading}
            </span>
          )}
          <span className="hraness-toggle-group__label" data-slot="toggle-group-label">
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
      className={cn("hraness-segmented-control", className)}
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
          className="hraness-segmented-control__item"
          data-slot="segmented-control-item"
          {...(item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled })}
          value={item.id}
        >
          <span
            aria-hidden="true"
            className="hraness-segmented-control__indicator"
            data-slot="segmented-control-indicator"
          />
          {item.leading === undefined ? null : (
            <span
              aria-hidden="true"
              className="hraness-segmented-control__leading"
              data-slot="segmented-control-leading"
            >
              {item.leading}
            </span>
          )}
          <span
            className="hraness-segmented-control__label"
            data-slot="segmented-control-label"
          >
            {item.label}
          </span>
        </AriaRadio>
      ))}
    </RadioGroup>
  );
}

export function Separator({ className, ...props }: AriaSeparatorProps) {
  return (
    <AriaSeparator
      {...props}
      className={cn("hraness-separator", className)}
      data-slot="separator"
    />
  );
}
