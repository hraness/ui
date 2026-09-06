import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import * as stylex from "@stylexjs/stylex";

import { motionStyles } from "./motion.stylex.js";

const motionKeys = [
  "fadeIn",
  "fadeOut",
  "overlayEnter",
  "overlayExit",
  "progressIndeterminate",
  "skeleton",
  "spin",
  "toastEnter",
  "toastExit",
] as const;

test("shared motion exposes one compiled recipe for every retained animation", () => {
  expect(Object.keys(motionStyles)).toEqual([...motionKeys]);

  for (const key of motionKeys) {
    const presentation = stylex.props(motionStyles[key]);
    expect(presentation.className).toMatch(/^x/u);
    expect(presentation.style).toBeUndefined();
  }
});

test("shared motion preserves exact geometry outside legacy CSS", async () => {
  const [components, motion] = await Promise.all([
    readFile(new URL("./components.css", import.meta.url), "utf8"),
    readFile(new URL("./motion.stylex.ts", import.meta.url), "utf8"),
  ]);

  expect(components).not.toContain("@keyframes");
  expect(motion.match(/stylex\.keyframes\(/gu)).toHaveLength(9);
  for (const witness of [
    'transform: "rotate(1turn)"',
    'backgroundPosition: "-200% 0"',
    'transform: "translateY(-0.25rem) scale(0.98)"',
    'transform: "translateY(-0.125rem) scale(0.99)"',
    'transform: "translateX(-125%)"',
    'transform: "translateX(250%)"',
    'transform: "translateX(1rem)"',
  ]) expect(motion).toContain(witness);
  expect(motion.match(/opacity: 0/gu)).toHaveLength(6);
  expect(motion.match(/\[reducedMotion\]: "none"/gu)).toHaveLength(9);
});

test("every motion consumer composes the shared recipe at its render boundary", async () => {
  const sources = await Promise.all([
    readFile(new URL("./actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("./feedback.tsx", import.meta.url), "utf8"),
    readFile(new URL("./indicators.tsx", import.meta.url), "utf8"),
    readFile(new URL("./overlays.tsx", import.meta.url), "utf8"),
    readFile(new URL("./select-field.tsx", import.meta.url), "utf8"),
    readFile(new URL("./toast.tsx", import.meta.url), "utf8"),
  ]);
  const joined = sources.join("\n");

  for (const usage of [
    "motionStyles.fadeIn",
    "motionStyles.fadeOut",
    "motionStyles.overlayEnter",
    "motionStyles.overlayExit",
    "motionStyles.progressIndeterminate",
    "motionStyles.skeleton",
    "motionStyles.spin",
    "motionStyles.toastEnter",
  ]) expect(joined).toContain(usage);
  expect(joined).not.toContain("motionStyles.toastExit");

  const recipeSources = await Promise.all([
    "actions",
    "dialog",
    "feedback",
    "indicators",
    "menu",
    "overlays",
    "select-field",
    "toast",
  ].map(async (name) => await readFile(
    new URL(`./${name}.stylex.ts`, import.meta.url),
    "utf8",
  )));
  expect(recipeSources.join("\n")).not.toContain("animationName:");
});
