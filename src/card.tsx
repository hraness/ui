import {
  forwardRef,
  type HTMLAttributes,
} from "react";

import { cn } from "./lib/utils.js";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn(
        "flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm",
        className,
      )}
      data-slot="card"
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
      className={cn("flex flex-col gap-1.5 px-6", className)}
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
      className={cn("font-semibold leading-none", className)}
      data-slot="card-title"
      ref={ref}
    />
  ),
);

CardTitle.displayName = "CardTitle";

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  CardDescriptionProps
>(({ className, ...props }, ref) => (
  <p
    {...props}
    className={cn("text-sm text-muted-foreground", className)}
    data-slot="card-description"
    ref={ref}
  />
));

CardDescription.displayName = "CardDescription";

export type CardContentProps = HTMLAttributes<HTMLDivElement>;

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn("px-6", className)}
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
      className={cn("flex items-center px-6", className)}
      data-slot="card-footer"
      ref={ref}
    />
  ),
);

CardFooter.displayName = "CardFooter";
