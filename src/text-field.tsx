"use client";

import {
  forwardRef,
  type ReactNode,
  type Ref,
} from "react";
import {
  FieldError,
  Input,
  type InputProps,
  Label,
  Text,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

export type TextFieldProps = Omit<
  AriaTextFieldProps,
  "children" | "className"
> & {
  readonly className?: string;
  readonly description?: ReactNode;
  readonly errorMessage?: ReactNode;
  readonly inputClassName?: string;
  readonly inputProps?: Omit<InputProps, "className">;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly isLabelHidden?: boolean;
  readonly label: ReactNode;
};

/** A labelled text input with connected help and validation messages. */
export const TextField = forwardRef<HTMLDivElement, TextFieldProps>(
  (
    {
      className,
      description,
      errorMessage,
      inputClassName,
      inputProps,
      inputRef,
      isLabelHidden = false,
      label,
      ...props
    },
    ref,
  ) => (
    <AriaTextField
      {...props}
      className={cn("group grid gap-2", className)}
      ref={ref}
    >
      <Label
        className={cn(
          "text-sm font-medium leading-none group-data-[disabled]:opacity-50",
          isLabelHidden && "sr-only",
        )}
      >
        {label}
      </Label>
      <Input
        {...inputProps}
        className={cn(
          "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground data-[focus-visible]:border-ring data-[focus-visible]:ring-[3px] data-[focus-visible]:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
          inputClassName,
        )}
        ref={inputRef}
      />
      {description === undefined ? null : (
        <Text className="text-sm text-muted-foreground" slot="description">
          {description}
        </Text>
      )}
      {errorMessage === undefined ? null : (
        <FieldError className="text-sm text-destructive">
          {errorMessage}
        </FieldError>
      )}
    </AriaTextField>
  ),
);

TextField.displayName = "TextField";
