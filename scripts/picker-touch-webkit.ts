import assert from "node:assert/strict";
import { devices, webkit } from "playwright-core";
import { createServer } from "vite";
import { touchDestination } from "../gallery/picker/touch-journey.ts";

const server = await createServer({
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
try {
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === "object");
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ ...devices["iPhone 13"], reducedMotion: "reduce" });
    await page.goto(`http://127.0.0.1:${address.port}/gallery/picker/`);
    await touchDestination(page);
    // iOS VoiceOver can emit two centered touchends without a physical pointer sequence.
    // Exercise React Aria's virtual activation independently of the genuine taps above.
    await page.waitForFunction(() => performance.now() > 500);
    await page.getByRole("combobox").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const center = {
        clientX: Math.ceil(bounds.left + bounds.width / 2),
        clientY: Math.ceil(bounds.top + bounds.height / 2),
      };
      for (let i = 0; i < 2; i++) {
        const event = new Event("touchend", { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: [] },
          changedTouches: { value: [center] },
        });
        element.dispatchEvent(event);
      }
    });
    await page.getByRole("listbox").waitFor();
    assert.equal(await page.getByLabel("Saved destination").innerText(), "Saved destination: Αθήνα");
    console.log(`Touch input and committed selection passed in WebKit ${browser.version()} (${webkit.executablePath()}).`);
    await page.close();
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
