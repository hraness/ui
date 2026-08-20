# hraness/ui

`@hraness/ui` is a source-first set of accessible React primitives and shared styles for Tailwind CSS applications. It combines React Aria Components behavior, semantic data-attribute variants, class composition, portable theme tokens, and a restrained application baseline.

The package publishes built ESM runtime entry points and ships its TypeScript and TSX source for declarations, inspection, and contribution. Its CSS exports remain source files and provide the complete default theme as well as separate token, reset, component, and Tailwind integration layers.

## Install

Pin an immutable release from GitHub:

```json
{
  "dependencies": {
    "@hraness/ui": "github:hraness/ui#v0.4.1"
  }
}
```

Then install with Bun:

```sh
bun install
```

React 18 or 19 and React DOM 18 or 19 are peer dependencies.

## Import the shared style

Import Tailwind once, then import the complete UI stylesheet before product-specific rules:

```css
@import "tailwindcss";
@import "@hraness/ui/styles.css";

/* Optional product-level token overrides and styles follow. */
```

`styles.css` registers the package source with Tailwind, defines the shared light and dark themes, applies the portable reset, and includes component recipes. Consumers do not need a fragile `node_modules`-relative `@source` path. The stylesheet expects Tailwind CSS v4 processing; it deliberately does not import Tailwind itself, which prevents duplicate Preflight and utility output.

Set `data-theme="dark"` or the `dark` class on a root element to select the dark recipe. Set `data-theme="light"` for an explicit light island. Product themes override the namespaced roles such as `--ui-background`, `--ui-primary`, and `--ui-ring` after the imports; Tailwind's familiar `bg-background`, `text-muted-foreground`, and related utilities remain available through the included bridge.

For a narrower integration, import any static layer directly:

```css
@import "@hraness/ui/tokens.css";
@import "@hraness/ui/reset.css";
@import "@hraness/ui/components.css";
```

`tokens.css` and `reset.css` are standards-only CSS and do not require Tailwind. `tailwind.css` owns only source detection, the dark variant, and semantic Tailwind mappings.

## Use the primitives

```tsx
import {
  Badge,
  Button,
  CopyButton,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Tag,
  TextField,
} from "@hraness/ui";

export function ProjectCard() {
  return (
    <Card className="max-w-md" tone="card">
      <CardHeader>
        <Badge tone="success">Local</Badge>
        <Tag accentColor="#D97706" icon="🧭" variant="outline">
          agent tools
        </Tag>
        <CardTitle>Local preview</CardTitle>
        <CardDescription>A Vite application running on this computer.</CardDescription>
      </CardHeader>
      <CardContent>
        <TextField
          description="Used for development notices."
          label="Email"
          placeholder="you@example.com"
          type="email"
        />
      </CardContent>
      <CardFooter>
        <CopyButton
          copyLabel="Copy URL"
          onCopyError={() => console.log("Copy failed")}
          value="https://example.com/preview"
          variant="primary"
        />
      </CardFooter>
    </Card>
  );
}
```

Quiet personal and project sites can share the same centered page and footer
measure without copying layout rules:

```tsx
import {
  AppearanceIcon,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
} from "@hraness/ui";

<QuietSitePage>
  <a href="https://instagram.com/example">
    <SocialIcon name="instagram" />
    <span>instagram</span>
  </a>
</QuietSitePage>
<QuietSiteFooter>
  <button aria-label="Appearance: System">
    <AppearanceIcon name="system" />
  </button>
</QuietSiteFooter>
```

`SocialIcon` provides the finite Bluesky, GitHub, Instagram, LinkedIn,
Substack, Threads, X, and YouTube marks used beside visible profile labels.
`AppearanceIcon` provides the shared Light, Dark, and System glyphs for
controls that own their accessible names. Icon-only `SegmentedControl` labels
are centered independently of inline text baselines.

Use React Aria's `onPress` event for actions. Action controls use the semantic `primary`, `secondary`, `quiet`, and `danger` variants and the `compact`, `default`, and `large` sizes. `CopyButton` writes one string to the clipboard, announces success, and temporarily swaps to its `copiedLabel`; both labels always occupy the same grid cell, so the button keeps the wider intrinsic width throughout the transition. `IconButton` and `IconLink` require an accessible name and own their hover/focus tooltip; `aria-label` supplies the default visible copy, while controls named by `aria-labelledby` must also provide `tooltip`. Set `IconLink` to `presentation="inline"` when an icon-only destination sits beside typographic content. The inline presentation keeps the link semantics, tooltip, centered glyph, and focus treatment without persistent action-control chrome, and it intentionally does not accept action sizes or variants.

`Knob` is a circular, single-value slider for compact numeric controls. It
requires a visible label and a controlled `value` or uncontrolled
`defaultValue`. Pointer and touch gestures may move either right or up to
increase the value; left or down decreases it. Shift-drag makes fine
adjustments. Arrow, Home, End, Page Up, and Page Down keys use React Aria's
native range semantics, and `name` plus `form` preserve form submission.
In a horizontally scrollable rack, set `touchPan="horizontal"`. Touch users
then swipe left or right to scroll the rack and drag vertically to adjust the
knob; mouse and trackpad pointers retain both adjustment axes.
Use `renderValue` when compact visible copy should differ from the formatted
accessible value. For example, a rack may show `83` while `formatOptions`
keeps the native range announcement at `83%`.

```tsx
<Knob
  defaultValue={0}
  formatOptions={{ maximumFractionDigits: 1 }}
  label="Pan"
  max={1}
  min={-1}
  name="pan"
  step={0.1}
/>
```

`Tag` is a noninteractive compact label. Its optional `icon` is decorative because the visible label carries the meaning. Use `default` for ordinary labels, `muted` for subdued metadata, and `outline` for a muted boundary. Add `accentColor` only when a measured or authored color carries categorical identity. Keep navigation on a native link that contains the tag instead of making the tag itself interactive.

Connect links to a client router once at the application boundary. Internal links then navigate through the router and prefetch once on hover or focus; external, fragment-only, and protocol-relative links never prefetch:

```tsx
import { RouterProvider } from "@hraness/ui";

<RouterProvider
  navigate={(href) => router.push(href)}
  prefetch={(href) => router.prefetch(href)}
>
  <App />
</RouterProvider>
```

## Component coverage

The public barrel includes:

- Actions: `Button`, `CopyButton`, `IconButton`, `IconLink`, `ToggleButton`, `Link`, and `LinkButton`.
- Forms: `Form`, text and text-area fields, search and number fields, checkbox and radio groups, switches, native and React Aria selects, and file fields.
- Collections: tabs, disclosures and accordions, toggle groups, segmented controls, list boxes, and separators.
- Overlays: menus, dialogs, popovers, tooltips, and an isolated toast provider and queue.
- Feedback and data: tags, badges, status dots, alerts, spinners, skeletons, progress, meters, sliders, knobs, avatars, and data tables.
- Content and layout: cards, pressable and themed surfaces, page intros, empty states, settings cards, toolbars, breadcrumbs, pagination, skip links, viewport frames, wrapping rows, and quiet-site page and footer landmarks.
- Icons: the current-color HugeIcons renderer plus finite social-profile and appearance glyphs.

Interactive primitives preserve React Aria state through `data-hovered`, `data-pressed`, `data-selected`, `data-invalid`, `data-focus-visible`, and related attributes. The shared CSS includes pointer-coarse target sizing, reduced-motion fallbacks, forced-color support, and visible focus treatment.

Collapsed disclosure panels remain available to browser find-in-page behavior without retaining the expanded panel inset in the page layout. The `compact` size keeps the same panel-content spacing while the disclosure is open.

## Customize safely

Override semantic roles after the imports to reskin the whole system without depending on component internals:

```css
:root {
  --ui-primary: oklch(0.52 0.16 250);
  --ui-ring: oklch(0.62 0.14 250);
  --ui-font-heading: "Your Heading Face", ui-monospace, monospace;
  --ui-radius: 1rem;
}
```

Every primitive accepts `className`. Actions also expose `controlClassName` when the nested semantic control needs a focused override:

```tsx
<Button className="max-w-full" controlClassName="rounded-xl" variant="quiet">
  Open application
</Button>
```

The package exports `cn` for consumer-side class composition. Treat documented component classes and `data-slot` values as stable styling hooks; prefer token overrides for system-wide changes.

## Migrating from 0.1

Version 0.2 replaces recipe helpers with semantic, styled primitives and is intentionally breaking. Rename action variants from `default`, `destructive`, `outline`, `ghost`, and `link` to the closest role among `primary`, `danger`, `secondary`, and `quiet`; replace `sm`, `lg`, and `icon` sizes with `compact`, `large`, and `IconButton`/`IconLink`; and replace `TextField isLabelHidden` with `showLabel={false}`. `buttonVariants` and `badgeVariants` are no longer exported. Conventional `ref` values continue to target the semantic button and field root.

## Development and contributions

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## License

MIT
