import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Accordion,
  Disclosure,
  SegmentedControl,
  Separator,
  Tabs,
  ToggleGroup,
} from "./collections.js";
import { Meter, ProgressBar, Slider } from "./indicators.js";
import { DialogContent, DialogTrigger, Tooltip } from "./overlays.js";
import {
  ToastProvider,
  type ToastOptions,
  useToast,
} from "./toast.js";

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

test("toast context is request-local and its empty portal is SSR-safe", () => {
  const persistent = { duration: null } satisfies ToastOptions;

  function ContextProbe() {
    const controller = useToast();
    return <span data-controller={typeof controller.toast}>Application</span>;
  }

  const html = renderToStaticMarkup(
    <ToastProvider maxVisibleToasts={Number.POSITIVE_INFINITY}>
      <ContextProbe />
    </ToastProvider>,
  );

  expect(persistent.duration).toBeNull();
  expect(html).toContain('data-controller="function"');
  expect(html).toContain("Application");
  expect(html).not.toContain("hraness-toast-region");
  expect(() => renderToStaticMarkup(<ContextProbe />)).toThrow(
    "useToast must be used within a ToastProvider.",
  );
});

test("collections own no remaining legacy visual selector", async () => {
  const [components, source] = await Promise.all([
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
});
