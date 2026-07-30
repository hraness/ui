// src/badge.tsx
import { cva } from "class-variance-authority";
import { forwardRef } from "react";

// src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// src/badge.tsx
import { jsxDEV } from "react/jsx-dev-runtime";
var badgeVariants = cva("inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      destructive: "border-transparent bg-destructive text-white",
      outline: "border-border text-foreground"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});
var Badge = forwardRef(({ className, variant, ...props }, ref) => /* @__PURE__ */ jsxDEV("span", {
  ...props,
  className: cn(badgeVariants({ variant }), className),
  "data-slot": "badge",
  ref
}, undefined, false, undefined, this));
Badge.displayName = "Badge";

// src/button.tsx
import { cva as cva2 } from "class-variance-authority";
import { forwardRef as forwardRef2 } from "react";
import {
  Button as AriaButton
} from "react-aria-components";
import { jsxDEV as jsxDEV2 } from "react/jsx-dev-runtime";
"use client";
var buttonVariants = cva2("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow] select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[pending]:opacity-75 data-[focus-visible]:border-ring data-[focus-visible]:ring-[3px] data-[focus-visible]:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground shadow-xs data-[hovered]:bg-primary/90 data-[pressed]:bg-primary/80",
      destructive: "bg-destructive text-white shadow-xs data-[hovered]:bg-destructive/90 data-[pressed]:bg-destructive/80 data-[focus-visible]:ring-destructive/20 dark:data-[focus-visible]:ring-destructive/40",
      outline: "border border-input bg-background shadow-xs data-[hovered]:bg-accent data-[hovered]:text-accent-foreground data-[pressed]:bg-accent/80",
      secondary: "bg-secondary text-secondary-foreground shadow-xs data-[hovered]:bg-secondary/80 data-[pressed]:bg-secondary/70",
      ghost: "data-[hovered]:bg-accent data-[hovered]:text-accent-foreground data-[pressed]:bg-accent/80",
      link: "text-primary underline-offset-4 data-[hovered]:underline data-[pressed]:opacity-80"
    },
    size: {
      default: "h-9 px-4 py-2 has-[>svg]:px-3",
      sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
      lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
      icon: "size-9"
    }
  },
  defaultVariants: {
    size: "default",
    variant: "default"
  }
});
var Button = forwardRef2(({ className, size, variant, ...props }, ref) => /* @__PURE__ */ jsxDEV2(AriaButton, {
  ...props,
  className: cn(buttonVariants({ size, variant }), className),
  ref
}, undefined, false, undefined, this));
Button.displayName = "Button";

// src/card.tsx
import {
  forwardRef as forwardRef3
} from "react";
import { jsxDEV as jsxDEV3 } from "react/jsx-dev-runtime";
var Card = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("div", {
  ...props,
  className: cn("flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm", className),
  "data-slot": "card",
  ref
}, undefined, false, undefined, this));
Card.displayName = "Card";
var CardHeader = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("div", {
  ...props,
  className: cn("flex flex-col gap-1.5 px-6", className),
  "data-slot": "card-header",
  ref
}, undefined, false, undefined, this));
CardHeader.displayName = "CardHeader";
var CardTitle = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("h3", {
  ...props,
  className: cn("font-semibold leading-none", className),
  "data-slot": "card-title",
  ref
}, undefined, false, undefined, this));
CardTitle.displayName = "CardTitle";
var CardDescription = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("p", {
  ...props,
  className: cn("text-sm text-muted-foreground", className),
  "data-slot": "card-description",
  ref
}, undefined, false, undefined, this));
CardDescription.displayName = "CardDescription";
var CardContent = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("div", {
  ...props,
  className: cn("px-6", className),
  "data-slot": "card-content",
  ref
}, undefined, false, undefined, this));
CardContent.displayName = "CardContent";
var CardFooter = forwardRef3(({ className, ...props }, ref) => /* @__PURE__ */ jsxDEV3("div", {
  ...props,
  className: cn("flex items-center px-6", className),
  "data-slot": "card-footer",
  ref
}, undefined, false, undefined, this));
CardFooter.displayName = "CardFooter";

// src/text-field.tsx
import {
  forwardRef as forwardRef4
} from "react";
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField
} from "react-aria-components";
import { jsxDEV as jsxDEV4 } from "react/jsx-dev-runtime";
"use client";
var TextField = forwardRef4(({
  className,
  description,
  errorMessage,
  inputClassName,
  inputProps,
  inputRef,
  isLabelHidden = false,
  label,
  ...props
}, ref) => /* @__PURE__ */ jsxDEV4(AriaTextField, {
  ...props,
  className: cn("group grid gap-2", className),
  ref,
  children: [
    /* @__PURE__ */ jsxDEV4(Label, {
      className: cn("text-sm font-medium leading-none group-data-[disabled]:opacity-50", isLabelHidden && "sr-only"),
      children: label
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV4(Input, {
      ...inputProps,
      className: cn("flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground data-[focus-visible]:border-ring data-[focus-visible]:ring-[3px] data-[focus-visible]:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40", inputClassName),
      ref: inputRef
    }, undefined, false, undefined, this),
    description === undefined ? null : /* @__PURE__ */ jsxDEV4(Text, {
      className: "text-sm text-muted-foreground",
      slot: "description",
      children: description
    }, undefined, false, undefined, this),
    errorMessage === undefined ? null : /* @__PURE__ */ jsxDEV4(FieldError, {
      className: "text-sm text-destructive",
      children: errorMessage
    }, undefined, false, undefined, this)
  ]
}, undefined, true, undefined, this));
TextField.displayName = "TextField";

// src/index.ts
var Badge2 = Badge;
var badgeVariants2 = badgeVariants;
var Button2 = Button;
var buttonVariants2 = buttonVariants;
var Card2 = Card;
var CardContent2 = CardContent;
var CardDescription2 = CardDescription;
var CardFooter2 = CardFooter;
var CardHeader2 = CardHeader;
var CardTitle2 = CardTitle;
var cn2 = cn;
var TextField2 = TextField;
export {
  cn2 as cn,
  buttonVariants2 as buttonVariants,
  badgeVariants2 as badgeVariants,
  TextField2 as TextField,
  CardTitle2 as CardTitle,
  CardHeader2 as CardHeader,
  CardFooter2 as CardFooter,
  CardDescription2 as CardDescription,
  CardContent2 as CardContent,
  Card2 as Card,
  Button2 as Button,
  Badge2 as Badge
};
