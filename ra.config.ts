import assert from "node:assert/strict";
import { defineConfig } from "@hraness/ra";
import type { Page } from "playwright-core";

const url = "/gallery/picker/";
const field = (p: Page) => p.getByRole("combobox", { name: "Destination" });
const saved = (p: Page) => p.getByLabel("Saved destination");
async function checkpoint(page: Page, file: string) {
  if (process.env.RA_WALK_DIR)
    await page.screenshot({ path: process.env.RA_WALK_DIR + "/" + file });
}
async function active(page: Page) {
  return field(page).evaluate((input) => {
    const id = input.getAttribute("aria-activedescendant");
    const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
    const row = id ? document.getElementById(id) : null;
    return row && list?.contains(row) ? row.getAttribute("data-key") : null;
  });
}
export default defineConfig({
  app: {
    command: "bun run ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port {port} --strictPort",
    ready: url,
  },
  views: ["desktop", "phone", "phone.dark", "320x700", "desktop.forced-colors"],
  states: {
    "picker-keyboard": {
      url,
      ready: '[data-slot="searchable-select"]',
      async steps(p) {
        const input = field(p);
        await input.fill("Oprto");
        // Single-edit transposition finds the complete display name through its alias.
        await p.getByRole("option", { name: "Porto", exact: true }).waitFor();
        await input.press("ArrowDown");
        assert.equal(await active(p), "porto");
        assert.equal(await input.evaluate((e) => e === document.activeElement), true);
        await input.press("Alt+Enter");
        await p.getByText("Preview: Porto", { exact: true }).waitFor();
        assert.equal(await saved(p).innerText(), "Saved destination: A Coruña");
        await checkpoint(p, "01-preview.png");
        await input.press("Enter");
        await p.getByText("Saved destination: Porto", { exact: true }).waitFor();
        assert.equal(await input.inputValue(), "Porto");
        assert.equal(await input.getAttribute("aria-expanded"), "false");
        await checkpoint(p, "02-selected.png");
      },
    },
    "picker-recovery": {
      url,
      ready: '[data-slot="searchable-select"]',
      async steps(p) {
        const input = field(p);
        await input.fill("nothinggg");
        await p.getByText("No matching destinations").waitFor();
        await checkpoint(p, "01-empty.png");
        assert.equal(await p.locator(".example").getAttribute("data-reason"), "input");
        await input.fill("");
        assert.equal(await p.locator(".example").getAttribute("data-query"), "");
        assert.equal(await p.locator(".example").getAttribute("data-reason"), "input");
        await input.press("Escape");
        assert.equal(await p.locator(".example").getAttribute("data-reason"), "reset");
        assert.equal(await input.inputValue(), "A Coruña");
        await input.fill("Port");
        await p.getByRole("option", { name: "Porto", exact: true }).waitFor();
        await input.press("ArrowDown");
        await input.press("Tab");
        assert.equal(await saved(p).innerText(), "Saved destination: A Coruña");
        assert.equal(await input.getAttribute("aria-expanded"), "false");
        await input.fill("Port");
        await input.press("ArrowDown");
        await p.getByRole("heading", { name: "Choose a destination" }).click();
        assert.equal(await input.getAttribute("aria-expanded"), "false");
        assert.equal(await saved(p).innerText(), "Saved destination: A Coruña");
        await input.fill("Athens");
        await p.getByRole("option", { name: "Αθήνα", exact: true }).click();
        await p.getByText("Saved destination: Αθήνα", { exact: true }).waitFor();
        await checkpoint(p, "02-recovered.png");
      },
    },
    "picker-browse": {
      url,
      ready: '[data-slot="searchable-select"]',
      async steps(p) {
        const input = field(p);
        const control = p.locator('[data-slot="searchable-select-control"]');
        const button = control.getByRole("button");
        if (await p.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
          const hit = await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const points = [
              [box.left + 2, box.top + 2],
              [box.right - 2, box.bottom - 2],
            ];
            return {
              width: box.width,
              height: box.height,
              inside: points.every(([x, y]) => element.contains(document.elementFromPoint(x!, y!))),
            };
          });
          assert.ok(hit.width >= 44 && hit.height >= 44 && hit.inside, JSON.stringify(hit));
        }
        await button.click();
        const list = p.getByRole("listbox");
        await list.waitFor();
        const popup = p.locator('[data-slot="searchable-select-popover"]');
        const [triggerBox, popupBox] = await Promise.all([
          control.boundingBox(),
          popup.boundingBox(),
        ]);
        assert.ok(triggerBox && popupBox);
        assert.ok(
          Math.abs(triggerBox.x - popupBox.x) <= 1 &&
            Math.abs(triggerBox.width - popupBox.width) <= 1,
          JSON.stringify({ triggerBox, popupBox }),
        );
        assert.equal(
          await list.getByRole("option", { selected: true }).getAttribute("data-key"),
          "coruna",
        );
        assert.equal(
          await list
            .getByRole("option", { name: /^Llanfair/ })
            .evaluate(
              (element) =>
                element.scrollWidth <= element.clientWidth + 1 &&
                document.documentElement.scrollWidth <= innerWidth,
            ),
          true,
        );
        await input.fill("port");
        await input.press("ArrowDown");
        assert.equal(await active(p), "porto");
        await input.press("ArrowDown");
        assert.equal(await active(p), "alegre");
        await input.press("ArrowDown");
        assert.notEqual(await active(p), "closed");
        assert.equal(await input.evaluate((element) => element === document.activeElement), true);
        // Leave the list expanded so ra also inspects the live combobox relationships.
      },
    },
    "picker-forced-colors": {
      url,
      views: ["desktop.forced-colors"],
      ready: '[data-slot="searchable-select"]',
      async steps(p) {
        assert.equal(await p.evaluate(() => matchMedia("(forced-colors: active)").matches), true);
        const input = field(p);
        await input.fill("Port");
        await input.press("ArrowDown");
        assert.equal(await active(p), "porto");
        const option = p.getByRole("option", { name: "Porto", exact: true });
        assert.equal(
          await option.evaluate((el) => {
            const style = getComputedStyle(el);
            return style.forcedColorAdjust === "none" && style.color !== style.backgroundColor;
          }),
          true,
        );
      },
    },
    "picker-composition": {
      url,
      ready: '[data-slot="searchable-select"]',
      async steps(p) {
        const input = field(p);
        await input.focus();
        await input.dispatchEvent("compositionstart", { data: "" });
        await input.fill("東京");
        await input.dispatchEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 229,
          isComposing: true,
          bubbles: true,
        });
        assert.equal(await saved(p).innerText(), "Saved destination: A Coruña");
        assert.equal(await input.getAttribute("aria-expanded"), "true");
        await input.dispatchEvent("compositionend", { data: "東京" });
        await input.press("Enter");
        assert.equal(await saved(p).innerText(), "Saved destination: 東京");
        await input.fill("port");
        // An external update can arrive while a user is searching, without shifting focus.
        await p
          .getByRole("button", { name: "Restore original destination" })
          .evaluate((element) => (element as HTMLElement).click());
        assert.equal(await input.inputValue(), "A Coruña");
        assert.equal(await input.getAttribute("aria-expanded"), "false");
      },
    },
    "picker-in-dialog": {
      url: url + "?dialog",
      ready: "button",
      async steps(p) {
        await p.getByRole("button", { name: "Edit destination" }).click();
        const input = field(p);
        await input.fill("Port");
        const list = p.getByRole("dialog").getByRole("listbox");
        await list.waitFor();
        assert.equal(
          await list
            .getByRole("option", { name: "Porto Bay", exact: true })
            .getAttribute("aria-disabled"),
          "true",
        );
        await input.press("Escape");
        assert.equal(await p.getByRole("dialog").isVisible(), true);
        await p.getByRole("button", { name: "Done" }).click();
        assert.equal(await p.getByRole("dialog").count(), 0);
      },
    },
  },
});
