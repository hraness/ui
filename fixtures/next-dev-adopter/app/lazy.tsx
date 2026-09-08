import * as stylex from "@stylexjs/stylex";

const lazyMargin = 62.625;
const styles = stylex.create({ panel: { marginLeft: lazyMargin, color: "rgb(43, 83, 123)" } });

export default function LazyPanel() {
  return <p {...stylex.props(styles.panel)} data-dev-lazy data-dev-expected-margin={`${lazyMargin}px`}>Lazy content</p>;
}
