import {
  Badge as BadgeComponent,
  badgeVariants as badgeVariantRecipe,
} from "./badge.js";
import {
  Button as ButtonComponent,
  buttonVariants as buttonVariantRecipe,
} from "./button.js";
import {
  Card as CardComponent,
  CardContent as CardContentComponent,
  CardDescription as CardDescriptionComponent,
  CardFooter as CardFooterComponent,
  CardHeader as CardHeaderComponent,
  CardTitle as CardTitleComponent,
} from "./card.js";
import { cn as mergeClassNames } from "./lib/utils.js";
import { TextField as TextFieldComponent } from "./text-field.js";

export const Badge = BadgeComponent;
export const badgeVariants = badgeVariantRecipe;
export const Button = ButtonComponent;
export const buttonVariants = buttonVariantRecipe;
export const Card = CardComponent;
export const CardContent = CardContentComponent;
export const CardDescription = CardDescriptionComponent;
export const CardFooter = CardFooterComponent;
export const CardHeader = CardHeaderComponent;
export const CardTitle = CardTitleComponent;
export const cn = mergeClassNames;
export const TextField = TextFieldComponent;

export type { BadgeProps } from "./badge.js";
export type { ButtonProps } from "./button.js";
export type {
  CardContentProps,
  CardDescriptionProps,
  CardFooterProps,
  CardHeaderProps,
  CardProps,
  CardTitleProps,
} from "./card.js";
export type { TextFieldProps } from "./text-field.js";
