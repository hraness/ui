"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,border-color,box-shadow] select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[pending]:opacity-75 data-[focus-visible]:border-ring data-[focus-visible]:ring-[3px] data-[focus-visible]:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs data-[hovered]:bg-primary/90 data-[pressed]:bg-primary/80",
        destructive:
          "bg-destructive text-white shadow-xs data-[hovered]:bg-destructive/90 data-[pressed]:bg-destructive/80 data-[focus-visible]:ring-destructive/20 dark:data-[focus-visible]:ring-destructive/40",
        outline:
          "border border-input bg-background shadow-xs data-[hovered]:bg-accent data-[hovered]:text-accent-foreground data-[pressed]:bg-accent/80",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs data-[hovered]:bg-secondary/80 data-[pressed]:bg-secondary/70",
        ghost:
          "data-[hovered]:bg-accent data-[hovered]:text-accent-foreground data-[pressed]:bg-accent/80",
        link:
          "text-primary underline-offset-4 data-[hovered]:underline data-[pressed]:opacity-80",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "default",
    },
  },
);

export type ButtonProps = Omit<AriaButtonProps, "className"> &
  VariantProps<typeof buttonVariants> & {
    readonly className?: string;
  };

/** A keyboard, pointer, and touch-aware action control. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <AriaButton
      {...props}
      className={cn(buttonVariants({ size, variant }), className)}
      ref={ref}
    />
  ),
);

Button.displayName = "Button";
