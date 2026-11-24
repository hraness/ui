import assert from "node:assert/strict";
import type { Page } from "playwright-core";

/** A native Chromium swipe starts on the text and must scroll the surrounding page. */
export async function scrollFromDestination(page: Page) {
  const input = page.getByRole("combobox", { name: "Destination" });
  const main = page.locator("main");
  const cdp = await page.context().newCDPSession(page);
  try {
    await main.evaluate((element) => { element.style.minHeight = "200vh"; });
    const box = await input.boundingBox();
    assert.ok(box);
    const x = box.x + 20;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const dy of [15, 40, 75]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - dy }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForFunction(() => window.scrollY > 0);
    assert.equal(await input.getAttribute("aria-expanded"), "false");
    assert.equal(await input.inputValue(), "A Coruña");
  } finally {
    await cdp.detach();
    await main.evaluate((element) => { element.style.minHeight = ""; });
  }
}

/** Real taps and keyboard events on the package gallery, shared by Chromium and WebKit. */
export async function touchDestination(page: Page, checkpoint?: (filename: string) => Promise<void>) {
  const input = page.getByRole("combobox", { name: "Destination" });
  const list = page.getByRole("listbox");
  const saved = page.getByLabel("Saved destination");
  await input.scrollIntoViewIfNeeded();
  await input.tap({ position: { x: 12, y: 14 } });
  await list.waitFor();
  const query = "Por Norte";
  await page.keyboard.type(query, { delay: 45 });
  assert.equal(await input.inputValue(), query);
  assert.equal(await saved.innerText(), "Saved destination: A Coruña");

  // Mobile text controls can snap to word boundaries. Tap the end of the first word.
  const middle = await input.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = [style.fontWeight, style.fontSize, style.fontFamily].join(" ");
    return {
      x: Math.round(parseFloat(style.paddingLeft) + canvas.measureText("Por").width),
      y: Math.round(element.clientHeight / 2),
    };
  });
  await input.tap({ position: middle });
  const handle = await input.elementHandle();
  assert.ok(handle);
  await page.waitForFunction((element) => {
    const field = element as HTMLInputElement;
    return field.selectionStart === field.selectionEnd && field.selectionStart! > 0 && field.selectionStart! < field.value.length;
  }, handle);
  const caret = await input.evaluate((element) => (element as HTMLInputElement).selectionStart);
  assert.ok(caret !== null && caret > 0 && caret < query.length);
  await page.keyboard.type("t");
  assert.equal(await input.inputValue(), query.slice(0, caret) + "t" + query.slice(caret));
  assert.equal(await saved.innerText(), "Saved destination: A Coruña");
  await checkpoint?.("01-edit.png");
  await input.press("Escape");
  await list.waitFor({ state: "detached" });

  await input.tap();
  await list.waitFor();
  await page.keyboard.type("Athens");
  assert.equal(await input.inputValue(), "Athens");
  await page.getByRole("option", { name: "Αθήνα", exact: true }).tap();
  await page.getByText("Saved destination: Αθήνα", { exact: true }).waitFor();
  await list.waitFor({ state: "detached" });
  await checkpoint?.("02-choose.png");
}
