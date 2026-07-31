"use client";

import type { ReactElement, ReactNode, Ref } from "react";
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
}: MenuProps) {
  return (
    <AriaPopover
      className={cn("hraness-menu-popover", popoverClassName)}
      data-match-trigger-width={matchTriggerWidth || undefined}
      data-slot="menu-popover"
      offset={6}
      placement={placement}
      {...(matchTriggerWidth
        ? { style: { minWidth: "var(--trigger-width)" } }
        : {})}
    >
      <AriaMenu
        aria-label={ariaLabel}
        className={cn("hraness-menu", className)}
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
        <div className="hraness-menu__footer" data-slot="menu-footer">{footer}</div>
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
};

export function MenuItem({
  children,
  className,
  description,
  leading,
  shortcut,
  textValue,
  variant = "default",
  ...props
}: MenuItemProps) {
  return (
    <AriaMenuItem
      {...props}
      className={cn("hraness-menu__item", className)}
      data-has-description={description === undefined ? undefined : "true"}
      data-slot="menu-item"
      data-variant={variant}
      textValue={textValue}
    >
      {leading === undefined ? null : (
        <span
          aria-hidden="true"
          className="hraness-menu__leading"
          data-slot="menu-item-leading"
        >
          {leading}
        </span>
      )}
      <span className="hraness-menu__copy" data-slot="menu-item-copy">
        <Text className="hraness-menu__label" data-slot="menu-item-label" slot="label">
          {children}
        </Text>
        {description === undefined ? null : (
          <Text
            className="hraness-menu__description"
            data-slot="menu-item-description"
            slot="description"
          >
            {description}
          </Text>
        )}
      </span>
      {shortcut === undefined ? null : (
        <Keyboard className="hraness-menu__shortcut" data-slot="menu-item-shortcut">
          {shortcut}
        </Keyboard>
      )}
    </AriaMenuItem>
  );
}

export function MenuSeparator({ className }: { readonly className?: string }) {
  return (
    <AriaSeparator
      className={cn("hraness-menu__separator", className)}
      data-slot="menu-separator"
    />
  );
}

export interface MenuSectionProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: ReactNode;
}

export function MenuSection({ children, className, title }: MenuSectionProps) {
  return (
    <AriaMenuSection
      className={cn("hraness-menu__section", className)}
      data-slot="menu-section"
    >
      {title === undefined ? null : (
        <Header className="hraness-menu__header" data-slot="menu-header">
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
  size = "medium",
  title,
  ...overlayProps
}: DialogContentProps) {
  return (
    <ModalOverlay
      {...overlayProps}
      className={cn("hraness-dialog-overlay", overlayClassName)}
      data-slot="dialog-overlay"
      isDismissable={isDismissable}
    >
      <AriaModal
        className={cn("hraness-dialog", className)}
        data-size={dialogSizeAttribute[size]}
        data-slot="dialog"
      >
        <AriaDialog
          className="hraness-dialog__content"
          data-slot="dialog-content"
          ref={dialogRef}
        >
          {({ close }) => (
            <>
              <header className="hraness-dialog__header" data-slot="dialog-header">
                <div className="hraness-dialog__heading" data-slot="dialog-heading">
                  <Heading
                    className="hraness-dialog__title"
                    data-slot="dialog-title"
                    slot="title"
                  >
                    {title}
                  </Heading>
                  {description === undefined ? null : (
                    <Text
                      className="hraness-dialog__description"
                      data-slot="dialog-description"
                      slot="description"
                    >
                      {description}
                    </Text>
                  )}
                </div>
                <AriaButton
                  aria-label={closeLabel}
                  className="hraness-dialog__close"
                  data-slot="dialog-close"
                  isDisabled={isCloseDisabled}
                  onPress={close}
                >
                  <span aria-hidden="true">{closeIcon}</span>
                </AriaButton>
              </header>
              <div className="hraness-dialog__body" data-slot="dialog-body">
                {typeof children === "function" ? children({ close }) : children}
              </div>
              {footer === undefined ? null : (
                <footer className="hraness-dialog__footer" data-slot="dialog-footer">
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
};

/** A named, non-modal popover for rich content under a DialogTrigger. */
export function Popover({
  "aria-label": ariaLabel,
  children,
  className,
  offset = 8,
  popoverRef,
  ...props
}: PopoverProps) {
  return (
    <AriaPopover
      {...props}
      className={cn("hraness-popover", className)}
      data-slot="popover"
      offset={offset}
      ref={popoverRef}
    >
      <AriaDialog
        aria-label={ariaLabel}
        className="hraness-popover__content"
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
  ...props
}: TooltipProps) {
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
        className={cn("hraness-tooltip", className)}
        data-slot="tooltip"
        offset={offset}
        placement={placement}
      >
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
