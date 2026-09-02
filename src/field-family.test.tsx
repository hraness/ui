import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FileField,
  NativeSelectField,
  NumberField,
  RadioGroup,
  RadioOption,
  SearchField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
  type TextFieldProps,
} from "./index.js";
import { fieldStyles } from "./fields.stylex.js";

const consumerStyles = stylex.create({
  controlOverride: {
    backgroundColor: "var(--ui-card)",
    borderColor: "var(--ui-warning)",
  },
  dynamicWidth: (width: string) => ({ width }),
  inputOverride: {
    color: "var(--ui-primary)",
    paddingInline: "var(--space-5)",
  },
  rootOverride: {
    display: "flex",
    gap: "var(--space-6)",
  },
  searchControlOverride: {
    display: "flex",
  },
});

const typedTextField: TextFieldProps = {
  controlXstyle: consumerStyles.controlOverride,
  inputXstyle: consumerStyles.inputOverride,
  label: "Project name",
  xstyle: consumerStyles.rootOverride,
};
// @ts-expect-error Field xstyle accepts compiled recipes, not raw CSS objects.
const rawTextFieldXstyle: TextFieldProps = { label: "Invalid", xstyle: { display: "flex" } };
void [rawTextFieldXstyle, typedTextField];

function openingTag(markup: string, slot: string): string {
  const match = markup.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`, "u"));
  if (match === null) throw new Error(`Missing ${slot} opening tag`);
  return match[0];
}

function classNames(tag: string): string[] {
  return tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
}

test("text field recipes preserve semantics and put caller presentation last", () => {
  const html = renderToStaticMarkup(
    <TextField
      className="consumer-field"
      controlXstyle={consumerStyles.controlOverride}
      description="Shown to collaborators."
      inputClassName="consumer-input"
      inputProps={{ style: { color: "rebeccapurple", width: "15rem" } }}
      inputXstyle={[
        consumerStyles.inputOverride,
        consumerStyles.dynamicWidth("14rem"),
      ]}
      isInvalid
      label="Project name"
      placeholder="Seamount"
      size="large"
      surface="card"
      style={{ display: "block" }}
      xstyle={consumerStyles.rootOverride}
    />,
  );
  const root = openingTag(html, "text-field");
  const control = openingTag(html, "field-control");
  const input = openingTag(html, "field-input");
  const rootClasses = classNames(root);
  const controlClasses = classNames(control);
  const inputClasses = classNames(input);

  expect(rootClasses[0]).toBe("hraness-field");
  expect(rootClasses[1]).toBe("hraness-text-field");
  expect(rootClasses.at(-1)).toBe("consumer-field");
  expect(rootClasses.some((name) => name.startsWith("x"))).toBe(true);
  expect(root).toContain('data-invalid="true"');
  expect(root).toContain('data-size="large"');
  expect(root).toContain('data-surface="card"');
  expect(root).toContain('style="display:block"');
  expect(controlClasses[0]).toBe("hraness-field__control");
  expect(controlClasses.some((name) => name.startsWith("x"))).toBe(true);
  expect(inputClasses[0]).toBe("hraness-field__input");
  expect(inputClasses.at(-1)).toBe("consumer-input");
  expect(input).toMatch(/style="--[^:]+:14rem;color:rebeccapurple;width:15rem"/u);
  expect(input).toContain('placeholder="Seamount"');
  expect(html).toContain("Shown to collaborators.");
});

test("the field family keeps native controls, named actions, and selected indicators", () => {
  const html = renderToStaticMarkup(
    <div>
      <TextAreaField label="Summary" resize="vertical" />
      <SearchField defaultValue="ocean" label="Search projects" />
      <NumberField defaultValue={2} label="Retries" name="retries" />
      <NativeSelectField
        defaultValue="atlantic"
        label="Ocean"
        options={[{ id: "atlantic", label: "Atlantic" }] as const}
      />
      <FileField label="Cover" name="cover" />
      <RadioGroup defaultValue="calm" label="Mode" name="mode">
        <RadioOption label="Calm" value="calm" />
      </RadioGroup>
      <SwitchField defaultSelected label="Alerts" name="alerts" />
    </div>,
  );

  expect(html).toContain("<textarea");
  expect(html).toContain('data-resize="vertical"');
  expect(html).toContain('aria-label="Clear search"');
  expect(html).toContain('aria-label="Decrease value"');
  expect(html).toContain('aria-label="Increase value"');
  expect(html).toContain('<option value="atlantic" selected="">Atlantic</option>');
  expect(html).toContain('type="file"');
  expect(html).toContain('data-slot="radio-indicator-dot"');
  expect(html).toContain('data-slot="switch-thumb"');
  expect(html).toContain('role="switch"');

  const numberStepClasses = stylex.props(
    fieldStyles.numberStep,
    fieldStyles.numberStepNativeInteractions,
  ).className?.split(" ") ?? [];
  const radioSelectedClasses = stylex.props(
    fieldStyles.radioIndicator,
    fieldStyles.radioIndicatorSelected,
  ).className?.split(" ") ?? [];
  const switchTrackSelectedClasses = stylex.props(
    fieldStyles.switchTrack,
    fieldStyles.switchTrackSelected,
  ).className?.split(" ") ?? [];
  const switchThumbSelectedClasses = stylex.props(
    fieldStyles.switchThumb,
    fieldStyles.switchThumbSelected,
  ).className?.split(" ") ?? [];

  for (const className of numberStepClasses) {
    expect(classNames(openingTag(html, "number-decrement"))).toContain(className);
    expect(classNames(openingTag(html, "number-increment"))).toContain(className);
  }
  for (const className of radioSelectedClasses) {
    expect(classNames(openingTag(html, "radio-indicator"))).toContain(className);
  }
  for (const className of switchTrackSelectedClasses) {
    expect(classNames(openingTag(html, "switch-track"))).toContain(className);
  }
  for (const className of switchThumbSelectedClasses) {
    expect(classNames(openingTag(html, "switch-thumb"))).toContain(className);
  }
});

test("search control recipes keep caller presentation last", () => {
  const html = renderToStaticMarkup(
    <SearchField
      controlXstyle={consumerStyles.searchControlOverride}
      defaultValue="ocean"
      label="Search projects"
    />,
  );
  const control = openingTag(html, "field-control");
  const callerClasses = stylex.props(
    consumerStyles.searchControlOverride,
  ).className?.split(" ") ?? [];

  expect(callerClasses).not.toHaveLength(0);
  for (const callerClass of callerClasses) {
    expect(classNames(control)).toContain(callerClass);
  }
});

test("native fields retain focus-within fallback atoms without caller control recipes", () => {
  const nativeSelect = renderToStaticMarkup(
    <NativeSelectField
      label="Ocean"
      options={[{ id: "atlantic", label: "Atlantic" }] as const}
    />,
  );
  const file = renderToStaticMarkup(<FileField label="Cover" />);
  const fallbackClasses = stylex.props(
    fieldStyles.controlFocusWithinFallback,
  ).className?.split(" ") ?? [];
  const nativeSelectClasses = stylex.props(
    fieldStyles.nativeSelect,
  ).className?.split(" ") ?? [];

  expect(fallbackClasses).not.toHaveLength(0);
  for (const fallbackClass of fallbackClasses) {
    expect(classNames(openingTag(nativeSelect, "field-control"))).toContain(
      fallbackClass,
    );
    expect(classNames(openingTag(file, "field-control"))).toContain(
      fallbackClass,
    );
  }
  for (const nativeSelectClass of nativeSelectClasses) {
    expect(classNames(openingTag(nativeSelect, "field-select"))).toContain(
      nativeSelectClass,
    );
  }
});

test("native fields retain focus-within defaults alongside caller control recipes", () => {
  const nativeSelect = renderToStaticMarkup(
    <NativeSelectField
      controlXstyle={consumerStyles.controlOverride}
      label="Ocean"
      options={[{ id: "atlantic", label: "Atlantic" }] as const}
    />,
  );
  const file = renderToStaticMarkup(
    <FileField
      controlXstyle={consumerStyles.controlOverride}
      label="Cover"
    />,
  );
  const fallbackClasses = stylex.props(
    fieldStyles.controlFocusWithinFallback,
  ).className?.split(" ") ?? [];

  expect(fallbackClasses).not.toHaveLength(0);
  for (const fallbackClass of fallbackClasses) {
    expect(classNames(openingTag(nativeSelect, "field-control"))).toContain(
      fallbackClass,
    );
    expect(classNames(openingTag(file, "field-control"))).toContain(
      fallbackClass,
    );
  }
});

test("SelectField preserves native submission and compiled trigger geometry", () => {
  const html = renderToStaticMarkup(
    <SelectField
      className="consumer-select"
      defaultValue="daily"
      label="Digest cadence"
      name="cadence"
      options={[
        { id: "daily", label: "Daily", textValue: "Daily" },
        { id: "weekly", label: "Weekly", textValue: "Weekly" },
      ]}
      style={{ display: "block" }}
      triggerXstyle={consumerStyles.controlOverride}
      xstyle={consumerStyles.rootOverride}
    />,
  );
  const root = openingTag(html, "select-field");
  const trigger = html.match(
    /<button[^>]*class="[^"]*hraness-select-field__trigger[^"]*"[^>]*>/u,
  )?.[0];
  const indicator = openingTag(html, "select-field-indicator");
  if (trigger === undefined) throw new Error("Missing SelectField trigger");

  expect(classNames(root)[0]).toBe("hraness-select-field");
  expect(classNames(root).at(-1)).toBe("consumer-select");
  expect(root).toContain('style="display:block"');
  expect(classNames(trigger).some((name) => name.startsWith("x"))).toBe(true);
  expect(indicator).toContain('viewBox="0 0 12 12"');
  expect(html).toContain('d="M2.25 4.25 6 7.75 9.75 4.25"');
  expect(html).toContain('name="cadence"');
  expect(html).not.toContain("⌄");
});

test("migrated field presentation leaves only native pseudo seams in legacy CSS", async () => {
  const [components, fields, select] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./fields.stylex.ts", import.meta.url)).text(),
    Bun.file(new URL("./select-field.stylex.ts", import.meta.url)).text(),
  ]);

  expect(components).not.toContain(".hraness-select-field__trigger {");
  expect(components).not.toContain(".hraness-number-field__control {");
  expect(components).not.toContain(".hraness-radio-option__indicator {");
  expect(components).not.toContain(".hraness-switch-field__track {");
  expect(components).toContain(".hraness-field__input::placeholder {");
  expect(components).toContain(".hraness-field__file::file-selector-button {");
  expect(components).toContain(
    ':where(.hraness-file-field[data-size="compact"])',
  );
  expect(components).toContain(
    ':where(.hraness-file-field[data-size="large"])',
  );
  expect(components).toContain(
    "min-height: calc(var(--interactive-target-min) - 2px);",
  );
  expect(fields).toContain('controlFocusWithinFallback: {');
  expect(fields).toContain('[forcedColors]: "Highlight"');
  expect(fields).toContain('[forcedColors]: "HighlightText"');
  expect(fields).toContain('[forcedColors]: "Canvas"');
  expect(fields).toContain('[forcedColors]: "CanvasText"');
  expect(fields).toContain('backgroundPosition: "0.75rem 50%, 1rem 50%"');
  expect(fields).toContain('backgroundImage: "none"');
  expect(fields).toContain('[coarsePointer]: "var(--interactive-target-min)"');
  expect(fields).toContain(
    '[coarsePointer]: "var(--interactive-target-min) minmax(3rem, 1fr) var(--interactive-target-min)"',
  );
  expect(fields).toContain(
    '[coarsePointer]: "calc(var(--interactive-target-min) - 0.5rem)"',
  );
  expect(fields).toContain('fieldControlSizeStyles = {');
  expect(select).toContain('triggerNativeInteractions: {');
  expect(select).toContain('selectTriggerSizeStyles = {');
});
