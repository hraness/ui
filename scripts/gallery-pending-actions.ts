import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";

/** Native input and observed paint from the installed package, without state injection. */
export async function verifyPendingActions(page: Page, environment: string): Promise<void> {
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const reset = page.locator('[data-gallery-pending-reset="true"]');
  await reset.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-gallery-pending-count]')]
    .every((element) => element.textContent === "0"));
  assert.equal(await page.locator('[data-gallery-pending-action]').count(), 9);
  const evidence = [];

  async function settle(control: Locator): Promise<void> {
    await control.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true })
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
  }

  async function keyboardFocus(control: Locator): Promise<void> {
    await control.scrollIntoViewIfNeeded();
    await control.evaluate((element) => {
      const probe = document.createElement("button");
      probe.type = "button";
      probe.dataset.galleryPendingTabProbe = "true";
      element.before(probe);
      probe.focus();
    });
    try {
      await page.keyboard.press("Tab");
    } finally {
      await page.locator('[data-gallery-pending-tab-probe="true"]')
        .evaluateAll((probes) => probes.forEach((probe) => probe.remove()));
    }
    await page.waitForFunction((selector) => {
      const element = document.querySelector(selector);
      return element === document.activeElement && element?.matches(":focus-visible")
        && element.hasAttribute("data-focus-visible");
    }, `[data-gallery-pending-action="${await control.getAttribute("data-gallery-pending-action")}"]`);
    await settle(control);
  }

  async function pointerPress(control: Locator): Promise<void> {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert(box, `${environment}: missing pending action pointer target`);
    assert(await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit !== null && (hit === element || element.contains(hit));
    }), `${environment}: pending action pointer target is obscured`);
    // A real pointer event must reach aria-disabled controls; Locator.click's
    // enabled-state wait would prevent exercising React Aria's press boundary.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(control);
  }

  async function pendingEvidence(control: Locator) {
    return control.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error("Pending control is not a native button");
      const root = element.closest('[data-slot="button"], [data-slot="icon-button"]');
      const spinner = element.querySelector<HTMLElement>('[data-slot="action-spinner"]');
      const label = element.querySelector<HTMLElement>('[data-slot="button-label"]');
      if (!(root instanceof HTMLElement) || !spinner) throw new Error("Pending wrapper or spinner missing");
      const inkElement = label ?? spinner;
      const inkProperty = label ? "color" : "border-block-start-color";
      type Pixel = [number, number, number, number];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("sRGB paint readback unavailable");
      const rgba = (color: string): Pixel => {
        if (!CSS.supports("color", color)) throw new Error(`Unsupported observed color: ${color}`);
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r! / 255, g! / 255, b! / 255, a! / 255];
      };
      const over = (front: Pixel, back: Pixel): Pixel => {
        const alpha = front[3] + back[3] * (1 - front[3]);
        if (alpha === 0) return [0, 0, 0, 0];
        return [0, 1, 2].map((channel) =>
          (front[channel]! * front[3] + back[channel]! * back[3] * (1 - front[3])) / alpha,
        ).concat(alpha) as Pixel;
      };
      const observedPaint = (start: HTMLElement, ink: Pixel): Pixel => {
        let pixel = ink;
        for (let node: HTMLElement | null = start; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.backgroundImage !== "none" || style.filter !== "none"
            || style.backdropFilter !== "none" || style.mixBlendMode !== "normal") {
            throw new Error("Pending contrast requires an observed solid, unfiltered paint chain");
          }
          if (Number(style.opacity) !== 1) throw new Error("Pending control or ancestor reduces observed paint opacity");
          pixel = over(pixel, rgba(style.backgroundColor));
          pixel[3] *= Number(style.opacity);
        }
        if (pixel[3] !== 1) throw new Error("Pending contrast has no opaque observed backdrop");
        return pixel;
      };
      const luminance = (pixel: Pixel) => pixel.slice(0, 3).reduce((sum, value, channel) =>
        sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          * [0.2126, 0.7152, 0.0722][channel]!, 0);
      const ratio = (left: Pixel, right: Pixel) => {
        const a = luminance(left), b = luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const style = getComputedStyle(element);
      const foreground = observedPaint(inkElement, rgba(getComputedStyle(inkElement).getPropertyValue(inkProperty)));
      const background = observedPaint(inkElement, [0, 0, 0, 0]);
      const outer = element.parentElement;
      if (!outer) throw new Error("Pending focus backdrop missing");
      const outline = rgba(style.outlineColor);
      outline[3] *= Number(style.opacity);
      const forcedColors = matchMedia("(forced-colors: active)").matches;
      const shadow = /^(.*) 0px 0px 0px 4px$/u.exec(style.boxShadow);
      return {
        ariaBusy: element.getAttribute("aria-busy"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        rootBusy: root.getAttribute("aria-busy"),
        rootPending: root.getAttribute("data-pending"),
        pending: element.getAttribute("data-pending"),
        disabled: element.disabled,
        opacity: Number(style.opacity),
        cursor: style.cursor,
        focused: document.activeElement === element,
        focusVisible: element.matches(":focus-visible") && element.hasAttribute("data-focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineOffset: Number.parseFloat(style.outlineOffset),
        outlineAlpha: outline[3],
        shadow: style.boxShadow,
        // The four-pixel spread stops at the opaque outline's outside edge.
        // Forced colors may suppress shadows entirely at the browser level.
        shadowWithinOutline: style.boxShadow === "none"
          ? forcedColors
          : shadow !== null && CSS.supports("color", shadow[1]!),
        outlineContrast: ratio(observedPaint(outer, outline), observedPaint(outer, [0, 0, 0, 0])),
        spinnerHidden: spinner.getAttribute("aria-hidden"),
        spinnerWidth: spinner.getBoundingClientRect().width,
        spinnerBorder: Number.parseFloat(getComputedStyle(spinner).borderBlockStartWidth),
        label: label?.textContent ?? element.getAttribute("aria-label"),
        foreground,
        background,
        contrast: ratio(foreground, background),
        forcedColors,
      };
    });
  }

  for (const kind of ["primary", "secondary", "icon"] as const) {
    for (const mode of ["dynamic", "disabled-pending"] as const) {
      const key = `${kind}-${mode}`;
      const control = page.locator(`[data-gallery-pending-action="${key}"]`);
      const count = page.locator(`[data-gallery-pending-count="${key}"]`);
      await keyboardFocus(control);
      if (mode === "dynamic") {
        const readyControl = await control.elementHandle();
        assert(readyControl);
        try {
          await page.keyboard.press("Enter");
          await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === "1",
            `[data-gallery-pending-count="${key}"]`);
          // Read before any new focus operation: the same ready DOM control
          // must remain connected and active when React turns it pending.
          await settle(control);
          assert(await readyControl.evaluate((element) => element.isConnected && document.activeElement === element),
            `${environment}: ${key} replaced or blurred its focused native control`);
        } finally {
          await readyControl.dispose();
        }
      }
      const observed = await pendingEvidence(control);
      // React Aria 1.19 filters aria-busy from its native button; the package
      // wrapper owns the busy state while React Aria owns pending interaction.
      assert.equal(observed.ariaBusy, null, `${environment}: ${key} native aria-busy ownership`);
      assert.equal(observed.rootBusy, "true");
      assert.equal(observed.ariaDisabled, "true");
      assert.equal(observed.rootPending, "true");
      assert.equal(observed.pending, "true");
      assert.equal(observed.disabled, false, `${environment}: ${key} lost pending focusability`);
      assert.equal(observed.opacity, 1, `${environment}: ${key} pending opacity`);
      assert.equal(observed.cursor, "progress", `${environment}: ${key} pending cursor`);
      assert(observed.focused && observed.focusVisible, `${environment}: ${key} lost visible/retained focus`);
      assert(observed.outlineStyle === "solid" && observed.outlineWidth === 2 && observed.outlineOffset === 2
        && observed.outlineAlpha === 1 && observed.shadowWithinOutline && observed.outlineContrast >= 3,
        `${environment}: ${key} focus outline is not visible: ${JSON.stringify(observed)}`);
      assert.equal(observed.spinnerHidden, "true");
      assert(observed.spinnerWidth > 0 && observed.spinnerBorder > 0, `${environment}: ${key} spinner has no paint`);
      assert.equal(observed.label, kind !== "icon" ? "Saving changes" : `Refresh ${mode}`);
      assert(observed.contrast >= 4.5,
        `${environment}: ${key} ${kind !== "icon" ? "text" : "spinner"} contrast ${observed.contrast}: ${JSON.stringify(observed)}`);
      const expectedCount = mode === "dynamic" ? "1" : "0";
      for (const input of ["Enter", "Space"] as const) {
        await page.keyboard.press(input);
        await settle(control);
        assert.equal(await count.textContent(), expectedCount, `${environment}: ${key} duplicate ${input} press`);
      }
      await pointerPress(control);
      assert.equal(await count.textContent(), expectedCount, `${environment}: ${key} duplicate pointer press`);
      evidence.push({ key, ...observed, suppressed: ["Enter", "Space", "pointer"] });
    }
    const key = `${kind}-disabled`;
    const disabled = page.locator(`[data-gallery-pending-action="${key}"]`);
    await settle(disabled);
    const observed = await disabled.evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error("Disabled control is not a native button");
      element.focus();
      return {
        disabled: element.disabled,
        attribute: element.hasAttribute("disabled"),
        dataDisabled: element.getAttribute("data-disabled"),
        opacity: getComputedStyle(element).opacity,
        focused: document.activeElement === element,
        spinner: element.querySelector('[data-slot="action-spinner"]') !== null,
        busy: element.getAttribute("aria-busy"),
      };
    });
    assert(observed.disabled && observed.attribute && observed.dataDisabled === "true" && !observed.focused);
    assert.equal(observed.opacity, "0.5", `${environment}: ${key} disabled opacity`);
    assert.equal(observed.spinner, false);
    assert.equal(observed.busy, null);
    await pointerPress(disabled);
    assert.equal(await page.locator(`[data-gallery-pending-count="${key}"]`).textContent(), "0");
    evidence.push({ key, ...observed });
  }
  // Restore initial fixture state and leave no active tooltip or focus behind.
  await reset.click();
  await reset.blur();
  await page.mouse.move(0, 0);
  await page.evaluate(({ x, y }) => scrollTo(x, y), scroll);
  console.log(`Pending action browser evidence ${environment}: ${JSON.stringify(evidence)}`);
}
