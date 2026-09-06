import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as stylex from "@stylexjs/stylex";
import { Menu as AriaMenu } from "react-aria-components";
import { menuStyles } from "./menu.stylex.js";
import { createRef } from "react";

import {
  Accordion,
  Disclosure,
  SegmentedControl,
  Separator,
  Tabs,
  ToggleGroup,
} from "./collections.js";
import { collectionStyles } from "./collections.stylex.js";
import { Meter, ProgressBar, Slider } from "./indicators.js";
import { DialogContent, DialogTrigger, MenuItem, MenuSection, MenuSeparator, Popover, Tooltip } from "./overlays.js";
import {
  ToastProvider,
  type ToastOptions,
  useToast,
} from "./toast.js";
import { toastStyles } from "./toast.stylex.js";

const menuOverrides = stylex.create({ item: { color: "rebeccapurple", backgroundColor: "papayawhip" }, section: { gap: "13px" }, header: { fontSize: "17px" } });
const dialogOverrides = stylex.create({ root: { width: "19rem" }, overlay: { paddingTop: "21px" } });
const toastOverrides = stylex.create({
  close: { backgroundColor: "papayawhip", ":hover": { backgroundColor: "rebeccapurple" } },
  closeDynamic: (width: string) => ({ width }),
  region: { gap: "13px" },
  regionDynamic: (gap: string) => ({ gap }),
  root: { borderRadius: "19px" },
  rootDynamic: (paddingTop: string) => ({ paddingTop }),
});

function recipeBlock(source: string, recipe: string): string {
  const start = source.indexOf(`  ${recipe}: {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  },", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 5);
}

test("Popover and Tooltip preserve portal-safe server rendering and typed caller seams", () => {
  const html = renderToStaticMarkup(<>
    <DialogTrigger defaultOpen><button type="button">Open details</button>
      <Popover aria-label="Named details" xstyle={dialogOverrides.root} className="caller-popover" popoverRef={createRef<HTMLElement>()} offset={12} style={() => ({ paddingTop: "23px" })}>Hidden rich content</Popover>
    </DialogTrigger>
    <Tooltip content="Supplementary details" xstyle={dialogOverrides.root} className="caller-tooltip" delay={0} closeDelay={0} isOpen style={{ paddingTop: "15px" }}><button type="button">Named trigger</button></Tooltip>
  </>);
  expect(html).toContain("Open details");
  expect(html).toContain("Named trigger");
  expect(html).not.toContain("Hidden rich content");
  expect(html).not.toContain("Supplementary details");
  expect(html).not.toContain("xstyle=");
  expect(html).not.toContain("popoverRef=");
});

test("Dialog remains portal-safe for every size with typed caller seams and close render functions", () => {
  for (const size of ["small", "medium", "large"] as const) {
    let renderCount = 0;
    const html = renderToStaticMarkup(
      <DialogTrigger defaultOpen>
        <button type="button">Open {size} settings</button>
        <DialogContent
          title="Dialog settings" description="Private dialog description" size={size}
          xstyle={dialogOverrides.root} overlayXstyle={dialogOverrides.overlay}
          className="caller-dialog" overlayClassName="caller-overlay"
          style={({ isEntering }) => ({ paddingTop: isEntering ? "23px" : "25px" })}
          dialogRef={createRef<HTMLDivElement>()} isCloseDisabled isDismissable={false}
          footer={({ close }) => <button onClick={close}>Footer close</button>}
        >
          {({ close }) => { renderCount += 1; return <button onClick={close}>Body close</button>; }}
        </DialogContent>
      </DialogTrigger>,
    );
    expect(html).toContain(`Open ${size} settings`);
    expect(html).not.toContain("Private dialog description");
    expect(html).not.toContain("Body close");
    expect(html).not.toContain("Footer close");
    expect(html).not.toContain("xstyle=");
    expect(renderCount).toBe(0);
  }
});

test("Menu retains collection semantics, rich slots, and caller recipes", () => {
  const html = renderToStaticMarkup(
    <AriaMenu aria-label="Actions" selectionMode="single" selectedKeys={["save"]} disabledKeys={["delete"]}>
      <MenuSection title="Document" className="caller-section" xstyle={menuOverrides.section} headerXstyle={menuOverrides.header}>
        <MenuItem id="save" textValue="Save document" leading="+" description="Keep changes" shortcut="⌘S" className="caller-item" xstyle={menuOverrides.item} style={() => ({ color: "tomato" })}>Save</MenuItem>
        <MenuItem id="delete" textValue="Delete document" variant="danger">Delete</MenuItem>
      </MenuSection>
      <MenuSeparator className="caller-separator" />
    </AriaMenu>,
  );
  for (const slot of ["menu-section", "menu-header", "menu-item", "menu-item-leading", "menu-item-copy", "menu-item-label", "menu-item-description", "menu-item-shortcut", "menu-separator"]) expect(html).toContain(`data-slot="${slot}"`);
  expect(html).toContain('role="menuitemradio"');
  expect(html).toContain('aria-checked="true"');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('data-variant="danger"');
  expect(html).toContain("color:tomato");
  expect(html).not.toContain("xstyle=");
  const firstItem = html.match(/<[^>]+data-slot="menu-item"[^>]*>/u)?.[0] ?? "";
  const classes = firstItem.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
  expect(classes[0]).toBe("hraness-menu__item");
  expect(classes.at(-1)).toBe("caller-item");
  for (const atom of (stylex.props(menuStyles.item, menuStyles.itemSelected, menuOverrides.item).className ?? "").split(" ")) expect(classes).toContain(atom);
});

test("tabs and disclosures retain collection ownership and ARIA relationships", () => {
  const html = renderToStaticMarkup(
    <>
      <Tabs
        aria-label="Project sections"
        items={[
          {
            id: "overview",
            label: "Overview",
            panel: <p>Project summary</p>,
          },
          {
            ariaLabel: "Project activity",
            id: "activity",
            isDisabled: true,
            label: <span aria-hidden="true">Pulse</span>,
            panel: <p>Recent activity</p>,
          },
        ]}
        onChange={() => undefined}
        value="overview"
      />
      <Accordion defaultExpandedKeys={["details"]}>
        <Disclosure headingLevel={4} id="details" title="Details">
          Persistent content
        </Disclosure>
      </Accordion>
    </>,
  );

  expect(html).toContain('data-slot="tabs"');
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-label="Project sections"');
  expect(html).toContain('role="tab"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('aria-label="Project activity"');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('role="tabpanel"');
  expect(html).toContain("Project summary");
  expect(html).toContain('class="hraness-disclosure__heading');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('data-slot="disclosure-panel"');
  expect(html).toContain("Persistent content");
});

test("collapsed compact disclosures expose a hidden panel without losing its content", () => {
  const html = renderToStaticMarkup(
    <Disclosure size="compact" title="Details">
      Persistent content
    </Disclosure>,
  );

  expect(html).toContain('data-size="compact"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('data-slot="disclosure-panel"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('hidden=""');
  expect(html).toContain("Persistent content");
});

test("toggle and segmented collections expose controlled selection semantics", () => {
  const html = renderToStaticMarkup(
    <>
      <ToggleGroup
        aria-label="Text formatting"
        items={[
          { id: "bold", label: "Bold" },
          {
            id: "sparkles",
            label: <span aria-hidden="true">✦</span>,
            textValue: "Sparkles",
          },
        ]}
        onChange={() => undefined}
        selectionMode="multiple"
        value={["bold"]}
      />
      <SegmentedControl
        aria-label="Density"
        items={[
          { id: "comfortable", label: "Comfortable" },
          { id: "compact", isDisabled: true, label: "Compact" },
        ]}
        onChange={() => undefined}
        value="comfortable"
      />
      <Separator orientation="vertical" />
    </>,
  );

  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Text formatting"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-label="Sparkles"');
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-label="Density"');
  expect(html).toContain('type="radio"');
  expect(html).toContain('value="comfortable"');
  expect(html).toContain('checked=""');
  expect(html).toContain('value="compact"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('role="separator"');
  expect(html).toContain('aria-orientation="vertical"');
});

test("progress, meter, and slider keep labels, values, and visible fill state", () => {
  const html = renderToStaticMarkup(
    <>
      <ProgressBar label="Upload" maxValue={100} showValue value={25} />
      <ProgressBar isIndeterminate label="Loading" showValue />
      <Meter label="Storage" maxValue={100} tone="warning" value={75} />
      <Slider defaultValue={35} label="Volume" name="volume" thumbLabel="Volume level" />
    </>,
  );

  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-valuenow="25"');
  expect(html).toContain('data-slot="progress-bar-fill"');
  expect(html).toContain('--hraness-percentage:25%');
  expect(html).toContain('width:25%');
  expect(html).toContain('data-indeterminate="true"');
  expect(html).toContain('role="meter progressbar"');
  expect(html).toContain('aria-valuenow="75"');
  expect(html).toContain('data-tone="warning"');
  expect(html).toContain('data-slot="slider"');
  expect(html).toContain('aria-label="Volume level"');
  expect(html).toContain('name="volume"');
  expect(html).toContain('value="35"');
});

test("portal-backed overlays preserve their triggers during server rendering", () => {
  const html = renderToStaticMarkup(
    <>
      <DialogTrigger>
        <button type="button">Open settings</button>
        <DialogContent description="Project preferences" title="Settings">
          Settings body
        </DialogContent>
      </DialogTrigger>
      <Tooltip content="More information">
        <button aria-label="Help" type="button">?</button>
      </Tooltip>
    </>,
  );

  expect(html).toContain("Open settings");
  expect(html).toContain('aria-label="Help"');
  expect(html).not.toContain("Settings body");
  expect(html).not.toContain("More information");
});

test("toast context is request-local and its empty portal preserves typed presentation seams", () => {
  const persistent = { duration: null } satisfies ToastOptions;

  function ContextProbe() {
    const controller = useToast();
    return <span data-controller={typeof controller.toast}>Application</span>;
  }

  const html = renderToStaticMarkup(
    <ToastProvider
      closeXstyle={toastOverrides.close}
      maxVisibleToasts={Number.POSITIVE_INFINITY}
      regionXstyle={toastOverrides.region}
      toastXstyle={toastOverrides.root}
    >
      <ContextProbe />
    </ToastProvider>,
  );

  expect(persistent.duration).toBeNull();
  expect(html).toContain('data-controller="function"');
  expect(html).toContain("Application");
  expect(html).not.toContain("hraness-toast-region");
  expect(html).not.toContain("Xstyle=");
  expect(() => renderToStaticMarkup(<ContextProbe />)).toThrow(
    "useToast must be used within a ToastProvider.",
  );
});

test("Toast owns exact recipes, caller order, and no legacy visual selectors", async () => {
  const [components, motion, source, recipe] = await Promise.all([
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./motion.stylex.ts", import.meta.url)).text(),
    Bun.file(new URL("./toast.tsx", import.meta.url)).text(),
    Bun.file(new URL("./toast.stylex.ts", import.meta.url)).text(),
  ]);
  expect(recipe.match(/^  [A-Za-z][A-Za-z0-9]+: \{/gmu)?.map((entry) => entry.slice(2, -3))).toEqual([
    "region", "root", "entering", "toneDanger", "toneInfo", "toneSuccess", "toneWarning",
    "content", "copy", "title", "description", "action", "close", "closeHovered", "closeFocusVisible", "closeNativeInteractionFallbacks",
  ]);
  expect(source).toContain("stylex.props(toastStyles.region, regionXstyle)");
  expect(source).toMatch(/toastStyles\.root,[\s\S]*toastStyles\.entering,[\s\S]*toastToneStyles\[tone\],[\s\S]*toastXstyle/u);
  expect(source).not.toMatch(/\.is(?:Entering|Exiting)\b/u);
  expect(source).toMatch(/toastStyles\.close,[\s\S]*!hasClosePresentation && toastStyles\.closeNativeInteractionFallbacks,[\s\S]*state\.isHovered && toastStyles\.closeHovered,[\s\S]*state\.isFocusVisible && toastStyles\.closeFocusVisible,[\s\S]*closeXstyle/u);
  expect(components).not.toMatch(/\.hraness-toast(?:-region|__(?:action|close|content|copy|description|title))?(?![A-Za-z0-9_-])/u);
  expect(components).not.toContain("@keyframes");
  expect(motion).toContain("export const toastEnterKeyframes = stylex.keyframes({");
  expect(motion).toContain("export const toastExitKeyframes = stylex.keyframes({");
  expect(motion).toContain("default: toastEnterKeyframes");
  expect(source).toContain("motionStyles.toastEnter");
  expect(stylex.props(toastStyles.region, toastOverrides.region).className).toContain(stylex.props(toastOverrides.region).className);
  expect(stylex.props(toastStyles.root, toastStyles.toneSuccess, toastOverrides.root).className).toContain(stylex.props(toastOverrides.root).className);
  expect(stylex.props(toastStyles.close, toastStyles.closeHovered, toastOverrides.close).className).toContain(stylex.props(toastOverrides.close).className);
  for (const [presentation, value] of [
    [stylex.props(toastStyles.region, toastOverrides.regionDynamic("17px")), "17px"],
    [stylex.props(toastStyles.root, toastOverrides.rootDynamic("19px")), "19px"],
    [stylex.props(toastStyles.close, toastOverrides.closeDynamic("3rem")), "3rem"],
  ] as const) expect(Object.values(presentation.style ?? {})).toContain(value);
});

test("collections own no remaining legacy visual selector", async () => {
  const [component, components, source] = await Promise.all([
    Bun.file(new URL("./collections.tsx", import.meta.url)).text(),
    Bun.file(new URL("./components.css", import.meta.url)).text(),
    Bun.file(new URL("./collections.stylex.ts", import.meta.url)).text(),
  ]);

  const renderedComponents = components.replace(
    /\/\* WebKit scrollbar pseudo-elements[^]*?\.hraness-segmented-control::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/u,
    "",
  );
  for (const className of [
    "tabs",
    "disclosure",
    "accordion",
    "toggle-group",
    "segmented-control",
    "separator",
  ]) {
    expect(renderedComponents).not.toMatch(
      new RegExp(`\\.hraness-${className}(?=\\s|:|\\{|\\[)`, "u"),
    );
  }
  expect(source).toContain('backgroundColor: "var(--ui-muted)"');
  expect(source).toContain('outlineColor: "var(--ui-ring)"');
  expect(source).toContain('transitionProperty: "background-color, box-shadow, color"');
  expect(components.match(/\.hraness-segmented-control::-webkit-scrollbar/gu)).toHaveLength(1);
  expect(component).toMatch(
    /collectionStyles\.tab,[\s\S]*?collectionStyles\.tabNativeFocusFallback,[\s\S]*?size === "compact" && collectionStyles\.tabCompact/u,
  );
  expect(component).toMatch(
    /collectionStyles\.disclosureTrigger,[\s\S]*?collectionStyles\.disclosureTriggerNativeFocusFallback,[\s\S]*?size === "compact" && collectionStyles\.disclosureTriggerCompact,[\s\S]*?size === "large" && collectionStyles\.disclosureTriggerLarge/u,
  );
  expect(component).toMatch(
    /collectionStyles\.segmentedItem,[\s\S]*?collectionStyles\.segmentedItemNativeInteractionFallbacks,[\s\S]*?size === "compact" && collectionStyles\.segmentedItemCompact/u,
  );
  expect(component).toContain("collectionStyles.toggleItem,");
});

test("collection density recipes retain real and synthetic coarse minimums", async () => {
  const source = await Bun.file(
    new URL("./collections.stylex.ts", import.meta.url),
  ).text();

  expect(source).toContain(
    'const syntheticCoarseMinimum = "var(--hraness-collection-coarse-min, 0px)"',
  );
  for (const [recipe, ordinaryMinimum, coarseMinimum] of [
    ["tab", "var(--interactive-target-compact)", "var(--interactive-target-min)"],
    ["tabCompact", "2rem", "var(--interactive-target-min)"],
    ["disclosureTrigger", "var(--interactive-target-min)", "var(--interactive-target-min)"],
    ["disclosureTriggerCompact", "var(--interactive-target-compact)", "var(--interactive-target-min)"],
    ["disclosureTriggerLarge", "var(--control-height-primary)", "max(var(--control-height-primary), var(--interactive-target-min))"],
    ["toggleItem", "var(--interactive-target-compact)", "var(--interactive-target-min)"],
    ["segmentedItem", "var(--interactive-target-compact)", "var(--interactive-target-min)"],
    ["segmentedItemCompact", "2rem", "var(--interactive-target-min)"],
  ] as const) {
    const block = recipeBlock(source, recipe);
    expect(block).toContain(
      `default: \`max(${ordinaryMinimum}, \${syntheticCoarseMinimum})\``,
    );
    expect(block).toContain(
      `[coarsePointer]: "${coarseMinimum}"`,
    );
  }

  const segmentedItem = recipeBlock(source, "segmentedItem");
  expect(segmentedItem).toContain(
    'default: "var(--hraness-collection-coarse-min)"',
  );
  expect(segmentedItem.match(/\[coarsePointer\]: "var\(--interactive-target-min\)"/gu)).toHaveLength(2);
});

test("selected collection recipes own their forced-colors surfaces", async () => {
  const source = await Bun.file(
    new URL("./collections.stylex.ts", import.meta.url),
  ).text();

  for (const recipe of ["tabSelected", "toggleItemSelected", "segmentedItemSelected"]) {
    const block = recipeBlock(source, recipe);
    expect(block).toContain('[forcedColors]: "ButtonFace"');
    expect(block).toContain('[forcedColors]: "ButtonText"');
  }
  expect(stylex.props(collectionStyles.tabSelected).className).toBeTruthy();
  expect(stylex.props(collectionStyles.toggleItemSelected).className).toBeTruthy();
  expect(stylex.props(collectionStyles.segmentedItemSelected).className).toBeTruthy();
});
