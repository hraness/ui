"use client";

import {
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from "react";
import {
  Header,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  type ListBoxItemProps as AriaListBoxItemProps,
  type ListBoxProps as AriaListBoxProps,
  ListBoxSection as AriaListBoxSection,
  type ListBoxSectionProps as AriaListBoxSectionProps,
  type Key,
  type Selection,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

export type { Key, Selection };

export type ListBoxProps<T extends object> = Omit<
  AriaListBoxProps<T>,
  "className"
> & {
  readonly className?: string;
};

function ListBoxInner<T extends object>(
  { className, ...props }: ListBoxProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <AriaListBox
      {...props}
      className={cn("hraness-list-box", className)}
      data-slot="list-box"
      ref={ref}
    />
  );
}

const ForwardedListBox = forwardRef(ListBoxInner);
ForwardedListBox.displayName = "ListBox";

export const ListBox = ForwardedListBox as <T extends object>(
  props: ListBoxProps<T> & RefAttributes<HTMLDivElement>,
) => ReactElement | null;

export type ListBoxItemProps<T extends object = object> = Omit<
  AriaListBoxItemProps<T>,
  "className"
> & {
  readonly className?: string;
};

function ListBoxItemInner<T extends object>(
  { className, ...props }: ListBoxItemProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <AriaListBoxItem
      {...props}
      className={cn("hraness-list-box__item", className)}
      data-slot="list-box-item"
      ref={ref}
    />
  );
}

const ForwardedListBoxItem = forwardRef(ListBoxItemInner);
ForwardedListBoxItem.displayName = "ListBoxItem";

export const ListBoxItem = ForwardedListBoxItem as <T extends object = object>(
  props: ListBoxItemProps<T> & RefAttributes<HTMLDivElement>,
) => ReactElement | null;

export type ListBoxSectionProps<T extends object = object> = Omit<
  AriaListBoxSectionProps<T>,
  "children" | "className" | "title"
> & {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: ReactNode;
};

function ListBoxSectionInner<T extends object>(
  {
    children,
    className,
    title,
    ...props
  }: ListBoxSectionProps<T>,
  ref: ForwardedRef<HTMLElement>,
) {
  return (
    <AriaListBoxSection
      {...props}
      className={cn("hraness-list-box__section", className)}
      data-slot="list-box-section"
      ref={ref}
    >
      {title === undefined ? null : (
        <Header
          className="hraness-list-box__header"
          data-slot="list-box-header"
        >
          {title}
        </Header>
      )}
      {children}
    </AriaListBoxSection>
  );
}

const ForwardedListBoxSection = forwardRef(ListBoxSectionInner);
ForwardedListBoxSection.displayName = "ListBoxSection";

export const ListBoxSection = ForwardedListBoxSection as <
  T extends object = object,
>(
  props: ListBoxSectionProps<T> & RefAttributes<HTMLElement>,
) => ReactElement | null;
