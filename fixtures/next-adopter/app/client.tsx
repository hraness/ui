"use client";

import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@hraness/ui";

const LazyProof = lazy(async () => await import("./lazy"));

const styles = stylex.create({
  client: { scrollMarginBottom: "17px" },
});

export function ClientProof() {
  const [hydrated, setHydrated] = useState(false);
  const [presses, setPresses] = useState(0);
  useEffect(() => setHydrated(true), []);
  return (
    <section
      {...stylex.props(styles.client)}
      data-next-client="true"
      data-next-hydrated={String(hydrated)}
    >
      <Button onPress={() => setPresses((count) => count + 1)}>Shared action {presses}</Button>
      <Suspense fallback={<span data-next-lazy="pending">pending</span>}>
        <LazyProof />
      </Suspense>
    </section>
  );
}
