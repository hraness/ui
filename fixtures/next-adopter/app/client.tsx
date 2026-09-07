"use client";

import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useEffect, useState } from "react";

const LazyProof = lazy(async () => await import("./lazy"));

const styles = stylex.create({
  client: { scrollMarginBottom: "17px" },
});

export function ClientProof() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <section
      {...stylex.props(styles.client)}
      data-next-client="true"
      data-next-hydrated={String(hydrated)}
    >
      <Suspense fallback={<span data-next-lazy="pending">pending</span>}>
        <LazyProof />
      </Suspense>
    </section>
  );
}
