"use client";

import {
  type AriaAttributes,
  type ChangeEvent,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  useId,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Button as AriaButton,
  CheckboxButton as AriaCheckboxButton,
  type CheckboxButtonRenderProps,
  CheckboxField as AriaCheckboxField,
  CheckboxFieldContext,
  type CheckboxFieldProps as AriaCheckboxFieldProps,
  type CheckboxFieldRenderProps,
  FieldError as AriaFieldError,
  type FieldErrorProps as AriaFieldErrorProps,
  Group,
  Input as AriaInput,
  type InputProps as AriaInputProps,
  Label,
  NumberField as AriaNumberField,
  type NumberFieldProps as AriaNumberFieldProps,
  RadioButton as AriaRadioButton,
  RadioField as AriaRadioField,
  type RadioFieldProps as AriaRadioFieldProps,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  SearchField as AriaSearchField,
  type SearchFieldProps as AriaSearchFieldProps,
  SwitchButton as AriaSwitchButton,
  SwitchField as AriaSwitchField,
  type SwitchFieldProps as AriaSwitchFieldProps,
  Text,
  type TextProps as AriaTextProps,
  TextArea as AriaTextArea,
  type TextAreaProps as AriaTextAreaProps,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
  useSlottedContext,
} from "react-aria-components";

import { checkboxFieldStyles } from "./checkbox-field.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export type FieldSize = "compact" | "default" | "large";
export type FieldSurface = "card" | "default" | "pane";
export type FieldErrorMessage = ReactNode | ((validation: ValidationResult) => ReactNode);

export type FieldDescriptionProps = Omit<AriaTextProps, "className" | "slot"> &
  Readonly<{ className?: string }>;

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <Text
      {...props}
      className={cn("hraness-field__description", className)}
      data-slot="field-description"
      slot="description"
    />
  );
}

export type FieldErrorProps = Omit<AriaFieldErrorProps, "className"> &
  Readonly<{ className?: string }>;

export function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <AriaFieldError
      {...props}
      className={cn("hraness-field__error", className)}
      data-slot="field-error"
    />
  );
}

function FieldMessages({
  description,
  errorMessage,
}: Readonly<{
  description?: ReactNode;
  errorMessage?: FieldErrorMessage;
}>) {
  return (
    <>
      {description === undefined ? null : (
        <FieldDescription>{description}</FieldDescription>
      )}
      {errorMessage === undefined ? null : (
        <FieldError>{errorMessage}</FieldError>
      )}
    </>
  );
}

type SharedTextFieldProps = Omit<AriaTextFieldProps, "children" | "className"> &
  Readonly<{
    className?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    label: ReactNode;
    placeholder?: string;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
  }>;

export type TextFieldProps = SharedTextFieldProps &
  Readonly<{
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "placeholder">;
    inputRef?: Ref<HTMLInputElement>;
  }>;

/** A labelled single-line field with connected help and validation copy. */
export const TextField = forwardRef<HTMLDivElement, TextFieldProps>(
  (
    {
      className,
      description,
      errorMessage,
      inputClassName,
      inputProps,
      inputRef,
      isDisabled = false,
      label,
      placeholder,
      showLabel = true,
      size = "default",
      surface = "default",
      ...props
    },
    ref,
  ) => (
    <AriaTextField
      {...props}
      className={cn("hraness-field", "hraness-text-field", className)}
      data-size={size}
      data-slot="text-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={ref}
    >
      <Label
        className={cn(
          "hraness-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
      >
        {label}
      </Label>
      <div className="hraness-field__control" data-slot="field-control">
        <AriaInput
          {...inputProps}
          className={cn("hraness-field__input", inputClassName)}
          data-slot="field-input"
          {...(placeholder === undefined ? {} : { placeholder })}
          ref={inputRef}
        />
      </div>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaTextField>
  ),
);

TextField.displayName = "TextField";

export type TextAreaFieldProps = SharedTextFieldProps &
  Readonly<{
    fieldRef?: Ref<HTMLDivElement>;
    resize?: "none" | "vertical";
    textAreaClassName?: string;
    textAreaProps?: Omit<AriaTextAreaProps, "className" | "placeholder">;
    textAreaRef?: Ref<HTMLTextAreaElement>;
  }>;

/** A labelled multiline field with an explicit resize contract. */
export function TextAreaField({
  className,
  description,
  errorMessage,
  fieldRef,
  isDisabled = false,
  label,
  placeholder,
  resize = "none",
  showLabel = true,
  size = "default",
  surface = "default",
  textAreaClassName,
  textAreaProps,
  textAreaRef,
  ...props
}: TextAreaFieldProps) {
  return (
    <AriaTextField
      {...props}
      className={cn("hraness-field", "hraness-text-area-field", className)}
      data-resize={resize}
      data-size={size}
      data-slot="text-area-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
    >
      <Label
        className={cn(
          "hraness-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
      >
        {label}
      </Label>
      <div className="hraness-field__control" data-slot="field-control">
        <AriaTextArea
          {...textAreaProps}
          className={cn("hraness-field__input", textAreaClassName)}
          data-slot="field-textarea"
          {...(placeholder === undefined ? {} : { placeholder })}
          ref={textAreaRef}
        />
      </div>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaTextField>
  );
}

export type SearchFieldProps = Omit<
  AriaSearchFieldProps,
  "aria-label" | "children" | "className"
> &
  Readonly<{
    className?: string;
    clearLabel?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "placeholder" | "type">;
    inputRef?: Ref<HTMLInputElement>;
    label: ReactNode;
    placeholder?: string;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
  }>;

/** A search input with a React Aria-owned clear action. */
export function SearchField({
  className,
  clearLabel = "Clear search",
  description,
  errorMessage,
  fieldRef,
  inputClassName,
  inputProps,
  inputRef,
  isDisabled = false,
  label,
  placeholder = "Search…",
  showLabel = false,
  size = "default",
  surface = "default",
  ...props
}: SearchFieldProps) {
  return (
    <AriaSearchField
      {...props}
      className={cn("hraness-field", "hraness-search-field", className)}
      data-size={size}
      data-slot="search-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
    >
      {({ isEmpty }) => (
        <>
          <Label
            className={cn(
              "hraness-field__label",
              !showLabel && "hraness-visually-hidden",
              visuallyHiddenClassName(!showLabel),
            )}
            data-slot="field-label"
          >
            {label}
          </Label>
          <Group
            className="hraness-field__control hraness-search-field__control"
            data-slot="field-control"
          >
            <AriaInput
              {...inputProps}
              className={cn("hraness-field__input", inputClassName)}
              data-slot="field-input"
              placeholder={placeholder}
              ref={inputRef}
              type="search"
            />
            {isEmpty ? null : (
              <AriaButton
                aria-label={clearLabel}
                className="hraness-search-field__clear"
                data-slot="search-clear"
              >
                <span aria-hidden="true">×</span>
              </AriaButton>
            )}
          </Group>
          <FieldMessages description={description} errorMessage={errorMessage} />
        </>
      )}
    </AriaSearchField>
  );
}

export type NumberFieldProps = Omit<AriaNumberFieldProps, "children" | "className"> &
  Readonly<{
    className?: string;
    decrementLabel?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    incrementLabel?: string;
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "type">;
    inputRef?: Ref<HTMLInputElement>;
    label: ReactNode;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
  }>;

/** A locale-aware numeric field with named increment and decrement controls. */
export function NumberField({
  className,
  decrementLabel = "Decrease value",
  description,
  errorMessage,
  fieldRef,
  incrementLabel = "Increase value",
  inputClassName,
  inputProps,
  inputRef,
  isDisabled = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  ...props
}: NumberFieldProps) {
  return (
    <AriaNumberField
      {...props}
      className={cn("hraness-field", "hraness-number-field", className)}
      data-size={size}
      data-slot="number-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
    >
      <Label
        className={cn(
          "hraness-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
      >
        {label}
      </Label>
      <Group className="hraness-number-field__control" data-slot="field-control">
        <AriaButton
          aria-label={decrementLabel}
          className="hraness-number-field__step"
          data-slot="number-decrement"
          slot="decrement"
        >
          <span aria-hidden="true">−</span>
        </AriaButton>
        <AriaInput
          {...inputProps}
          className={cn("hraness-field__input", inputClassName)}
          data-slot="field-input"
          ref={inputRef}
        />
        <AriaButton
          aria-label={incrementLabel}
          className="hraness-number-field__step"
          data-slot="number-increment"
          slot="increment"
        >
          <span aria-hidden="true">+</span>
        </AriaButton>
      </Group>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaNumberField>
  );
}

export type CheckboxFieldProps = Omit<
  AriaCheckboxFieldProps,
  "children" | "className"
> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    /** Typed StyleX presentation applied to the semantic checkbox control. */
    controlXstyle?: StyleXStyles;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    label: ReactNode;
    showLabel?: boolean;
    /** Typed StyleX presentation applied to the field root. */
    xstyle?: StyleXStyles;
  }>;

function checkboxFieldPresentation(
  state: CheckboxFieldRenderProps,
  xstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    checkboxFieldStyles.root,
    state.isDisabled && checkboxFieldStyles.disabled,
    xstyle,
  );
}

function checkboxControlPresentation(
  state: CheckboxButtonRenderProps,
  controlXstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    checkboxFieldStyles.control,
    state.isFocusVisible && checkboxFieldStyles.focusVisible,
    controlXstyle,
  );
}

/** A validation-aware checkbox built on the React Aria 1.19 split field API. */
export function CheckboxField({
  className,
  controlClassName,
  controlXstyle,
  description,
  errorMessage,
  fieldRef,
  label,
  render,
  showLabel = true,
  style,
  xstyle,
  ...props
}: CheckboxFieldProps) {
  const inheritedRender = useSlottedContext(
    CheckboxFieldContext,
    props.slot,
  )?.render;
  const resolvedRender = render ?? inheritedRender;

  return (
    <AriaCheckboxField
      {...props}
      className=""
      data-slot="checkbox-field"
      ref={fieldRef}
      render={(domProps, state) => {
        const presentation = checkboxFieldPresentation(state, xstyle);
        const composedProps = {
          ...domProps,
          className: cn(
            domProps.className,
            "hraness-checkbox-field",
            presentation.className,
            className,
          ),
          style: mergeStylexInlineStyles(presentation.style, domProps.style),
        };

        return resolvedRender === undefined
          ? <div {...composedProps} />
          : resolvedRender(composedProps, state);
      }}
      {...(style === undefined ? {} : { style })}
    >
      <AriaCheckboxButton
        className={(state) => {
          const presentation = checkboxControlPresentation(state, controlXstyle);
          return cn(
            "hraness-checkbox-field__control",
            presentation.className,
            controlClassName,
          );
        }}
        data-slot="checkbox-control"
        style={(state) =>
          mergeStylexInlineStyles(
            checkboxControlPresentation(state, controlXstyle).style,
            undefined,
          )}
      >
        {({ isIndeterminate, isInvalid, isSelected }) => {
          const indicatorPresentation = stylex.props(
            checkboxFieldStyles.indicator,
            (isIndeterminate || isSelected)
              && checkboxFieldStyles.selectedIndicator,
            isInvalid && checkboxFieldStyles.invalidIndicator,
          );
          const labelPresentation = stylex.props(checkboxFieldStyles.label);

          return (
            <>
              <span
                aria-hidden="true"
                {...indicatorPresentation}
                className={cn(
                  "hraness-checkbox-field__indicator",
                  indicatorPresentation.className,
                )}
                data-slot="checkbox-indicator"
              >
                {isIndeterminate ? "−" : isSelected ? "✓" : null}
              </span>
              <span
                {...labelPresentation}
                className={cn(
                  "hraness-checkbox-field__label",
                  labelPresentation.className,
                  !showLabel && "hraness-visually-hidden",
                  visuallyHiddenClassName(!showLabel),
                )}
                data-slot="checkbox-label"
              >
                {label}
              </span>
            </>
          );
        }}
      </AriaCheckboxButton>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaCheckboxField>
  );
}

export type RadioGroupProps = Omit<AriaRadioGroupProps, "children" | "className"> &
  Readonly<{
    children: ReactNode;
    className?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    groupRef?: Ref<HTMLDivElement>;
    label: ReactNode;
    optionsClassName?: string;
  }>;

/** A labelled radio group whose options validate as one field. */
export function RadioGroup({
  children,
  className,
  description,
  errorMessage,
  groupRef,
  label,
  optionsClassName,
  ...props
}: RadioGroupProps) {
  return (
    <AriaRadioGroup
      {...props}
      className={cn("hraness-radio-group", className)}
      data-slot="radio-group"
      ref={groupRef}
    >
      <Label className="hraness-radio-group__label" data-slot="field-label">
        {label}
      </Label>
      <div
        className={cn("hraness-radio-group__options", optionsClassName)}
        data-slot="radio-options"
      >
        {children}
      </div>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaRadioGroup>
  );
}

export type RadioOptionProps = Omit<AriaRadioFieldProps, "children" | "className"> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    description?: ReactNode;
    fieldRef?: Ref<HTMLDivElement>;
    label: ReactNode;
  }>;

/** One option inside RadioGroup, using the non-deprecated split radio API. */
export function RadioOption({
  className,
  controlClassName,
  description,
  fieldRef,
  label,
  ...props
}: RadioOptionProps) {
  return (
    <AriaRadioField
      {...props}
      className={cn("hraness-radio-option", className)}
      data-slot="radio-option"
      ref={fieldRef}
    >
      <AriaRadioButton
        className={cn("hraness-radio-option__control", controlClassName)}
        data-slot="radio-control"
      >
        <span
          aria-hidden="true"
          className="hraness-radio-option__indicator"
          data-slot="radio-indicator"
        />
        <span className="hraness-radio-option__label" data-slot="radio-label">
          {label}
        </span>
      </AriaRadioButton>
      {description === undefined ? null : (
        <FieldDescription className="hraness-radio-option__description">
          {description}
        </FieldDescription>
      )}
    </AriaRadioField>
  );
}

export type SwitchFieldProps = Omit<AriaSwitchFieldProps, "children" | "className"> &
  Readonly<{
    className?: string;
    controlClassName?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    label: ReactNode;
  }>;

/** A validation-aware switch built on the React Aria 1.19 split field API. */
export function SwitchField({
  className,
  controlClassName,
  description,
  errorMessage,
  fieldRef,
  label,
  ...props
}: SwitchFieldProps) {
  return (
    <AriaSwitchField
      {...props}
      className={cn("hraness-switch-field", className)}
      data-slot="switch-field"
      ref={fieldRef}
    >
      <AriaSwitchButton
        className={cn("hraness-switch-field__control", controlClassName)}
        data-slot="switch-control"
      >
        <span
          aria-hidden="true"
          className="hraness-switch-field__track"
          data-slot="switch-track"
        >
          <span className="hraness-switch-field__thumb" data-slot="switch-thumb" />
        </span>
        <span className="hraness-switch-field__label" data-slot="switch-label">
          {label}
        </span>
      </AriaSwitchButton>
      <FieldMessages description={description} errorMessage={errorMessage} />
    </AriaSwitchField>
  );
}

export interface NativeSelectOption<Id extends string> {
  readonly disabled?: boolean;
  readonly id: Id;
  readonly label: string;
}

export type NativeSelectFieldProps<Id extends string> = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "defaultValue" | "onChange" | "size" | "value"
> &
  Readonly<{
    className?: string;
    defaultValue?: Id | "";
    description?: ReactNode;
    errorMessage?: ReactNode;
    isInvalid?: boolean;
    label: ReactNode;
    onChange?: (value: Id, event: ChangeEvent<HTMLSelectElement>) => void;
    options: readonly NativeSelectOption<Id>[];
    placeholder?: string;
    selectClassName?: string;
    selectRef?: Ref<HTMLSelectElement>;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    value?: Id | "";
  }>;

function reportsInvalid(value: AriaAttributes["aria-invalid"]): boolean {
  return value === true
    || value === "true"
    || value === "grammar"
    || value === "spelling";
}

/** A typed native select for the cases where platform selection UI is preferred. */
export function NativeSelectField<Id extends string>({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  defaultValue,
  description,
  disabled = false,
  errorMessage,
  id,
  isInvalid = false,
  label,
  onChange,
  options,
  placeholder,
  selectClassName,
  selectRef,
  showLabel = true,
  size = "default",
  surface = "default",
  value,
  ...props
}: NativeSelectFieldProps<Id>) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${controlId}-description`;
  const invalid = isInvalid || reportsInvalid(ariaInvalid);
  const showsError = invalid && errorMessage !== undefined;
  const errorId = showsError ? `${controlId}-error` : undefined;
  const describedBy = [ariaDescribedBy, descriptionId, errorId]
    .filter((candidate): candidate is string => (
      typeof candidate === "string" && candidate.length > 0
    ))
    .join(" ") || undefined;
  const resolvedAriaInvalid = reportsInvalid(ariaInvalid)
    ? ariaInvalid
    : invalid
      ? true
      : ariaInvalid;

  return (
    <div
      className={cn("hraness-field", "hraness-native-select-field", className)}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-size={size}
      data-slot="native-select-field"
      data-surface={surface}
    >
      <label
        className={cn(
          "hraness-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
        htmlFor={controlId}
      >
        {label}
      </label>
      <div className="hraness-field__control" data-slot="field-control">
        <select
          {...props}
          aria-describedby={describedBy}
          aria-invalid={resolvedAriaInvalid}
          className={cn("hraness-field__select", selectClassName)}
          data-slot="field-select"
          disabled={disabled}
          {...(defaultValue === undefined ? {} : { defaultValue })}
          id={controlId}
          onChange={(event) => {
            const next = options.find((option) => option.id === event.currentTarget.value);
            if (next !== undefined) onChange?.(next.id, event);
          }}
          ref={selectRef}
          {...(value === undefined ? {} : { value })}
        >
          {placeholder === undefined ? null : (
            <option disabled value="">{placeholder}</option>
          )}
          {options.map((option) => (
            <option disabled={option.disabled} key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {description === undefined ? null : (
        <span
          className="hraness-field__description"
          data-slot="field-description"
          id={descriptionId}
        >
          {description}
        </span>
      )}
      {!showsError ? null : (
        <span
          className="hraness-field__error"
          data-slot="field-error"
          id={errorId}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}

export type FileFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children" | "defaultValue" | "size" | "type" | "value"
> &
  Readonly<{
    className?: string;
    description?: ReactNode;
    errorMessage?: ReactNode;
    inputClassName?: string;
    inputRef?: Ref<HTMLInputElement>;
    isInvalid?: boolean;
    label: ReactNode;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
  }>;

/** A native file input with stable label and help relationships. */
export function FileField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  description,
  disabled = false,
  errorMessage,
  id,
  inputClassName,
  inputRef,
  isInvalid = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  ...props
}: FileFieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${controlId}-description`;
  const invalid = isInvalid || reportsInvalid(ariaInvalid);
  const showsError = invalid && errorMessage !== undefined;
  const errorId = showsError ? `${controlId}-error` : undefined;
  const describedBy = [ariaDescribedBy, descriptionId, errorId]
    .filter((candidate): candidate is string => (
      typeof candidate === "string" && candidate.length > 0
    ))
    .join(" ") || undefined;
  const resolvedAriaInvalid = reportsInvalid(ariaInvalid)
    ? ariaInvalid
    : invalid
      ? true
      : ariaInvalid;

  return (
    <div
      className={cn("hraness-field", "hraness-file-field", className)}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-size={size}
      data-slot="file-field"
      data-surface={surface}
    >
      <label
        className={cn(
          "hraness-field__label",
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
        htmlFor={controlId}
      >
        {label}
      </label>
      <div className="hraness-field__control" data-slot="field-control">
        <input
          {...props}
          aria-describedby={describedBy}
          aria-invalid={resolvedAriaInvalid}
          className={cn("hraness-field__file", inputClassName)}
          data-slot="field-file"
          disabled={disabled}
          id={controlId}
          ref={inputRef}
          type="file"
        />
      </div>
      {description === undefined ? null : (
        <span
          className="hraness-field__description"
          data-slot="field-description"
          id={descriptionId}
        >
          {description}
        </span>
      )}
      {!showsError ? null : (
        <span
          className="hraness-field__error"
          data-slot="field-error"
          id={errorId}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
