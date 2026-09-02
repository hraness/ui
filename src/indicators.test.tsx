import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import { Meter, ProgressBar, Slider } from "./indicators.js";
import { indicatorStyles } from "./indicators.stylex.js";

const testStyles = stylex.create({
  dynamicWidth: (width: string) => ({ width }),
  rootOverride: {
    display: "flex",
    gap: "var(--space-8)",
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
  const className = openingTagForSlot(html, slot).match(/class="([^"]+)"/u)?.[1];
  if (className === undefined) throw new Error(`Rendered ${slot} has no class`);
  return className.split(" ");
}

function hasGeneratedClass(
  classes: readonly string[],
  semanticClasses: readonly string[],
  callerClass?: string,
): boolean {
  return classes.some(
    (name) => !semanticClasses.includes(name) && name !== callerClass,
  );
}

test("indicator primitives preserve roles, slots, semantic hooks, and form semantics", () => {
  const progress = renderToStaticMarkup(
    <ProgressBar
      className="consumer-progress"
      data-product="writer"
      label="Upload"
      maxValue={100}
      showValue
      value={25}
    />,
  );
  const indeterminate = renderToStaticMarkup(
    <ProgressBar isIndeterminate label="Loading" showValue />,
  );
  const meter = renderToStaticMarkup(
    <Meter
      className="consumer-meter"
      label="Storage"
      maxValue={100}
      tone="warning"
      value={75}
    />,
  );
  const slider = renderToStaticMarkup(
    <Slider
      className="consumer-slider"
      defaultValue={35}
      label="Volume"
      name="volume"
      thumbLabel="Volume level"
    />,
  );

  expect(openingTagForSlot(progress, "progress-bar")).toContain('role="progressbar"');
  expect(openingTagForSlot(progress, "progress-bar")).toContain(
    'data-product="writer"',
  );
  expect(openingTagForSlot(progress, "progress-bar")).toContain('aria-valuenow="25"');
  expect(openingTagForSlot(progress, "progress-bar-fill")).toContain(
    '--hraness-percentage:25%;width:25%',
  );
  expect(progress).toContain("25%");
  expect(classesForSlot(progress, "progress-bar")[0]).toBe("hraness-progress-bar");
  expect(classesForSlot(progress, "progress-bar").at(-1)).toBe(
    "consumer-progress",
  );

  expect(openingTagForSlot(indeterminate, "progress-bar")).not.toContain(
    "aria-valuenow=",
  );
  expect(openingTagForSlot(indeterminate, "progress-bar-fill")).toContain(
    'data-indeterminate="true"',
  );
  expect(openingTagForSlot(indeterminate, "progress-bar-fill")).toContain(
    '--hraness-percentage:0%;width:0%',
  );
  expect(indeterminate).not.toContain("progress-bar-value");

  expect(openingTagForSlot(meter, "meter")).toContain(
    'role="meter progressbar"',
  );
  expect(openingTagForSlot(meter, "meter")).toContain('data-tone="warning"');
  expect(openingTagForSlot(meter, "meter-fill")).toContain(
    '--hraness-percentage:75%;width:75%',
  );
  expect(classesForSlot(meter, "meter").at(-1)).toBe("consumer-meter");

  expect(openingTagForSlot(slider, "slider")).toContain(
    'data-orientation="horizontal"',
  );
  expect(slider).toContain('aria-label="Volume level"');
  expect(slider).toContain('name="volume"');
  expect(slider).toContain('type="range"');
  expect(classesForSlot(slider, "slider").at(-1)).toBe("consumer-slider");
});

test("indicator primitives attach generated StyleX presentation to every visual slot", () => {
  const progress = renderToStaticMarkup(
    <ProgressBar label="Upload" maxValue={100} showValue value={25} />,
  );
  const meter = renderToStaticMarkup(
    <Meter label="Storage" maxValue={100} tone="danger" value={75} />,
  );
  const slider = renderToStaticMarkup(
    <Slider defaultValue={35} label="Volume" thumbLabel="Volume level" />,
  );
  const sliderFallbackClasses = stylex.props(
    indicatorStyles.sliderThumbNativeFocusFallback,
  ).className?.split(" ") ?? [];

  for (const [html, slot, semanticClasses] of [
    [progress, "progress-bar", ["hraness-progress-bar"]],
    [progress, "progress-bar-header", [
      "hraness-progress-bar__header",
      "hraness-progress-bar__label-row",
    ]],
    [progress, "progress-bar-label", ["hraness-progress-bar__label"]],
    [progress, "progress-bar-value", ["hraness-progress-bar__value"]],
    [progress, "progress-bar-track", ["hraness-progress-bar__track"]],
    [progress, "progress-bar-fill", ["hraness-progress-bar__fill"]],
    [meter, "meter", ["hraness-meter"]],
    [meter, "meter-header", [
      "hraness-meter__header",
      "hraness-meter__label-row",
    ]],
    [meter, "meter-label", ["hraness-meter__label"]],
    [meter, "meter-value", ["hraness-meter__value"]],
    [meter, "meter-track", ["hraness-meter__track"]],
    [meter, "meter-fill", ["hraness-meter__fill"]],
    [slider, "slider", ["hraness-slider"]],
    [slider, "slider-header", ["hraness-slider__label-row"]],
    [slider, "slider-label", ["hraness-slider__label"]],
    [slider, "slider-value", ["hraness-slider__value"]],
    [slider, "slider-track", ["hraness-slider__track"]],
    [slider, "slider-fill", ["hraness-slider__fill"]],
    [slider, "slider-thumb", ["hraness-slider__thumb"]],
    [slider, "slider-thumb-indicator", ["hraness-slider__thumb-indicator"]],
  ] as const) {
    expect(classesForSlot(html, slot).slice(0, semanticClasses.length)).toEqual(
      [...semanticClasses],
    );
    expect(hasGeneratedClass(classesForSlot(html, slot), semanticClasses)).toBe(
      true,
    );
  }
  expect(sliderFallbackClasses).not.toHaveLength(0);
  for (const fallbackClass of sliderFallbackClasses) {
    expect(classesForSlot(slider, "slider-thumb")).toContain(fallbackClass);
  }
});

test("indicator recipes cover every meter tone and both slider orientations", () => {
  const toneClasses = new Map<string, string>();

  for (const tone of ["default", "success", "warning", "danger"] as const) {
    const html = renderToStaticMarkup(
      <Meter label={tone} maxValue={100} tone={tone} value={50} />,
    );
    const fillClasses = classesForSlot(html, "meter-fill").join(" ");
    expect(openingTagForSlot(html, "meter")).toContain(`data-tone="${tone}"`);
    toneClasses.set(tone, fillClasses);
  }

  expect(new Set(toneClasses.values())).toHaveLength(4);

  const horizontal = renderToStaticMarkup(
    <Slider defaultValue={20} label="Horizontal" orientation="horizontal" />,
  );
  const vertical = renderToStaticMarkup(
    <Slider defaultValue={20} label="Vertical" orientation="vertical" />,
  );

  expect(openingTagForSlot(horizontal, "slider")).toContain(
    'data-orientation="horizontal"',
  );
  expect(openingTagForSlot(vertical, "slider")).toContain(
    'data-orientation="vertical"',
  );
  expect(classesForSlot(horizontal, "slider").join(" ")).not.toBe(
    classesForSlot(vertical, "slider").join(" "),
  );
  expect(classesForSlot(horizontal, "slider-track").join(" ")).not.toBe(
    classesForSlot(vertical, "slider-track").join(" "),
  );
  expect(classesForSlot(horizontal, "slider-thumb").join(" ")).not.toBe(
    classesForSlot(vertical, "slider-thumb").join(" "),
  );
});

test("caller StyleX and native styles remain caller-last on indicator roots", () => {
  const progress = renderToStaticMarkup(
    <ProgressBar
      className="consumer-progress"
      label="Upload"
      style={{ width: "7rem" }}
      value={25}
      xstyle={testStyles.dynamicWidth("6rem")}
    />,
  );
  const meter = renderToStaticMarkup(
    <Meter
      className="consumer-meter"
      label="Storage"
      style={() => ({ width: "8rem" })}
      value={50}
      xstyle={testStyles.dynamicWidth("6rem")}
    />,
  );
  const slider = renderToStaticMarkup(
    <Slider
      className="consumer-slider"
      defaultValue={35}
      label="Volume"
      style={() => ({ width: "9rem" })}
      xstyle={testStyles.rootOverride}
    />,
  );

  expect(openingTagForSlot(progress, "progress-bar")).toContain("width:7rem");
  expect(openingTagForSlot(meter, "meter")).toContain("width:8rem");
  expect(openingTagForSlot(slider, "slider")).toContain("width:9rem");
  expect(classesForSlot(progress, "progress-bar").at(-1)).toBe(
    "consumer-progress",
  );
  expect(classesForSlot(meter, "meter").at(-1)).toBe("consumer-meter");
  expect(classesForSlot(slider, "slider").at(-1)).toBe("consumer-slider");
  expect(hasGeneratedClass(
    classesForSlot(progress, "progress-bar"),
    ["hraness-progress-bar"],
    "consumer-progress",
  )).toBe(true);
});
