import { expect, test } from "bun:test";
import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AppearanceIcon,
  Icon,
  isSocialIconName,
  SocialIcon,
  socialIconNames,
} from "./icon.js";

const testStyles = stylex.create({
  block: {
    display: "block",
  },
});

function renderedClasses(html: string): string[] {
  const match = html.match(/class="([^"]+)"/u);
  if (match?.[1] === undefined) throw new Error("Rendered icon has no class");
  return match[1].split(" ");
}

function openingTagForSlot(html: string, slot: string): string {
  const marker = `data-slot="${slot}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Rendered markup has no ${slot} slot`);
  const start = html.lastIndexOf("<", markerIndex);
  const end = html.indexOf(">", markerIndex);
  if (start < 0 || end < 0) throw new Error(`Rendered ${slot} tag is incomplete`);
  return html.slice(start, end + 1);
}

function classesForSlot(html: string, slot: string): string[] {
  return renderedClasses(openingTagForSlot(html, slot));
}

function openingSvg(html: string): string {
  const match = html.match(/<svg\b[^>]*>/u);
  if (match === null) throw new Error("Rendered icon has no SVG");
  return match[0];
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}="([^"]+)"`, "u"))?.[1];
}

function generatedWrapperClasses(
  classes: readonly string[],
  semanticClass: string,
  callerClass?: string,
): string[] {
  return classes.filter(
    (name) => name !== semanticClass && name !== callerClass,
  );
}

test("Icon keeps the shared decorative current-color contract", () => {
  const html = renderToStaticMarkup(<Icon icon={Search01Icon} />);

  expect(html).toContain("<svg");
  expect(html).toContain('aria-hidden="true"');
  expect(renderedClasses(html)).toContain("hraness-icon");
  expect(html).toContain('color="currentColor"');
  expect(html).toContain('data-slot="icon"');
  expect(html).toContain('width="20"');
  expect(html).toContain('stroke-width="1.5"');
});

test("Icon applies typed caller styles after its shared recipe", () => {
  const baseClasses = renderedClasses(
    renderToStaticMarkup(<Icon icon={Search01Icon} />),
  );
  const overrideClasses = renderedClasses(
    renderToStaticMarkup(
      <Icon icon={Search01Icon} xstyle={testStyles.block} />,
    ),
  );
  const baseGenerated = baseClasses.filter((name) => name !== "hraness-icon");
  const overrideGenerated = overrideClasses.filter(
    (name) => name !== "hraness-icon",
  );

  expect(baseGenerated.length).toBeGreaterThan(0);
  expect(overrideGenerated).toHaveLength(baseGenerated.length);
  expect(overrideClasses).toContain("hraness-icon");
  expect(
    overrideGenerated.filter((name) => baseGenerated.includes(name)),
  ).toHaveLength(baseGenerated.length - 1);
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

test("social icons keep wrapper ordering, defaults, and Substack nesting", () => {
  const github = renderToStaticMarkup(
    <SocialIcon className="consumer-social-icon" name="github" />,
  );
  const githubClasses = classesForSlot(github, "social-icon");
  const githubSvg = openingSvg(github);

  expect(openingTagForSlot(github, "social-icon")).toStartWith("<span");
  expect(githubClasses[0]).toBe("hraness-social-icon");
  expect(githubClasses.at(-1)).toBe("consumer-social-icon");
  expect(
    generatedWrapperClasses(
      githubClasses,
      "hraness-social-icon",
      "consumer-social-icon",
    ).length,
  ).toBeGreaterThan(0);
  expect(attribute(openingTagForSlot(github, "social-icon"), "aria-hidden"))
    .toBe("true");
  expect(attribute(githubSvg, "width")).toBe("16");
  expect(attribute(githubSvg, "height")).toBe("16");
  expect(attribute(githubSvg, "data-slot")).toBe("icon");

  const substack = renderToStaticMarkup(
    <SocialIcon name="substack" size={23} />,
  );
  const substackSvg = openingSvg(substack);

  expect(attribute(substackSvg, "width")).toBe("23");
  expect(attribute(substackSvg, "height")).toBe("23");
  expect(attribute(substackSvg, "fill")).toBe("currentColor");
  expect(attribute(substackSvg, "aria-hidden")).toBe("true");
  expect(renderedClasses(substackSvg)).toContain("hraness-icon");
  expect(substack).toContain("M22.539 8.242H1.46V5.406");
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

test("social and appearance wrappers share a caller-last StyleX recipe", () => {
  const socialBase = classesForSlot(
    renderToStaticMarkup(<SocialIcon name="github" />),
    "social-icon",
  );
  const appearanceBase = classesForSlot(
    renderToStaticMarkup(<AppearanceIcon name="system" />),
    "appearance-icon",
  );
  const socialOverride = classesForSlot(
    renderToStaticMarkup(
      <SocialIcon
        className="consumer-social-icon"
        name="github"
        xstyle={testStyles.block}
      />,
    ),
    "social-icon",
  );
  const appearanceOverride = classesForSlot(
    renderToStaticMarkup(
      <AppearanceIcon
        className="consumer-appearance-icon"
        name="system"
        xstyle={testStyles.block}
      />,
    ),
    "appearance-icon",
  );
  const socialBaseGenerated = generatedWrapperClasses(
    socialBase,
    "hraness-social-icon",
  );
  const appearanceBaseGenerated = generatedWrapperClasses(
    appearanceBase,
    "hraness-appearance-icon",
  );
  const socialOverrideGenerated = generatedWrapperClasses(
    socialOverride,
    "hraness-social-icon",
    "consumer-social-icon",
  );
  const appearanceOverrideGenerated = generatedWrapperClasses(
    appearanceOverride,
    "hraness-appearance-icon",
    "consumer-appearance-icon",
  );

  expect(socialBaseGenerated.length).toBeGreaterThan(0);
  expect(appearanceBaseGenerated).toEqual(socialBaseGenerated);
  expect(socialOverrideGenerated).toEqual(appearanceOverrideGenerated);
  expect(socialOverrideGenerated).toHaveLength(socialBaseGenerated.length);
  expect(
    socialOverrideGenerated.filter((name) =>
      socialBaseGenerated.includes(name)),
  ).toHaveLength(socialBaseGenerated.length - 1);
  expect(socialOverride[0]).toBe("hraness-social-icon");
  expect(socialOverride.at(-1)).toBe("consumer-social-icon");
  expect(appearanceOverride[0]).toBe("hraness-appearance-icon");
  expect(appearanceOverride.at(-1)).toBe("consumer-appearance-icon");

  const appearance = renderToStaticMarkup(<AppearanceIcon name="system" />);
  const appearanceSvg = openingSvg(appearance);
  expect(openingTagForSlot(appearance, "appearance-icon")).toStartWith("<span");
  expect(attribute(openingTagForSlot(appearance, "appearance-icon"), "aria-hidden"))
    .toBe("true");
  expect(attribute(appearanceSvg, "width")).toBe("18");
  expect(attribute(appearanceSvg, "height")).toBe("18");
  expect(attribute(appearanceSvg, "data-slot")).toBe("icon");
});
