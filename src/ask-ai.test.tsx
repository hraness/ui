import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AskAiAboutThis,
  askAiProviders,
  buildAskAiProviderLinks,
} from "./index.js";

const subjectUrl = "https://hraness.com/stripe?view=timeline#launch";
const prompt = `Tell me about ${subjectUrl}`;

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
  expect(html.match(/aria-hidden="true"/gu)).toHaveLength(4);
  for (const label of ["ChatGPT", "Claude", "Perplexity", "Grok"]) {
    expect(html).toContain(label);
  }
  expect(html).not.toContain("onClick");
  expect(html).not.toContain("javascript:");
});

test("the component validates before rendering any provider markup", () => {
  expect(() =>
    renderToStaticMarkup(
      <AskAiAboutThis url="ftp://hraness.com/stripe" />,
    ),
  ).toThrow("must use HTTPS");
});
