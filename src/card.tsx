"use client";

import {
  forwardRef,
  type HTMLAttributes,
  type Ref,
} from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

export type SurfaceShape = "rectangular" | "rounded";
export type CardTone = "accent" | "card" | "inverse" | "neutral";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  readonly shape?: SurfaceShape;
  readonly tone?: CardTone;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, shape = "rounded", tone = "card", ...props }, ref) => (
    <div
      {...props}
      className={cn("hraness-card", className)}
      data-shape={shape}
      data-slot="card"
      data-tone={tone}
      ref={ref}
    />
  ),
);

Card.displayName = "Card";

export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn("hraness-card__header", className)}
      data-slot="card-header"
      ref={ref}
    />
  ),
);

CardHeader.displayName = "CardHeader";

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3
      {...props}
      className={cn("hraness-card__title", className)}
      data-slot="card-title"
      ref={ref}
    />
  ),
);

CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      {...props}
      className={cn("hraness-card__description", className)}
      data-slot="card-description"
      ref={ref}
    />
  ),
);

CardDescription.displayName = "CardDescription";

export type CardContentProps = HTMLAttributes<HTMLDivElement>;

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn("hraness-card__content", className)}
      data-slot="card-content"
      ref={ref}
    />
  ),
);

CardContent.displayName = "CardContent";

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn("hraness-card__footer", className)}
      data-slot="card-footer"
      ref={ref}
    />
  ),
);

CardFooter.displayName = "CardFooter";

export type PressableCardProps = Omit<AriaButtonProps, "className"> & {
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly className?: string;
  readonly shape?: SurfaceShape;
  readonly tone?: CardTone;
};

/** A whole-card action with one semantic button and no nested controls. */
export function PressableCard({
  buttonRef,
  className,
  shape = "rounded",
  tone = "card",
  ...props
}: PressableCardProps) {
  return (
    <AriaButton
      {...props}
      className={cn("hraness-pressable-card", className)}
      data-shape={shape}
      data-slot="pressable-card"
      data-tone={tone}
      ref={buttonRef}
    />
  );
}
