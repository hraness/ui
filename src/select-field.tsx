"use client";

import type { ReactNode, Ref } from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  type SelectProps as AriaSelectProps,
  SelectValue,
  Text,
  type Key,
} from "react-aria-components";

import {
  FieldDescription,
  FieldError,
  type FieldErrorMessage,
  type FieldSize,
  type FieldSurface,
} from "./fields.js";
import { fieldStyles } from "./fields.stylex.js";
import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import {
  selectFieldStyles,
  selectTriggerSizeStyles,
  selectTriggerSurfaceStyles,
} from "./select-field.stylex.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export interface SelectOption<Id extends string> {
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly id: Id;
  readonly label: ReactNode;
  /** Required when label is not a plain string. */
  readonly textValue: string;
}

export type SelectFieldProps<Id extends string> = Omit<
  AriaSelectProps<SelectOption<Id>>,
  "children" | "className" | "defaultSelectedKey" | "onSelectionChange" | "selectedKey"
> & {
  readonly className?: string;
  readonly defaultValue?: Id;
  readonly description?: ReactNode;
  readonly errorMessage?: FieldErrorMessage;
  readonly label: ReactNode;
  readonly onChange?: (value: Id | null) => void;
  readonly options: readonly [SelectOption<Id>, ...SelectOption<Id>[]];
  readonly placeholder?: string;
  readonly selectRef?: Ref<HTMLDivElement>;
  readonly showLabel?: boolean;
  readonly size?: FieldSize;
  readonly surface?: FieldSurface;
  readonly triggerXstyle?: StyleXStyles;
  readonly value?: Id | null;
  readonly xstyle?: StyleXStyles;
};

/** A fully styled React Aria select with typeahead and a hidden native form control. */
export function SelectField<Id extends string>({
  className,
  defaultValue,
  description,
  errorMessage,
  label,
  onChange,
  options,
  placeholder = "Select an option",
  selectRef,
  showLabel = true,
  size = "default",
  surface = "default",
  style,
  triggerXstyle,
  value,
  xstyle,
  ...props
}: SelectFieldProps<Id>) {
  const ownedValue = (key: Key | null): Id | null => {
    if (key === null) return null;
    const candidate = String(key);
    return options.find((option) => option.id === candidate)?.id ?? null;
  };

  return (
    <AriaSelect
      {...props}
      className={(state) => {
        const presentation = stylex.props(
          fieldStyles.root,
          state.isDisabled && fieldStyles.disabled,
          xstyle,
        );
        return cn(
          "hraness-select-field",
          presentation.className,
          className,
        );
      }}
      data-size={size}
      data-slot="select-field"
      data-surface={surface}
      {...(defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue })}
      onSelectionChange={(key) => onChange?.(ownedValue(key))}
      placeholder={placeholder}
      ref={selectRef}
      style={(state) => {
        const presentation = stylex.props(
          fieldStyles.root,
          state.isDisabled && fieldStyles.disabled,
          xstyle,
        );
        const callerStyle = typeof style === "function" ? style(state) : style;
        return mergeStylexInlineStyles(presentation.style, callerStyle);
      }}
      {...(value === undefined ? {} : { selectedKey: value })}
    >
      {(selectState) => {
        const labelPresentation = stylex.props(fieldStyles.label);
        const indicatorPresentation = stylex.props(
          selectFieldStyles.indicator,
          selectState.isOpen && selectFieldStyles.indicatorOpen,
        );
        const listBoxPresentation = stylex.props(selectFieldStyles.listBox);
        return (
          <>
            <Label
              className={cn(
                "hraness-select-field__label",
                labelPresentation.className,
                !showLabel && "hraness-visually-hidden",
                visuallyHiddenClassName(!showLabel),
              )}
              style={labelPresentation.style}
            >
              {label}
            </Label>
            <AriaButton
              className={(buttonState) => {
                const presentation = stylex.props(
                  selectFieldStyles.trigger,
                  selectTriggerSizeStyles[size],
                  selectTriggerSurfaceStyles[surface],
                  !hasStylexPresentation(triggerXstyle)
                    && selectFieldStyles.triggerNativeInteractions,
                  buttonState.isHovered && selectFieldStyles.triggerHovered,
                  buttonState.isFocusVisible
                    && selectFieldStyles.triggerFocusVisible,
                  selectState.isInvalid && selectFieldStyles.triggerInvalid,
                  triggerXstyle,
                );
                return cn(
                  "hraness-select-field__trigger",
                  presentation.className,
                );
              }}
              render={(buttonProps) => (
                <button
                  {...buttonProps}
                  aria-invalid={selectState.isInvalid || undefined}
                />
              )}
              style={(buttonState) => stylex.props(
                selectFieldStyles.trigger,
                selectTriggerSizeStyles[size],
                selectTriggerSurfaceStyles[surface],
                !hasStylexPresentation(triggerXstyle)
                  && selectFieldStyles.triggerNativeInteractions,
                buttonState.isHovered && selectFieldStyles.triggerHovered,
                buttonState.isFocusVisible
                  && selectFieldStyles.triggerFocusVisible,
                selectState.isInvalid && selectFieldStyles.triggerInvalid,
                triggerXstyle,
              ).style}
            >
              <SelectValue<SelectOption<Id>>
                className={(valueState) => {
                  const presentation = stylex.props(
                    selectFieldStyles.value,
                    valueState.isPlaceholder && selectFieldStyles.placeholder,
                  );
                  return cn(
                    "hraness-select-field__value",
                    presentation.className,
                  );
                }}
                style={(valueState) => stylex.props(
                  selectFieldStyles.value,
                  valueState.isPlaceholder && selectFieldStyles.placeholder,
                ).style}
              />
              <svg
                aria-hidden="true"
                {...indicatorPresentation}
                className={cn(
                  "hraness-select-field__indicator",
                  indicatorPresentation.className,
                )}
                data-slot="select-field-indicator"
                fill="none"
                focusable="false"
                viewBox="0 0 12 12"
              >
                <path
                  d="M2.25 4.25 6 7.75 9.75 4.25"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.25"
                />
              </svg>
            </AriaButton>
            {description === undefined ? null : (
              <FieldDescription className="hraness-select-field__description">
                {description}
              </FieldDescription>
            )}
            {errorMessage === undefined ? null : (
              <FieldError className="hraness-select-field__error">
                {errorMessage}
              </FieldError>
            )}
            <Popover
              className={(popoverState) => {
                const presentation = stylex.props(
                  selectFieldStyles.popover,
                  popoverState.isEntering && selectFieldStyles.popoverEntering,
                  popoverState.isExiting && selectFieldStyles.popoverExiting,
                );
                return cn(
                  "hraness-select-field__popover",
                  presentation.className,
                );
              }}
              placement="bottom start"
              style={(popoverState) => stylex.props(
                selectFieldStyles.popover,
                popoverState.isEntering && selectFieldStyles.popoverEntering,
                popoverState.isExiting && selectFieldStyles.popoverExiting,
              ).style}
            >
              <ListBox
                {...listBoxPresentation}
                className={cn(
                  "hraness-select-field__list-box",
                  listBoxPresentation.className,
                )}
                items={options}
              >
                {(option) => (
                  <ListBoxItem
                    className={(optionState) => {
                      const presentation = stylex.props(
                        selectFieldStyles.option,
                        !optionState.isDisabled
                          && selectFieldStyles.optionNativeInteraction,
                        !optionState.isDisabled
                          && (optionState.isFocused || optionState.isHovered)
                          && selectFieldStyles.optionFocused,
                        optionState.isDisabled && selectFieldStyles.optionDisabled,
                      );
                      return cn(
                        "hraness-select-field__option",
                        presentation.className,
                      );
                    }}
                    id={option.id}
                    {...(option.disabled === undefined
                      ? {}
                      : { isDisabled: option.disabled })}
                    style={(optionState) => stylex.props(
                      selectFieldStyles.option,
                      !optionState.isDisabled
                        && selectFieldStyles.optionNativeInteraction,
                      !optionState.isDisabled
                        && (optionState.isFocused || optionState.isHovered)
                        && selectFieldStyles.optionFocused,
                      optionState.isDisabled && selectFieldStyles.optionDisabled,
                    ).style}
                    textValue={option.textValue}
                  >
                    {(optionState) => {
                      const copyPresentation = stylex.props(
                        selectFieldStyles.optionCopy,
                      );
                      const labelPresentation = stylex.props(
                        selectFieldStyles.optionLabel,
                      );
                      const descriptionPresentation = stylex.props(
                        selectFieldStyles.optionDescription,
                      );
                      const checkPresentation = stylex.props(
                        selectFieldStyles.optionCheck,
                      );
                      return (
                        <>
                          <span
                            {...copyPresentation}
                            className={cn(
                              "hraness-select-field__option-copy",
                              copyPresentation.className,
                            )}
                          >
                            <Text
                              {...labelPresentation}
                              className={cn(
                                "hraness-select-field__option-label",
                                labelPresentation.className,
                              )}
                              slot="label"
                            >
                              {option.label}
                            </Text>
                            {option.description === undefined ? null : (
                              <Text
                                {...descriptionPresentation}
                                className={cn(
                                  "hraness-select-field__option-description",
                                  descriptionPresentation.className,
                                )}
                                slot="description"
                              >
                                {option.description}
                              </Text>
                            )}
                          </span>
                          {optionState.isSelected ? (
                            <span
                              aria-hidden="true"
                              {...checkPresentation}
                              className={cn(
                                "hraness-select-field__option-check",
                                checkPresentation.className,
                              )}
                              data-slot="select-option-check"
                            >
                              ✓
                            </span>
                          ) : null}
                        </>
                      );
                    }}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </>
        );
      }}
    </AriaSelect>
  );
}
