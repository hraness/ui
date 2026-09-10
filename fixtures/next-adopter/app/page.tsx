import * as stylex from "@stylexjs/stylex";
import { themeClassName } from "@fixture/theme";
import Link from "next/link";

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
      <nav aria-label="Adapter examples">
        <ul>
          <li><Link href="/delegated-one">Shared history one</Link></li>
          <li><Link href="/delegated-two">Shared history two</Link></li>
        </ul>
      </nav>
    </main>
  );
}
