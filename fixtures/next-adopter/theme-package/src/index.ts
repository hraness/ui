import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  root: { paddingBlockEnd: "31px" },
});

export const themeClassName = stylex.props(styles.root).className ?? "";
