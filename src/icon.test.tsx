import { expect, test } from "bun:test";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppearanceIcon,
  Icon,
  isSocialIconName,
  SocialIcon,
  socialIconNames,
} from "./icon.js";

test("Icon keeps the shared decorative current-color contract", () => {
  const html = renderToStaticMarkup(<Icon icon={Search01Icon} />);

  expect(html).toContain("<svg");
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('class="hraness-icon"');
  expect(html).toContain('color="currentColor"');
  expect(html).toContain('data-slot="icon"');
  expect(html).toContain('width="20"');
  expect(html).toContain('stroke-width="1.5"');
});

test("social icons cover the finite profile set including Substack", () => {
  expect(isSocialIconName("threads")).toBeTrue();
  expect(isSocialIconName("mastodon")).toBeFalse();

  const html = renderToStaticMarkup(
    <>
      {socialIconNames.map((name) => <SocialIcon key={name} name={name} />)}
    </>,
  );

  for (const name of socialIconNames) {
    expect(html).toContain(`data-social-icon="${name}"`);
  }
  expect(html.match(/data-slot="social-icon"/gu)).toHaveLength(
    socialIconNames.length,
  );
  expect(html).toContain("M22.539 8.242H1.46V5.406");
});

test("appearance icons use the shared light, dark, and system glyphs", () => {
  const html = renderToStaticMarkup(
    <>
      <AppearanceIcon name="light" />
      <AppearanceIcon name="dark" />
      <AppearanceIcon name="system" />
    </>,
  );

  expect(html.match(/data-slot="appearance-icon"/gu)).toHaveLength(3);
  expect(html).toContain('data-appearance-icon="light"');
  expect(html).toContain('data-appearance-icon="dark"');
  expect(html).toContain('data-appearance-icon="system"');
});
