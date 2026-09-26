import assert from "node:assert/strict";
import type { Browser, Page } from "playwright-core";
import { requireHuePreservingOpacity } from "./opacity-recipes.ts";

function recipes(source: string) {
  const values = requireHuePreservingOpacity(source).map(recipe => {
    const match = /^var\((--[a-z-]+)\) (\d+)%$/u.exec(recipe.operands[0] ?? "");
    assert(match?.[1] && match[2] && recipe.operands[1] === "transparent", "Every token opacity recipe must have a checked semantic source and percentage");
    return { expression: recipe.expression, role: match[1], opacity: Number(match[2]) / 100 };
  });
  assert.equal(values.length, 13, "All edge, divider and four elevation roles must be covered");
  return values;
}

async function samples(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("Native raster context required");
    const paint = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    return [...document.querySelectorAll<HTMLElement>("[data-opacity]")].map(node => {
      const style = getComputedStyle(node);
      const source = node.querySelector<HTMLElement>("span");
      if (!source) throw Error("Missing opaque source probe");
      const sourceColor = getComputedStyle(source).backgroundColor;
      if (!CSS.supports("color", style.backgroundColor) || !CSS.supports("color", sourceColor)) throw Error("Invalid observed color");
      const opaque = paint(sourceColor), alpha = paint(style.backgroundColor)[3];
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "rgb(255 255 255)"; context.fillRect(0, 0, 1, 1);
      context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
      return { id: node.id, opacity: Number(node.dataset.opacity), computed: style.backgroundColor, opaque, alpha, composite: [...context.getImageData(0, 0, 1, 1).data] };
    });
  });
}

/** Actual portable token rules, native alpha and paint, with the old formula as a counterfactual. */
export async function verifyPortableOpacity(browser: Browser, tokens: string) {
  const all = recipes(tokens);
  const original = tokens.replaceAll("color-mix(in srgb,", "color-mix(in oklch,");
  assert.throws(() => recipes(original), /must use srgb/u);
  const cases = [];
  for (const theme of ["light", "dark"] as const) for (const tint of ["default", "blue"] as const) {
    const page = await browser.newPage({ viewport: { width: 480, height: 640 }, colorScheme: theme });
    page.setDefaultTimeout(5000);
    const override = tint === "blue" ? "--ui-background:#1a1b26;--ui-card:#16161e;--ui-border:#16161e" : "";
    const markup = (source: string, legacy = false) => `<!doctype html><html data-theme="${theme}"><head><style>${source}
      #island{${override}}[data-opacity]{width:200px;height:12px}
      ${all.map((recipe, index) => `#sample-${index}{background-color:${legacy ? recipe.expression.replace("in srgb,", "in oklch,") : recipe.expression}}#sample-${index}>span{background-color:var(${recipe.role})}`).join("\n")}
      #edge{background-color:var(--ui-surface-edge)}#edge>span{background-color:var(--ui-border)}
      #divider{background-color:var(--ui-divider)}#divider>span{background-color:var(--ui-border)}
      </style></head><body><section id="island" data-palette="fixture">
      ${all.map((recipe, index) => `<div id="sample-${index}" data-opacity="${recipe.opacity}"><span></span></div>`).join("")}
      <div id="edge" data-opacity=".28"><span></span></div><div id="divider" data-opacity=".55"><span></span></div>
      ${["low", "raised", "overlay", "inset"].map(role => `<div data-depth="${role}" style="box-shadow:var(--elevation-${role})"></div>`).join("")}
      </section></body></html>`;
    try {
      await page.setContent(markup(tokens));
      const actual = await samples(page);
      assert.equal(actual.length, 15);
      for (const sample of actual) {
        assert.equal(sample.opaque[3], 255, "The semantic source must be opaque");
        assert(sample.alpha !== undefined && Math.abs(sample.alpha - 255 * sample.opacity) <= 1, "Native alpha must match the unchanged percentage");
        sample.composite.forEach((channel, index) => {
          const opaque = sample.opaque[index]; assert(opaque !== undefined);
          const expected = index === 3 ? 255 : Math.round(opaque * sample.opacity + 255 * (1 - sample.opacity));
          assert(Math.abs(channel - expected) <= 2, `${theme}/${tint}/${sample.id}: source hue changed (${sample.composite} vs ${sample.opaque})`);
        });
      }
      const depth = await page.locator("[data-depth]").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).boxShadow));
      assert.equal(depth.length, 4); assert(depth.every(value => value !== "none"), "All four actual elevation roles must paint");
      await page.setContent(markup(original, true));
      const negative = await samples(page);
      const hueLoss = negative.filter(sample => sample.composite.some((channel, index) => {
        const opaque = sample.opaque[index]; assert(opaque !== undefined);
        const expected = index === 3 ? 255 : Math.round(opaque * sample.opacity + 255 * (1 - sample.opacity));
        return Math.abs(channel - expected) > 2;
      })).map(sample => sample.id);
      await page.setContent(markup(tokens));
      await page.emulateMedia({ forcedColors: "active" });
      const forced = await page.evaluate(() => {
        const island = document.querySelector("#island"); if (!island) throw Error("Missing theme boundary");
        const style = getComputedStyle(island);
        return { edge: style.getPropertyValue("--ui-surface-edge").trim(), divider: style.getPropertyValue("--ui-divider").trim(), depth: [...document.querySelectorAll("[data-depth]")].map(node => getComputedStyle(node).boxShadow), active: matchMedia("(forced-colors: active)").matches };
      });
      assert(forced.active); assert.equal(forced.edge, "CanvasText"); assert.equal(forced.divider, "CanvasText"); assert(forced.depth.every(value => value === "none"));
      cases.push({ theme, tint, actual, negative, hueLoss, depth, forced });
    } finally { await page.close(); }
  }
  assert.equal(cases.length, 4);
  return { browser: browser.version(), tokenRecipes: all.length, cases, observedLegacyHueLoss: cases.reduce((sum, entry) => sum + entry.hueLoss.length, 0) };
}
