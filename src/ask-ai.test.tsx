import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import type { StylexPackageManifestV1 } from "../build/contracts.js";
import { askAiProviderMarks } from "./ask-ai-marks.generated.js";
import {
  AskAiAboutThis,
  askAiProviders,
  buildAskAiProviderLinks,
} from "./index.js";

const subjectUrl = "https://hraness.com/stripe?view=timeline#launch";
const prompt = `Tell me about ${subjectUrl}`;
const compiledCss = await Bun.file(
  new URL("../dist/stylex.css", import.meta.url),
).text();
const compiledManifest: StylexPackageManifestV1 = await Bun.file(
  new URL("../dist/stylex-manifest.json", import.meta.url),
).json();
const testStyles = stylex.create({
  dynamicGap: (gap: string) => ({ gap }),
});

function attribute(tag: string, name: string): string | undefined {
  return tag
    .match(new RegExp(`${name}="([^"]+)"`, "u"))?.[1]
    ?.replaceAll("&amp;", "&");
}

test("provider links preserve their order, endpoints, parameters, and literal subject URL", () => {
  const links = buildAskAiProviderLinks(subjectUrl);

  expect(askAiProviders).toEqual([
    "chatgpt",
    "claude",
    "perplexity",
    "grok",
  ]);
  expect(links.map((link) => link.provider)).toEqual([...askAiProviders]);
  expect(links.map((link) => link.label)).toEqual([
    "ChatGPT",
    "Claude",
    "Perplexity",
    "Grok",
  ]);

  const destinations = links.map((link) => new URL(link.href));
  expect(
    destinations.map(
      (destination) => `${destination.origin}${destination.pathname}`,
    ),
  ).toEqual([
    "https://chatgpt.com/",
    "https://claude.ai/new",
    "https://perplexity.ai/",
    "https://x.com/i/grok",
  ]);
  expect(
    destinations.map((destination) =>
      destination.searchParams.get(
        destination.hostname === "x.com" ? "text" : "q",
      ),
    ),
  ).toEqual([prompt, prompt, prompt, prompt]);
  for (const destination of destinations) {
    expect(destination.searchParams.size).toBe(1);
  }
});

test("provider links reject relative, non-HTTPS, credentialed, and malformed subjects", () => {
  for (const value of [
    "/stripe",
    "hraness.com/stripe",
    "http://hraness.com/stripe",
    "mailto:hello@hraness.com",
    "https://user:secret@hraness.com/stripe",
    " https://hraness.com/stripe",
    "https://hraness.com/a path",
    "https://hraness.com/%ZZ",
    "https:hraness.com/stripe",
    "https://",
  ]) {
    expect(() => buildAskAiProviderLinks(value)).toThrow();
  }
});

test("AskAiAboutThis renders deterministic accessible server markup and real anchors", () => {
  const html = renderToStaticMarkup(
    <AskAiAboutThis
      className="content-ai-links"
      data-content-kind="essay"
      style={{ marginTop: "1rem" }}
      url={subjectUrl}
    />,
  );
  const navTag = html.slice(0, html.indexOf(">") + 1);
  const anchorTags = [...html.matchAll(/<a\b[^>]*>/gu)].map(
    (match) => match[0],
  );

  expect(navTag).toStartWith("<nav");
  expect(navTag).toContain('aria-label="Ask AI about this"');
  expect(navTag).toContain('data-slot="ask-ai-about-this"');
  expect(navTag).toContain('data-content-kind="essay"');
  expect(navTag).toContain("hraness-ask-ai-about-this");
  expect(navTag).toContain("content-ai-links");
  expect(navTag).toContain('style="margin-top:1rem"');
  expect(html).toContain('data-slot="ask-ai-about-this-links"');
  expect(html).toContain(">Ask AI about this</span>");
  expect(anchorTags).toHaveLength(4);

  const expectedLinks = buildAskAiProviderLinks(subjectUrl);
  for (const [index, anchorTag] of anchorTags.entries()) {
    const link = expectedLinks[index];
    expect(link).toBeDefined();
    expect(attribute(anchorTag, "data-ask-ai-provider")).toBe(link?.provider);
    expect(attribute(anchorTag, "href")).toBe(link?.href);
    expect(attribute(anchorTag, "target")).toBe("_blank");
    expect(attribute(anchorTag, "rel")).toBe("noopener noreferrer nofollow");
  }

  expect(html.match(/data-slot="ask-ai-about-this-icon"/gu)).toHaveLength(4);
  // Each link carries a decorative tile plus its glyph, and color artwork
  // when the registry publishes it (OpenAI and xAI ship glyph-only).
  expect(html.match(/aria-hidden="true"/gu)).toHaveLength(10);
  expect(html.match(/__icon-glyph/gu)).toHaveLength(4);
  expect(html.match(/__icon-art/gu)).toHaveLength(2);
  for (const label of ["ChatGPT", "Claude", "Perplexity", "Grok"]) {
    expect(html).toContain(label);
  }
  expect(html).not.toContain("onClick");
  expect(html).not.toContain("javascript:");
});

test("AskAiAboutThis default server markup has no inline styling", () => {
  const html = renderToStaticMarkup(<AskAiAboutThis url={subjectUrl} />);

  expect(html.match(/\sstyle=/gu) ?? []).toEqual([]);
  expect(html.match(/<style\b/gu) ?? []).toEqual([]);
});

test("provider icons keep their compiled accent paints and forced-color overrides", () => {
  const html = renderToStaticMarkup(<AskAiAboutThis url={subjectUrl} />);
  const iconTags = html.match(
    /<span\b[^>]*data-slot="ask-ai-about-this-icon"[^>]*>/gu,
  ) ?? [];
  const expectedAccents = {
    chatgpt: "#0f1014",
    claude: "#d97757",
    perplexity: "#22b8cd",
    grok: "#1a1a1a",
  } as const;

  expect(iconTags).toHaveLength(askAiProviders.length);
  for (const [index, provider] of askAiProviders.entries()) {
    const classes = (attribute(iconTags[index] ?? "", "class") ?? "")
      .split(/\s+/u);
    const rules = compiledManifest.rules.filter(([name]) => classes.includes(name));
    const accent = expectedAccents[provider];
    const paints = {
      "background-color": `color-mix(in srgb, ${accent} 14%, var(--ui-background))`,
      "background-image": `linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 48%), linear-gradient(160deg, color-mix(in srgb, ${accent} 26%, transparent), color-mix(in srgb, ${accent} 6%, transparent) 74%)`,
      color: `light-dark(color-mix(in srgb, ${accent} 78%, black), color-mix(in srgb, ${accent} 55%, white))`,
      outline: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
    };
    const forcedColorPaints = {
      "background-color": "Canvas",
      "background-image": "none",
      outline: "1px solid ButtonBorder",
    };

    for (const [condition, declarations] of [
      [".", paints],
      ["@media(forced-colors:active)", forcedColorPaints],
    ] as const) {
      for (const [property, value] of Object.entries(declarations)) {
        const declaration = `${property}:${value}`.replace(/\s+/gu, "");
        const matches = rules.filter(([, rule]) => {
          const css = rule.ltr.replace(/\s+/gu, "");
          return css.startsWith(condition) && css.includes(declaration);
        });
        expect(matches).toHaveLength(1);
        for (const [name] of matches) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          expect(new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])[^{}]*\\{`, "u")
            .test(compiledCss)).toBe(true);
        }
      }
    }
    expect(askAiProviderMarks[provider].accent).toBe(accent);
  }
});

test("caller root styles remain final after dynamic StyleX values", () => {
  const html = renderToStaticMarkup(
    <AskAiAboutThis
      style={{ gap: "2rem", marginTop: "3rem" }}
      url={subjectUrl}
      xstyle={testStyles.dynamicGap("1rem")}
    />,
  );
  const navTag = html.slice(0, html.indexOf(">") + 1);
  const rootStyle = attribute(navTag, "style") ?? "";

  expect(rootStyle).toMatch(/--[^:]+:1rem/u);
  expect(rootStyle).toContain("gap:2rem");
  expect(rootStyle).toContain("margin-top:3rem");
  expect(rootStyle.indexOf("--")).toBeLessThan(rootStyle.indexOf("gap:2rem"));
});

test("the component validates before rendering any provider markup", () => {
  expect(() =>
    renderToStaticMarkup(
      <AskAiAboutThis url="ftp://hraness.com/stripe" />,
    ),
  ).toThrow("must use HTTPS");
});
