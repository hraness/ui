// src/actions.tsx
import {
  forwardRef
} from "react";
import {
  Button as AriaButton2,
  Link as AriaLink,
  ToggleButton as AriaToggleButton
} from "react-aria-components";

// src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// src/overlays.tsx
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Header,
  Heading,
  Keyboard,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Modal as AriaModal,
  ModalOverlay,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  Text,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  Button as AriaButton
} from "react-aria-components";
import { jsxDEV, Fragment } from "react/jsx-dev-runtime";
"use client";
function Menu({
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
  shouldCloseOnSelect = true
}) {
  return /* @__PURE__ */ jsxDEV(AriaPopover, {
    className: cn("hraness-menu-popover", popoverClassName),
    "data-match-trigger-width": matchTriggerWidth || undefined,
    "data-slot": "menu-popover",
    offset: 6,
    placement,
    ...matchTriggerWidth ? { style: { minWidth: "var(--trigger-width)" } } : {},
    children: [
      /* @__PURE__ */ jsxDEV(AriaMenu, {
        "aria-label": ariaLabel,
        className: cn("hraness-menu", className),
        "data-slot": "menu",
        ...defaultSelectedKeys === undefined ? {} : { defaultSelectedKeys },
        ...disabledKeys === undefined ? {} : { disabledKeys },
        ...disallowEmptySelection === undefined ? {} : { disallowEmptySelection },
        ...onAction === undefined ? {} : { onAction: (key) => onAction(String(key)) },
        ...onSelectionChange === undefined ? {} : { onSelectionChange },
        ref: menuRef,
        ...selectedKeys === undefined ? {} : { selectedKeys },
        ...selectionMode === undefined ? {} : { selectionMode },
        shouldCloseOnSelect,
        children
      }, undefined, false, undefined, this),
      footer === undefined ? null : /* @__PURE__ */ jsxDEV("div", {
        className: "hraness-menu__footer",
        "data-slot": "menu-footer",
        children: footer
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function MenuItem({
  children,
  className,
  description,
  leading,
  shortcut,
  textValue,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxDEV(AriaMenuItem, {
    ...props,
    className: cn("hraness-menu__item", className),
    "data-has-description": description === undefined ? undefined : "true",
    "data-slot": "menu-item",
    "data-variant": variant,
    textValue,
    children: [
      leading === undefined ? null : /* @__PURE__ */ jsxDEV("span", {
        "aria-hidden": "true",
        className: "hraness-menu__leading",
        "data-slot": "menu-item-leading",
        children: leading
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("span", {
        className: "hraness-menu__copy",
        "data-slot": "menu-item-copy",
        children: [
          /* @__PURE__ */ jsxDEV(Text, {
            className: "hraness-menu__label",
            "data-slot": "menu-item-label",
            slot: "label",
            children
          }, undefined, false, undefined, this),
          description === undefined ? null : /* @__PURE__ */ jsxDEV(Text, {
            className: "hraness-menu__description",
            "data-slot": "menu-item-description",
            slot: "description",
            children: description
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      shortcut === undefined ? null : /* @__PURE__ */ jsxDEV(Keyboard, {
        className: "hraness-menu__shortcut",
        "data-slot": "menu-item-shortcut",
        children: shortcut
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function MenuSeparator({ className }) {
  return /* @__PURE__ */ jsxDEV(AriaSeparator, {
    className: cn("hraness-menu__separator", className),
    "data-slot": "menu-separator"
  }, undefined, false, undefined, this);
}
function MenuSection({ children, className, title }) {
  return /* @__PURE__ */ jsxDEV(AriaMenuSection, {
    className: cn("hraness-menu__section", className),
    "data-slot": "menu-section",
    children: [
      title === undefined ? null : /* @__PURE__ */ jsxDEV(Header, {
        className: "hraness-menu__header",
        "data-slot": "menu-header",
        children: title
      }, undefined, false, undefined, this),
      children
    ]
  }, undefined, true, undefined, this);
}
var dialogSizeAttribute = {
  large: "lg",
  medium: "md",
  small: "sm"
};
function DialogContent({
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
}) {
  return /* @__PURE__ */ jsxDEV(ModalOverlay, {
    ...overlayProps,
    className: cn("hraness-dialog-overlay", overlayClassName),
    "data-slot": "dialog-overlay",
    isDismissable,
    children: /* @__PURE__ */ jsxDEV(AriaModal, {
      className: cn("hraness-dialog", className),
      "data-size": dialogSizeAttribute[size],
      "data-slot": "dialog",
      children: /* @__PURE__ */ jsxDEV(AriaDialog, {
        className: "hraness-dialog__content",
        "data-slot": "dialog-content",
        ref: dialogRef,
        children: ({ close }) => /* @__PURE__ */ jsxDEV(Fragment, {
          children: [
            /* @__PURE__ */ jsxDEV("header", {
              className: "hraness-dialog__header",
              "data-slot": "dialog-header",
              children: [
                /* @__PURE__ */ jsxDEV("div", {
                  className: "hraness-dialog__heading",
                  "data-slot": "dialog-heading",
                  children: [
                    /* @__PURE__ */ jsxDEV(Heading, {
                      className: "hraness-dialog__title",
                      "data-slot": "dialog-title",
                      slot: "title",
                      children: title
                    }, undefined, false, undefined, this),
                    description === undefined ? null : /* @__PURE__ */ jsxDEV(Text, {
                      className: "hraness-dialog__description",
                      "data-slot": "dialog-description",
                      slot: "description",
                      children: description
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                /* @__PURE__ */ jsxDEV(AriaButton, {
                  "aria-label": closeLabel,
                  className: "hraness-dialog__close",
                  "data-slot": "dialog-close",
                  isDisabled: isCloseDisabled,
                  onPress: close,
                  children: /* @__PURE__ */ jsxDEV("span", {
                    "aria-hidden": "true",
                    children: closeIcon
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV("div", {
              className: "hraness-dialog__body",
              "data-slot": "dialog-body",
              children: typeof children === "function" ? children({ close }) : children
            }, undefined, false, undefined, this),
            footer === undefined ? null : /* @__PURE__ */ jsxDEV("footer", {
              className: "hraness-dialog__footer",
              "data-slot": "dialog-footer",
              children: typeof footer === "function" ? footer({ close }) : footer
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function Popover({
  "aria-label": ariaLabel,
  children,
  className,
  offset = 8,
  popoverRef,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV(AriaPopover, {
    ...props,
    className: cn("hraness-popover", className),
    "data-slot": "popover",
    offset,
    ref: popoverRef,
    children: /* @__PURE__ */ jsxDEV(AriaDialog, {
      "aria-label": ariaLabel,
      className: "hraness-popover__content",
      "data-slot": "popover-content",
      children
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function Tooltip({
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
}) {
  return /* @__PURE__ */ jsxDEV(TooltipTrigger, {
    closeDelay,
    delay,
    ...defaultOpen === undefined ? {} : { defaultOpen },
    ...isDisabled === undefined ? {} : { isDisabled },
    ...isOpen === undefined ? {} : { isOpen },
    ...onOpenChange === undefined ? {} : { onOpenChange },
    children: [
      children,
      /* @__PURE__ */ jsxDEV(AriaTooltip, {
        ...props,
        className: cn("hraness-tooltip", className),
        "data-slot": "tooltip",
        offset,
        placement,
        children: content
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/router.tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef
} from "react";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";
import { jsxDEV as jsxDEV2 } from "react/jsx-dev-runtime";
"use client";
var PrefetchContext = createContext(null);
function RouterProvider({
  children,
  navigate,
  prefetch,
  useHref
}) {
  const prefetchValue = useMemo(() => prefetch ?? null, [prefetch]);
  return /* @__PURE__ */ jsxDEV2(AriaRouterProvider, {
    navigate,
    ...useHref === undefined ? {} : { useHref },
    children: /* @__PURE__ */ jsxDEV2(PrefetchContext.Provider, {
      value: prefetchValue,
      children
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function isPrefetchableHref(href) {
  return href !== undefined && href.startsWith("/") && !href.startsWith("//");
}
function useLinkPrefetch(href) {
  const prefetch = useContext(PrefetchContext);
  const prefetchedHrefRef = useRef(null);
  return useCallback(() => {
    if (prefetch === null || !isPrefetchableHref(href) || prefetchedHrefRef.current === href)
      return;
    prefetch(href);
    prefetchedHrefRef.current = href;
  }, [href, prefetch]);
}

// src/actions.tsx
import { jsxDEV as jsxDEV3, Fragment as Fragment2 } from "react/jsx-dev-runtime";
"use client";
function isAriaTrue(value) {
  return value === true || value === "true";
}
function requireNonBlank(value, component, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${component} ${field} must not be blank.`);
  }
}
function validateAccessibleName(props, component) {
  if (props["aria-label"] !== undefined) {
    requireNonBlank(props["aria-label"], component, "aria-label");
    return;
  }
  requireNonBlank(props["aria-labelledby"], component, "aria-labelledby");
}
function iconTooltip(props, component) {
  validateAccessibleName(props, component);
  const tooltip = props.tooltip ?? props["aria-label"];
  if (tooltip === undefined || tooltip === null || tooltip === false) {
    throw new Error(`${component} tooltip must be provided with aria-labelledby.`);
  }
  if (typeof tooltip === "string")
    requireNonBlank(tooltip, component, "tooltip");
  return tooltip;
}
function resolveButtonChildren(children, values) {
  return typeof children === "function" ? children(values) : children;
}
function resolveLinkChildren(children, values) {
  return typeof children === "function" ? children(values) : children;
}
function resolveToggleButtonChildren(children, values) {
  return typeof children === "function" ? children(values) : children;
}
function PendingIndicator({ className }) {
  return /* @__PURE__ */ jsxDEV3("span", {
    "aria-hidden": "true",
    className: cn("hraness-action__spinner", className),
    "data-slot": "action-spinner"
  }, undefined, false, undefined, this);
}
var Button = forwardRef((allProps, ref) => {
  const reservesPendingSlot = Object.prototype.hasOwnProperty.call(allProps, "isPending");
  const {
    "aria-busy": ariaBusy,
    children,
    className,
    controlClassName,
    isDisabled = false,
    isPending = false,
    leading,
    size = "default",
    variant = "secondary",
    ...props
  } = allProps;
  const isBusy = isPending || isAriaTrue(ariaBusy);
  const isNativelyDisabled = isDisabled && !isPending;
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const hasLeadingSlot = hasLeading || reservesPendingSlot;
  return /* @__PURE__ */ jsxDEV3("span", {
    "aria-busy": isBusy ? "true" : undefined,
    className: cn("hraness-button", className),
    "data-disabled": isNativelyDisabled || undefined,
    "data-pending": isPending || undefined,
    "data-size": size,
    "data-slot": "button",
    "data-variant": variant,
    children: /* @__PURE__ */ jsxDEV3(AriaButton2, {
      ...props,
      "aria-busy": isBusy ? "true" : undefined,
      className: cn("hraness-button__control", controlClassName),
      "data-slot": "button-control",
      isDisabled: isNativelyDisabled,
      isPending,
      ref,
      children: (values) => /* @__PURE__ */ jsxDEV3(Fragment2, {
        children: [
          hasLeadingSlot ? /* @__PURE__ */ jsxDEV3("span", {
            "aria-hidden": "true",
            className: "hraness-button__leading",
            "data-empty": !isPending && !hasLeading ? "true" : undefined,
            "data-slot": "button-leading",
            children: isPending ? /* @__PURE__ */ jsxDEV3(PendingIndicator, {}, undefined, false, undefined, this) : leading
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ jsxDEV3("span", {
            className: "hraness-button__label",
            "data-slot": "button-label",
            children: resolveButtonChildren(children, values)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
});
Button.displayName = "Button";
function IconButton(allProps) {
  const tooltipContent = iconTooltip(allProps, "IconButton");
  const {
    "aria-busy": ariaBusy,
    buttonRef,
    children,
    className,
    controlClassName,
    isDisabled = false,
    isPending = false,
    size = "default",
    tooltip,
    variant = "quiet",
    ...props
  } = allProps;
  const isBusy = isPending || isAriaTrue(ariaBusy);
  const isNativelyDisabled = isDisabled && !isPending;
  return /* @__PURE__ */ jsxDEV3("span", {
    "aria-busy": isBusy ? "true" : undefined,
    className: cn("hraness-icon-button", className),
    "data-disabled": isNativelyDisabled || undefined,
    "data-pending": isPending || undefined,
    "data-size": size,
    "data-slot": "icon-button",
    "data-variant": variant,
    children: /* @__PURE__ */ jsxDEV3(Tooltip, {
      content: tooltip ?? tooltipContent,
      children: /* @__PURE__ */ jsxDEV3(AriaButton2, {
        ...props,
        "aria-busy": isBusy ? "true" : undefined,
        className: cn("hraness-icon-button__control", controlClassName),
        "data-slot": "icon-button-control",
        isDisabled: isNativelyDisabled,
        isPending,
        ref: buttonRef,
        children: (values) => /* @__PURE__ */ jsxDEV3("span", {
          className: "hraness-icon-button__content",
          "data-slot": "icon-button-content",
          children: isPending ? /* @__PURE__ */ jsxDEV3(PendingIndicator, {
            className: "hraness-icon-button__spinner"
          }, undefined, false, undefined, this) : resolveButtonChildren(children, values)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function ToggleButton(allProps) {
  const {
    buttonRef,
    children,
    className,
    controlClassName,
    isDisabled = false,
    isIconOnly = false,
    leading,
    size = "default",
    variant = "secondary",
    ...props
  } = allProps;
  if (isIconOnly)
    validateAccessibleName(allProps, "ToggleButton");
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  return /* @__PURE__ */ jsxDEV3("span", {
    className: cn("hraness-toggle-button", className),
    "data-disabled": isDisabled || undefined,
    "data-icon-only": isIconOnly || undefined,
    "data-size": size,
    "data-slot": "toggle-button",
    "data-variant": variant,
    children: /* @__PURE__ */ jsxDEV3(AriaToggleButton, {
      ...props,
      className: cn("hraness-toggle-button__control", controlClassName),
      "data-slot": "toggle-button-control",
      isDisabled,
      ref: buttonRef,
      children: (values) => /* @__PURE__ */ jsxDEV3(Fragment2, {
        children: [
          hasLeading ? /* @__PURE__ */ jsxDEV3("span", {
            "aria-hidden": "true",
            className: "hraness-toggle-button__leading",
            "data-slot": "toggle-button-leading",
            children: leading
          }, undefined, false, undefined, this) : null,
          resolveToggleButtonChildren(children, values)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
var PrefetchingLink = forwardRef(function PrefetchingLink2({
  href,
  isDisabled = false,
  onFocus,
  onHoverStart,
  ...props
}, ref) {
  const prefetch = useLinkPrefetch(isDisabled ? undefined : href);
  return /* @__PURE__ */ jsxDEV3(AriaLink, {
    ...props,
    href,
    isDisabled,
    onFocus: (event) => {
      prefetch();
      onFocus?.(event);
    },
    onHoverStart: (event) => {
      prefetch();
      onHoverStart?.(event);
    },
    ref
  }, undefined, false, undefined, this);
});
function Link({ className, href, linkRef, ...props }) {
  return /* @__PURE__ */ jsxDEV3(PrefetchingLink, {
    ...props,
    className: cn("hraness-link", className),
    "data-slot": "link",
    href,
    ref: linkRef
  }, undefined, false, undefined, this);
}
function LinkButton({
  children,
  className,
  controlClassName,
  href,
  isDisabled = false,
  leading,
  linkRef,
  size = "default",
  variant = "secondary",
  ...props
}) {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  return /* @__PURE__ */ jsxDEV3("span", {
    className: cn("hraness-link-button", className),
    "data-disabled": isDisabled || undefined,
    "data-size": size,
    "data-slot": "link-button",
    "data-variant": variant,
    children: /* @__PURE__ */ jsxDEV3(PrefetchingLink, {
      ...props,
      className: cn("hraness-link-button__control", controlClassName),
      "data-slot": "link-button-control",
      href,
      isDisabled,
      ref: linkRef,
      children: (values) => /* @__PURE__ */ jsxDEV3(Fragment2, {
        children: [
          hasLeading ? /* @__PURE__ */ jsxDEV3("span", {
            "aria-hidden": "true",
            className: "hraness-link-button__leading",
            "data-slot": "link-button-leading",
            children: leading
          }, undefined, false, undefined, this) : null,
          /* @__PURE__ */ jsxDEV3("span", {
            className: "hraness-link-button__label",
            "data-slot": "link-button-label",
            children: resolveLinkChildren(children, values)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
function IconLink(allProps) {
  const tooltipContent = iconTooltip(allProps, "IconLink");
  const {
    children,
    className,
    controlClassName,
    href,
    isDisabled = false,
    linkRef,
    size = "default",
    tooltip,
    variant = "quiet",
    ...props
  } = allProps;
  return /* @__PURE__ */ jsxDEV3("span", {
    className: cn("hraness-icon-button", "hraness-icon-link", className),
    "data-disabled": isDisabled || undefined,
    "data-size": size,
    "data-slot": "icon-link",
    "data-variant": variant,
    children: /* @__PURE__ */ jsxDEV3(Tooltip, {
      content: tooltip ?? tooltipContent,
      children: /* @__PURE__ */ jsxDEV3(PrefetchingLink, {
        ...props,
        className: cn("hraness-icon-button__control", "hraness-icon-link__control", controlClassName),
        "data-slot": "icon-link-control",
        href,
        isDisabled,
        ref: linkRef,
        children: (values) => /* @__PURE__ */ jsxDEV3("span", {
          className: "hraness-icon-button__content hraness-icon-link__content",
          "data-slot": "icon-link-content",
          children: resolveLinkChildren(children, values)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
}
// src/badge.tsx
import { forwardRef as forwardRef2 } from "react";
import { jsxDEV as jsxDEV4 } from "react/jsx-dev-runtime";
var StatusDot = forwardRef2(({ className, tone = "neutral", ...props }, ref) => /* @__PURE__ */ jsxDEV4("span", {
  ...props,
  "aria-hidden": "true",
  className: cn("hraness-status-dot", className),
  "data-slot": "status-dot",
  "data-tone": tone,
  ref
}, undefined, false, undefined, this));
StatusDot.displayName = "StatusDot";
function badgeVariants({ tone = "neutral" } = {}) {
  return cn("hraness-badge", `hraness-badge--${tone}`);
}
var Badge = forwardRef2(({ children, className, isLive = false, tone = "neutral", ...props }, ref) => /* @__PURE__ */ jsxDEV4("span", {
  ...props,
  "aria-live": isLive ? "polite" : undefined,
  className: cn(badgeVariants({ tone }), className),
  "data-slot": "badge",
  "data-tone": tone,
  ref,
  role: isLive ? "status" : undefined,
  children
}, undefined, false, undefined, this));
Badge.displayName = "Badge";
// src/card.tsx
import {
  forwardRef as forwardRef3
} from "react";
import {
  Button as AriaButton3
} from "react-aria-components";
import { jsxDEV as jsxDEV5 } from "react/jsx-dev-runtime";
"use client";
var Card = forwardRef3(({ className, shape = "rounded", tone = "card", ...props }, ref) => /* @__PURE__ */ jsxDEV5("div", {
  ...props,
  className: cn("hraness-card", className),
  "data-shape": shape,
  "data-slot": "card",
  "data-tone": tone,
  ref
}, undefined, false, undefined, this));
Card.displayName = "Card";
var CardHeader = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV5("div", {
  ...props,
  className: cn("hraness-card__header", className),
  "data-slot": "card-header",
  ref
}, undefined, false, undefined, this));
CardHeader.displayName = "CardHeader";
var CardTitle = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV5("h3", {
  ...props,
  className: cn("hraness-card__title", className),
  "data-slot": "card-title",
  ref
}, undefined, false, undefined, this));
CardTitle.displayName = "CardTitle";
var CardDescription = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV5("p", {
  ...props,
  className: cn("hraness-card__description", className),
  "data-slot": "card-description",
  ref
}, undefined, false, undefined, this));
CardDescription.displayName = "CardDescription";
var CardContent = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV5("div", {
  ...props,
  className: cn("hraness-card__content", className),
  "data-slot": "card-content",
  ref
}, undefined, false, undefined, this));
CardContent.displayName = "CardContent";
var CardFooter = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV5("div", {
  ...props,
  className: cn("hraness-card__footer", className),
  "data-slot": "card-footer",
  ref
}, undefined, false, undefined, this));
CardFooter.displayName = "CardFooter";
function PressableCard({
  buttonRef,
  className,
  shape = "rounded",
  tone = "card",
  ...props
}) {
  return /* @__PURE__ */ jsxDEV5(AriaButton3, {
    ...props,
    className: cn("hraness-pressable-card", className),
    "data-shape": shape,
    "data-slot": "pressable-card",
    "data-tone": tone,
    ref: buttonRef
  }, undefined, false, undefined, this);
}
// src/checkbox-group.tsx
import {
  CheckboxGroup as AriaCheckboxGroup,
  Label as Label2
} from "react-aria-components";

// src/fields.tsx
import {
  forwardRef as forwardRef4,
  useId
} from "react";
import {
  Button as AriaButton4,
  CheckboxButton as AriaCheckboxButton,
  CheckboxField as AriaCheckboxField,
  FieldError as AriaFieldError,
  Group,
  Input as AriaInput,
  Label,
  NumberField as AriaNumberField,
  RadioButton as AriaRadioButton,
  RadioField as AriaRadioField,
  RadioGroup as AriaRadioGroup,
  SearchField as AriaSearchField,
  SwitchButton as AriaSwitchButton,
  SwitchField as AriaSwitchField,
  Text as Text2,
  TextArea as AriaTextArea,
  TextField as AriaTextField
} from "react-aria-components";
import { jsxDEV as jsxDEV6, Fragment as Fragment3 } from "react/jsx-dev-runtime";
"use client";
function FieldDescription({ className, ...props }) {
  return /* @__PURE__ */ jsxDEV6(Text2, {
    ...props,
    className: cn("hraness-field__description", className),
    "data-slot": "field-description",
    slot: "description"
  }, undefined, false, undefined, this);
}
function FieldError({ className, ...props }) {
  return /* @__PURE__ */ jsxDEV6(AriaFieldError, {
    ...props,
    className: cn("hraness-field__error", className),
    "data-slot": "field-error"
  }, undefined, false, undefined, this);
}
function FieldMessages({
  description,
  errorMessage
}) {
  return /* @__PURE__ */ jsxDEV6(Fragment3, {
    children: [
      description === undefined ? null : /* @__PURE__ */ jsxDEV6(FieldDescription, {
        children: description
      }, undefined, false, undefined, this),
      errorMessage === undefined ? null : /* @__PURE__ */ jsxDEV6(FieldError, {
        children: errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
var TextField = forwardRef4(({
  className,
  description,
  errorMessage,
  inputClassName,
  inputProps,
  inputRef,
  isDisabled = false,
  label,
  placeholder,
  showLabel = true,
  size = "default",
  surface = "default",
  ...props
}, ref) => /* @__PURE__ */ jsxDEV6(AriaTextField, {
  ...props,
  className: cn("hraness-field", "hraness-text-field", className),
  "data-size": size,
  "data-slot": "text-field",
  "data-surface": surface,
  isDisabled,
  ref,
  children: [
    /* @__PURE__ */ jsxDEV6(Label, {
      className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
      "data-slot": "field-label",
      children: label
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV6("div", {
      className: "hraness-field__control",
      "data-slot": "field-control",
      children: /* @__PURE__ */ jsxDEV6(AriaInput, {
        ...inputProps,
        className: cn("hraness-field__input", inputClassName),
        "data-slot": "field-input",
        ...placeholder === undefined ? {} : { placeholder },
        ref: inputRef
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV6(FieldMessages, {
      description,
      errorMessage
    }, undefined, false, undefined, this)
  ]
}, undefined, true, undefined, this));
TextField.displayName = "TextField";
function TextAreaField({
  className,
  description,
  errorMessage,
  fieldRef,
  isDisabled = false,
  label,
  placeholder,
  resize = "none",
  showLabel = true,
  size = "default",
  surface = "default",
  textAreaClassName,
  textAreaProps,
  textAreaRef,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaTextField, {
    ...props,
    className: cn("hraness-field", "hraness-text-area-field", className),
    "data-resize": resize,
    "data-size": size,
    "data-slot": "text-area-field",
    "data-surface": surface,
    isDisabled,
    ref: fieldRef,
    children: [
      /* @__PURE__ */ jsxDEV6(Label, {
        className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
        "data-slot": "field-label",
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6("div", {
        className: "hraness-field__control",
        "data-slot": "field-control",
        children: /* @__PURE__ */ jsxDEV6(AriaTextArea, {
          ...textAreaProps,
          className: cn("hraness-field__input", textAreaClassName),
          "data-slot": "field-textarea",
          ...placeholder === undefined ? {} : { placeholder },
          ref: textAreaRef
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6(FieldMessages, {
        description,
        errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function SearchField({
  className,
  clearLabel = "Clear search",
  description,
  errorMessage,
  fieldRef,
  inputClassName,
  inputProps,
  inputRef,
  isDisabled = false,
  label,
  placeholder = "Search…",
  showLabel = false,
  size = "default",
  surface = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaSearchField, {
    ...props,
    className: cn("hraness-field", "hraness-search-field", className),
    "data-size": size,
    "data-slot": "search-field",
    "data-surface": surface,
    isDisabled,
    ref: fieldRef,
    children: ({ isEmpty }) => /* @__PURE__ */ jsxDEV6(Fragment3, {
      children: [
        /* @__PURE__ */ jsxDEV6(Label, {
          className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
          "data-slot": "field-label",
          children: label
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV6(Group, {
          className: "hraness-field__control hraness-search-field__control",
          "data-slot": "field-control",
          children: [
            /* @__PURE__ */ jsxDEV6(AriaInput, {
              ...inputProps,
              className: cn("hraness-field__input", inputClassName),
              "data-slot": "field-input",
              placeholder,
              ref: inputRef,
              type: "search"
            }, undefined, false, undefined, this),
            isEmpty ? null : /* @__PURE__ */ jsxDEV6(AriaButton4, {
              "aria-label": clearLabel,
              className: "hraness-search-field__clear",
              "data-slot": "search-clear",
              children: /* @__PURE__ */ jsxDEV6("span", {
                "aria-hidden": "true",
                children: "×"
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV6(FieldMessages, {
          description,
          errorMessage
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function NumberField({
  className,
  decrementLabel = "Decrease value",
  description,
  errorMessage,
  fieldRef,
  incrementLabel = "Increase value",
  inputClassName,
  inputProps,
  inputRef,
  isDisabled = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaNumberField, {
    ...props,
    className: cn("hraness-field", "hraness-number-field", className),
    "data-size": size,
    "data-slot": "number-field",
    "data-surface": surface,
    isDisabled,
    ref: fieldRef,
    children: [
      /* @__PURE__ */ jsxDEV6(Label, {
        className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
        "data-slot": "field-label",
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6(Group, {
        className: "hraness-number-field__control",
        "data-slot": "field-control",
        children: [
          /* @__PURE__ */ jsxDEV6(AriaButton4, {
            "aria-label": decrementLabel,
            className: "hraness-number-field__step",
            "data-slot": "number-decrement",
            slot: "decrement",
            children: /* @__PURE__ */ jsxDEV6("span", {
              "aria-hidden": "true",
              children: "−"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV6(AriaInput, {
            ...inputProps,
            className: cn("hraness-field__input", inputClassName),
            "data-slot": "field-input",
            ref: inputRef
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV6(AriaButton4, {
            "aria-label": incrementLabel,
            className: "hraness-number-field__step",
            "data-slot": "number-increment",
            slot: "increment",
            children: /* @__PURE__ */ jsxDEV6("span", {
              "aria-hidden": "true",
              children: "+"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV6(FieldMessages, {
        description,
        errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function CheckboxField({
  className,
  controlClassName,
  description,
  errorMessage,
  fieldRef,
  label,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaCheckboxField, {
    ...props,
    className: cn("hraness-checkbox-field", className),
    "data-slot": "checkbox-field",
    ref: fieldRef,
    children: [
      /* @__PURE__ */ jsxDEV6(AriaCheckboxButton, {
        className: cn("hraness-checkbox-field__control", controlClassName),
        "data-slot": "checkbox-control",
        children: ({ isIndeterminate, isSelected }) => /* @__PURE__ */ jsxDEV6(Fragment3, {
          children: [
            /* @__PURE__ */ jsxDEV6("span", {
              "aria-hidden": "true",
              className: "hraness-checkbox-field__indicator",
              "data-slot": "checkbox-indicator",
              children: isIndeterminate ? "−" : isSelected ? "✓" : null
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV6("span", {
              className: "hraness-checkbox-field__label",
              "data-slot": "checkbox-label",
              children: label
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6(FieldMessages, {
        description,
        errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function RadioGroup({
  children,
  className,
  description,
  errorMessage,
  groupRef,
  label,
  optionsClassName,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaRadioGroup, {
    ...props,
    className: cn("hraness-radio-group", className),
    "data-slot": "radio-group",
    ref: groupRef,
    children: [
      /* @__PURE__ */ jsxDEV6(Label, {
        className: "hraness-radio-group__label",
        "data-slot": "field-label",
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6("div", {
        className: cn("hraness-radio-group__options", optionsClassName),
        "data-slot": "radio-options",
        children
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6(FieldMessages, {
        description,
        errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function RadioOption({
  className,
  controlClassName,
  description,
  fieldRef,
  label,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaRadioField, {
    ...props,
    className: cn("hraness-radio-option", className),
    "data-slot": "radio-option",
    ref: fieldRef,
    children: [
      /* @__PURE__ */ jsxDEV6(AriaRadioButton, {
        className: cn("hraness-radio-option__control", controlClassName),
        "data-slot": "radio-control",
        children: [
          /* @__PURE__ */ jsxDEV6("span", {
            "aria-hidden": "true",
            className: "hraness-radio-option__indicator",
            "data-slot": "radio-indicator"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV6("span", {
            className: "hraness-radio-option__label",
            "data-slot": "radio-label",
            children: label
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV6(FieldDescription, {
        className: "hraness-radio-option__description",
        children: description
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function SwitchField({
  className,
  controlClassName,
  description,
  errorMessage,
  fieldRef,
  label,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV6(AriaSwitchField, {
    ...props,
    className: cn("hraness-switch-field", className),
    "data-slot": "switch-field",
    ref: fieldRef,
    children: [
      /* @__PURE__ */ jsxDEV6(AriaSwitchButton, {
        className: cn("hraness-switch-field__control", controlClassName),
        "data-slot": "switch-control",
        children: [
          /* @__PURE__ */ jsxDEV6("span", {
            "aria-hidden": "true",
            className: "hraness-switch-field__track",
            "data-slot": "switch-track",
            children: /* @__PURE__ */ jsxDEV6("span", {
              className: "hraness-switch-field__thumb",
              "data-slot": "switch-thumb"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV6("span", {
            className: "hraness-switch-field__label",
            "data-slot": "switch-label",
            children: label
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV6(FieldMessages, {
        description,
        errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function reportsInvalid(value) {
  return value === true || value === "true" || value === "grammar" || value === "spelling";
}
function NativeSelectField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  defaultValue,
  description,
  disabled = false,
  errorMessage,
  id,
  isInvalid = false,
  label,
  onChange,
  options,
  placeholder,
  selectClassName,
  selectRef,
  showLabel = true,
  size = "default",
  surface = "default",
  value,
  ...props
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${controlId}-description`;
  const invalid = isInvalid || reportsInvalid(ariaInvalid);
  const showsError = invalid && errorMessage !== undefined;
  const errorId = showsError ? `${controlId}-error` : undefined;
  const describedBy = [ariaDescribedBy, descriptionId, errorId].filter((candidate) => typeof candidate === "string" && candidate.length > 0).join(" ") || undefined;
  const resolvedAriaInvalid = reportsInvalid(ariaInvalid) ? ariaInvalid : invalid ? true : ariaInvalid;
  return /* @__PURE__ */ jsxDEV6("div", {
    className: cn("hraness-field", "hraness-native-select-field", className),
    "data-disabled": disabled || undefined,
    "data-invalid": invalid || undefined,
    "data-size": size,
    "data-slot": "native-select-field",
    "data-surface": surface,
    children: [
      /* @__PURE__ */ jsxDEV6("label", {
        className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
        "data-slot": "field-label",
        htmlFor: controlId,
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6("div", {
        className: "hraness-field__control",
        "data-slot": "field-control",
        children: /* @__PURE__ */ jsxDEV6("select", {
          ...props,
          "aria-describedby": describedBy,
          "aria-invalid": resolvedAriaInvalid,
          className: cn("hraness-field__select", selectClassName),
          "data-slot": "field-select",
          disabled,
          ...defaultValue === undefined ? {} : { defaultValue },
          id: controlId,
          onChange: (event) => {
            const next = options.find((option) => option.id === event.currentTarget.value);
            if (next !== undefined)
              onChange?.(next.id, event);
          },
          ref: selectRef,
          ...value === undefined ? {} : { value },
          children: [
            placeholder === undefined ? null : /* @__PURE__ */ jsxDEV6("option", {
              disabled: true,
              value: "",
              children: placeholder
            }, undefined, false, undefined, this),
            options.map((option) => /* @__PURE__ */ jsxDEV6("option", {
              disabled: option.disabled,
              value: option.id,
              children: option.label
            }, option.id, false, undefined, this))
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV6("span", {
        className: "hraness-field__description",
        "data-slot": "field-description",
        id: descriptionId,
        children: description
      }, undefined, false, undefined, this),
      !showsError ? null : /* @__PURE__ */ jsxDEV6("span", {
        className: "hraness-field__error",
        "data-slot": "field-error",
        id: errorId,
        children: errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function FileField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  description,
  disabled = false,
  errorMessage,
  id,
  inputClassName,
  inputRef,
  isInvalid = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  ...props
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${controlId}-description`;
  const invalid = isInvalid || reportsInvalid(ariaInvalid);
  const showsError = invalid && errorMessage !== undefined;
  const errorId = showsError ? `${controlId}-error` : undefined;
  const describedBy = [ariaDescribedBy, descriptionId, errorId].filter((candidate) => typeof candidate === "string" && candidate.length > 0).join(" ") || undefined;
  const resolvedAriaInvalid = reportsInvalid(ariaInvalid) ? ariaInvalid : invalid ? true : ariaInvalid;
  return /* @__PURE__ */ jsxDEV6("div", {
    className: cn("hraness-field", "hraness-file-field", className),
    "data-disabled": disabled || undefined,
    "data-invalid": invalid || undefined,
    "data-size": size,
    "data-slot": "file-field",
    "data-surface": surface,
    children: [
      /* @__PURE__ */ jsxDEV6("label", {
        className: cn("hraness-field__label", !showLabel && "hraness-visually-hidden"),
        "data-slot": "field-label",
        htmlFor: controlId,
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV6("div", {
        className: "hraness-field__control",
        "data-slot": "field-control",
        children: /* @__PURE__ */ jsxDEV6("input", {
          ...props,
          "aria-describedby": describedBy,
          "aria-invalid": resolvedAriaInvalid,
          className: cn("hraness-field__file", inputClassName),
          "data-slot": "field-file",
          disabled,
          id: controlId,
          ref: inputRef,
          type: "file"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV6("span", {
        className: "hraness-field__description",
        "data-slot": "field-description",
        id: descriptionId,
        children: description
      }, undefined, false, undefined, this),
      !showsError ? null : /* @__PURE__ */ jsxDEV6("span", {
        className: "hraness-field__error",
        "data-slot": "field-error",
        id: errorId,
        children: errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}

// src/checkbox-group.tsx
import { jsxDEV as jsxDEV7 } from "react/jsx-dev-runtime";
"use client";
function CheckboxGroup({
  children,
  className,
  description,
  errorMessage,
  groupRef,
  label,
  optionsClassName,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV7(AriaCheckboxGroup, {
    ...props,
    className: cn("hraness-checkbox-group", className),
    "data-slot": "checkbox-group",
    ref: groupRef,
    children: [
      /* @__PURE__ */ jsxDEV7(Label2, {
        className: "hraness-checkbox-group__label",
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV7("div", {
        className: cn("hraness-checkbox-group__options", optionsClassName),
        children
      }, undefined, false, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV7(FieldDescription, {
        children: description
      }, undefined, false, undefined, this),
      errorMessage === undefined ? null : /* @__PURE__ */ jsxDEV7(FieldError, {
        children: errorMessage
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
// src/collections.tsx
import {
  Button as AriaButton5,
  Disclosure as AriaDisclosure,
  DisclosureGroup as AriaDisclosureGroup,
  DisclosurePanel as AriaDisclosurePanel,
  Heading as Heading2,
  Radio as AriaRadio,
  RadioGroup as RadioGroup2,
  Separator as AriaSeparator2,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs as AriaTabs,
  ToggleButton as ToggleButton2,
  ToggleButtonGroup
} from "react-aria-components";
import { jsxDEV as jsxDEV8 } from "react/jsx-dev-runtime";
"use client";
function ownedStringIdForKey(items, key) {
  const candidate = String(key);
  return items.find((item) => item.id === candidate)?.id ?? null;
}
function firstOwnedStringId(items, keys) {
  const first = keys[Symbol.iterator]().next();
  return first.done ? null : ownedStringIdForKey(items, first.value);
}
function toIdList(value) {
  if (value === null)
    return [];
  return typeof value === "string" ? [value] : value;
}
function Tabs({
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
}) {
  return /* @__PURE__ */ jsxDEV8(AriaTabs, {
    ...props,
    className: cn("hraness-tabs", className),
    "data-slot": "tabs",
    "data-size": size,
    ...defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue },
    onSelectionChange: (key) => {
      const next = ownedStringIdForKey(items, key);
      if (next !== null)
        onChange?.(next);
    },
    ref: tabsRef,
    ...value === undefined ? {} : { selectedKey: value },
    children: [
      /* @__PURE__ */ jsxDEV8("div", {
        className: "hraness-tabs__bar",
        "data-slot": "tabs-bar",
        children: [
          /* @__PURE__ */ jsxDEV8(TabList, {
            "aria-label": ariaLabel,
            className: "hraness-tabs__list",
            "data-slot": "tabs-list",
            items,
            children: (item) => /* @__PURE__ */ jsxDEV8(Tab, {
              ...item.ariaLabel === undefined ? {} : { "aria-label": item.ariaLabel },
              className: "hraness-tabs__tab",
              "data-slot": "tab",
              id: item.id,
              ...item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled },
              children: [
                item.leading === undefined ? null : /* @__PURE__ */ jsxDEV8("span", {
                  "aria-hidden": "true",
                  className: "hraness-tabs__leading",
                  "data-slot": "tab-leading",
                  children: item.leading
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV8("span", {
                  className: "hraness-tabs__label",
                  "data-slot": "tab-label",
                  children: item.label
                }, undefined, false, undefined, this),
                item.badge
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          end === undefined ? null : /* @__PURE__ */ jsxDEV8("div", {
            className: "hraness-tabs__end",
            "data-slot": "tabs-end",
            children: end
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV8(TabPanels, {
        className: "hraness-tabs__panels",
        "data-slot": "tab-panels",
        items,
        children: (item) => /* @__PURE__ */ jsxDEV8(TabPanel, {
          className: "hraness-tabs__panel",
          "data-slot": "tab-panel",
          id: item.id,
          children: item.panel
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function Disclosure({
  children,
  className,
  headingLevel = 3,
  indicator = "›",
  size = "default",
  title,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV8(AriaDisclosure, {
    ...props,
    className: cn("hraness-disclosure", className),
    "data-slot": "disclosure",
    "data-size": size,
    children: [
      /* @__PURE__ */ jsxDEV8(Heading2, {
        className: "hraness-disclosure__heading",
        "data-slot": "disclosure-heading",
        level: headingLevel,
        children: /* @__PURE__ */ jsxDEV8(AriaButton5, {
          className: "hraness-disclosure__trigger",
          "data-slot": "disclosure-trigger",
          slot: "trigger",
          children: [
            /* @__PURE__ */ jsxDEV8("span", {
              className: "hraness-disclosure__title",
              "data-slot": "disclosure-title",
              children: title
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV8("span", {
              "aria-hidden": "true",
              className: "hraness-disclosure__indicator",
              "data-slot": "disclosure-indicator",
              children: indicator
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV8(AriaDisclosurePanel, {
        className: "hraness-disclosure__panel",
        "data-slot": "disclosure-panel",
        children
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function Accordion({ children, className, ...props }) {
  return /* @__PURE__ */ jsxDEV8(AriaDisclosureGroup, {
    ...props,
    className: cn("hraness-accordion", className),
    "data-slot": "accordion",
    children
  }, undefined, false, undefined, this);
}
function ToggleGroup({
  "aria-label": ariaLabel,
  className,
  isDisabled = false,
  items,
  onChange,
  orientation = "horizontal",
  selectionMode = "single",
  value
}) {
  const ownedSelectedKeys = toIdList(value).flatMap((candidate) => {
    const owned = ownedStringIdForKey(items, candidate);
    return owned === null ? [] : [owned];
  });
  const selectedKeys = selectionMode === "single" ? ownedSelectedKeys.slice(0, 1) : ownedSelectedKeys;
  return /* @__PURE__ */ jsxDEV8(ToggleButtonGroup, {
    "aria-label": ariaLabel,
    className: cn("hraness-toggle-group", className),
    "data-slot": "toggle-group",
    isDisabled,
    onSelectionChange: (keys) => {
      if (selectionMode === "single") {
        onChange(firstOwnedStringId(items, keys));
        return;
      }
      const next = [...keys].flatMap((key) => {
        const owned = ownedStringIdForKey(items, key);
        return owned === null ? [] : [owned];
      });
      onChange(next);
    },
    orientation,
    selectedKeys,
    selectionMode,
    children: items.map((item) => /* @__PURE__ */ jsxDEV8(ToggleButton2, {
      ...item.textValue === undefined ? {} : { "aria-label": item.textValue },
      className: "hraness-toggle-group__item",
      "data-slot": "toggle-group-item",
      id: item.id,
      ...item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled },
      children: [
        item.leading === undefined ? null : /* @__PURE__ */ jsxDEV8("span", {
          "aria-hidden": "true",
          className: "hraness-toggle-group__leading",
          "data-slot": "toggle-group-leading",
          children: item.leading
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV8("span", {
          className: "hraness-toggle-group__label",
          "data-slot": "toggle-group-label",
          children: item.label
        }, undefined, false, undefined, this)
      ]
    }, item.id, true, undefined, this))
  }, undefined, false, undefined, this);
}
function SegmentedControl({
  "aria-label": ariaLabel,
  className,
  isDisabled = false,
  items,
  onChange,
  size = "default",
  value
}) {
  const fallbackValue = items.find((item) => item.isDisabled !== true)?.id ?? items[0].id;
  const normalizedValue = ownedStringIdForKey(items, value) ?? fallbackValue;
  return /* @__PURE__ */ jsxDEV8(RadioGroup2, {
    "aria-label": ariaLabel,
    className: cn("hraness-segmented-control", className),
    "data-slot": "segmented-control",
    "data-size": size,
    isDisabled,
    onChange: (key) => {
      const next = ownedStringIdForKey(items, key);
      if (next !== null)
        onChange(next);
    },
    orientation: "horizontal",
    value: normalizedValue,
    children: items.map((item) => /* @__PURE__ */ jsxDEV8(AriaRadio, {
      ...item.ariaLabel === undefined ? {} : { "aria-label": item.ariaLabel },
      className: "hraness-segmented-control__item",
      "data-slot": "segmented-control-item",
      ...item.isDisabled === undefined ? {} : { isDisabled: item.isDisabled },
      value: item.id,
      children: [
        /* @__PURE__ */ jsxDEV8("span", {
          "aria-hidden": "true",
          className: "hraness-segmented-control__indicator",
          "data-slot": "segmented-control-indicator"
        }, undefined, false, undefined, this),
        item.leading === undefined ? null : /* @__PURE__ */ jsxDEV8("span", {
          "aria-hidden": "true",
          className: "hraness-segmented-control__leading",
          "data-slot": "segmented-control-leading",
          children: item.leading
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV8("span", {
          className: "hraness-segmented-control__label",
          "data-slot": "segmented-control-label",
          children: item.label
        }, undefined, false, undefined, this)
      ]
    }, item.id, true, undefined, this))
  }, undefined, false, undefined, this);
}
function Separator({ className, ...props }) {
  return /* @__PURE__ */ jsxDEV8(AriaSeparator2, {
    ...props,
    className: cn("hraness-separator", className),
    "data-slot": "separator"
  }, undefined, false, undefined, this);
}
// src/content.tsx
import {
  forwardRef as forwardRef5
} from "react";
import { jsxDEV as jsxDEV9 } from "react/jsx-dev-runtime";
var KeyHint = forwardRef5(({ children, className, ...props }, ref) => /* @__PURE__ */ jsxDEV9("kbd", {
  ...props,
  className: cn("hraness-key-hint", className),
  "data-slot": "key-hint",
  ref,
  children
}, undefined, false, undefined, this));
KeyHint.displayName = "KeyHint";
var PageIntro = forwardRef5(({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
  titleAs = "h1",
  ...props
}, ref) => {
  const Heading3 = titleAs;
  return /* @__PURE__ */ jsxDEV9("section", {
    ...props,
    className: cn("hraness-page-intro", className),
    "data-slot": "page-intro",
    ref,
    children: [
      /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-page-intro__copy",
        "data-slot": "page-intro-copy",
        children: [
          eyebrow === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
            className: "hraness-page-intro__eyebrow",
            "data-slot": "page-intro-eyebrow",
            children: eyebrow
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV9(Heading3, {
            className: "hraness-page-intro__title",
            "data-slot": "page-intro-title",
            children: title
          }, undefined, false, undefined, this),
          description === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
            className: "hraness-page-intro__description",
            "data-slot": "page-intro-description",
            children: description
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      actions === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-page-intro__actions",
        "data-slot": "page-intro-actions",
        children: actions
      }, undefined, false, undefined, this),
      children
    ]
  }, undefined, true, undefined, this);
});
PageIntro.displayName = "PageIntro";
var EmptyState = forwardRef5(({
  action,
  className,
  description,
  icon,
  title,
  titleAs = "h2",
  ...props
}, ref) => {
  const Heading3 = titleAs;
  return /* @__PURE__ */ jsxDEV9("section", {
    ...props,
    className: cn("hraness-empty-state", className),
    "data-slot": "empty-state",
    ref,
    children: [
      icon === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
        "aria-hidden": "true",
        className: "hraness-empty-state__icon",
        "data-slot": "empty-state-icon",
        children: icon
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV9(Heading3, {
        className: "hraness-empty-state__title",
        "data-slot": "empty-state-title",
        children: title
      }, undefined, false, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-empty-state__description",
        "data-slot": "empty-state-description",
        children: description
      }, undefined, false, undefined, this),
      action === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-empty-state__action",
        "data-slot": "empty-state-action",
        children: action
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
});
EmptyState.displayName = "EmptyState";
var InlineAlert = forwardRef5(({
  "aria-live": ariaLive,
  children,
  className,
  icon,
  isLive = false,
  role,
  title,
  tone = "info",
  ...props
}, ref) => {
  const resolvedAriaLive = ariaLive ?? (isLive ? tone === "danger" ? "assertive" : "polite" : undefined);
  const resolvedRole = role ?? (isLive ? tone === "danger" ? "alert" : "status" : undefined);
  return /* @__PURE__ */ jsxDEV9("div", {
    ...props,
    "aria-live": resolvedAriaLive,
    className: cn("hraness-inline-alert", className),
    "data-slot": "inline-alert",
    "data-tone": tone,
    ref,
    role: resolvedRole,
    children: [
      icon === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
        "aria-hidden": "true",
        className: "hraness-inline-alert__icon",
        "data-slot": "inline-alert-icon",
        children: icon
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-inline-alert__content",
        "data-slot": "inline-alert-content",
        children: [
          title === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
            className: "hraness-inline-alert__title",
            "data-slot": "inline-alert-title",
            children: title
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV9("div", {
            className: "hraness-inline-alert__body",
            "data-slot": "inline-alert-body",
            children
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
});
InlineAlert.displayName = "InlineAlert";
var SettingsCard = forwardRef5(({
  actions,
  children,
  className,
  description,
  shape = "rounded",
  title,
  titleAs = "h2",
  ...props
}, ref) => {
  const Heading3 = titleAs;
  return /* @__PURE__ */ jsxDEV9("section", {
    ...props,
    className: cn("hraness-settings-card", className),
    "data-shape": shape,
    "data-slot": "settings-card",
    ref,
    children: [
      /* @__PURE__ */ jsxDEV9("header", {
        className: "hraness-settings-card__header",
        "data-slot": "settings-card-header",
        children: [
          /* @__PURE__ */ jsxDEV9("div", {
            "data-slot": "settings-card-heading",
            children: [
              /* @__PURE__ */ jsxDEV9(Heading3, {
                className: "hraness-settings-card__title",
                "data-slot": "settings-card-title",
                children: title
              }, undefined, false, undefined, this),
              description === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
                className: "hraness-settings-card__description",
                "data-slot": "settings-card-description",
                children: description
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this),
          actions === undefined ? null : /* @__PURE__ */ jsxDEV9("div", {
            className: "hraness-settings-card__actions",
            "data-slot": "settings-card-actions",
            children: actions
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV9("div", {
        className: "hraness-settings-card__body",
        "data-slot": "settings-card-body",
        children
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
});
SettingsCard.displayName = "SettingsCard";
// src/data-display.tsx
import {
  forwardRef as forwardRef6
} from "react";
import { jsxDEV as jsxDEV10 } from "react/jsx-dev-runtime";
function avatarInitials(name) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0)
    return "?";
  const selected = words.length === 1 ? words : [words[0] ?? "", words.at(-1) ?? ""];
  return selected.flatMap((word) => Array.from(word.toUpperCase()).slice(0, 1)).join("");
}
var Avatar = forwardRef6(({
  "aria-label": ariaLabel,
  alt = "",
  className,
  name,
  role,
  size = "default",
  src,
  title,
  ...props
}, ref) => {
  const fallbackLabel = ariaLabel ?? (alt === "" ? undefined : alt);
  const imageProps = { alt, src };
  return /* @__PURE__ */ jsxDEV10("span", {
    ...props,
    "aria-label": src === undefined ? fallbackLabel : ariaLabel,
    className: cn("hraness-avatar", className),
    "data-size": size,
    "data-slot": "avatar",
    ref,
    role: role ?? (src === undefined && fallbackLabel !== undefined ? "img" : undefined),
    title: title ?? name,
    children: src === undefined ? /* @__PURE__ */ jsxDEV10("span", {
      "aria-hidden": "true",
      className: "hraness-avatar__fallback",
      "data-slot": "avatar-fallback",
      children: avatarInitials(name)
    }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV10("img", {
      ...imageProps,
      className: "hraness-avatar__image",
      "data-slot": "avatar-image"
    }, undefined, false, undefined, this)
  }, undefined, false, undefined, this);
});
Avatar.displayName = "Avatar";
function DataTableInner({
  caption,
  className,
  columns,
  empty = "No results.",
  getRowId,
  rows,
  wrapperClassName,
  ...props
}, ref) {
  return /* @__PURE__ */ jsxDEV10("div", {
    className: cn("hraness-data-table", wrapperClassName),
    "data-slot": "data-table-wrapper",
    children: /* @__PURE__ */ jsxDEV10("table", {
      ...props,
      className: cn("hraness-data-table__table", className),
      "data-slot": "data-table",
      ref,
      children: [
        caption === undefined ? null : /* @__PURE__ */ jsxDEV10("caption", {
          "data-slot": "data-table-caption",
          children: caption
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV10("thead", {
          "data-slot": "data-table-head",
          children: /* @__PURE__ */ jsxDEV10("tr", {
            "data-slot": "data-table-header-row",
            children: columns.map((column) => /* @__PURE__ */ jsxDEV10("th", {
              "data-align": column.align ?? "start",
              "data-slot": "data-table-header",
              scope: "col",
              children: column.header
            }, column.id, false, undefined, this))
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV10("tbody", {
          "data-slot": "data-table-body",
          children: rows.length === 0 ? /* @__PURE__ */ jsxDEV10("tr", {
            "data-slot": "data-table-empty-row",
            children: /* @__PURE__ */ jsxDEV10("td", {
              className: "hraness-data-table__empty",
              colSpan: columns.length,
              "data-slot": "data-table-empty",
              children: empty
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this) : rows.map((row) => /* @__PURE__ */ jsxDEV10("tr", {
            "data-slot": "data-table-row",
            children: columns.map((column) => /* @__PURE__ */ jsxDEV10("td", {
              "data-align": column.align ?? "start",
              "data-slot": "data-table-cell",
              children: column.cell(row)
            }, column.id, false, undefined, this))
          }, getRowId(row), false, undefined, this))
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
var ForwardedDataTable = forwardRef6(DataTableInner);
ForwardedDataTable.displayName = "DataTable";
var DataTable = ForwardedDataTable;
// src/feedback.tsx
import {
  forwardRef as forwardRef7,
  useId as useId2
} from "react";
import { jsxDEV as jsxDEV11 } from "react/jsx-dev-runtime";
var Spinner = forwardRef7(({ className, label, size = "default", ...props }, ref) => /* @__PURE__ */ jsxDEV11("span", {
  ...props,
  "aria-hidden": label === undefined ? "true" : undefined,
  className: cn("hraness-spinner", className),
  "data-size": size,
  "data-slot": "spinner",
  ref,
  role: label === undefined ? undefined : "status",
  children: label === undefined ? null : /* @__PURE__ */ jsxDEV11("span", {
    className: "hraness-visually-hidden",
    "data-slot": "spinner-label",
    children: label
  }, undefined, false, undefined, this)
}, undefined, false, undefined, this));
Spinner.displayName = "Spinner";
var Skeleton = forwardRef7(({
  className,
  height,
  isText = false,
  style,
  width,
  ...props
}, ref) => /* @__PURE__ */ jsxDEV11("div", {
  ...props,
  "aria-hidden": "true",
  className: cn("hraness-skeleton", className),
  "data-slot": "skeleton",
  "data-text": isText || undefined,
  ref,
  style: {
    ...style,
    ...height === undefined ? {} : { height },
    ...width === undefined ? {} : { width }
  }
}, undefined, false, undefined, this));
Skeleton.displayName = "Skeleton";
function normalizeProgress(value, maximum) {
  const safeMaximum = Number.isFinite(maximum) && maximum > 0 ? maximum : 100;
  const finiteValue = Number.isFinite(value) ? value : 0;
  const safeValue = Math.min(safeMaximum, Math.max(0, finiteValue));
  return {
    maximum: safeMaximum,
    percent: safeValue / safeMaximum * 100,
    value: safeValue
  };
}
var Progress = forwardRef7(({
  className,
  label,
  max = 100,
  showValue = false,
  value,
  ...props
}, ref) => {
  const normalized = normalizeProgress(value, max);
  const labelId = `${useId2()}-label`;
  return /* @__PURE__ */ jsxDEV11("div", {
    ...props,
    className: cn("hraness-progress", className),
    "data-slot": "progress",
    ref,
    children: [
      /* @__PURE__ */ jsxDEV11("div", {
        className: "hraness-progress__label-row",
        "data-slot": "progress-label-row",
        children: [
          /* @__PURE__ */ jsxDEV11("span", {
            "data-slot": "progress-label",
            id: labelId,
            children: label
          }, undefined, false, undefined, this),
          showValue ? /* @__PURE__ */ jsxDEV11("span", {
            "data-slot": "progress-value",
            children: [
              Math.round(normalized.percent),
              "%"
            ]
          }, undefined, true, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV11("progress", {
        "aria-labelledby": labelId,
        className: "hraness-progress__control",
        "data-slot": "progress-control",
        max: normalized.maximum,
        value: normalized.value
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
});
Progress.displayName = "Progress";
// src/form.tsx
import { forwardRef as forwardRef8 } from "react";
import {
  Form as AriaForm
} from "react-aria-components";
import { jsxDEV as jsxDEV12 } from "react/jsx-dev-runtime";
"use client";
var Form = forwardRef8(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV12(AriaForm, {
  ...props,
  className: cn("hraness-form", className),
  "data-slot": "form",
  ref
}, undefined, false, undefined, this));
Form.displayName = "Form";
// src/indicators.tsx
import {
  Label as Label3,
  Meter as AriaMeter,
  ProgressBar as AriaProgressBar,
  Slider as AriaSlider,
  SliderFill,
  SliderOutput,
  SliderThumb,
  SliderTrack
} from "react-aria-components";
import { jsxDEV as jsxDEV13, Fragment as Fragment4 } from "react/jsx-dev-runtime";
"use client";
function percentageStyle(percentage) {
  const finitePercentage = percentage === undefined || !Number.isFinite(percentage) ? 0 : percentage;
  const safe = Math.min(100, Math.max(0, finitePercentage));
  const width = `${safe}%`;
  return { "--hraness-percentage": width, width };
}
function ProgressBar({
  className,
  label,
  progressRef,
  showValue = false,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV13(AriaProgressBar, {
    ...props,
    className: cn("hraness-progress-bar", className),
    "data-slot": "progress-bar",
    ref: progressRef,
    children: ({ percentage, valueText }) => /* @__PURE__ */ jsxDEV13(Fragment4, {
      children: [
        /* @__PURE__ */ jsxDEV13("div", {
          className: "hraness-progress-bar__header hraness-progress-bar__label-row",
          "data-slot": "progress-bar-header",
          children: [
            /* @__PURE__ */ jsxDEV13(Label3, {
              className: "hraness-progress-bar__label",
              "data-slot": "progress-bar-label",
              children: label
            }, undefined, false, undefined, this),
            showValue && valueText !== undefined ? /* @__PURE__ */ jsxDEV13("span", {
              className: "hraness-progress-bar__value",
              "data-slot": "progress-bar-value",
              children: valueText
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV13("div", {
          className: "hraness-progress-bar__track",
          "data-slot": "progress-bar-track",
          children: /* @__PURE__ */ jsxDEV13("span", {
            className: "hraness-progress-bar__fill",
            "data-indeterminate": percentage === undefined || undefined,
            "data-slot": "progress-bar-fill",
            style: percentageStyle(percentage)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function Meter({
  className,
  label,
  meterRef,
  showValue = true,
  tone = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxDEV13(AriaMeter, {
    ...props,
    className: cn("hraness-meter", className),
    "data-slot": "meter",
    "data-tone": tone,
    ref: meterRef,
    children: ({ percentage, valueText }) => /* @__PURE__ */ jsxDEV13(Fragment4, {
      children: [
        /* @__PURE__ */ jsxDEV13("div", {
          className: "hraness-meter__header hraness-meter__label-row",
          "data-slot": "meter-header",
          children: [
            /* @__PURE__ */ jsxDEV13(Label3, {
              className: "hraness-meter__label",
              "data-slot": "meter-label",
              children: label
            }, undefined, false, undefined, this),
            showValue && valueText !== undefined ? /* @__PURE__ */ jsxDEV13("span", {
              className: "hraness-meter__value",
              "data-slot": "meter-value",
              children: valueText
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV13("div", {
          className: "hraness-meter__track",
          "data-slot": "meter-track",
          children: /* @__PURE__ */ jsxDEV13("span", {
            className: "hraness-meter__fill",
            "data-slot": "meter-fill",
            style: percentageStyle(percentage)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function Slider({
  className,
  label,
  name,
  showValue = true,
  sliderRef,
  thumbLabel,
  ...props
}) {
  return /* @__PURE__ */ jsxDEV13(AriaSlider, {
    ...props,
    className: cn("hraness-slider", className),
    "data-slot": "slider",
    ref: sliderRef,
    children: [
      /* @__PURE__ */ jsxDEV13("div", {
        className: "hraness-slider__label-row",
        "data-slot": "slider-header",
        children: [
          /* @__PURE__ */ jsxDEV13(Label3, {
            className: "hraness-slider__label",
            "data-slot": "slider-label",
            children: label
          }, undefined, false, undefined, this),
          showValue ? /* @__PURE__ */ jsxDEV13(SliderOutput, {
            className: "hraness-slider__value",
            "data-slot": "slider-value"
          }, undefined, false, undefined, this) : null
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV13(SliderTrack, {
        className: "hraness-slider__track",
        "data-slot": "slider-track",
        children: [
          /* @__PURE__ */ jsxDEV13(SliderFill, {
            className: "hraness-slider__fill",
            "data-slot": "slider-fill"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV13(SliderThumb, {
            ...thumbLabel === undefined ? {} : { "aria-label": thumbLabel },
            className: "hraness-slider__thumb",
            "data-slot": "slider-thumb",
            ...name === undefined ? {} : { name }
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
// src/list-box.tsx
import {
  forwardRef as forwardRef9
} from "react";
import {
  Header as Header2,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  ListBoxSection as AriaListBoxSection
} from "react-aria-components";
import { jsxDEV as jsxDEV14 } from "react/jsx-dev-runtime";
"use client";
function ListBoxInner({ className, ...props }, ref) {
  return /* @__PURE__ */ jsxDEV14(AriaListBox, {
    ...props,
    className: cn("hraness-list-box", className),
    "data-slot": "list-box",
    ref
  }, undefined, false, undefined, this);
}
var ForwardedListBox = forwardRef9(ListBoxInner);
ForwardedListBox.displayName = "ListBox";
var ListBox = ForwardedListBox;
function ListBoxItemInner({ className, ...props }, ref) {
  return /* @__PURE__ */ jsxDEV14(AriaListBoxItem, {
    ...props,
    className: cn("hraness-list-box__item", className),
    "data-slot": "list-box-item",
    ref
  }, undefined, false, undefined, this);
}
var ForwardedListBoxItem = forwardRef9(ListBoxItemInner);
ForwardedListBoxItem.displayName = "ListBoxItem";
var ListBoxItem = ForwardedListBoxItem;
function ListBoxSectionInner({
  children,
  className,
  title,
  ...props
}, ref) {
  return /* @__PURE__ */ jsxDEV14(AriaListBoxSection, {
    ...props,
    className: cn("hraness-list-box__section", className),
    "data-slot": "list-box-section",
    ref,
    children: [
      title === undefined ? null : /* @__PURE__ */ jsxDEV14(Header2, {
        className: "hraness-list-box__header",
        "data-slot": "list-box-header",
        children: title
      }, undefined, false, undefined, this),
      children
    ]
  }, undefined, true, undefined, this);
}
var ForwardedListBoxSection = forwardRef9(ListBoxSectionInner);
ForwardedListBoxSection.displayName = "ListBoxSection";
var ListBoxSection = ForwardedListBoxSection;
// src/navigation.tsx
import {
  forwardRef as forwardRef10
} from "react";
import { jsxDEV as jsxDEV15 } from "react/jsx-dev-runtime";
var Breadcrumbs = forwardRef10(({
  "aria-label": ariaLabel = "Breadcrumbs",
  className,
  items,
  ...props
}, ref) => /* @__PURE__ */ jsxDEV15("nav", {
  ...props,
  "aria-label": ariaLabel,
  className: cn("hraness-breadcrumbs", className),
  "data-slot": "breadcrumbs",
  ref,
  children: /* @__PURE__ */ jsxDEV15("ol", {
    "data-slot": "breadcrumbs-list",
    children: items.map((item, index) => {
      const current = index === items.length - 1;
      return /* @__PURE__ */ jsxDEV15("li", {
        "data-slot": "breadcrumbs-item",
        children: item.href === undefined || current ? /* @__PURE__ */ jsxDEV15("span", {
          "aria-current": current ? "page" : undefined,
          "data-slot": current ? "breadcrumbs-current" : "breadcrumbs-label",
          children: item.label
        }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV15("a", {
          "data-slot": "breadcrumbs-link",
          href: item.href,
          children: item.label
        }, undefined, false, undefined, this)
      }, item.id, false, undefined, this);
    })
  }, undefined, false, undefined, this)
}, undefined, false, undefined, this));
Breadcrumbs.displayName = "Breadcrumbs";
var maximumPaginationSiblings = 100;
function positiveInteger(value, fallback = 1) {
  return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.trunc(value))) : fallback;
}
function normalizedPages(currentPage, totalPages) {
  const total = positiveInteger(totalPages);
  const current = Math.min(total, positiveInteger(currentPage));
  return { current, total };
}
function paginationRange(currentPage, totalPages, siblings = 1) {
  const { current, total } = normalizedPages(currentPage, totalPages);
  const radius = Number.isFinite(siblings) ? Math.min(maximumPaginationSiblings, Math.max(0, Math.trunc(siblings))) : 1;
  const pages = new Set([1, total]);
  for (let page = current - radius;page <= current + radius; page += 1) {
    if (page > 1 && page < total)
      pages.add(page);
  }
  if (current <= radius + 2) {
    const edge = Math.min(total - 1, 2 + radius * 2);
    for (let page = 2;page <= edge; page += 1)
      pages.add(page);
  }
  if (current >= total - radius - 1) {
    const edge = Math.max(2, total - 1 - radius * 2);
    for (let page = edge;page < total; page += 1)
      pages.add(page);
  }
  const ordered = [...pages].sort((left, right) => left - right);
  const result = [];
  for (const page of ordered) {
    const previous = result.at(-1);
    if (typeof previous === "number" && page - previous > 1) {
      result.push("ellipsis");
    }
    result.push(page);
  }
  return result;
}
function pageLinkProps(page, current) {
  return page === current ? { "aria-current": "page" } : {};
}
var Pagination = forwardRef10(({
  "aria-label": ariaLabel = "Pagination",
  className,
  currentPage,
  hrefForPage,
  siblings = 1,
  totalPages,
  ...props
}, ref) => {
  const { current, total } = normalizedPages(currentPage, totalPages);
  const parts = paginationRange(current, total, siblings);
  const previous = current - 1;
  const next = current + 1;
  return /* @__PURE__ */ jsxDEV15("nav", {
    ...props,
    "aria-label": ariaLabel,
    className: cn("hraness-pagination", className),
    "data-slot": "pagination",
    ref,
    children: [
      previous < 1 ? /* @__PURE__ */ jsxDEV15("span", {
        "aria-disabled": "true",
        className: "hraness-pagination__boundary",
        "data-direction": "previous",
        "data-slot": "pagination-previous",
        children: "Previous"
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV15("a", {
        className: "hraness-pagination__boundary",
        "data-direction": "previous",
        "data-slot": "pagination-previous",
        href: hrefForPage(previous),
        rel: "prev",
        children: "Previous"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV15("ol", {
        "data-slot": "pagination-list",
        children: parts.map((part, index) => /* @__PURE__ */ jsxDEV15("li", {
          "data-slot": "pagination-item",
          children: part === "ellipsis" ? /* @__PURE__ */ jsxDEV15("span", {
            "aria-hidden": "true",
            className: "hraness-pagination__ellipsis",
            "data-slot": "pagination-ellipsis",
            children: "…"
          }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV15("a", {
            ...pageLinkProps(part, current),
            "data-slot": "pagination-link",
            href: hrefForPage(part),
            children: part
          }, undefined, false, undefined, this)
        }, `${String(part)}-${String(index)}`, false, undefined, this))
      }, undefined, false, undefined, this),
      next > total ? /* @__PURE__ */ jsxDEV15("span", {
        "aria-disabled": "true",
        className: "hraness-pagination__boundary",
        "data-direction": "next",
        "data-slot": "pagination-next",
        children: "Next"
      }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV15("a", {
        className: "hraness-pagination__boundary",
        "data-direction": "next",
        "data-slot": "pagination-next",
        href: hrefForPage(next),
        rel: "next",
        children: "Next"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
});
Pagination.displayName = "Pagination";
// src/select-field.tsx
import {
  Button as AriaButton6,
  Label as Label4,
  ListBox as ListBox2,
  ListBoxItem as ListBoxItem2,
  Popover as Popover2,
  Select as AriaSelect,
  SelectValue,
  Text as Text3
} from "react-aria-components";
import { jsxDEV as jsxDEV16 } from "react/jsx-dev-runtime";
"use client";
function SelectField({
  className,
  defaultValue,
  description,
  errorMessage,
  label,
  onChange,
  options,
  placeholder = "Select an option",
  selectRef,
  showLabel = true,
  size = "default",
  surface = "default",
  value,
  ...props
}) {
  const ownedValue = (key) => {
    if (key === null)
      return null;
    const candidate = String(key);
    return options.find((option) => option.id === candidate)?.id ?? null;
  };
  return /* @__PURE__ */ jsxDEV16(AriaSelect, {
    ...props,
    className: cn("hraness-select-field", className),
    "data-size": size,
    "data-slot": "select-field",
    "data-surface": surface,
    ...defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue },
    onSelectionChange: (key) => onChange?.(ownedValue(key)),
    placeholder,
    ref: selectRef,
    ...value === undefined ? {} : { selectedKey: value },
    children: [
      /* @__PURE__ */ jsxDEV16(Label4, {
        className: cn("hraness-select-field__label", !showLabel && "hraness-visually-hidden"),
        children: label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV16(AriaButton6, {
        className: "hraness-select-field__trigger",
        children: [
          /* @__PURE__ */ jsxDEV16(SelectValue, {
            className: "hraness-select-field__value"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV16("span", {
            "aria-hidden": "true",
            className: "hraness-select-field__indicator",
            children: "⌄"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      description === undefined ? null : /* @__PURE__ */ jsxDEV16(FieldDescription, {
        className: "hraness-select-field__description",
        children: description
      }, undefined, false, undefined, this),
      errorMessage === undefined ? null : /* @__PURE__ */ jsxDEV16(FieldError, {
        className: "hraness-select-field__error",
        children: errorMessage
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV16(Popover2, {
        className: "hraness-select-field__popover",
        placement: "bottom start",
        children: /* @__PURE__ */ jsxDEV16(ListBox2, {
          className: "hraness-select-field__list-box",
          items: options,
          children: (option) => /* @__PURE__ */ jsxDEV16(ListBoxItem2, {
            className: "hraness-select-field__option",
            id: option.id,
            ...option.disabled === undefined ? {} : { isDisabled: option.disabled },
            textValue: option.textValue,
            children: /* @__PURE__ */ jsxDEV16("span", {
              className: "hraness-select-field__option-copy",
              children: [
                /* @__PURE__ */ jsxDEV16(Text3, {
                  className: "hraness-select-field__option-label",
                  slot: "label",
                  children: option.label
                }, undefined, false, undefined, this),
                option.description === undefined ? null : /* @__PURE__ */ jsxDEV16(Text3, {
                  className: "hraness-select-field__option-description",
                  slot: "description",
                  children: option.description
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
// src/skip-link.tsx
import {
  forwardRef as forwardRef11
} from "react";
import { jsxDEV as jsxDEV17 } from "react/jsx-dev-runtime";
"use client";
function attemptFocus(target, ownerDocument) {
  try {
    target.focus({ preventScroll: true });
  } catch {
    try {
      target.focus();
    } catch {
      return false;
    }
  }
  return ownerDocument.activeElement === target;
}
function scrollTargetIntoView(target) {
  try {
    target.scrollIntoView({ block: "start" });
  } catch {
    try {
      target.scrollIntoView();
    } catch {
      return;
    }
  }
}
function focusHashTarget(href) {
  if (href.length === 1 || typeof document === "undefined")
    return false;
  const target = document.getElementById(href.slice(1));
  if (target === null)
    return false;
  let hasTemporaryTabIndex = false;
  let didFocus = attemptFocus(target, document);
  if (!didFocus && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    hasTemporaryTabIndex = true;
    didFocus = attemptFocus(target, document);
  }
  if (!didFocus) {
    if (hasTemporaryTabIndex)
      target.removeAttribute("tabindex");
    return false;
  }
  if (hasTemporaryTabIndex) {
    target.addEventListener("blur", () => {
      if (target.getAttribute("tabindex") === "-1") {
        target.removeAttribute("tabindex");
      }
    }, { once: true });
  }
  scrollTargetIntoView(target);
  return true;
}
var SkipLink = forwardRef11(({
  children = "Skip to main content",
  className,
  href = "#main-content",
  onClick,
  onKeyDown,
  ...props
}, ref) => {
  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (focusHashTarget(href))
      event.preventDefault();
  };
  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (focusHashTarget(href))
      event.preventDefault();
  };
  return /* @__PURE__ */ jsxDEV17("a", {
    ...props,
    className: cn("hraness-skip-link", className),
    "data-slot": "skip-link",
    href,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    ref,
    children
  }, undefined, false, undefined, this);
});
SkipLink.displayName = "SkipLink";
// src/surfaces.tsx
import {
  forwardRef as forwardRef12
} from "react";
import { jsxDEV as jsxDEV18 } from "react/jsx-dev-runtime";
function setForwardedRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null) {
    ref.current = value;
  }
}
var ViewportFrame = forwardRef12(({ as = "div", className, ...props }, ref) => {
  const Element = as;
  return /* @__PURE__ */ jsxDEV18(Element, {
    ...props,
    className: cn("hraness-viewport-frame", className),
    "data-slot": "viewport-frame",
    ref: (element) => {
      setForwardedRef(ref, element);
    }
  }, undefined, false, undefined, this);
});
ViewportFrame.displayName = "ViewportFrame";
var WrappingRow = forwardRef12(({ as = "div", className, ...props }, ref) => {
  const Element = as;
  return /* @__PURE__ */ jsxDEV18(Element, {
    ...props,
    className: cn("hraness-wrapping-row", className),
    "data-slot": "wrapping-row",
    ref: (element) => {
      setForwardedRef(ref, element);
    }
  }, undefined, false, undefined, this);
});
WrappingRow.displayName = "WrappingRow";
var ThemedSurface = forwardRef12(({
  as = "div",
  className,
  shape = "rounded",
  tone = "card",
  ...props
}, ref) => {
  const Element = as;
  return /* @__PURE__ */ jsxDEV18(Element, {
    ...props,
    className: cn("hraness-themed-surface", className),
    "data-shape": shape,
    "data-slot": "themed-surface",
    "data-tone": tone,
    ref: (element) => {
      setForwardedRef(ref, element);
    }
  }, undefined, false, undefined, this);
});
ThemedSurface.displayName = "ThemedSurface";
// src/toast.tsx
import {
  createContext as createContext2,
  useContext as useContext2,
  useMemo as useMemo2
} from "react";
import {
  Button as AriaButton7,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as AriaToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
  Text as Text4
} from "react-aria-components";
import { jsxDEV as jsxDEV19 } from "react/jsx-dev-runtime";
"use client";
var ToastContext = createContext2(null);
var DEFAULT_DURATION = 5000;
var DEFAULT_MAX_VISIBLE_TOASTS = 3;
function finiteDuration(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
function visibleToastLimit(value) {
  if (!Number.isFinite(value))
    return DEFAULT_MAX_VISIBLE_TOASTS;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}
function ToastProvider({
  children,
  closeLabel = "Dismiss notification",
  defaultDuration = DEFAULT_DURATION,
  label = "Notifications",
  maxVisibleToasts = DEFAULT_MAX_VISIBLE_TOASTS
}) {
  const duration = finiteDuration(defaultDuration, DEFAULT_DURATION);
  const visibleLimit = visibleToastLimit(maxVisibleToasts);
  const queue = useMemo2(() => new AriaToastQueue({ maxVisibleToasts: visibleLimit }), [visibleLimit]);
  const controller = useMemo2(() => ({
    dismiss: (key) => queue.close(key),
    dismissAll: () => queue.clear(),
    toast: (message, options = {}) => queue.add(message, {
      ...options.onClose === undefined ? {} : { onClose: options.onClose },
      ...options.duration === null ? {} : {
        timeout: finiteDuration(options.duration ?? duration, duration)
      }
    })
  }), [duration, queue]);
  return /* @__PURE__ */ jsxDEV19(ToastContext.Provider, {
    value: controller,
    children: [
      children,
      /* @__PURE__ */ jsxDEV19(AriaToastRegion, {
        "aria-label": label,
        className: "hraness-toast-region",
        "data-slot": "toast-region",
        queue,
        children: ({ toast }) => /* @__PURE__ */ jsxDEV19(AriaToast, {
          className: "hraness-toast",
          "data-slot": "toast",
          "data-tone": toast.content.tone ?? "info",
          toast,
          children: [
            /* @__PURE__ */ jsxDEV19(AriaToastContent, {
              className: "hraness-toast__content",
              "data-slot": "toast-content",
              children: [
                /* @__PURE__ */ jsxDEV19("div", {
                  className: "hraness-toast__copy",
                  "data-slot": "toast-copy",
                  children: [
                    /* @__PURE__ */ jsxDEV19(Text4, {
                      className: "hraness-toast__title",
                      "data-slot": "toast-title",
                      slot: "title",
                      children: toast.content.title
                    }, undefined, false, undefined, this),
                    toast.content.description === undefined ? null : /* @__PURE__ */ jsxDEV19(Text4, {
                      className: "hraness-toast__description",
                      "data-slot": "toast-description",
                      slot: "description",
                      children: toast.content.description
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                toast.content.action === undefined ? null : /* @__PURE__ */ jsxDEV19("div", {
                  className: "hraness-toast__action",
                  "data-slot": "toast-action",
                  children: toast.content.action
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV19(AriaButton7, {
              "aria-label": closeLabel,
              className: "hraness-toast__close",
              "data-slot": "toast-close",
              slot: "close",
              children: /* @__PURE__ */ jsxDEV19("span", {
                "aria-hidden": "true",
                children: "×"
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function useToast() {
  const controller = useContext2(ToastContext);
  if (controller === null) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return controller;
}
// src/toolbar.tsx
import { forwardRef as forwardRef13 } from "react";
import {
  Toolbar as AriaToolbar
} from "react-aria-components";
import { jsxDEV as jsxDEV20 } from "react/jsx-dev-runtime";
"use client";
var Toolbar = forwardRef13(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV20(AriaToolbar, {
  ...props,
  className: cn("hraness-toolbar", className),
  "data-slot": "toolbar",
  ref
}, undefined, false, undefined, this));
Toolbar.displayName = "Toolbar";
export {
  useToast,
  useLinkPrefetch,
  paginationRange,
  normalizeProgress,
  isPrefetchableHref,
  cn,
  avatarInitials,
  WrappingRow,
  ViewportFrame,
  Tooltip,
  Toolbar,
  ToggleGroup,
  ToggleButton,
  ToastProvider,
  ThemedSurface,
  TextField,
  TextAreaField,
  Tabs,
  SwitchField,
  StatusDot,
  Spinner,
  Slider,
  SkipLink,
  Skeleton,
  SettingsCard,
  Separator,
  SelectField,
  SegmentedControl,
  SearchField,
  RouterProvider,
  RadioOption,
  RadioGroup,
  ProgressBar,
  Progress,
  PressableCard,
  Popover,
  Pagination,
  PageIntro,
  NumberField,
  NativeSelectField,
  Meter,
  MenuTrigger,
  MenuSeparator,
  MenuSection,
  MenuItem,
  Menu,
  ListBoxSection,
  ListBoxItem,
  ListBox,
  LinkButton,
  Link,
  KeyHint,
  InlineAlert,
  IconLink,
  IconButton,
  Form,
  FileField,
  FieldError,
  FieldDescription,
  EmptyState,
  Disclosure,
  DialogTrigger,
  DialogContent,
  DataTable,
  CheckboxGroup,
  CheckboxField,
  CardTitle,
  CardHeader,
  CardFooter,
  CardDescription,
  CardContent,
  Card,
  Button,
  Breadcrumbs,
  Badge,
  Avatar,
  Accordion
};
