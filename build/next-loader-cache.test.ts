import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "bun:test";

type LoaderContext = Readonly<{ cacheable: (value: boolean) => void; async: () => never }>;
const loader = createRequire(import.meta.url)("./next-loader.cjs") as {
  call(context: LoaderContext, source: Buffer, map: unknown): void;
  raw: boolean;
};

test("each Next loader invocation disables module caching before receipt-producing work", () => {
  assert.equal(loader.raw, true);
  const enteredAsync = new Error("fixture reached async boundary");
  for (const attempt of ["first", "repeat"]) {
    const events: string[] = [];
    assert.throws(() => loader.call({
      cacheable(value) { assert.equal(value, false); events.push("noncacheable"); },
      async() { events.push("async"); throw enteredAsync; },
    }, Buffer.from(`export const attempt = ${JSON.stringify(attempt)};`), null), (error) => error === enteredAsync);
    assert.deepEqual(events, ["noncacheable", "async"]);
  }
});
