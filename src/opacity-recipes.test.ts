import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { colorMixExpressions, opacityRecipes, requireHuePreservingOpacity } from "../scripts/opacity-recipes.ts";

function paintFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return paintFiles(path);
    return entry.name.endsWith(".css") || entry.name.endsWith(".stylex.ts") ? [path] : [];
  });
}

test("portable and compiled opacity recipes retain source hue", () => {
  const files = paintFiles(import.meta.dir);
  let count = 0;
  for (const file of files) count += requireHuePreservingOpacity(readFileSync(file, "utf8")).length;
  expect(files.length).toBeGreaterThan(20);
  expect(count).toBeGreaterThanOrEqual(29);
  const tokens = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
  expect(requireHuePreservingOpacity(tokens)).toHaveLength(13);
  expect(tokens).toContain("--ui-surface-light: color-mix(in oklch, var(--ui-card) 94%, white)");
  expect(tokens).toContain("--ui-surface-shade: color-mix(in oklch, var(--ui-background) 55%, black)");
});

test("opacity parsing preserves nested two-paint blends and rejects opacity regressions", () => {
  for (let depth = 0; depth <= 12; depth++) {
    let color = "#16161e";
    for (let level = 0; level < depth; level++) color = `var(--role-${level}, ${color})`;
    for (const percentage of [5, 24, 55, 90]) {
      const alpha = `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
      expect(requireHuePreservingOpacity(alpha)).toHaveLength(1);
      expect(() => requireHuePreservingOpacity(alpha.replace("in srgb", "in oklch"))).toThrow("must use srgb");
      const colored = `color-mix(in oklch, ${color} ${percentage}%, #f0f1f8)`;
      expect(opacityRecipes(colored)).toEqual([]);
      expect(colorMixExpressions(colored)[0]?.expression).toBe(colored);
    }
  }
  expect(() => requireHuePreservingOpacity("color-mix(in oklch, transparent 20%, currentColor)")).toThrow("must use srgb");
  expect(() => colorMixExpressions("color-mix(in srgb, var(--color), transparent")).toThrow("Incomplete");
  expect(() => colorMixExpressions("color-mix(in srgb, red)")).toThrow("Malformed");
});
