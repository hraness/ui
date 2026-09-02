"use client";

import {
  type AriaAttributes,
  type ChangeEvent,
  type CSSProperties,
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
import {
  fieldControlSizeStyles,
  fieldInputSizeStyles,
  fieldStyles,
  fieldSurfaceStyles,
  numberControlSizeStyles,
  numberControlSurfaceStyles,
  searchClearSizeStyles,
} from "./fields.stylex.js";
import {
  hasStylexPresentation,
  mergeStylexInlineStyles,
} from "./lib/stylex.js";
import { cn } from "./lib/utils.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

export type FieldSize = "compact" | "default" | "large";
export type FieldSurface = "card" | "default" | "pane";
export type FieldErrorMessage = ReactNode | ((validation: ValidationResult) => ReactNode);

export type FieldDescriptionProps = Omit<AriaTextProps, "className" | "slot"> &
  Readonly<{ className?: string; xstyle?: StyleXStyles }>;

export function FieldDescription({
  className,
  style,
  xstyle,
  ...props
}: FieldDescriptionProps) {
  const presentation = stylex.props(fieldStyles.description, xstyle);
  return (
    <Text
      {...props}
      className={cn(
        "hraness-field__description",
        presentation.className,
        className,
      )}
      data-slot="field-description"
      slot="description"
      style={mergeStylexInlineStyles(presentation.style, style)}
    />
  );
}

export type FieldErrorProps = Omit<AriaFieldErrorProps, "className"> &
  Readonly<{ className?: string; xstyle?: StyleXStyles }>;

export function FieldError({
  className,
  style,
  xstyle,
  ...props
}: FieldErrorProps) {
  const presentation = stylex.props(fieldStyles.error, xstyle);
  return (
    <AriaFieldError
      {...props}
      className={cn(
        "hraness-field__error",
        presentation.className,
        className,
      )}
      data-slot="field-error"
      style={(state) => mergeStylexInlineStyles(
        presentation.style,
        resolveRenderStyle(style, state),
      )}
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
    controlXstyle?: StyleXStyles;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    label: ReactNode;
    placeholder?: string;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    xstyle?: StyleXStyles;
  }>;

export type TextFieldProps = SharedTextFieldProps &
  Readonly<{
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "placeholder">;
    inputRef?: Ref<HTMLInputElement>;
    inputXstyle?: StyleXStyles;
  }>;

function fieldRootPresentation(
  isDisabled: boolean,
  xstyle: StyleXStyles | undefined,
) {
  return stylex.props(
    fieldStyles.root,
    isDisabled && fieldStyles.disabled,
    xstyle,
  );
}

function fieldControlPresentation(
  state: Readonly<{ isInvalid: boolean }>,
  size: FieldSize,
  surface: FieldSurface,
  controlXstyle: StyleXStyles | undefined,
  ...recipes: StyleXStyles[]
) {
  return stylex.props(
    fieldStyles.control,
    fieldControlSizeStyles[size],
    fieldSurfaceStyles[surface],
    ...recipes,
    fieldStyles.controlFocusWithinFallback,
    state.isInvalid && fieldStyles.controlInvalid,
    controlXstyle,
  );
}

function fieldInputPresentation(
  size: FieldSize,
  inputXstyle: StyleXStyles | undefined,
  ...recipes: StyleXStyles[]
) {
  return stylex.props(
    fieldStyles.input,
    fieldInputSizeStyles[size],
    ...recipes,
    inputXstyle,
  );
}

function resolveRenderStyle<State>(
  style: CSSProperties | ((state: State) => CSSProperties | undefined) | undefined,
  state: State,
): CSSProperties | undefined {
  return typeof style === "function" ? style(state) : style;
}

/** A labelled single-line field with connected help and validation copy. */
export const TextField = forwardRef<HTMLDivElement, TextFieldProps>(
  (
    {
      className,
      controlXstyle,
      description,
      errorMessage,
      inputClassName,
      inputProps,
      inputRef,
      inputXstyle,
      isDisabled = false,
      label,
      placeholder,
      showLabel = true,
      size = "default",
      surface = "default",
      style,
      xstyle,
      ...props
    },
    ref,
  ) => (
    <AriaTextField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-field",
          "hraness-text-field",
          presentation.className,
          className,
        );
      }}
      data-size={size}
      data-slot="text-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={ref}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      {(state) => {
        const labelPresentation = stylex.props(fieldStyles.label);
        const controlPresentation = fieldControlPresentation(
          state,
          size,
          surface,
          controlXstyle,
        );
        const inputPresentation = fieldInputPresentation(size, inputXstyle);
        return (
          <>
            <Label
              className={cn(
                "hraness-field__label",
                labelPresentation.className,
                !showLabel && "hraness-visually-hidden",
                visuallyHiddenClassName(!showLabel),
              )}
              data-slot="field-label"
              style={labelPresentation.style}
            >
              {label}
            </Label>
            <div
              {...controlPresentation}
              className={cn(
                "hraness-field__control",
                controlPresentation.className,
              )}
              data-slot="field-control"
            >
              <AriaInput
                {...inputProps}
                className={() => cn(
                    "hraness-field__input",
                    inputPresentation.className,
                    inputClassName,
                  )}
                data-slot="field-input"
                {...(placeholder === undefined ? {} : { placeholder })}
                ref={inputRef}
                style={(inputState) => mergeStylexInlineStyles(
                    inputPresentation.style,
                    resolveRenderStyle(inputProps?.style, inputState),
                  )}
              />
            </div>
            <FieldMessages description={description} errorMessage={errorMessage} />
          </>
        );
      }}
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
    textAreaXstyle?: StyleXStyles;
  }>;

/** A labelled multiline field with an explicit resize contract. */
export function TextAreaField({
  className,
  controlXstyle,
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
  style,
  textAreaClassName,
  textAreaProps,
  textAreaRef,
  textAreaXstyle,
  xstyle,
  ...props
}: TextAreaFieldProps) {
  return (
    <AriaTextField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-field",
          "hraness-text-area-field",
          presentation.className,
          className,
        );
      }}
      data-resize={resize}
      data-size={size}
      data-slot="text-area-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      {(state) => {
        const labelPresentation = stylex.props(fieldStyles.label);
        const controlPresentation = fieldControlPresentation(
          state,
          size,
          surface,
          controlXstyle,
        );
        const textAreaPresentation = fieldInputPresentation(
          size,
          textAreaXstyle,
          fieldStyles.textArea,
          resize === "none"
            ? fieldStyles.textAreaResizeNone
            : fieldStyles.textAreaResizeVertical,
        );
        return (
          <>
            <Label
              className={cn(
                "hraness-field__label",
                labelPresentation.className,
                !showLabel && "hraness-visually-hidden",
                visuallyHiddenClassName(!showLabel),
              )}
              data-slot="field-label"
              style={labelPresentation.style}
            >
              {label}
            </Label>
            <div
              {...controlPresentation}
              className={cn(
                "hraness-field__control",
                controlPresentation.className,
              )}
              data-slot="field-control"
            >
              <AriaTextArea
                {...textAreaProps}
                className={() => cn(
                    "hraness-field__input",
                    textAreaPresentation.className,
                    textAreaClassName,
                  )}
                data-slot="field-textarea"
                {...(placeholder === undefined ? {} : { placeholder })}
                ref={textAreaRef}
                style={(textAreaState) => mergeStylexInlineStyles(
                    textAreaPresentation.style,
                    resolveRenderStyle(textAreaProps?.style, textAreaState),
                  )}
              />
            </div>
            <FieldMessages description={description} errorMessage={errorMessage} />
          </>
        );
      }}
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
    controlXstyle?: StyleXStyles;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "placeholder" | "type">;
    inputRef?: Ref<HTMLInputElement>;
    inputXstyle?: StyleXStyles;
    label: ReactNode;
    placeholder?: string;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    xstyle?: StyleXStyles;
  }>;

/** A search input with a React Aria-owned clear action. */
export function SearchField({
  className,
  clearLabel = "Clear search",
  controlXstyle,
  description,
  errorMessage,
  fieldRef,
  inputClassName,
  inputProps,
  inputRef,
  inputXstyle,
  isDisabled = false,
  label,
  placeholder = "Search…",
  showLabel = false,
  size = "default",
  surface = "default",
  style,
  xstyle,
  ...props
}: SearchFieldProps) {
  return (
    <AriaSearchField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-field",
          "hraness-search-field",
          presentation.className,
          className,
        );
      }}
      data-size={size}
      data-slot="search-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      {(state) => {
        const labelPresentation = stylex.props(fieldStyles.label);
        const controlPresentation = fieldControlPresentation(
          state,
          size,
          surface,
          controlXstyle,
          fieldStyles.searchControl,
        );
        const inputPresentation = fieldInputPresentation(
          size,
          inputXstyle,
          fieldStyles.searchInput,
        );
        return (
          <>
          <Label
            className={cn(
              "hraness-field__label",
              labelPresentation.className,
              !showLabel && "hraness-visually-hidden",
              visuallyHiddenClassName(!showLabel),
            )}
            data-slot="field-label"
            style={labelPresentation.style}
          >
            {label}
          </Label>
          <Group
            {...controlPresentation}
            className={cn(
              "hraness-field__control",
              "hraness-search-field__control",
              controlPresentation.className,
            )}
            data-slot="field-control"
          >
            <AriaInput
              {...inputProps}
              className={() => cn(
                  "hraness-field__input",
                  inputPresentation.className,
                  inputClassName,
                )}
              data-slot="field-input"
              placeholder={placeholder}
              ref={inputRef}
              style={(inputState) => mergeStylexInlineStyles(
                  inputPresentation.style,
                  resolveRenderStyle(inputProps?.style, inputState),
                )}
              type="search"
            />
            {state.isEmpty ? null : (
              <AriaButton
                aria-label={clearLabel}
                className={(buttonState) => {
                  const presentation = stylex.props(
                    fieldStyles.searchClear,
                    searchClearSizeStyles[size],
                    fieldStyles.searchClearNativeInteractions,
                    buttonState.isHovered && fieldStyles.searchClearHovered,
                    buttonState.isFocusVisible
                      && fieldStyles.searchClearFocusVisible,
                  );
                  return cn(
                    "hraness-search-field__clear",
                    presentation.className,
                  );
                }}
                data-slot="search-clear"
                style={(buttonState) => stylex.props(
                  fieldStyles.searchClear,
                  searchClearSizeStyles[size],
                  fieldStyles.searchClearNativeInteractions,
                  buttonState.isHovered && fieldStyles.searchClearHovered,
                  buttonState.isFocusVisible
                    && fieldStyles.searchClearFocusVisible,
                ).style}
              >
                <span aria-hidden="true">×</span>
              </AriaButton>
            )}
          </Group>
          <FieldMessages description={description} errorMessage={errorMessage} />
          </>
        );
      }}
    </AriaSearchField>
  );
}

export type NumberFieldProps = Omit<AriaNumberFieldProps, "children" | "className"> &
  Readonly<{
    className?: string;
    controlXstyle?: StyleXStyles;
    decrementLabel?: string;
    description?: ReactNode;
    errorMessage?: FieldErrorMessage;
    fieldRef?: Ref<HTMLDivElement>;
    incrementLabel?: string;
    inputClassName?: string;
    inputProps?: Omit<AriaInputProps, "className" | "type">;
    inputRef?: Ref<HTMLInputElement>;
    inputXstyle?: StyleXStyles;
    label: ReactNode;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    xstyle?: StyleXStyles;
  }>;

/** A locale-aware numeric field with named increment and decrement controls. */
export function NumberField({
  className,
  controlXstyle,
  decrementLabel = "Decrease value",
  description,
  errorMessage,
  fieldRef,
  incrementLabel = "Increase value",
  inputClassName,
  inputProps,
  inputRef,
  inputXstyle,
  isDisabled = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  style,
  xstyle,
  ...props
}: NumberFieldProps) {
  return (
    <AriaNumberField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-field",
          "hraness-number-field",
          presentation.className,
          className,
        );
      }}
      data-size={size}
      data-slot="number-field"
      data-surface={surface}
      isDisabled={isDisabled}
      ref={fieldRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      {(state) => {
        const labelPresentation = stylex.props(fieldStyles.label);
        const controlPresentation = stylex.props(
          fieldStyles.numberControl,
          numberControlSizeStyles[size],
          numberControlSurfaceStyles[surface],
          fieldStyles.controlFocusWithinFallback,
          state.isInvalid && fieldStyles.controlInvalid,
          controlXstyle,
        );
        const inputPresentation = fieldInputPresentation(size, inputXstyle);
        const stepPresentation = (buttonState: Readonly<{
          isFocusVisible: boolean;
          isHovered: boolean;
        }>) => stylex.props(
          fieldStyles.numberStep,
          fieldStyles.numberStepNativeInteractions,
          buttonState.isHovered && fieldStyles.numberStepHovered,
          buttonState.isFocusVisible && fieldStyles.numberStepFocusVisible,
        );
        return (
          <>
            <Label
              className={cn(
                "hraness-field__label",
                labelPresentation.className,
                !showLabel && "hraness-visually-hidden",
                visuallyHiddenClassName(!showLabel),
              )}
              data-slot="field-label"
              style={labelPresentation.style}
            >
              {label}
            </Label>
            <Group
              {...controlPresentation}
              className={cn(
                "hraness-number-field__control",
                controlPresentation.className,
              )}
              data-slot="field-control"
            >
              <AriaButton
                aria-label={decrementLabel}
                className={(buttonState) => cn(
                  "hraness-number-field__step",
                  stepPresentation(buttonState).className,
                )}
                data-slot="number-decrement"
                slot="decrement"
                style={(buttonState) => stepPresentation(buttonState).style}
              >
                <span aria-hidden="true">−</span>
              </AriaButton>
              <AriaInput
                {...inputProps}
                className={() => cn(
                    "hraness-field__input",
                    inputPresentation.className,
                    inputClassName,
                  )}
                data-slot="field-input"
                ref={inputRef}
                style={(inputState) => mergeStylexInlineStyles(
                    inputPresentation.style,
                    resolveRenderStyle(inputProps?.style, inputState),
                  )}
              />
              <AriaButton
                aria-label={incrementLabel}
                className={(buttonState) => cn(
                  "hraness-number-field__step",
                  stepPresentation(buttonState).className,
                )}
                data-slot="number-increment"
                slot="increment"
                style={(buttonState) => stepPresentation(buttonState).style}
              >
                <span aria-hidden="true">+</span>
              </AriaButton>
            </Group>
            <FieldMessages description={description} errorMessage={errorMessage} />
          </>
        );
      }}
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
    optionsXstyle?: StyleXStyles;
    xstyle?: StyleXStyles;
  }>;

/** A labelled radio group whose options validate as one field. */
export function RadioGroup({
  children,
  className,
  description,
  errorMessage,
  groupRef,
  label,
  orientation = "vertical",
  optionsClassName,
  optionsXstyle,
  style,
  xstyle,
  ...props
}: RadioGroupProps) {
  const labelPresentation = stylex.props(fieldStyles.label);
  const optionsPresentation = stylex.props(
    fieldStyles.options,
    orientation === "horizontal" && fieldStyles.optionsHorizontal,
    optionsXstyle,
  );
  return (
    <AriaRadioGroup
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-radio-group",
          presentation.className,
          className,
        );
      }}
      data-slot="radio-group"
      orientation={orientation}
      ref={groupRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      <Label
        className={cn(
          "hraness-radio-group__label",
          labelPresentation.className,
        )}
        data-slot="field-label"
        style={labelPresentation.style}
      >
        {label}
      </Label>
      <div
        {...optionsPresentation}
        className={cn(
          "hraness-radio-group__options",
          optionsPresentation.className,
          optionsClassName,
        )}
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
    controlXstyle?: StyleXStyles;
    xstyle?: StyleXStyles;
  }>;

/** One option inside RadioGroup, using the non-deprecated split radio API. */
export function RadioOption({
  className,
  controlClassName,
  controlXstyle,
  description,
  fieldRef,
  label,
  style,
  xstyle,
  ...props
}: RadioOptionProps) {
  return (
    <AriaRadioField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-radio-option",
          presentation.className,
          className,
        );
      }}
      data-slot="radio-option"
      ref={fieldRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      <AriaRadioButton
        className={(state) => {
          const presentation = stylex.props(
            fieldStyles.radioSwitchControl,
            !hasStylexPresentation(controlXstyle)
              && fieldStyles.radioSwitchNativeFocus,
            state.isFocusVisible && fieldStyles.radioSwitchFocusVisible,
            controlXstyle,
          );
          return cn(
            "hraness-radio-option__control",
            presentation.className,
            controlClassName,
          );
        }}
        data-slot="radio-control"
        style={(state) => stylex.props(
          fieldStyles.radioSwitchControl,
          !hasStylexPresentation(controlXstyle)
            && fieldStyles.radioSwitchNativeFocus,
          state.isFocusVisible && fieldStyles.radioSwitchFocusVisible,
          controlXstyle,
        ).style}
      >
        {(state) => {
          const indicatorPresentation = stylex.props(
            fieldStyles.radioIndicator,
            state.isSelected && fieldStyles.radioIndicatorSelected,
            state.isInvalid && fieldStyles.radioIndicatorInvalid,
          );
          const dotPresentation = stylex.props(fieldStyles.radioDot);
          const labelPresentation = stylex.props(fieldStyles.label);
          return (
            <>
              <span
                aria-hidden="true"
                {...indicatorPresentation}
                className={cn(
                  "hraness-radio-option__indicator",
                  indicatorPresentation.className,
                )}
                data-slot="radio-indicator"
              >
                {state.isSelected ? (
                  <span
                    {...dotPresentation}
                    className={dotPresentation.className}
                    data-slot="radio-indicator-dot"
                  />
                ) : null}
              </span>
              <span
                {...labelPresentation}
                className={cn(
                  "hraness-radio-option__label",
                  labelPresentation.className,
                )}
                data-slot="radio-label"
              >
                {label}
              </span>
            </>
          );
        }}
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
    controlXstyle?: StyleXStyles;
    xstyle?: StyleXStyles;
  }>;

/** A validation-aware switch built on the React Aria 1.19 split field API. */
export function SwitchField({
  className,
  controlClassName,
  controlXstyle,
  description,
  errorMessage,
  fieldRef,
  label,
  style,
  xstyle,
  ...props
}: SwitchFieldProps) {
  return (
    <AriaSwitchField
      {...props}
      className={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return cn(
          "hraness-switch-field",
          presentation.className,
          className,
        );
      }}
      data-slot="switch-field"
      ref={fieldRef}
      style={(state) => {
        const presentation = fieldRootPresentation(state.isDisabled, xstyle);
        return mergeStylexInlineStyles(
          presentation.style,
          resolveRenderStyle(style, state),
        );
      }}
    >
      <AriaSwitchButton
        className={(state) => {
          const presentation = stylex.props(
            fieldStyles.radioSwitchControl,
            !hasStylexPresentation(controlXstyle)
              && fieldStyles.radioSwitchNativeFocus,
            state.isFocusVisible && fieldStyles.radioSwitchFocusVisible,
            controlXstyle,
          );
          return cn(
            "hraness-switch-field__control",
            presentation.className,
            controlClassName,
          );
        }}
        data-slot="switch-control"
        style={(state) => stylex.props(
          fieldStyles.radioSwitchControl,
          !hasStylexPresentation(controlXstyle)
            && fieldStyles.radioSwitchNativeFocus,
          state.isFocusVisible && fieldStyles.radioSwitchFocusVisible,
          controlXstyle,
        ).style}
      >
        {(state) => {
          const trackPresentation = stylex.props(
            fieldStyles.switchTrack,
            state.isSelected && fieldStyles.switchTrackSelected,
            state.isInvalid && fieldStyles.switchTrackInvalid,
          );
          const thumbPresentation = stylex.props(
            fieldStyles.switchThumb,
            state.isSelected && fieldStyles.switchThumbSelected,
          );
          const labelPresentation = stylex.props(fieldStyles.label);
          return (
            <>
              <span
                aria-hidden="true"
                {...trackPresentation}
                className={cn(
                  "hraness-switch-field__track",
                  trackPresentation.className,
                )}
                data-slot="switch-track"
              >
                <span
                  {...thumbPresentation}
                  className={cn(
                    "hraness-switch-field__thumb",
                    thumbPresentation.className,
                  )}
                  data-slot="switch-thumb"
                />
              </span>
              <span
                {...labelPresentation}
                className={cn(
                  "hraness-switch-field__label",
                  labelPresentation.className,
                )}
                data-slot="switch-label"
              >
                {label}
              </span>
            </>
          );
        }}
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
    controlXstyle?: StyleXStyles;
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
    selectXstyle?: StyleXStyles;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    value?: Id | "";
    xstyle?: StyleXStyles;
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
  controlXstyle,
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
  selectXstyle,
  showLabel = true,
  size = "default",
  surface = "default",
  style,
  value,
  xstyle,
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
  const rootPresentation = fieldRootPresentation(disabled, xstyle);
  const labelPresentation = stylex.props(fieldStyles.label);
  const controlPresentation = fieldControlPresentation(
    { isInvalid: invalid },
    size,
    surface,
    controlXstyle,
  );
  const selectPresentation = fieldInputPresentation(
    size,
    selectXstyle,
    fieldStyles.nativeSelect,
  );
  const descriptionPresentation = stylex.props(fieldStyles.description);
  const errorPresentation = stylex.props(fieldStyles.error);

  return (
    <div
      {...rootPresentation}
      className={cn(
        "hraness-field",
        "hraness-native-select-field",
        rootPresentation.className,
        className,
      )}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-size={size}
      data-slot="native-select-field"
      data-surface={surface}
    >
      <label
        className={cn(
          "hraness-field__label",
          labelPresentation.className,
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
        htmlFor={controlId}
        style={labelPresentation.style}
      >
        {label}
      </label>
      <div
        {...controlPresentation}
        className={cn(
          "hraness-field__control",
          controlPresentation.className,
        )}
        data-slot="field-control"
      >
        <select
          {...props}
          aria-describedby={describedBy}
          aria-invalid={resolvedAriaInvalid}
          className={cn(
            "hraness-field__select",
            selectPresentation.className,
            selectClassName,
          )}
          data-slot="field-select"
          disabled={disabled}
          {...(defaultValue === undefined ? {} : { defaultValue })}
          id={controlId}
          onChange={(event) => {
            const next = options.find((option) => option.id === event.currentTarget.value);
            if (next !== undefined) onChange?.(next.id, event);
          }}
          ref={selectRef}
          style={mergeStylexInlineStyles(selectPresentation.style, style)}
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
          className={cn(
            "hraness-field__description",
            descriptionPresentation.className,
          )}
          data-slot="field-description"
          id={descriptionId}
          style={descriptionPresentation.style}
        >
          {description}
        </span>
      )}
      {!showsError ? null : (
        <span
          className={cn(
            "hraness-field__error",
            errorPresentation.className,
          )}
          data-slot="field-error"
          id={errorId}
          style={errorPresentation.style}
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
    controlXstyle?: StyleXStyles;
    description?: ReactNode;
    errorMessage?: ReactNode;
    inputClassName?: string;
    inputRef?: Ref<HTMLInputElement>;
    inputXstyle?: StyleXStyles;
    isInvalid?: boolean;
    label: ReactNode;
    showLabel?: boolean;
    size?: FieldSize;
    surface?: FieldSurface;
    xstyle?: StyleXStyles;
  }>;

/** A native file input with stable label and help relationships. */
export function FileField({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  className,
  controlXstyle,
  description,
  disabled = false,
  errorMessage,
  id,
  inputClassName,
  inputRef,
  inputXstyle,
  isInvalid = false,
  label,
  showLabel = true,
  size = "default",
  surface = "default",
  style,
  xstyle,
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
  const rootPresentation = fieldRootPresentation(disabled, xstyle);
  const labelPresentation = stylex.props(fieldStyles.label);
  const controlPresentation = fieldControlPresentation(
    { isInvalid: invalid },
    size,
    surface,
    controlXstyle,
  );
  const inputPresentation = fieldInputPresentation(
    size,
    inputXstyle,
    fieldStyles.fileInput,
  );
  const descriptionPresentation = stylex.props(fieldStyles.description);
  const errorPresentation = stylex.props(fieldStyles.error);

  return (
    <div
      {...rootPresentation}
      className={cn(
        "hraness-field",
        "hraness-file-field",
        rootPresentation.className,
        className,
      )}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-size={size}
      data-slot="file-field"
      data-surface={surface}
    >
      <label
        className={cn(
          "hraness-field__label",
          labelPresentation.className,
          !showLabel && "hraness-visually-hidden",
          visuallyHiddenClassName(!showLabel),
        )}
        data-slot="field-label"
        htmlFor={controlId}
        style={labelPresentation.style}
      >
        {label}
      </label>
      <div
        {...controlPresentation}
        className={cn(
          "hraness-field__control",
          controlPresentation.className,
        )}
        data-slot="field-control"
      >
        <input
          {...props}
          aria-describedby={describedBy}
          aria-invalid={resolvedAriaInvalid}
          className={cn(
            "hraness-field__file",
            inputPresentation.className,
            inputClassName,
          )}
          data-slot="field-file"
          disabled={disabled}
          id={controlId}
          ref={inputRef}
          style={mergeStylexInlineStyles(inputPresentation.style, style)}
          type="file"
        />
      </div>
      {description === undefined ? null : (
        <span
          className={cn(
            "hraness-field__description",
            descriptionPresentation.className,
          )}
          data-slot="field-description"
          id={descriptionId}
          style={descriptionPresentation.style}
        >
          {description}
        </span>
      )}
      {!showsError ? null : (
        <span
          className={cn(
            "hraness-field__error",
            errorPresentation.className,
          )}
          data-slot="field-error"
          id={errorId}
          style={errorPresentation.style}
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
