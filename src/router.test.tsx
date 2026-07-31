import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Link } from "./actions.js";
import { isPrefetchableHref, RouterProvider } from "./router.js";

test("router prefetch is limited to owned application paths", () => {
  expect(isPrefetchableHref("/account")).toBe(true);
  expect(isPrefetchableHref("/inbox?view=open#latest")).toBe(true);
  expect(isPrefetchableHref("//cdn.example.com/asset")).toBe(false);
  expect(isPrefetchableHref("https://example.com/account")).toBe(false);
  expect(isPrefetchableHref("#main-content")).toBe(false);
  expect(isPrefetchableHref(undefined)).toBe(false);
});

test("the router provider preserves semantic links during server rendering", () => {
  const html = renderToStaticMarkup(
    <RouterProvider navigate={() => undefined} prefetch={() => undefined}>
      <Link href="/account">Account</Link>
    </RouterProvider>,
  );

  expect(html).toContain("<a");
  expect(html).toContain('class="hraness-link"');
  expect(html).toContain('href="/account"');
});
