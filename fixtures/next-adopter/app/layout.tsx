import "@fixture/theme/compiler-foundation.css";
import "@hraness/ui/compiler-foundation.css";
import "./site.css";

import { headers } from "next/headers";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  if (requestHeaders.get("x-stylex-global-error-proof") === "true") {
    throw new Error("Intentional packed Next global-error proof");
  }
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
