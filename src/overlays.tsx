"use client";

import type { ReactElement, ReactNode, Ref } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Header,
  Heading,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Modal as AriaModal,
  ModalOverlay,
  type ModalOverlayProps,
  Popover as AriaPopover,
  type PopoverProps as AriaPopoverProps,
  Separator as AriaSeparator,
  Text,
  Tooltip as AriaTooltip,
  type TooltipProps as AriaTooltipProps,
  TooltipTrigger,
  type TooltipTriggerComponentProps,
  Button as AriaButton,
  type Placement,
} from "react-aria-components";

import { cn } from "./lib/utils.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { menuStyles } from "./menu.stylex.js";
import { dialogStyles } from "./dialog.stylex.js";
import { overlayStyles } from "./overlays.stylex.js";

export { DialogTrigger, MenuTrigger };
export type { Placement };

type MenuSelectionProps = Pick<
  AriaMenuProps<object>,
  | "defaultSelectedKeys"
  | "disabledKeys"
  | "disallowEmptySelection"
  | "onSelectionChange"
  | "selectedKeys"
  | "selectionMode"
>;

export interface MenuProps extends MenuSelectionProps {
  readonly "aria-label": string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly footer?: ReactNode;
  readonly matchTriggerWidth?: boolean;
  readonly menuRef?: Ref<HTMLDivElement>;
  readonly onAction?: (key: string) => void;
  readonly placement?: Placement;
  readonly popoverClassName?: string;
  readonly shouldCloseOnSelect?: boolean;
  readonly xstyle?: StyleXStyles;
  readonly popoverXstyle?: StyleXStyles;
  readonly footerXstyle?: StyleXStyles;
}

export function Menu({
  "aria-label": ariaLabel,
  children,
  className,
  defaultSelectedKeys,
  disabledKeys,
  disallowEmptySelection,
  footer,
  matchTriggerWidth = false,
  menuRef,
  onAction,
  onSelectionChange,
  placement = "bottom end",
  popoverClassName,
  selectedKeys,
  selectionMode,
  shouldCloseOnSelect = true,
  xstyle,
  popoverXstyle,
  footerXstyle,
}: MenuProps) {
  const presentation = stylex.props(menuStyles.root, xstyle);
  const footerPresentation = stylex.props(menuStyles.footer, footerXstyle);
  const popoverPresentation = (state: { isEntering: boolean; isExiting: boolean }) => stylex.props(
    menuStyles.popover,
    state.isEntering && menuStyles.popoverEntering,
    state.isExiting && menuStyles.popoverExiting,
    popoverXstyle,
  );
  return (
    <AriaPopover
      className={(state) => cn("hraness-menu-popover", popoverPresentation(state).className, popoverClassName)}
      data-match-trigger-width={matchTriggerWidth || undefined}
      data-slot="menu-popover"
      offset={6}
      placement={placement}
      style={(state) => mergeStylexInlineStyles(popoverPresentation(state).style, matchTriggerWidth ? { minWidth: "var(--trigger-width)" } : undefined)}
    >
      <AriaMenu
        aria-label={ariaLabel}
        className={cn("hraness-menu", presentation.className, className)}
        {...(presentation.style === undefined ? {} : { style: presentation.style })}
        data-slot="menu"
        {...(defaultSelectedKeys === undefined ? {} : { defaultSelectedKeys })}
        {...(disabledKeys === undefined ? {} : { disabledKeys })}
        {...(disallowEmptySelection === undefined ? {} : { disallowEmptySelection })}
        {...(onAction === undefined
          ? {}
          : { onAction: (key) => onAction(String(key)) })}
        {...(onSelectionChange === undefined ? {} : { onSelectionChange })}
        ref={menuRef}
        {...(selectedKeys === undefined ? {} : { selectedKeys })}
        {...(selectionMode === undefined ? {} : { selectionMode })}
        shouldCloseOnSelect={shouldCloseOnSelect}
      >
        {children}
      </AriaMenu>
      {footer === undefined ? null : (
        <div className={cn("hraness-menu__footer", footerPresentation.className)} style={footerPresentation.style} data-slot="menu-footer">{footer}</div>
      )}
    </AriaPopover>
  );
}

export type MenuItemProps = Omit<
  AriaMenuItemProps,
  "children" | "className" | "id" | "textValue"
> & {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly id: string;
  readonly leading?: ReactNode;
  readonly shortcut?: ReactNode;
  /** Required for deterministic typeahead when labels contain rich content. */
  readonly textValue: string;
  readonly variant?: "danger" | "default";
  readonly xstyle?: StyleXStyles;
};

export function MenuItem({
  children,
  className,
  description,
  leading,
  shortcut,
  textValue,
  variant = "default",
  xstyle,
  style,
  ...props
}: MenuItemProps) {
  return (
    <AriaMenuItem
      {...props}
      className={(state) => cn("hraness-menu__item", stylex.props(
        menuStyles.item,
        (state.isFocused || state.isHovered) && menuStyles.itemHighlighted,
        state.isSelected && menuStyles.itemSelected,
        state.isDisabled && menuStyles.itemDisabled,
        variant === "danger" && menuStyles.itemDanger,
        variant === "danger" && (state.isFocused || state.isHovered) && menuStyles.itemDangerHighlighted,
        xstyle,
      ).className, className)}
      style={(state) => mergeStylexInlineStyles(stylex.props(
        menuStyles.item,
        (state.isFocused || state.isHovered) && menuStyles.itemHighlighted,
        state.isSelected && menuStyles.itemSelected,
        state.isDisabled && menuStyles.itemDisabled,
        variant === "danger" && menuStyles.itemDanger,
        variant === "danger" && (state.isFocused || state.isHovered) && menuStyles.itemDangerHighlighted,
        xstyle,
      ).style, typeof style === "function" ? style(state) : style)}
      data-has-description={description === undefined ? undefined : "true"}
      data-slot="menu-item"
      data-variant={variant}
      textValue={textValue}
    >
      {leading === undefined ? null : (
        <span
          aria-hidden="true"
          {...stylex.props(menuStyles.leading)}
          className={cn("hraness-menu__leading", stylex.props(menuStyles.leading).className)}
          data-slot="menu-item-leading"
        >
          {leading}
        </span>
      )}
      <span {...stylex.props(menuStyles.copy)} className={cn("hraness-menu__copy", stylex.props(menuStyles.copy).className)} data-slot="menu-item-copy">
        <Text {...stylex.props(menuStyles.label)} className={cn("hraness-menu__label", stylex.props(menuStyles.label).className)} data-slot="menu-item-label" slot="label">
          {children}
        </Text>
        {description === undefined ? null : (
          <Text
            {...stylex.props(menuStyles.description)}
            className={cn("hraness-menu__description", stylex.props(menuStyles.description).className)}
            data-slot="menu-item-description"
            slot="description"
          >
            {description}
          </Text>
        )}
      </span>
      {shortcut === undefined ? null : (
        <Keyboard {...stylex.props(menuStyles.shortcut)} className={cn("hraness-menu__shortcut", stylex.props(menuStyles.shortcut).className)} data-slot="menu-item-shortcut">
          {shortcut}
        </Keyboard>
      )}
    </AriaMenuItem>
  );
}

export function MenuSeparator({ className, xstyle }: { readonly className?: string; readonly xstyle?: StyleXStyles }) {
  const presentation = stylex.props(menuStyles.separator, xstyle);
  return (
    <AriaSeparator
      {...presentation}
      className={cn("hraness-menu__separator", presentation.className, className)}
      data-slot="menu-separator"
    />
  );
}

export interface MenuSectionProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: ReactNode;
  readonly xstyle?: StyleXStyles;
  readonly headerXstyle?: StyleXStyles;
}

export function MenuSection({ children, className, title, xstyle, headerXstyle }: MenuSectionProps) {
  const presentation = stylex.props(menuStyles.section, xstyle);
  const headerPresentation = stylex.props(menuStyles.header, headerXstyle);
  return (
    <AriaMenuSection
      {...presentation}
      className={cn("hraness-menu__section", presentation.className, className)}
      data-slot="menu-section"
    >
      {title === undefined ? null : (
        <Header {...headerPresentation} className={cn("hraness-menu__header", headerPresentation.className)} data-slot="menu-header">
          {title}
        </Header>
      )}
      {children}
    </AriaMenuSection>
  );
}

export type DialogCloseOptions = { readonly close: () => void };

const dialogSizeAttribute = {
  large: "lg",
  medium: "md",
  small: "sm",
} as const;

export type DialogContentProps = Omit<ModalOverlayProps, "children" | "className"> & {
  readonly children: ReactNode | ((options: DialogCloseOptions) => ReactNode);
  readonly className?: string;
  readonly closeIcon?: ReactNode;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly dialogRef?: Ref<HTMLDivElement>;
  readonly footer?: ReactNode | ((options: DialogCloseOptions) => ReactNode);
  readonly isCloseDisabled?: boolean;
  readonly overlayClassName?: string;
  readonly xstyle?: StyleXStyles;
  readonly overlayXstyle?: StyleXStyles;
  readonly size?: "large" | "medium" | "small";
  readonly title: ReactNode;
};

/** Modal dialog content for use as the second child of DialogTrigger. */
export function DialogContent({
  children,
  className,
  closeIcon = "×",
  closeLabel = "Close dialog",
  description,
  dialogRef,
  footer,
  isCloseDisabled = false,
  isDismissable = true,
  overlayClassName,
  xstyle,
  overlayXstyle,
  style,
  size = "medium",
  title,
  ...overlayProps
}: DialogContentProps) {
  const presentation = stylex.props(dialogStyles.root, size === "small" && dialogStyles.rootSmall, size === "large" && dialogStyles.rootLarge, xstyle);
  const overlayPresentation = (state: { isEntering: boolean; isExiting: boolean }) => stylex.props(
    dialogStyles.overlay,
    state.isEntering && dialogStyles.overlayEntering,
    state.isExiting && dialogStyles.overlayExiting,
    overlayXstyle,
  );
  const closePresentation = (state: { isHovered: boolean; isFocusVisible: boolean }) => stylex.props(
    dialogStyles.close,
    dialogStyles.closeNativeInteraction,
    state.isHovered && dialogStyles.closeHovered,
    state.isFocusVisible && dialogStyles.closeFocusVisible,
  );
  return (
    <ModalOverlay
      {...overlayProps}
      className={(state) => cn("hraness-dialog-overlay", overlayPresentation(state).className, overlayClassName)}
      style={(state) => mergeStylexInlineStyles(overlayPresentation(state).style, typeof style === "function" ? style(state) : style)}
      data-slot="dialog-overlay"
      isDismissable={isDismissable}
    >
      <AriaModal
        className={cn("hraness-dialog", presentation.className, className)}
        style={presentation.style}
        data-size={dialogSizeAttribute[size]}
        data-slot="dialog"
      >
        <AriaDialog
          {...stylex.props(dialogStyles.content)}
          className={cn("hraness-dialog__content", stylex.props(dialogStyles.content).className)}
          data-slot="dialog-content"
          ref={dialogRef}
        >
          {({ close }) => (
            <>
              <header {...stylex.props(dialogStyles.header)} className={cn("hraness-dialog__header", stylex.props(dialogStyles.header).className)} data-slot="dialog-header">
                <div {...stylex.props(dialogStyles.heading)} className={cn("hraness-dialog__heading", stylex.props(dialogStyles.heading).className)} data-slot="dialog-heading">
                  <Heading
                    {...stylex.props(dialogStyles.title)}
                    className={cn("hraness-dialog__title", stylex.props(dialogStyles.title).className)}
                    data-slot="dialog-title"
                    slot="title"
                  >
                    {title}
                  </Heading>
                  {description === undefined ? null : (
                    <Text
                      {...stylex.props(dialogStyles.description)}
                      className={cn("hraness-dialog__description", stylex.props(dialogStyles.description).className)}
                      data-slot="dialog-description"
                      slot="description"
                    >
                      {description}
                    </Text>
                  )}
                </div>
                <AriaButton
                  aria-label={closeLabel}
                  className={(state) => cn("hraness-dialog__close", closePresentation(state).className)}
                  style={(state) => closePresentation(state).style}
                  data-slot="dialog-close"
                  isDisabled={isCloseDisabled}
                  onPress={close}
                >
                  <span aria-hidden="true">{closeIcon}</span>
                </AriaButton>
              </header>
              <div {...stylex.props(dialogStyles.body)} className={cn("hraness-dialog__body", stylex.props(dialogStyles.body).className)} data-slot="dialog-body">
                {typeof children === "function" ? children({ close }) : children}
              </div>
              {footer === undefined ? null : (
                <footer {...stylex.props(dialogStyles.footer)} className={cn("hraness-dialog__footer", stylex.props(dialogStyles.footer).className)} data-slot="dialog-footer">
                  {typeof footer === "function" ? footer({ close }) : footer}
                </footer>
              )}
            </>
          )}
        </AriaDialog>
      </AriaModal>
    </ModalOverlay>
  );
}

export type PopoverProps = Omit<AriaPopoverProps, "children" | "className"> & {
  readonly "aria-label": string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly popoverRef?: Ref<HTMLElement>;
  readonly xstyle?: StyleXStyles;
};

/** A named, non-modal popover for rich content under a DialogTrigger. */
export function Popover({
  "aria-label": ariaLabel,
  children,
  className,
  offset = 8,
  popoverRef,
  style,
  xstyle,
  ...props
}: PopoverProps) {
  const presentation = (state: { isEntering: boolean; isExiting: boolean }) => stylex.props(
    overlayStyles.surface,
    overlayStyles.popover,
    state.isEntering && overlayStyles.popoverEntering,
    state.isExiting && overlayStyles.popoverExiting,
    xstyle,
  );
  const contentPresentation = stylex.props(overlayStyles.popoverContent);
  return (
    <AriaPopover
      {...props}
      className={(state) => cn("hraness-popover", presentation(state).className, className)}
      style={(state) => mergeStylexInlineStyles(presentation(state).style, typeof style === "function" ? style(state) : style)}
      data-slot="popover"
      offset={offset}
      ref={popoverRef}
    >
      <AriaDialog
        aria-label={ariaLabel}
        className={cn("hraness-popover__content", contentPresentation.className)}
        style={contentPresentation.style}
        data-slot="popover-content"
      >
        {children}
      </AriaDialog>
    </AriaPopover>
  );
}

export type TooltipProps = Omit<
  AriaTooltipProps,
  "children" | "className" | "defaultOpen" | "isOpen" | "onOpenChange"
> & Pick<
  TooltipTriggerComponentProps,
  "closeDelay" | "defaultOpen" | "delay" | "isDisabled" | "isOpen" | "onOpenChange"
> & {
  /** The trigger must keep its own accessible name; tooltip text is supplementary. */
  readonly children: ReactElement;
  readonly className?: string;
  readonly content: ReactNode;
  readonly xstyle?: StyleXStyles;
};

export function Tooltip({
  children,
  className,
  closeDelay = 500,
  content,
  defaultOpen,
  delay = 500,
  isDisabled,
  isOpen,
  onOpenChange,
  offset = 8,
  placement = "top",
  style,
  xstyle,
  ...props
}: TooltipProps) {
  const presentation = stylex.props(overlayStyles.surface, overlayStyles.tooltip, xstyle);
  return (
    <TooltipTrigger
      closeDelay={closeDelay}
      delay={delay}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {children}
      <AriaTooltip
        {...props}
        className={cn("hraness-tooltip", presentation.className, className)}
        style={(state) => mergeStylexInlineStyles(presentation.style, typeof style === "function" ? style(state) : style)}
        data-slot="tooltip"
        offset={offset}
        placement={placement}
      >
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
