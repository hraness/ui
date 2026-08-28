"use client";

import { forwardRef } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Form as AriaForm,
  FormContext,
  type FormProps as AriaFormProps,
  useSlottedContext,
} from "react-aria-components";

import { formStyles } from "./form.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";

export type FormProps = Omit<AriaFormProps, "className"> & {
  readonly className?: string;
  /** Typed StyleX presentation applied after the Form base recipe. */
  readonly xstyle?: StyleXStyles;
};

/** A validation-aware semantic form that leaves submission to the caller. */
export const Form = forwardRef<HTMLFormElement, FormProps>(
  ({ className, render, style, xstyle, ...props }, ref) => {
    const inheritedRender = useSlottedContext(FormContext, props.slot)?.render;
    const resolvedRender = render ?? inheritedRender;

    return (
      <AriaForm
        {...props}
        className="hraness-form"
        data-slot="form"
        ref={ref}
        render={(domProps) => {
          const presentation = stylex.props(formStyles.root, xstyle);
          const composedProps = {
            ...domProps,
            className: cn(
              domProps.className,
              presentation.className,
              className,
            ),
            style: mergeStylexInlineStyles(
              presentation.style,
              domProps.style,
            ),
          };

          return resolvedRender === undefined
            ? <form {...composedProps} />
            : resolvedRender(composedProps, undefined);
        }}
        {...(style === undefined ? {} : { style })}
      />
    );
  },
);

Form.displayName = "Form";
