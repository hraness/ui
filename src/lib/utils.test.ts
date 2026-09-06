import { expect, test } from "bun:test";

import { cn } from "./utils.js";

test("combines conditional class inputs", () => {
  expect(cn("inline-flex", false, null, ["items-center", undefined], {
    "opacity-50": true,
    hidden: false,
  })).toBe("inline-flex items-center opacity-50");
});

test("preserves caller class source order", () => {
  expect(cn("h-9 rounded-md px-3", "h-12 px-6")).toBe(
    "h-9 rounded-md px-3 h-12 px-6",
  );
});

test("keeps distinct React Aria state variants", () => {
  expect(cn(
    "data-[hovered]:bg-primary/90",
    "data-[pressed]:bg-primary/80",
  )).toBe(
    "data-[hovered]:bg-primary/90 data-[pressed]:bg-primary/80",
  );
});
