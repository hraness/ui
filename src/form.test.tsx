import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormContext } from "react-aria-components";

import { Form, type FormProps } from "./form.js";

const consumerStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  override: {
    display: "flex",
    gap: "var(--space-2)",
    minWidth: "7rem",
  },
});

const typedForm: FormProps = {
  action: "/preferences",
  children: "Preferences",
  method: "post",
  xstyle: consumerStyles.override,
};
// @ts-expect-error Form accepts compiled StyleX recipes rather than raw CSS objects.
const rawFormXstyle: FormProps = { children: "Invalid", xstyle: { display: "flex" } };
void [rawFormXstyle, typedForm];

function openingTag(markup: string): string {
  return markup.slice(0, markup.indexOf(">") + 1);
}

test("Form preserves native submission, validation, ref, and custom render contracts", () => {
  const ref = createRef<HTMLFormElement>();
  const onSubmit = () => undefined;
  let customRenderContract = false;
  const html = renderToStaticMarkup(
    <Form
      acceptCharset="utf-8"
      action="/preferences"
      className="consumer-form"
      data-product="settings"
      method="post"
      onSubmit={onSubmit}
      ref={ref}
      render={(props, state) => {
        customRenderContract = state === undefined
          && props.action === "/preferences"
          && props.method === "post"
          && props.onSubmit === onSubmit;
        return <form {...props} data-custom-render="true" />;
      }}
      style={{ display: "block", width: "15rem" }}
      validationBehavior="aria"
      xstyle={[
        consumerStyles.override,
        consumerStyles.dynamicWidth("14rem"),
      ]}
    >
      <button type="button">Save locally</button>
    </Form>,
  );
  const tag = openingTag(html);
  const classes = tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

  expect(customRenderContract).toBe(true);
  expect(tag).toStartWith("<form");
  expect(tag).toContain('accept-charset="utf-8"');
  expect(tag).toContain('action="/preferences"');
  expect(tag).toContain('data-custom-render="true"');
  expect(tag).toContain('data-product="settings"');
  expect(tag).toContain('data-slot="form"');
  expect(tag).toContain('method="post"');
  expect(tag).toContain('novalidate=""');
  expect(classes[0]).toBe("hraness-form");
  expect(classes.at(-1)).toBe("consumer-form");
  expect(classes.slice(1, -1).some((name) => name.startsWith("x"))).toBe(true);
  expect(tag).toMatch(
    /style="--[^:]+:14rem;display:block;width:15rem"/u,
  );
  expect(html).toContain('<button type="button">Save locally</button>');
  expect(Form.displayName).toBe("Form");
});

test("Form composes React Aria context presentation and inherited rendering", () => {
  const html = renderToStaticMarkup(
    <FormContext.Provider
      value={{
        className: "context-form",
        render: (props) => (
          <form {...props} data-context-render="true" />
        ),
      }}
    >
      <Form className="consumer-form">
        <button type="button">Save locally</button>
      </Form>
    </FormContext.Provider>,
  );
  const tag = openingTag(html);
  const classes = tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];

  expect(tag).toContain('data-context-render="true"');
  expect(classes[0]).toBe("context-form");
  expect(classes[1]).toBe("hraness-form");
  expect(classes.at(-1)).toBe("consumer-form");
});

test("Form keeps its exact recipe out of the legacy stylesheet", async () => {
  const [components, source] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./form.stylex.ts", import.meta.url)).text(),
  ]);

  expect(components).not.toMatch(/\.hraness-form(?![A-Za-z0-9_-])/u);
  expect(source).toContain('display: "grid"');
  expect(source).toContain('gap: "var(--space-6)"');
  expect(source).toContain("minWidth: 0");
});
