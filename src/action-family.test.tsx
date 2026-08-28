import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Button,
  type ButtonProps,
  IconButton,
  type IconButtonProps,
  IconLink,
  LinkButton,
  type LinkButtonProps,
  ToggleButton,
} from "./actions.js";
import {
  actionLabeledVariantStyles,
  actionNativeLabeledHoverStyles,
  actionStyles,
} from "./actions.stylex.js";

const consumerStyles = stylex.create({
  control: {
    backgroundColor: "purple",
    outlineColor: "orange",
    ":hover": {
      backgroundColor: "rebeccapurple",
    },
  },
  controlDynamicHeight: (height: string) => ({ minHeight: height }),
  label: {
    display: "grid",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  root: {
    display: "flex",
    maxWidth: "20rem",
  },
  rootDynamicGap: (gap: string) => ({ gap }),
});

const styledButtonProps: ButtonProps = {
  children: "Save",
  controlXstyle: consumerStyles.control,
  partXstyles: { label: consumerStyles.label },
  xstyle: consumerStyles.root,
};
const styledLinkButtonProps: LinkButtonProps = {
  children: "Settings",
  href: "/settings",
  partXstyles: { label: consumerStyles.label },
};
const invalidButtonPart: ButtonProps = {
  children: "Save",
  partXstyles: {
    // @ts-expect-error Button and LinkButton expose only their label part.
    leading: consumerStyles.label,
  },
};
const invalidIconButtonPart: IconButtonProps = {
  "aria-label": "Save",
  children: "S",
  // @ts-expect-error IconButton does not expose a label part.
  partXstyles: { label: consumerStyles.label },
};
void [
  invalidButtonPart,
  invalidIconButtonPart,
  styledButtonProps,
  styledLinkButtonProps,
];

function openingTag(html: string, slot: string): string {
  const tag = html.match(
    new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`, "u"),
  )?.[0];
  if (tag === undefined) throw new Error(`Missing ${slot} in rendered action`);
  return tag;
}

function classes(tag: string): string[] {
  const className = tag.match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error("Rendered action has no class");
  return className.split(" ");
}

test("actions compose wrapper, control, label, and native presentation in public order", () => {
  const html = renderToStaticMarkup(
    <Button
      className="consumer-root"
      controlClassName="consumer-control"
      controlXstyle={[
        consumerStyles.control,
        consumerStyles.controlDynamicHeight("3.25rem"),
      ]}
      leading="S"
      partXstyles={{ label: consumerStyles.label }}
      style={{ backgroundColor: "black" }}
      xstyle={[
        consumerStyles.root,
        consumerStyles.rootDynamicGap("1rem"),
      ]}
    >
      Save changes
    </Button>,
  );
  const root = openingTag(html, "button");
  const control = openingTag(html, "button-control");
  const leading = openingTag(html, "button-leading");
  const label = openingTag(html, "button-label");
  const linkLabel = openingTag(
    renderToStaticMarkup(
      <LinkButton
        href="/settings"
        partXstyles={{ label: consumerStyles.label }}
      >
        Settings
      </LinkButton>,
    ),
    "link-button-label",
  );

  expect(classes(root)[0]).toBe("hraness-button");
  expect(classes(root).at(-1)).toBe("consumer-root");
  expect(root).toMatch(/style="--[^:]+:1rem"/u);
  expect(classes(control)[0]).toBe("hraness-button__control");
  expect(classes(control).at(-1)).toBe("consumer-control");
  expect(control).toMatch(/style="--[^:]+:3\.25rem;background-color:black"/u);
  expect(classes(leading)[0]).toBe("hraness-button__leading");
  for (const labelClass of stylex.props(consumerStyles.label).className?.split(" ") ?? []) {
    expect(classes(label)).toContain(labelClass);
    expect(classes(linkLabel)).toContain(labelClass);
  }
});

test("effective controlXstyle removes native fallbacks while empty conditionals retain them", () => {
  const nativeFallbackClasses = stylex.props(
    actionStyles.nativeInteractionFallbacks,
    actionNativeLabeledHoverStyles.secondary,
  ).className?.split(" ") ?? [];
  const baseVariantClasses = stylex.props(
    actionLabeledVariantStyles.secondary,
  ).className?.split(" ") ?? [];
  expect(nativeFallbackClasses.length).toBeGreaterThan(0);
  expect(baseVariantClasses.length).toBeGreaterThan(0);

  const fallbackControl = openingTag(
    renderToStaticMarkup(<Button controlXstyle={[false, null, undefined]}>Open</Button>),
    "button-control",
  );
  const overriddenControl = openingTag(
    renderToStaticMarkup(
      <Button controlXstyle={consumerStyles.control}>Open</Button>,
    ),
    "button-control",
  );

  for (const baseVariantClass of baseVariantClasses) {
    expect(classes(fallbackControl)).toContain(baseVariantClass);
  }
  for (const fallbackClass of nativeFallbackClasses) {
    expect(classes(fallbackControl)).toContain(fallbackClass);
    expect(classes(overriddenControl)).not.toContain(fallbackClass);
  }
});

test("action variants and presentations retain semantic controls and selected priority", () => {
  const html = renderToStaticMarkup(
    <div>
      <Button isPending variant="danger">Delete</Button>
      <IconButton aria-label="Refresh" size="large">R</IconButton>
      <ToggleButton defaultSelected size="transport">Pinned</ToggleButton>
      <ToggleButton aria-label="Pin" defaultSelected isIconOnly size="large">P</ToggleButton>
      <LinkButton href="/settings" variant="quiet">Settings</LinkButton>
      <IconLink aria-label="Activity" href="/activity">A</IconLink>
      <IconLink aria-label="Source" href="/source" presentation="inline">S</IconLink>
    </div>,
  );
  const toggleControls = [
    ...html.matchAll(/<button[^>]*data-slot="toggle-button-control"[^>]*>/gu),
  ].map((match) => match[0]);
  const selectedClasses = stylex.props(actionStyles.selected).className?.split(" ") ?? [];
  const dangerControl = openingTag(html, "button-control");
  const dangerClasses = stylex.props(
    actionLabeledVariantStyles.danger,
    actionNativeLabeledHoverStyles.danger,
  ).className?.split(" ") ?? [];

  expect(html).toContain('data-pending="true"');
  expect(html).toContain('data-variant="danger"');
  expect(html).toContain('data-size="transport"');
  expect(html).toContain('data-slot="link-button-control"');
  expect(html).toContain('data-slot="icon-link-control"');
  expect(html).toContain('data-slot="inline-icon-link-control"');
  expect(toggleControls).toHaveLength(2);
  expect(selectedClasses.length).toBeGreaterThan(0);
  expect(dangerClasses.length).toBeGreaterThan(0);
  for (const dangerClass of dangerClasses) {
    expect(classes(dangerControl)).toContain(dangerClass);
  }
  for (const control of toggleControls) {
    expect(control).toContain('data-selected="true"');
    for (const selectedClass of selectedClasses) {
      expect(classes(control)).toContain(selectedClass);
    }
  }
});

test("action StyleX source owns every migrated visual recipe and legacy CSS owns none", async () => {
  const [components, source] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./actions.stylex.ts", import.meta.url)).text(),
  ]);

  expect(components).not.toMatch(
    /\.hraness-(?:action__spinner|(?:button|copy-button|icon-button|icon-link|inline-icon-link|link-button|toggle-button)(?:__[A-Za-z0-9_-]+)?)(?![A-Za-z0-9_-])/u,
  );
  expect(components).toContain(
    '--hraness-action-coarse-min: var(--interactive-target-min);',
  );
  for (const recipe of [
    "nativeInteractionFallbacks",
    "hoveredDanger",
    "iconOnlyToggle",
    "inlineControl",
    "labeledDanger",
    "nativeLabeledDangerHover",
    "selected",
    "spinner",
  ]) {
    expect(source).toContain(`${recipe}: {`);
  }
  expect(source).toContain('animationName: {');
  expect(source).toContain('[reducedMotion]: "none"');
  expect(source).toContain('font: "inherit"');
  expect(source).not.toContain("fontSizeAdjust");
  expect(components).toContain("@keyframes hraness-spin");
});
