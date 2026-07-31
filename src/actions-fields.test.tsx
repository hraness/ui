import { expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Button,
  IconButton,
  IconLink,
  Link,
  LinkButton,
  ToggleButton,
  type IconButtonProps,
  type IconLinkProps,
  type ToggleButtonProps,
} from "./actions.js";
import {
  CheckboxField,
  FileField,
  NativeSelectField,
  NumberField,
  RadioGroup,
  RadioOption,
  SearchField,
  SwitchField,
  TextAreaField,
  TextField,
} from "./fields.js";

const namedIconButtonProps = [
  { "aria-label": "Refresh", children: "↻" },
  { "aria-labelledby": "refresh-label", children: "↻", tooltip: "Refresh" },
] satisfies readonly IconButtonProps[];

const namedIconLinkProps = [
  { "aria-label": "Activity", children: "↗", href: "/activity" },
  {
    "aria-labelledby": "activity-label",
    children: "↗",
    href: "/activity",
    tooltip: "Activity",
  },
] satisfies readonly IconLinkProps[];

const namedIconToggleProps = [
  { "aria-label": "Pin project", children: "⌖", isIconOnly: true },
] satisfies readonly ToggleButtonProps[];

// @ts-expect-error Icon-only toggle buttons require an accessible name.
const unnamedIconToggleProps: ToggleButtonProps = { isIconOnly: true };
// @ts-expect-error An aria-labelledby icon link needs explicit tooltip content.
const untooledIconLinkProps: IconLinkProps = {
  "aria-labelledby": "activity-label",
  href: "/activity",
};
void unnamedIconToggleProps;
void untooledIconLinkProps;

test("action controls retain names, destinations, variants, and pending focusability", () => {
  expect(namedIconButtonProps).toHaveLength(2);
  expect(namedIconLinkProps).toHaveLength(2);
  expect(namedIconToggleProps).toHaveLength(1);
  const buttonRef = createRef<HTMLButtonElement>();
  const html = renderToStaticMarkup(
    <div>
      <Button
        aria-busy
        className="save-host"
        controlClassName="save-control"
        isDisabled
        isPending
        leading="S"
        ref={buttonRef}
        size="large"
        variant="primary"
      >
        Save changes
      </Button>
      <IconButton aria-label="Refresh" isPending size="compact">↻</IconButton>
      <ToggleButton defaultSelected>Pin</ToggleButton>
      <ToggleButton aria-label="Pin project" isIconOnly>⌖</ToggleButton>
      <Link href="/docs">Documentation</Link>
      <LinkButton href="/settings" leading="S" variant="quiet">Settings</LinkButton>
      <IconLink aria-label="Activity" href="/activity">↗</IconLink>
    </div>,
  );

  expect(html).toContain('data-slot="button"');
  expect(html).toContain('data-size="large"');
  expect(html).toContain('data-variant="primary"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("save-host");
  expect(html).toContain("save-control");
  expect(html).toContain("hraness-action__spinner");
  expect(html).not.toContain('disabled=""');
  expect(html).toContain('aria-label="Refresh"');
  expect(html).toContain('data-slot="icon-button"');
  expect(html).toContain('data-selected="true"');
  expect(html).toContain('href="/docs"');
  expect(html).toContain('href="/settings"');
  expect(html).toContain('href="/activity"');
  expect(html).toContain('data-slot="icon-link"');
  expect(Button.displayName).toBe("Button");
});

test("icon-only actions reject blank names and tooltip content at runtime", () => {
  expect(() => renderToStaticMarkup(
    <IconButton aria-label="">↻</IconButton>,
  )).toThrow("IconButton aria-label must not be blank");
  expect(() => renderToStaticMarkup(
    <IconLink aria-label="Activity" href="/activity" tooltip="">↗</IconLink>,
  )).toThrow("IconLink tooltip must not be blank");
  expect(() => renderToStaticMarkup(
    <ToggleButton
      {...({ isIconOnly: true } as unknown as ToggleButtonProps)}
    >
      ⌖
    </ToggleButton>,
  )).toThrow("ToggleButton aria-labelledby must not be blank");
});

test("TextField and TextAreaField connect labels, help, and validation output", () => {
  const fieldRef = createRef<HTMLDivElement>();
  const html = renderToStaticMarkup(
    <div>
      <TextField
        description="Use your work address."
        errorMessage={({ validationErrors }) => (
          validationErrors.join(" ") || "Invalid email."
        )}
        inputProps={{ autoComplete: "email" }}
        isInvalid
        label="Email"
        placeholder="you@example.com"
        ref={fieldRef}
        type="email"
      />
      <TextAreaField
        description="Keep it short."
        label="Summary"
        placeholder="Project summary"
        resize="vertical"
        textAreaProps={{ rows: 4 }}
      />
    </div>,
  );
  const labelFor = html.match(/<label[^>]*for="([^"]+)"[^>]*>Email/u)?.[1];
  const inputTag = html.match(/<input[^>]*placeholder="you@example.com"[^>]*>/u)?.[0];
  const inputId = inputTag?.match(/\sid="([^"]+)"/u)?.[1];

  expect(labelFor).toBeDefined();
  expect(labelFor).toBe(inputId);
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("Use your work address.");
  expect(html).toContain("Invalid email.");
  expect(html).toContain("<textarea");
  expect(html).toContain('rows="4"');
  expect(html).toContain('data-resize="vertical"');
  expect(TextField.displayName).toBe("TextField");
});

test("search and number fields preserve their named auxiliary actions and form value", () => {
  const html = renderToStaticMarkup(
    <div>
      <SearchField defaultValue="ocean" label="Search projects" />
      <NumberField
        defaultValue={3}
        description="Between one and five."
        label="Retries"
        maxValue={5}
        minValue={1}
        name="retries"
      />
    </div>,
  );

  expect(html).toContain('type="search"');
  expect(html).toContain('aria-label="Clear search"');
  expect(html).toContain('aria-label="Decrease value"');
  expect(html).toContain('aria-label="Increase value"');
  expect(html).toContain('name="retries"');
  expect(html).toContain('value="3"');
  expect(html).toContain("Between one and five.");
});

test("split checkbox, radio, and switch fields retain native controls and relationships", () => {
  const html = renderToStaticMarkup(
    <div>
      <CheckboxField
        description="Required for notifications."
        errorMessage="Accept notifications."
        isInvalid
        isSelected
        label="Notifications"
        name="notifications"
      />
      <RadioGroup
        defaultValue="calm"
        errorMessage="Choose a mode."
        isInvalid
        label="Mode"
        name="mode"
      >
        <RadioOption description="Fewer interruptions." label="Calm" value="calm" />
        <RadioOption label="Focus" value="focus" />
      </RadioGroup>
      <SwitchField
        description="Send a desktop alert."
        isSelected
        label="Desktop alerts"
        name="desktopAlerts"
      />
    </div>,
  );

  expect(html).toContain('type="checkbox"');
  expect(html).toContain('name="notifications"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("Required for notifications.");
  expect(html).toContain("Accept notifications.");
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('type="radio"');
  expect(html).toContain('name="mode"');
  expect(html).toContain("Fewer interruptions.");
  expect(html).toContain('role="switch"');
  expect(html).toContain('name="desktopAlerts"');
});

test("native select and file fields use text options and exact described-by targets", () => {
  const html = renderToStaticMarkup(
    <div>
      <NativeSelectField
        defaultValue="atlantic"
        description="Used for the map."
        label="Ocean"
        name="ocean"
        options={[
          { id: "atlantic", label: "Atlantic" },
          { disabled: true, id: "arctic", label: "Arctic" },
        ] as const}
      />
      <FileField
        accept="image/*"
        description="PNG or JPEG."
        errorMessage="Choose an image."
        isInvalid
        label="Cover image"
        multiple
        name="cover"
      />
    </div>,
  );
  const selectTag = html.match(/<select[^>]*data-slot="field-select"[^>]*>/u)?.[0];
  const selectDescriptionId = selectTag?.match(
    /aria-describedby="([^"]+)"/u,
  )?.[1];
  const fileTag = html.match(/<input[^>]*data-slot="field-file"[^>]*>/u)?.[0];
  const fileDescriptionIds = fileTag?.match(
    /aria-describedby="([^"]+)"/u,
  )?.[1]?.split(" ");

  expect(html).toContain('<option value="atlantic" selected="">Atlantic</option>');
  expect(html).toContain('<option disabled="" value="arctic">Arctic</option>');
  expect(selectDescriptionId).toBeDefined();
  expect(html).toContain(`id="${selectDescriptionId}"`);
  expect(html).toContain("Used for the map.");
  expect(html).toContain('type="file"');
  expect(html).toContain('accept="image/*"');
  expect(html).toContain('multiple=""');
  expect(html).toContain('aria-invalid="true"');
  expect(fileDescriptionIds).toHaveLength(2);
  for (const id of fileDescriptionIds ?? []) expect(html).toContain(`id="${id}"`);
  expect(html).toContain("Choose an image.");

  const validHtml = renderToStaticMarkup(
    <FileField errorMessage="Not invalid yet." label="Attachment" />,
  );
  expect(validHtml).not.toContain("Not invalid yet.");
});
