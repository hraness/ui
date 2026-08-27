import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Button,
  CheckboxField,
  CheckboxGroup,
  Form,
  SelectField,
} from "./index.js";

test("form, select, and checkbox composition keeps native submission semantics", () => {
  const html = renderToStaticMarkup(
    <Form action="/preferences" method="post">
      <SelectField
        defaultValue="daily"
        label="Digest cadence"
        name="cadence"
        options={[
          { id: "daily", label: "Daily", textValue: "Daily" },
          {
            description: "One message at the end of the week.",
            id: "weekly",
            label: "Weekly",
            textValue: "Weekly",
          },
        ]}
      />
      <CheckboxGroup label="Notifications" name="notifications">
        <CheckboxField label="Product updates" value="product" />
        <CheckboxField label="Security notices" value="security" />
      </CheckboxGroup>
      <Button type="submit" variant="primary">Save preferences</Button>
    </Form>,
  );

  expect(html).toContain("<form");
  expect(html).toContain('action="/preferences"');
  expect(html).toContain('method="post"');
  expect(html).toContain('class="hraness-select-field"');
  expect(html).toContain(
    'class="hraness-select-field__indicator" data-slot="select-field-indicator" fill="none" focusable="false" viewBox="0 0 12 12"',
  );
  expect(html).toContain('d="M2.25 4.25 6 7.75 9.75 4.25"');
  expect(html).not.toContain("⌄");
  expect(html).toContain('name="cadence"');
  expect(html).toContain("Digest cadence");
  expect(html).toContain('role="group"');
  expect(html).toContain("Notifications");
  expect(html).toContain('name="notifications"');
  expect(html).toContain('value="product"');
  expect(html).toContain('value="security"');
  expect(html).toContain('type="submit"');
  expect(html).toContain("Save preferences");
});
