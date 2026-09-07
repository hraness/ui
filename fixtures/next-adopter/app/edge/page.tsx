import * as stylex from "@stylexjs/stylex";

export const runtime = "edge";

const styles = stylex.create({
  edge: { marginInlineEnd: "29px" },
});

export default function EdgePage() {
  return <main {...stylex.props(styles.edge)} data-next-edge-rsc="true">Edge StyleX graph</main>;
}
