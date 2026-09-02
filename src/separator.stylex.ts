import * as stylex from "@stylexjs/stylex";

export const separatorStyles = stylex.create({
  root: {
    // Match the legacy background shorthand, including its reset semantics.
    backgroundAttachment: "scroll",
    backgroundClip: "border-box",
    backgroundColor: "var(--ui-border)",
    backgroundImage: "none",
    backgroundOrigin: "padding-box",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundSize: "auto auto",
    // Match `border: 0`, including the border-image reset.
    borderColor: "currentColor",
    borderImageOutset: 0,
    borderImageRepeat: "stretch",
    borderImageSlice: "100%",
    borderImageSource: "none",
    borderImageWidth: 1,
    borderStyle: "none",
    borderWidth: 0,
    flexBasis: "auto",
    flexGrow: 0,
    flexShrink: 0,
    height: "1px",
    width: "100%",
  },
  vertical: {
    alignSelf: "stretch",
    height: "auto",
    width: "1px",
  },
});
