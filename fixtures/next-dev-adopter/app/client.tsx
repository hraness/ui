"use client";

import * as stylex from "@stylexjs/stylex";
import { lazy, Suspense, useState } from "react";
import { clientBackground, clientStyles } from "./client.stylex";

const LazyPanel = lazy(() => import("./lazy"));

export default function Client() {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);
  return <section aria-label="Client state">
    <button {...stylex.props(clientStyles.control)} data-dev-counter data-dev-expected-background={clientBackground} onClick={() => setCount((value) => value + 1)}>Count {count}</button>
    <label>Draft <input data-dev-draft defaultValue="" /></label>
    <button onClick={() => setVisible(true)}>Open lazy content</button>
    {visible && <Suspense fallback={<p>Loading lazy content</p>}><LazyPanel /></Suspense>}
  </section>;
}
