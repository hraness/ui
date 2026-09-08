import React, { useEffect, useState } from "react";
import { Tag } from "@hraness/ui";

export function View() {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return React.createElement("section", { "data-hydrated": String(ready) },
    React.createElement(Tag, { children: "Packed package" }),
    React.createElement("button", { type: "button", onClick: () => setCount((value) => value + 1) }, `Count ${String(count)}`),
    React.createElement("output", { "data-count": true }, String(count)),
  );
}
