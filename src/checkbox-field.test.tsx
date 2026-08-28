import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CheckboxFieldContext,
  type CheckboxFieldRenderProps,
} from "react-aria-components";

import { CheckboxField } from "./fields.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

const testStyles = stylex.create({
  controlDynamicHeight: (height: string) => ({ minHeight: height }),
  controlOverride: {
    backgroundColor: "var(--ui-secondary)",
    gap: "var(--space-4)",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    outlineColor: "var(--ui-warning)",
    outlineOffset: "7px",
    outlineStyle: "dashed",
    outlineWidth: "4px",
  },
  rootDynamicWidth: (width: string) => ({ width }),
  rootOverride: {
    color: "var(--ui-primary)",
    display: "flex",
    gap: "var(--space-5)",
    gridTemplateColumns: "none",
  },
});

function tags(html: string) {
  const root = html.match(/<div[^>]*data-slot="checkbox-field"[^>]*>/u)?.[0];
  const control = html.match(/<label[^>]*data-slot="checkbox-control"[^>]*>/u)?.[0];
  const input = html.match(/<input[^>]*type="checkbox"[^>]*>/u)?.[0];
  const indicator = html.match(
    /<span[^>]*data-slot="checkbox-indicator"[^>]*>/u,
  )?.[0];
  const label = html.match(/<span[^>]*data-slot="checkbox-label"[^>]*>/u)?.[0];
  if (
    root === undefined
    || control === undefined
    || input === undefined
    || indicator === undefined
    || label === undefined
  ) {
    throw new Error("Rendered CheckboxField structure is incomplete");
  }
  return { control, indicator, input, label, root };
}

function classes(tag: string): string[] {
  const className = tag.match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error("Rendered element has no class");
  return className.split(" ");
}

test("CheckboxField preserves native form, validation, and split-field semantics", () => {
  const html = renderToStaticMarkup(
    <form action="/preferences" method="post">
      <CheckboxField
        defaultSelected
        description="Required for notifications."
        errorMessage="Accept notifications."
        isInvalid
        isRequired
        label="Notifications"
        name="notifications"
        value="enabled"
      />
    </form>,
  );
  const rendered = tags(html);

  expect(html).toStartWith('<form action="/preferences" method="post">');
  expect(rendered.root).toStartWith("<div");
  expect(rendered.root).toContain('data-selected="true"');
  expect(rendered.root).toContain('data-invalid="true"');
  expect(rendered.root).toContain('data-required="true"');
  expect(rendered.control).toStartWith("<label");
  expect(rendered.control).toContain('data-selected="true"');
  expect(rendered.control).toContain('data-invalid="true"');
  expect(rendered.input).toContain('name="notifications"');
  expect(rendered.input).toContain('value="enabled"');
  expect(rendered.input).toContain('checked=""');
  expect(rendered.input).toContain('required=""');
  expect(rendered.input).toContain('aria-invalid="true"');
  expect(rendered.input).toMatch(/aria-describedby="[^"]+ [^"]+"/u);
  expect(rendered.indicator).toContain('aria-hidden="true"');
  expect(html).toContain(">✓</span>");
  expect(rendered.label).not.toContain("hraness-visually-hidden");
  expect(html).toContain(">Notifications</span>");
  expect(html).toContain("Required for notifications.");
  expect(html).toContain("Accept notifications.");
  expect(html).not.toContain("data-size=");
});

test("CheckboxField keeps a required label accessible when its copy is visually hidden", () => {
  const html = renderToStaticMarkup(
    <CheckboxField
      label="Select this project"
      name="project"
      showLabel={false}
    />,
  );
  const rendered = tags(html);

  expect(rendered.control).toStartWith("<label");
  expect(rendered.label).toContain("hraness-checkbox-field__label");
  expect(rendered.label).toContain("hraness-visually-hidden");
  const labelClasses = classes(rendered.label);
  const hiddenClasses = visuallyHiddenClassName()?.split(" ") ?? [];
  const hiddenIndex = labelClasses.indexOf("hraness-visually-hidden");
  expect(labelClasses[0]).toBe("hraness-checkbox-field__label");
  expect(hiddenIndex).toBeGreaterThan(0);
  expect(hiddenClasses.every((className) => labelClasses.includes(className))).toBe(true);
  expect(hiddenClasses.every(
    (className) => labelClasses.indexOf(className) > hiddenIndex,
  )).toBe(true);
  expect(rendered.label).not.toContain("style=");
  expect(html).toContain(">Select this project</span>");
  expect(rendered.input).not.toContain("aria-label=");
});

type CheckboxFieldState = CheckboxFieldRenderProps & Readonly<{
  defaultClassName: string | undefined;
  defaultStyle: CSSProperties;
}>;

test("CheckboxField composes context, render, StyleX, caller classes, and native style", () => {
  const seenStates: CheckboxFieldState[] = [];
  const html = renderToStaticMarkup(
    <CheckboxFieldContext.Provider
      value={{
        className: "context-checkbox",
        render: (props, state) => (
          <div
            {...props}
            data-context-render={state.isDisabled ? "disabled" : "enabled"}
          />
        ),
      }}
    >
      <CheckboxField
        className="consumer-checkbox"
        controlClassName="consumer-checkbox-control"
        controlXstyle={[
          testStyles.controlOverride,
          testStyles.controlDynamicHeight("3.25rem"),
        ]}
        isDisabled
        label="Unavailable preference"
        style={(state) => {
          seenStates.push(state as CheckboxFieldState);
          return { width: "15rem" };
        }}
        xstyle={[
          testStyles.rootOverride,
          testStyles.rootDynamicWidth("14rem"),
        ]}
      />
    </CheckboxFieldContext.Provider>,
  );
  const rendered = tags(html);
  const rootClasses = classes(rendered.root);
  const controlClasses = classes(rendered.control);
  const rootCallerClasses = stylex.props(
    testStyles.rootOverride,
    testStyles.rootDynamicWidth("14rem"),
  ).className?.split(" ") ?? [];
  const controlCallerClasses = stylex.props(
    testStyles.controlOverride,
    testStyles.controlDynamicHeight("3.25rem"),
  ).className?.split(" ") ?? [];

  expect(rendered.root).toContain('data-context-render="disabled"');
  expect(rootClasses[0]).toBe("context-checkbox");
  expect(rootClasses[1]).toBe("hraness-checkbox-field");
  expect(rootClasses.at(-1)).toBe("consumer-checkbox");
  expect(rootCallerClasses).not.toHaveLength(0);
  for (const callerClass of rootCallerClasses) {
    expect(rootClasses).toContain(callerClass);
  }
  expect(rendered.root).toMatch(/style="--[^:]+:14rem;width:15rem"/u);
  expect(seenStates).toHaveLength(1);
  expect(seenStates[0]?.isDisabled).toBe(true);

  expect(controlClasses[0]).toBe("hraness-checkbox-field__control");
  expect(controlClasses.at(-1)).toBe("consumer-checkbox-control");
  expect(controlCallerClasses).not.toHaveLength(0);
  for (const callerClass of controlCallerClasses) {
    expect(controlClasses).toContain(callerClass);
  }
  expect(rendered.control).toMatch(/style="--[^:]+:3\.25rem"/u);
  expect(rendered.input).toContain('disabled=""');
});

test("CheckboxField prefers a local render function over inherited context rendering", () => {
  const html = renderToStaticMarkup(
    <CheckboxFieldContext.Provider
      value={{
        className: "context-checkbox",
        render: (props) => (
          <div
            {...props}
            data-context-render="true"
          />
        ),
      }}
    >
      <CheckboxField
        label="Locally rendered preference"
        render={(props, state) => (
          <div
            {...props}
            data-local-render={state.isDisabled ? "disabled" : "enabled"}
          />
        )}
      />
    </CheckboxFieldContext.Provider>,
  );
  const rendered = tags(html);

  expect(rendered.root).toContain('data-local-render="enabled"');
  expect(rendered.root).not.toContain("data-context-render=");
  expect(classes(rendered.root)[0]).toBe("context-checkbox");
});

test("CheckboxField slot null opts out of inherited context presentation", () => {
  const html = renderToStaticMarkup(
    <CheckboxFieldContext.Provider
      value={{
        className: "context-checkbox",
        render: (props) => (
          <div
            {...props}
            data-context-render="true"
          />
        ),
      }}
    >
      <CheckboxField
        className="local-checkbox"
        label="Unslotted preference"
        slot={null}
      />
    </CheckboxFieldContext.Provider>,
  );
  const rendered = tags(html);
  const rootClasses = classes(rendered.root);

  expect(rendered.root).not.toContain("data-context-render=");
  expect(rootClasses[0]).toBe("hraness-checkbox-field");
  expect(rootClasses.at(-1)).toBe("local-checkbox");
  expect(rootClasses).not.toContain("context-checkbox");
});
