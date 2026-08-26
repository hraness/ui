import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import { QuietSiteFooter, QuietSitePage } from "./quiet-site.js";

const testStyles = stylex.create({
  dynamicFooter: (paddingTop: string) => ({ paddingTop }),
  dynamicPage: (inlineSize: string) => ({ "inline-size": inlineSize }),
  footerOverride: {
    display: "grid",
  },
  pageOverride: {
    "max-inline-size": "40rem",
  },
});

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
  const tag = openingTagForSlot(html, slot);
  const className = tag.match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error(`Rendered ${slot} has no class`);
  return className.split(" ");
}

function generatedClasses(
  classes: readonly string[],
  semanticClass: string,
  callerClass?: string,
): string[] {
  return classes.filter(
    (name) => name !== semanticClass && name !== callerClass,
  );
}

test("quiet-site landmarks preserve native elements, attributes, slots, and classes", () => {
  const html = renderToStaticMarkup(
    <>
      <QuietSitePage
        aria-label="Personal index"
        className="personal-index"
        data-product="writer"
        id="writer-main"
        lang="en"
        style={{ backgroundColor: "rgb(1, 2, 3)" }}
        title="Writer"
      >
        <h1>Writer</h1>
      </QuietSitePage>
      <QuietSiteFooter
        aria-label="Personal footer"
        className="personal-footer"
        data-product="writer"
        id="writer-footer"
        style={{ paddingTop: "3rem" }}
        title="Appearance controls"
      >
        <span>Appearance</span>
      </QuietSiteFooter>
    </>,
  );
  const pageTag = openingTagForSlot(html, "quiet-site-page");
  const footerTag = openingTagForSlot(html, "quiet-site-footer");
  const pageClasses = classesForSlot(html, "quiet-site-page");
  const footerClasses = classesForSlot(html, "quiet-site-footer");

  expect(pageTag).toStartWith("<main");
  expect(footerTag).toStartWith("<footer");
  expect(pageClasses[0]).toBe("hraness-quiet-site-page");
  expect(pageClasses.at(-1)).toBe("personal-index");
  expect(footerClasses[0]).toBe("hraness-quiet-site-footer");
  expect(footerClasses.at(-1)).toBe("personal-footer");
  expect(generatedClasses(pageClasses, "hraness-quiet-site-page", "personal-index").length)
    .toBeGreaterThan(0);
  expect(generatedClasses(footerClasses, "hraness-quiet-site-footer", "personal-footer").length)
    .toBeGreaterThan(0);
  expect(pageTag).toContain('aria-label="Personal index"');
  expect(pageTag).toContain('data-product="writer"');
  expect(pageTag).toContain('id="writer-main"');
  expect(pageTag).toContain('lang="en"');
  expect(pageTag).toContain('style="background-color:rgb(1, 2, 3)"');
  expect(pageTag).toContain('title="Writer"');
  expect(footerTag).toContain('aria-label="Personal footer"');
  expect(footerTag).toContain('data-product="writer"');
  expect(footerTag).toContain('id="writer-footer"');
  expect(footerTag).toContain('style="padding-top:3rem"');
  expect(footerTag).toContain('title="Appearance controls"');
});

test("quiet-site landmarks apply typed caller StyleX recipes last", () => {
  const pageBase = classesForSlot(
    renderToStaticMarkup(<QuietSitePage>Page</QuietSitePage>),
    "quiet-site-page",
  );
  const pageOverride = classesForSlot(
    renderToStaticMarkup(
      <QuietSitePage className="consumer-page" xstyle={testStyles.pageOverride}>
        Page
      </QuietSitePage>,
    ),
    "quiet-site-page",
  );
  const footerBase = classesForSlot(
    renderToStaticMarkup(<QuietSiteFooter>Footer</QuietSiteFooter>),
    "quiet-site-footer",
  );
  const footerOverride = classesForSlot(
    renderToStaticMarkup(
      <QuietSiteFooter
        className="consumer-footer"
        xstyle={testStyles.footerOverride}
      >
        Footer
      </QuietSiteFooter>,
    ),
    "quiet-site-footer",
  );
  const pageBaseGenerated = generatedClasses(
    pageBase,
    "hraness-quiet-site-page",
  );
  const pageOverrideGenerated = generatedClasses(
    pageOverride,
    "hraness-quiet-site-page",
    "consumer-page",
  );
  const footerBaseGenerated = generatedClasses(
    footerBase,
    "hraness-quiet-site-footer",
  );
  const footerOverrideGenerated = generatedClasses(
    footerOverride,
    "hraness-quiet-site-footer",
    "consumer-footer",
  );

  expect(pageOverrideGenerated).toHaveLength(pageBaseGenerated.length);
  expect(
    pageOverrideGenerated.filter((name) => pageBaseGenerated.includes(name)),
  ).toHaveLength(pageBaseGenerated.length - 1);
  expect(footerOverrideGenerated).toHaveLength(footerBaseGenerated.length);
  expect(
    footerOverrideGenerated.filter((name) => footerBaseGenerated.includes(name)),
  ).toHaveLength(footerBaseGenerated.length - 1);
  expect(pageOverride[0]).toBe("hraness-quiet-site-page");
  expect(pageOverride.at(-1)).toBe("consumer-page");
  expect(footerOverride[0]).toBe("hraness-quiet-site-footer");
  expect(footerOverride.at(-1)).toBe("consumer-footer");
});

test("caller inline styles win while dynamic StyleX values survive the merge", () => {
  const pageTag = openingTagForSlot(
    renderToStaticMarkup(
      <QuietSitePage
        style={{ inlineSize: "29rem", minBlockSize: "7rem" }}
        xstyle={testStyles.dynamicPage("28rem")}
      >
        Page
      </QuietSitePage>,
    ),
    "quiet-site-page",
  );
  const footerTag = openingTagForSlot(
    renderToStaticMarkup(
      <QuietSiteFooter
        style={{ backgroundColor: "rgb(1, 2, 3)", paddingTop: "3rem" }}
        xstyle={testStyles.dynamicFooter("2rem")}
      >
        Footer
      </QuietSiteFooter>,
    ),
    "quiet-site-footer",
  );
  const pageStyle = pageTag.match(/style="([^"]+)"/u)?.[1] ?? "";
  const footerStyle = footerTag.match(/style="([^"]+)"/u)?.[1] ?? "";

  expect(pageStyle).toMatch(/--[^:]+:28rem/u);
  expect(pageStyle).toContain("inline-size:29rem");
  expect(pageStyle).toContain("min-block-size:7rem");
  expect(pageStyle.indexOf("--")).toBeLessThan(pageStyle.indexOf("inline-size:29rem"));
  expect(footerStyle).toMatch(/--[^:]+:2rem/u);
  expect(footerStyle).toContain("background-color:rgb(1, 2, 3)");
  expect(footerStyle).toContain("padding-top:3rem");
  expect(footerStyle.indexOf("--")).toBeLessThan(footerStyle.indexOf("padding-top:3rem"));
});
