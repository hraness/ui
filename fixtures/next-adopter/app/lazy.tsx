"use client";

import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  lazy: { scrollPaddingInlineStart: "19px" },
});

export default function LazyProof() {
  return <span {...stylex.props(styles.lazy)} data-next-lazy="ready">ready</span>;
}
