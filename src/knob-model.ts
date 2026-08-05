export const KNOB_DRAG_DISTANCE = 160;

export type KnobGesture = Readonly<{
  active: boolean;
  originValue: number;
  pixelOffset: number;
}>;

export type KnobGestureMove = Readonly<{
  deltaX: number;
  deltaY: number;
  isFine?: boolean;
}>;

export type KnobTouchIntent = "adjust" | "pending" | "scroll";

export function resolveKnobTouchIntent(
  deltaX: number,
  deltaY: number,
  threshold = 4,
): KnobTouchIntent {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) {
    return "pending";
  }
  return Math.abs(deltaX) > Math.abs(deltaY) ? "scroll" : "adjust";
}

/**
 * A horizontally scrollable touch rack reserves the horizontal axis for the
 * browser. Mouse and pen gestures retain the standard dominant-axis behavior.
 */
export function constrainKnobGestureMove(
  move: KnobGestureMove,
  pointerType: string,
  touchPan: "horizontal" | "none",
): KnobGestureMove {
  return pointerType === "touch" && touchPan === "horizontal"
    ? { ...move, deltaX: 0 }
    : move;
}

export type KnobGestureUpdate = Readonly<{
  gesture: KnobGesture;
  value: number;
}>;

export type KnobGestureEnd = Readonly<{
  didEnd: boolean;
  gesture: KnobGesture;
}>;

export type KnobGestureCancel = Readonly<{
  didCancel: boolean;
  gesture: KnobGesture;
  value: number;
}>;

export type KnobFrameQueue = Readonly<{
  cancel: () => void;
  enqueue: (value: number, apply: (value: number) => void) => void;
  flush: (apply: (value: number) => void) => void;
}>;

const FINE_MOVEMENT_SCALE = 0.1;

/** Coalesces pointer storms to one latest-value write per animation frame. */
export function createKnobFrameQueue(
  schedule: (callback: () => void) => number,
  cancelFrame: (frame: number) => void,
): KnobFrameQueue {
  let frame: number | null = null;
  let pendingValue: number | null = null;
  let pendingApply: ((value: number) => void) | null = null;

  const applyPending = (applyOverride?: (value: number) => void): void => {
    const value = pendingValue;
    const apply = applyOverride ?? pendingApply;
    frame = null;
    pendingValue = null;
    pendingApply = null;
    if (value !== null && apply !== null) apply(value);
  };

  return {
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pendingValue = null;
      pendingApply = null;
    },
    enqueue(value, apply) {
      pendingValue = value;
      pendingApply = apply;
      if (frame === null) frame = schedule(() => applyPending());
    },
    flush(apply) {
      if (frame !== null) cancelFrame(frame);
      applyPending(apply);
    },
  };
}

function roundToStepPrecision(value: number, step: number): number {
  const stepText = step.toString().toLowerCase();
  const exponentIndex = stepText.indexOf("e-");
  let precision = 0;

  if (exponentIndex > 0) {
    precision = Math.abs(Math.floor(Math.log10(Math.abs(step)))) + exponentIndex;
  } else {
    const decimalIndex = stepText.indexOf(".");
    if (decimalIndex >= 0) precision = stepText.length - decimalIndex;
  }

  if (precision === 0) return value;
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

/** Clamps a finite value to the knob's inclusive numeric range. */
export function clampKnobValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Snaps a value to a step originating at min, then clamps it to the range. */
export function quantizeKnobValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const maximumStepIndex = Math.floor((max - min) / step + 1e-10);
  const requestedStepIndex = Math.round((value - min) / step);
  const stepIndex = Math.min(maximumStepIndex, Math.max(0, requestedStepIndex));

  if (stepIndex === 0) return min;
  return roundToStepPrecision(min + stepIndex * step, step);
}

/**
 * Resolves a two-dimensional move to one knob delta. Rightward and upward
 * movement increase the value; the dominant axis wins for diagonal moves.
 */
export function knobMovementDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : -deltaY;
}

export function beginKnobGesture(value: number): KnobGesture {
  return { active: true, originValue: value, pixelOffset: 0 };
}

/** Cancels an active gesture and restores the exact value at pointer down. */
export function cancelKnobGesture(gesture: KnobGesture): KnobGestureCancel {
  return {
    didCancel: gesture.active,
    gesture: gesture.active ? { ...gesture, active: false } : gesture,
    value: gesture.originValue,
  };
}

export function moveKnobGesture(
  gesture: KnobGesture,
  move: KnobGestureMove,
  min: number,
  max: number,
  step: number,
): KnobGestureUpdate {
  if (!gesture.active) {
    return { gesture, value: quantizeKnobValue(gesture.originValue, min, max, step) };
  }

  const movementScale = move.isFine ? FINE_MOVEMENT_SCALE : 1;
  const pixelOffset = gesture.pixelOffset
    + knobMovementDelta(move.deltaX, move.deltaY) * movementScale;
  const rawValue = gesture.originValue
    + pixelOffset / KNOB_DRAG_DISTANCE * (max - min);

  return {
    gesture: { ...gesture, pixelOffset },
    value: quantizeKnobValue(rawValue, min, max, step),
  };
}

export function endKnobGesture(gesture: KnobGesture): KnobGestureEnd {
  if (!gesture.active) return { didEnd: false, gesture };
  return {
    didEnd: true,
    gesture: { ...gesture, active: false },
  };
}

export function knobValuePercentage(value: number, min: number, max: number): number {
  return clampKnobValue((value - min) / (max - min), 0, 1);
}
