"use client";

import type { ReactNode, Ref } from "react";
import {
  CheckboxGroup as AriaCheckboxGroup,
  type CheckboxGroupProps as AriaCheckboxGroupProps,
  Label,
} from "react-aria-components";

import {
  FieldDescription,
  FieldError,
  type FieldErrorMessage,
} from "./fields.js";
import { cn } from "./lib/utils.js";

export type CheckboxGroupProps = Omit<
  AriaCheckboxGroupProps,
  "children" | "className"
> & {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly errorMessage?: FieldErrorMessage;
  readonly groupRef?: Ref<HTMLDivElement>;
  readonly label: ReactNode;
  readonly optionsClassName?: string;
};

/** A labelled multi-selection group composed from CheckboxField children. */
export function CheckboxGroup({
  children,
  className,
  description,
  errorMessage,
  groupRef,
  label,
  optionsClassName,
  ...props
}: CheckboxGroupProps) {
  return (
    <AriaCheckboxGroup
      {...props}
      className={cn("hraness-checkbox-group", className)}
      data-slot="checkbox-group"
      ref={groupRef}
    >
      <Label className="hraness-checkbox-group__label">{label}</Label>
      <div className={cn("hraness-checkbox-group__options", optionsClassName)}>
        {children}
      </div>
      {description === undefined ? null : (
        <FieldDescription>{description}</FieldDescription>
      )}
      {errorMessage === undefined ? null : <FieldError>{errorMessage}</FieldError>}
    </AriaCheckboxGroup>
  );
}
