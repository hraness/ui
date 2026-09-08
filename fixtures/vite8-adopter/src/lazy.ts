import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({ lazy: { scrollPaddingInlineStart: "271828px" } });
export const lazyClassName = stylex.props(styles.lazy).className;
