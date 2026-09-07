import * as stylex from "@stylexjs/stylex";
import { themeClassName } from "@fixture/theme";

import { ClientProof } from "./client";

const styles = stylex.create({
  node: { outlineOffset: "13px" },
});

export default function Page() {
  return (
    <main
      {...stylex.props(styles.node)}
      className={`${stylex.props(styles.node).className ?? ""} ${themeClassName}`.trim()}
      data-next-node-rsc="true"
    >
      <h1>Next StyleX adapter</h1>
      <ClientProof />
    </main>
  );
}
