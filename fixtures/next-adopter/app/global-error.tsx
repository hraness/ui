"use client";

import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  error: { borderBlockStartWidth: "23px" },
});

export default function GlobalError({ reset }: Readonly<{ error: Error & { digest?: string }; reset(): void }>) {
  return (
    <html lang="en">
      <body {...stylex.props(styles.error)} data-next-global-error="true">
        <button onClick={reset} type="button">Retry</button>
      </body>
    </html>
  );
}
