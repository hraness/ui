"use client";

import type { ReactNode, Ref } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
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
import { fieldStyles } from "./fields.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
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
  readonly optionsXstyle?: StyleXStyles;
  readonly xstyle?: StyleXStyles;
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
  optionsXstyle,
  style,
  xstyle,
  ...props
}: CheckboxGroupProps) {
  const optionsPresentation = stylex.props(fieldStyles.options, optionsXstyle);
  const labelPresentation = stylex.props(fieldStyles.label);
  return (
    <AriaCheckboxGroup
      {...props}
      className={(state) => {
        const presentation = stylex.props(
          fieldStyles.root,
          state.isDisabled && fieldStyles.disabled,
          xstyle,
        );
        return cn(
          "hraness-checkbox-group",
          presentation.className,
          className,
        );
      }}
      data-slot="checkbox-group"
      ref={groupRef}
      style={(state) => {
        const presentation = stylex.props(
          fieldStyles.root,
          state.isDisabled && fieldStyles.disabled,
          xstyle,
        );
        const callerStyle = typeof style === "function" ? style(state) : style;
        return mergeStylexInlineStyles(presentation.style, callerStyle);
      }}
    >
      <Label
        className={cn(
          "hraness-checkbox-group__label",
          labelPresentation.className,
        )}
        style={labelPresentation.style}
      >
        {label}
      </Label>
      <div
        {...optionsPresentation}
        className={cn(
          "hraness-checkbox-group__options",
          optionsPresentation.className,
          optionsClassName,
        )}
      >
        {children}
      </div>
      {description === undefined ? null : (
        <FieldDescription>{description}</FieldDescription>
      )}
      {errorMessage === undefined ? null : <FieldError>{errorMessage}</FieldError>}
    </AriaCheckboxGroup>
  );
}
