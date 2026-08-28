import * as stylex from "@stylexjs/stylex";

export const visuallyHiddenStyles = stylex.create({
  root: {
    borderColor: "currentColor !important",
    borderImageOutset: "0 !important",
    borderImageRepeat: "stretch !important",
    borderImageSlice: "100% !important",
    borderImageSource: "none !important",
    borderImageWidth: "1 !important",
    borderStyle: "none !important",
    borderWidth: "0 !important",
    clip: "rect(0, 0, 0, 0) !important",
    height: "1px !important",
    overflow: "hidden !important",
    padding: "0 !important",
    position: "absolute !important",
    whiteSpace: "nowrap !important",
    width: "1px !important",
  },
});

export function visuallyHiddenClassName(hidden = true): string | undefined {
  return stylex.props(hidden && visuallyHiddenStyles.root).className;
}
