"use client";

import type { ReactNode, Ref } from "react";
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
import { cn } from "./lib/utils.js";
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
  readonly value?: Id | null;
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
  value,
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
      className={cn("hraness-select-field", className)}
      data-size={size}
      data-slot="select-field"
      data-surface={surface}
      {...(defaultValue === undefined ? {} : { defaultSelectedKey: defaultValue })}
      onSelectionChange={(key) => onChange?.(ownedValue(key))}
      placeholder={placeholder}
      ref={selectRef}
      {...(value === undefined ? {} : { selectedKey: value })}
    >
      <Label
        className={cn(
          "hraness-select-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
      >
        {label}
      </Label>
      <AriaButton className="hraness-select-field__trigger">
        <SelectValue<SelectOption<Id>> className="hraness-select-field__value" />
        <svg
          aria-hidden="true"
          className="hraness-select-field__indicator"
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
        <FieldError className="hraness-select-field__error">{errorMessage}</FieldError>
      )}
      <Popover className="hraness-select-field__popover" placement="bottom start">
        <ListBox
          className="hraness-select-field__list-box"
          items={options}
        >
          {(option) => (
            <ListBoxItem
              className="hraness-select-field__option"
              id={option.id}
              {...(option.disabled === undefined
                ? {}
                : { isDisabled: option.disabled })}
              textValue={option.textValue}
            >
              <span className="hraness-select-field__option-copy">
                <Text className="hraness-select-field__option-label" slot="label">
                  {option.label}
                </Text>
                {option.description === undefined ? null : (
                  <Text
                    className="hraness-select-field__option-description"
                    slot="description"
                  >
                    {option.description}
                  </Text>
                )}
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
