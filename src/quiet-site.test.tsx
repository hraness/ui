import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { QuietSiteFooter, QuietSitePage } from "./quiet-site.js";

test("quiet-site landmarks share stable slots and consumer classes", () => {
  const html = renderToStaticMarkup(
    <>
      <QuietSitePage className="personal-index">
        <h1>Writer</h1>
      </QuietSitePage>
      <QuietSiteFooter className="personal-footer">
        <span>Appearance</span>
      </QuietSiteFooter>
    </>,
  );

  expect(html).toContain(
    'class="hraness-quiet-site-page personal-index" data-slot="quiet-site-page"',
  );
  expect(html).toContain(
    'class="hraness-quiet-site-footer personal-footer" data-slot="quiet-site-footer"',
  );
  expect(html).toContain("<main");
  expect(html).toContain("<footer");
});

test("quiet-site CSS keeps the footer centered on the page measure", async () => {
  const css = await Bun.file(new URL("./components.css", import.meta.url)).text();

  expect(css).toMatch(
    /\.hraness-quiet-site-page\s*\{[^}]*max-inline-size:\s*var\(--hraness-quiet-site-measure,[^}]*margin-inline:\s*auto;/su,
  );
  expect(css).toMatch(
    /\.hraness-quiet-site-footer\s*\{[^}]*max-inline-size:\s*var\(--hraness-quiet-site-measure,[^}]*margin-inline:\s*auto;/su,
  );
  expect(css).toMatch(
    /\.hraness-quiet-site-page\s*\{[^}]*margin-block:\s*clamp\(2rem, 6vh, 4rem\) clamp\(3\.5rem, 10vh, 6rem\);/su,
  );
  expect(css).toContain("env(safe-area-inset-bottom)");
});
