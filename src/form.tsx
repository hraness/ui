"use client";

import { forwardRef } from "react";
import {
  Form as AriaForm,
  type FormProps as AriaFormProps,
} from "react-aria-components";

import { cn } from "./lib/utils.js";

export type FormProps = Omit<AriaFormProps, "className"> & {
  readonly className?: string;
};

/** A validation-aware semantic form with no submission side effects. */
export const Form = forwardRef<HTMLFormElement, FormProps>(
  ({ className, ...props }, ref) => (
    <AriaForm
      {...props}
      className={cn("hraness-form", className)}
      data-slot="form"
      ref={ref}
    />
  ),
);

Form.displayName = "Form";
