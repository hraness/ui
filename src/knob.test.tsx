import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Knob } from "./index.js";
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
import { visuallyHiddenClassName } from "./visually-hidden.stylex.js";

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

  expect(html).toContain('class="hraness-knob product-knob"');
  expect(html).toContain('class="hraness-knob__control product-control"');
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
  expect(html).toContain('data-focus-indicator="true"');
  expect(html).toContain('data-slot="knob-dial"');
  expect(html).toContain('stroke-dasharray="75 25"');
  expect(html).toContain('stroke-dasharray="18.75 100"');
  expect(html).toContain('transform="rotate(202.5 24 24)"');
  expect(html).toContain('data-slot="knob-gesture"');
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
  expect(html).toContain('class="hraness-knob__value"');
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
