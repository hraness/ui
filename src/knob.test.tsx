import { expect, test } from "bun:test";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { renderToStaticMarkup } from "react-dom/server";

import { Knob, type KnobProps } from "./index.js";
import {
  beginKnobGesture,
  cancelKnobGesture,
  clampKnobValue,
  constrainKnobGestureMove,
  createKnobFrameQueue,
  endKnobGesture,
  knobMovementDelta,
  knobValuePercentage,
  moveKnobGesture,
  quantizeKnobValue,
  resolveKnobTouchIntent,
} from "./knob-model.js";
import { knobStyles } from "./knob.stylex.js";
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

const consumerStyles = stylex.create({
  controlOverride: {
    backgroundColor: "var(--ui-card)",
    outlineColor: "var(--ui-warning)",
  },
  dynamicWidth: (width: string) => ({ width }),
  rootOverride: {
    display: "flex",
    gap: "var(--space-6)",
  },
});

const typedKnob: KnobProps = {
  controlXstyle: consumerStyles.controlOverride,
  defaultValue: 50,
  label: "Typed knob",
  xstyle: consumerStyles.rootOverride,
};
const rawKnobXstyle: KnobProps = {
  defaultValue: 50,
  label: "Invalid",
  // @ts-expect-error Knob xstyle accepts compiled recipes, not raw CSS objects.
  xstyle: { display: "flex" },
};
void [rawKnobXstyle, typedKnob];

function openingTag(markup: string, slot: string): string {
  const match = markup.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`, "u"));
  if (match === null) throw new Error(`Missing ${slot} opening tag`);
  return match[0];
}

function classNames(tag: string): string[] {
  return tag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
}

test("knob renders one labelled native range with formatted value and form ownership", () => {
  const html = renderToStaticMarkup(
    <Knob
      className="product-knob"
      controlClassName="product-control"
      form="mixer"
      formatOptions={{ maximumFractionDigits: 1, style: "percent" }}
      label="Pan"
      max={1}
      min={-1}
      name="pan"
      step={0.1}
      touchPan="horizontal"
      value={0.3}
    />,
  );

  expect(classNames(openingTag(html, "knob"))[0]).toBe("hraness-knob");
  expect(classNames(openingTag(html, "knob")).at(-1)).toBe("product-knob");
  expect(classNames(openingTag(html, "knob-control"))[0]).toBe(
    "hraness-knob__control",
  );
  expect(classNames(openingTag(html, "knob-control")).at(-1)).toBe(
    "product-control",
  );
  expect(openingTag(html, "knob-control")).toContain("touch-action:pan-x");
  expect(html).toContain('data-slot="knob-label"');
  expect(html).toContain(">Pan</label>");
  expect(html).toContain('type="range"');
  expect(html).toContain('aria-orientation="horizontal"');
  expect(html).toContain('aria-valuetext="30%"');
  expect(html).toContain('min="-1"');
  expect(html).toContain('max="1"');
  expect(html).toContain('step="0.1"');
  expect(html).toContain('value="0.3"');
  expect(html).toContain('name="pan"');
  expect(html).toContain('form="mixer"');
  expect(html).toContain('data-touch-pan="horizontal"');
  expect(html).toContain('data-slot="knob-value"');
  expect(html).toContain(">30%</output>");
});

test("knob renders its 270 degree dial at the normalized value", () => {
  const html = renderToStaticMarkup(
    <Knob defaultValue={25} density="compact" label="Drive" />,
  );

  expect(html).toContain('data-density="compact"');
  expect(openingTag(html, "knob-control")).toContain(
    'data-focus-indicator="true"',
  );
  expect(openingTag(html, "knob-dial")).not.toContain(
    'data-focus-indicator="true"',
  );
  expect(html).toContain('data-slot="knob-dial"');
  expect(html).toContain('stroke-dasharray="75 25"');
  expect(html).toContain('stroke-dasharray="18.75 100"');
  expect(html).toContain('transform="rotate(202.5 24 24)"');
  expect(html).toContain('data-slot="knob-gesture"');
});

test("knob recipes keep caller StyleX local and native thumb geometry last", () => {
  const defaultHtml = renderToStaticMarkup(
    <Knob defaultValue={25} label="Default knob" />,
  );
  const overrideHtml = renderToStaticMarkup(
    <Knob
      className="consumer-root"
      controlClassName="consumer-control"
      controlXstyle={consumerStyles.controlOverride}
      defaultValue={25}
      label="Override knob"
      style={{ width: "15rem" }}
      xstyle={[
        consumerStyles.rootOverride,
        consumerStyles.dynamicWidth("14rem"),
      ]}
    />,
  );
  const defaultControlClasses = classNames(
    openingTag(defaultHtml, "knob-control"),
  );
  const root = openingTag(overrideHtml, "knob");
  const rootClasses = classNames(root);
  const control = openingTag(overrideHtml, "knob-control");
  const controlClasses = classNames(control);
  const thumb = openingTag(overrideHtml, "knob-thumb");
  const dialClasses = classNames(openingTag(overrideHtml, "knob-dial"));
  const gestureClasses = classNames(openingTag(overrideHtml, "knob-gesture"));
  const fallbackClasses = stylex.props(
    knobStyles.controlNativeFocus,
  ).className?.split(" ") ?? [];
  const rootCallerClasses = stylex.props(
    consumerStyles.rootOverride,
    consumerStyles.dynamicWidth("14rem"),
  ).className?.split(" ") ?? [];
  const controlCallerClasses = stylex.props(
    consumerStyles.controlOverride,
  ).className?.split(" ") ?? [];

  expect(rootClasses[0]).toBe("hraness-knob");
  expect(rootClasses.at(-1)).toBe("consumer-root");
  expect(controlClasses[0]).toBe("hraness-knob__control");
  expect(controlClasses.at(-1)).toBe("consumer-control");
  expect(root).toMatch(/style="--[^:]+:14rem;width:15rem"/u);
  expect(fallbackClasses).not.toHaveLength(0);
  for (const fallbackClass of fallbackClasses) {
    expect(defaultControlClasses).toContain(fallbackClass);
    expect(controlClasses).not.toContain(fallbackClass);
  }
  for (const callerClass of rootCallerClasses) {
    expect(rootClasses).toContain(callerClass);
    expect(controlClasses).not.toContain(callerClass);
  }
  for (const callerClass of controlCallerClasses) {
    expect(controlClasses).toContain(callerClass);
    expect(rootClasses).not.toContain(callerClass);
    expect(dialClasses).not.toContain(callerClass);
    expect(gestureClasses).not.toContain(callerClass);
  }
  expect(thumb).toContain(
    'style="position:absolute;left:0;transform:none;touch-action:none;height:100%;top:0;width:100%"',
  );
  expect(overrideHtml).toContain('type="range"');
  expect(overrideHtml).toContain('aria-orientation="horizontal"');
});

test("empty control overrides retain the native focus fallback", () => {
  const fallbackClasses = stylex.props(
    knobStyles.controlNativeFocus,
  ).className?.split(" ") ?? [];
  const emptyOverrides: readonly StyleXStyles[] = [
    false,
    null,
    undefined,
    [],
    [false, null, undefined],
  ];

  expect(fallbackClasses).not.toHaveLength(0);
  for (const controlXstyle of emptyOverrides) {
    const controlClasses = classNames(openingTag(
      renderToStaticMarkup(
        <Knob
          controlXstyle={controlXstyle}
          defaultValue={25}
          label="Conditional knob"
        />,
      ),
      "knob-control",
    ));
    for (const fallbackClass of fallbackClasses) {
      expect(controlClasses).toContain(fallbackClass);
    }
  }
});

test("knob finite recipes preserve compact, touch-pan, and disabled boundaries", () => {
  const html = renderToStaticMarkup(
    <Knob
      defaultValue={25}
      density="compact"
      disabled
      label="Compact knob"
      touchPan="horizontal"
    />,
  );
  const controlClasses = classNames(openingTag(html, "knob-control"));
  const gestureClasses = classNames(openingTag(html, "knob-gesture"));
  const dialClasses = classNames(openingTag(html, "knob-dial"));
  const expectedControlClasses = stylex.props(
    knobStyles.control,
    knobStyles.controlHorizontalTouchPan,
    knobStyles.controlDisabled,
    knobStyles.controlNativeFocus,
  ).className?.split(" ") ?? [];
  const expectedGestureClasses = stylex.props(
    knobStyles.gesture,
    knobStyles.gestureHorizontalTouchPan,
    knobStyles.gestureDisabled,
  ).className?.split(" ") ?? [];
  const expectedDialClasses = stylex.props(
    knobStyles.dial,
    knobStyles.dialCompact,
  ).className?.split(" ") ?? [];

  for (const className of expectedControlClasses) {
    expect(controlClasses).toContain(className);
  }
  for (const className of expectedGestureClasses) {
    expect(gestureClasses).toContain(className);
  }
  for (const className of expectedDialClasses) {
    expect(dialClasses).toContain(className);
  }
  expect(stylex.props(knobStyles.controlDragging).className).toBeDefined();
  expect(openingTag(html, "knob-control")).toContain("touch-action:pan-x");
  expect(html).toContain('data-disabled="true"');
  expect(html).toContain('data-touch-pan="horizontal"');
});

test("knob can simplify visible copy without weakening accessible value text", () => {
  const html = renderToStaticMarkup(
    <Knob
      formatOptions={{ style: "unit", unit: "percent" }}
      label="Volume"
      renderValue={value => Math.round(value)}
      value={83}
    />,
  );

  expect(html).toContain('aria-valuetext="83%"');
  expect(html).toContain('data-slot="knob-value">83</output>');
  expect(html).not.toContain('data-slot="knob-value">83%</output>');
});

test("knob can hide its output visually without removing value semantics", () => {
  const html = renderToStaticMarkup(
    <Knob
      formatOptions={{ style: "unit", unit: "percent" }}
      label="Volume"
      outputVisibility="visually-hidden"
      value={83}
    />,
  );

  expect(html).toContain('data-output-visibility="visually-hidden"');
  expect(html).toContain('aria-valuetext="83%"');
  const output = html.match(
    /<output\b[^>]*data-slot="knob-value"[^>]*>83%<\/output>/u,
  )?.[0];
  expect(output).toBeDefined();
  const outputClasses = output?.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
  const hiddenClasses = visuallyHiddenClassName()?.split(" ") ?? [];
  expect(outputClasses.slice(0, 2)).toEqual([
    "hraness-knob__value",
    "hraness-visually-hidden",
  ]);
  expect(hiddenClasses.every((className) => outputClasses.includes(className))).toBe(true);
  expect(output).not.toContain("style=");
});

test("knob output stays visible by default", () => {
  const html = renderToStaticMarkup(
    <Knob defaultValue={25} label="Drive" />,
  );

  expect(html).toContain('data-output-visibility="visible"');
  expect(classNames(openingTag(html, "knob-value"))).toContain(
    "hraness-knob__value",
  );
  expect(html).not.toContain("hraness-visually-hidden");
});

test("disabled knob retains its value while removing native and gesture interaction", () => {
  const html = renderToStaticMarkup(
    <Knob defaultValue={48} disabled label="Output" name="output" />,
  );

  expect(html).toContain('data-disabled="true"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('value="48"');
});

test("knob rejects ranges, steps, values, and labels that cannot form a slider", () => {
  expect(() => renderToStaticMarkup(
    <Knob defaultValue={0} label=" " />,
  )).toThrow("Knob label must provide an accessible name.");
  expect(() => renderToStaticMarkup(
    <Knob defaultValue={0} label="Gain" max={0} min={0} />,
  )).toThrow("Knob min and max must be finite, with max greater than min.");
  expect(() => renderToStaticMarkup(
    <Knob defaultValue={0} label="Gain" step={0} />,
  )).toThrow("Knob step must be a finite number greater than zero.");
  expect(() => renderToStaticMarkup(
    <Knob label="Gain" value={Number.NaN} />,
  )).toThrow("Knob value must be finite.");
});

test("quantization is clamped, aligned, monotonic, and idempotent across ranges", () => {
  let seed = 0x51_0f_15;
  const random = (): number => {
    seed = Math.imul(seed, 1_664_525) + 1_013_904_223 >>> 0;
    return seed / 0x1_0000_0000;
  };

  for (let index = 0; index < 5_000; index += 1) {
    const min = Math.floor(random() * 200 - 100) / 10;
    const step = [0.01, 0.1, 0.25, 0.5, 1, 2.5][Math.floor(random() * 6)] ?? 1;
    const max = min + step * (1 + Math.floor(random() * 80));
    const left = min - (max - min) + random() * (max - min) * 3;
    const right = left + random() * (max - min);
    const quantizedLeft = quantizeKnobValue(left, min, max, step);
    const quantizedRight = quantizeKnobValue(right, min, max, step);
    const alignment = (quantizedLeft - min) / step;

    expect(quantizedLeft).toBeGreaterThanOrEqual(min);
    expect(quantizedLeft - max).toBeLessThan(1e-8);
    expect(Math.abs(alignment - Math.round(alignment))).toBeLessThan(1e-8);
    expect(quantizedRight).toBeGreaterThanOrEqual(quantizedLeft);
    expect(quantizeKnobValue(quantizedLeft, min, max, step)).toBe(quantizedLeft);
  }

  expect(quantizeKnobValue(0.300_000_000_000_000_04, 0, 1, 0.1)).toBe(0.3);
});

test("two-axis gestures use right and up as increase directions", () => {
  expect(knobMovementDelta(8, 2)).toBe(8);
  expect(knobMovementDelta(-8, 2)).toBe(-8);
  expect(knobMovementDelta(2, -8)).toBe(8);
  expect(knobMovementDelta(2, 8)).toBe(-8);

  const horizontal = moveKnobGesture(
    beginKnobGesture(50),
    { deltaX: 16, deltaY: 0 },
    0,
    100,
    1,
  );
  const vertical = moveKnobGesture(
    beginKnobGesture(50),
    { deltaX: 0, deltaY: -16 },
    0,
    100,
    1,
  );
  const fine = moveKnobGesture(
    beginKnobGesture(50),
    { deltaX: 16, deltaY: 0, isFine: true },
    0,
    100,
    0.1,
  );

  expect(horizontal.value).toBe(60);
  expect(vertical.value).toBe(60);
  expect(fine.value).toBe(51);
});

test("horizontal touch racks reserve swipes for scrolling and keep vertical adjustment", () => {
  expect(resolveKnobTouchIntent(2, 3)).toBe("pending");
  expect(resolveKnobTouchIntent(8, 4)).toBe("scroll");
  expect(resolveKnobTouchIntent(4, -8)).toBe("adjust");
  expect(resolveKnobTouchIntent(8, -8)).toBe("adjust");
  expect(
    constrainKnobGestureMove(
      { deltaX: 24, deltaY: 0 },
      "touch",
      "horizontal",
    ),
  ).toEqual({ deltaX: 0, deltaY: 0 });
  expect(
    constrainKnobGestureMove(
      { deltaX: 24, deltaY: -8 },
      "touch",
      "horizontal",
    ),
  ).toEqual({ deltaX: 0, deltaY: -8 });
  expect(
    constrainKnobGestureMove(
      { deltaX: 24, deltaY: -8 },
      "mouse",
      "horizontal",
    ),
  ).toEqual({ deltaX: 24, deltaY: -8 });
});

test("a gesture reports one end even if completion is observed again", () => {
  const first = endKnobGesture(beginKnobGesture(50));
  const second = endKnobGesture(first.gesture);

  expect(first.didEnd).toBe(true);
  expect(second.didEnd).toBe(false);
});

test("cancellation restores the pointer-down value exactly once", () => {
  const moved = moveKnobGesture(
    beginKnobGesture(50),
    { deltaX: 32, deltaY: 0 },
    0,
    100,
    1,
  );
  const canceled = cancelKnobGesture(moved.gesture);
  const repeated = cancelKnobGesture(canceled.gesture);

  expect(moved.value).toBe(70);
  expect(canceled).toEqual({
    didCancel: true,
    gesture: { ...moved.gesture, active: false },
    value: 50,
  });
  expect(repeated.didCancel).toBe(false);
  expect(repeated.value).toBe(50);
});

test("pointer storms publish only the latest value per frame and flush on release", () => {
  const frames = new Map<number, () => void>();
  const canceled: number[] = [];
  const values: number[] = [];
  let nextFrame = 1;
  const queue = createKnobFrameQueue(
    callback => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    },
    frame => {
      canceled.push(frame);
      frames.delete(frame);
    },
  );

  queue.enqueue(10, value => values.push(value));
  queue.enqueue(20, value => values.push(value));
  queue.enqueue(30, value => values.push(value));
  expect(frames.size).toBe(1);
  const scheduled = frames.entries().next().value;
  if (scheduled === undefined) throw new Error("A knob frame was not scheduled.");
  frames.delete(scheduled[0]);
  scheduled[1]();
  expect(values).toEqual([30]);

  queue.enqueue(40, value => values.push(value));
  queue.enqueue(50, value => values.push(value));
  queue.flush(value => values.push(value));
  expect(values).toEqual([30, 50]);
  expect(canceled).toEqual([2]);

  queue.enqueue(60, value => values.push(value));
  queue.cancel();
  expect(frames.size).toBe(0);
  expect(values).toEqual([30, 50]);
});

test("clamping and dial percentage stay within their inclusive bounds", () => {
  expect(clampKnobValue(-10, 0, 100)).toBe(0);
  expect(clampKnobValue(120, 0, 100)).toBe(100);
  expect(knobValuePercentage(-10, 0, 100)).toBe(0);
  expect(knobValuePercentage(25, 0, 100)).toBe(0.25);
  expect(knobValuePercentage(120, 0, 100)).toBe(1);
});
