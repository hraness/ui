import * as stylex from "@stylexjs/stylex";

const reducedMotion = "@media(prefers-reduced-motion: reduce)";

export const fadeInKeyframes = stylex.keyframes({
  from: { opacity: 0 },
});

export const fadeOutKeyframes = stylex.keyframes({
  to: { opacity: 0 },
});

export const overlayEnterKeyframes = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateY(-0.25rem) scale(0.98)",
  },
});

export const overlayExitKeyframes = stylex.keyframes({
  to: {
    opacity: 0,
    transform: "translateY(-0.125rem) scale(0.99)",
  },
});

export const progressIndeterminateKeyframes = stylex.keyframes({
  from: { transform: "translateX(-125%)" },
  to: { transform: "translateX(250%)" },
});

export const skeletonKeyframes = stylex.keyframes({
  to: { backgroundPosition: "-200% 0" },
});

export const spinKeyframes = stylex.keyframes({
  to: { transform: "rotate(1turn)" },
});

export const toastEnterKeyframes = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translateX(1rem)",
  },
});

export const toastExitKeyframes = stylex.keyframes({
  to: {
    opacity: 0,
    transform: "translateX(1rem)",
  },
});

export const motionStyles = stylex.create({
  fadeIn: {
    animationName: { default: fadeInKeyframes, [reducedMotion]: "none" },
  },
  fadeOut: {
    animationName: { default: fadeOutKeyframes, [reducedMotion]: "none" },
  },
  overlayEnter: {
    animationName: {
      default: overlayEnterKeyframes,
      [reducedMotion]: "none",
    },
  },
  overlayExit: {
    animationName: {
      default: overlayExitKeyframes,
      [reducedMotion]: "none",
    },
  },
  progressIndeterminate: {
    animationName: {
      default: progressIndeterminateKeyframes,
      [reducedMotion]: "none",
    },
  },
  skeleton: {
    animationName: { default: skeletonKeyframes, [reducedMotion]: "none" },
  },
  spin: {
    animationName: { default: spinKeyframes, [reducedMotion]: "none" },
  },
  toastEnter: {
    animationName: {
      default: toastEnterKeyframes,
      [reducedMotion]: "none",
    },
  },
  toastExit: {
    animationName: {
      default: toastExitKeyframes,
      [reducedMotion]: "none",
    },
  },
});
