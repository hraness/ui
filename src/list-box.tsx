"use client";

import {
  createContext,
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  useContext,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Header,
  ListBox as AriaListBox,
  ListBoxContext,
  ListBoxItem as AriaListBoxItem,
  type ListBoxItemProps as AriaListBoxItemProps,
  type ListBoxItemRenderProps,
  type ListBoxProps as AriaListBoxProps,
  ListBoxSection as AriaListBoxSection,
  type ListBoxSectionProps as AriaListBoxSectionProps,
  type Key,
  type Selection,
  useSlottedContext,
} from "react-aria-components";

import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { listBoxStyles } from "./list-box.stylex.js";

export type { Key, Selection };

const HorizontalChildrenContext = createContext(false);

export type ListBoxProps<T extends object> = Omit<
  AriaListBoxProps<T>,
  "className"
> & {
  readonly className?: string;
  /** Typed StyleX presentation applied after the orientation recipe. */
  readonly xstyle?: StyleXStyles;
};

function ListBoxInner<T extends object>(
  { className, render, style, xstyle, ...props }: ListBoxProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  const inheritedRender = useSlottedContext(ListBoxContext, props.slot)?.render;
  const resolvedRender = render ?? inheritedRender;

  return (
    <AriaListBox
      {...props}
      className=""
      data-slot="list-box"
      ref={ref}
      render={(domProps, state) => {
        const isHorizontal = state.orientation === "horizontal";
        const presentation = stylex.props(
          listBoxStyles.root,
          isHorizontal && listBoxStyles.horizontalRoot,
          xstyle,
        );
        const composedProps = {
          ...domProps,
          children: (
            <HorizontalChildrenContext.Provider value={isHorizontal}>
              {domProps.children}
            </HorizontalChildrenContext.Provider>
          ),
          className: cn(
            domProps.className,
            "hraness-list-box",
            presentation.className,
            className,
          ),
          style: mergeStylexInlineStyles(presentation.style, domProps.style),
        };
        return resolvedRender === undefined
          ? <div {...composedProps} />
          : resolvedRender(composedProps, state);
      }}
      {...(style === undefined ? {} : { style })}
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
  /** Typed StyleX presentation applied after the item interaction recipes. */
  readonly xstyle?: StyleXStyles;
};

type ItemDOMRender = NonNullable<AriaListBoxItemProps<object>["render"]>;

function ListBoxItemElement({
  className,
  domProps,
  isLink,
  render,
  state,
  xstyle,
}: Readonly<{
  className: string | undefined;
  domProps: Parameters<ItemDOMRender>[0];
  isLink: boolean;
  render: ItemDOMRender | undefined;
  state: ListBoxItemRenderProps;
  xstyle: StyleXStyles | undefined;
}>) {
  // Collection builders render before the root's resolved orientation exists.
  const isHorizontalChild = useContext(HorizontalChildrenContext);
  const presentation = stylex.props(
    listBoxStyles.item,
    isHorizontalChild && listBoxStyles.horizontalChild,
    (state.isFocused || state.isHovered) && listBoxStyles.itemHighlighted,
    state.isSelected && listBoxStyles.itemSelected,
    state.isDisabled && listBoxStyles.itemDisabled,
    xstyle,
  );
  const composedProps = {
    ...domProps,
    className: cn(
      domProps.className,
      "hraness-list-box__item",
      presentation.className,
      className,
    ),
    style: mergeStylexInlineStyles(presentation.style, domProps.style),
  };
  if (render !== undefined) return render(composedProps, state);
  return isLink
    ? <a {...composedProps} />
    : <div {...composedProps} />;
}

function ListBoxItemInner<T extends object>(
  { className, render, xstyle, ...props }: ListBoxItemProps<T>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  return (
    <AriaListBoxItem
      {...props}
      className=""
      data-slot="list-box-item"
      ref={ref}
      render={(domProps, state) => (
        <ListBoxItemElement
          className={className}
          domProps={domProps}
          isLink={Boolean(props.href)}
          render={render}
          state={state}
          xstyle={xstyle}
        />
      )}
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
  readonly headerXstyle?: StyleXStyles;
  readonly title?: ReactNode;
  readonly xstyle?: StyleXStyles;
};

type SectionDOMRender = NonNullable<AriaListBoxSectionProps<object>["render"]>;

function ListBoxSectionElement({
  className,
  domProps,
  render,
  xstyle,
}: Readonly<{
  className: string | undefined;
  domProps: Parameters<SectionDOMRender>[0];
  render: SectionDOMRender | undefined;
  xstyle: StyleXStyles | undefined;
}>) {
  const isHorizontalChild = useContext(HorizontalChildrenContext);
  const presentation = stylex.props(
    listBoxStyles.section,
    isHorizontalChild && listBoxStyles.horizontalChild,
    xstyle,
  );
  const composedProps = {
    ...domProps,
    children: (
      <HorizontalChildrenContext.Provider value={false}>
        {domProps.children}
      </HorizontalChildrenContext.Provider>
    ),
    className: cn(
      domProps.className,
      "hraness-list-box__section",
      presentation.className,
      className,
    ),
    style: mergeStylexInlineStyles(presentation.style, domProps.style),
  };
  return render === undefined
    ? <section {...composedProps} />
    : render(composedProps, undefined);
}

function ListBoxSectionInner<T extends object>(
  {
    children,
    className,
    headerXstyle,
    render,
    title,
    xstyle,
    ...props
  }: ListBoxSectionProps<T>,
  ref: ForwardedRef<HTMLElement>,
) {
  const headerPresentation = stylex.props(listBoxStyles.header, headerXstyle);
  return (
    <AriaListBoxSection
      {...props}
      className=""
      data-slot="list-box-section"
      ref={ref}
      render={(domProps) => (
        <ListBoxSectionElement
          className={className}
          domProps={domProps}
          render={render}
          xstyle={xstyle}
        />
      )}
    >
      {title === undefined ? null : (
        <Header
          className={cn("hraness-list-box__header", headerPresentation.className)}
          data-slot="list-box-header"
          style={headerPresentation.style}
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
