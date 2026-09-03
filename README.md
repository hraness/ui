# @hraness/ui

Accessible product-neutral React Aria primitives with compiled StyleX recipes and portable CSS tokens.

`@hraness/ui` gives Hraness web products one shared interaction and theme layer. The package owns accessible primitives, finite semantic variants, public styling hooks, and framework-neutral composition seams. Each product keeps control of its content, state, data, layout, and visual identity.

## First render

Pin the current immutable release:

```json
{
  "dependencies": {
    "@hraness/ui": "github:hraness/ui#v0.4.10"
  }
}
```

Install it with Bun:

```sh
bun install
```

Import Tailwind once, then import the complete package stylesheet before product rules:

```css
@import "tailwindcss";
@import "@hraness/ui/styles.css";

/* Optional product-level token overrides and styles follow. */
```

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CopyButton,
} from "@hraness/ui";

export function PreviewCard() {
  return (
    <Card tone="card">
      <CardHeader>
        <CardTitle>Local preview</CardTitle>
        <CardDescription>A Vite application running on this computer.</CardDescription>
      </CardHeader>
      <CardContent><code>http://localhost:5173</code></CardContent>
      <CardFooter>
        <CopyButton
          copyLabel="Copy preview URL"
          value="http://localhost:5173"
        />
      </CardFooter>
    </Card>
  );
}
```

That render uses one semantic card tree and one React Aria button. `CopyButton` writes the exact URL, announces success through a live region, and reserves enough width for both its idle and copied labels. The default stylesheet supplies light and dark tokens, focus treatment, coarse-pointer sizing, reduced-motion behavior, and forced-color fallbacks.

React 18 or 19 and React DOM 18 or 19 are peer dependencies.

## Proof in the package

| Contract | Checked package fact | Public authority |
| --- | --- | --- |
| Runtime and types | ESM consumers load `dist/index.js`; TypeScript reads `src/index.ts` | `package.json` exports |
| Style delivery | Six public CSS entry points cover the complete theme and each narrower layer | `package.json` exports |
| Theme surface | 37 namespaced theme roles cover surfaces, text, actions, status, charts, typography, and radius | `src/tokens.css` |
| Interaction states | Components expose semantic `data-slot` hooks and React Aria state attributes | Source types and server-rendered tests |
| Compatibility | React and React DOM 18 through 19; StyleX 0.19 for caller-authored `xstyle` | Peer and package dependencies |

The package also exports portable spacing, typography, target-size, motion, elevation, layer, and breakpoint scales. Theme the system through roles such as `--ui-background`, `--ui-primary`, and `--ui-ring`; product code does not need generated StyleX class names.

## Composable interface map

| Reader task | Public interfaces | Composition boundary |
| --- | --- | --- |
| Trigger an action or navigate | `Button`, `CopyButton`, `IconButton`, `Link`, `LinkButton`, `IconLink`, `ToggleButton` | React Aria owns input semantics; the caller owns the action and destination |
| Collect and validate input | `Form`, fields, checkbox and radio groups, switches, native and React Aria selects, file fields | The caller owns values, validation policy, and submission |
| Select from a collection | Tabs, disclosures, accordions, toggle groups, segmented controls, list boxes, menus | The primitive owns keyboard behavior; the caller owns the items and state |
| Show status or data | Tags, badges, status dots, alerts, spinners, skeletons, progress, meters, sliders, knobs, avatars, tables | The primitive renders state; the caller supplies the state and meaning |
| Structure a surface | Cards, page intros, empty states, settings cards, toolbars, breadcrumbs, pagination, viewport frames, wrapping rows, quiet-site landmarks | The package supplies bounded structure; the product owns page layout and content |
| Connect application seams | `RouterProvider`, `ToastProvider`, `AskAiAboutThis`, icons | The package stays framework-neutral and does not own application data |
| Apply presentation | Tokens, reset, legacy CSS, compiled StyleX CSS, Tailwind bridge, typed `xstyle` | Product tokens, caller recipes, and native styles remain explicit override layers |

## Style delivery

`@hraness/ui` publishes one JavaScript entry point and six public CSS entry points:

- `@hraness/ui/styles.css` provides the complete theme, reset, legacy recipes, compiled StyleX recipes, and Tailwind bridge.
- `@hraness/ui/tokens.css` provides standards-only light and dark tokens.
- `@hraness/ui/reset.css` provides the standards-only baseline and layer order.
- `@hraness/ui/components.css` provides the remaining legacy component recipes.
- `@hraness/ui/stylex.css` provides package-compiled StyleX recipes.
- `@hraness/ui/tailwind.css` provides Tailwind source detection, the dark variant, and semantic utility mappings.

`styles.css` keeps the reset `base` below `components`, then fixes the component sublayers from lowest to highest as `legacy`, `priority1`, `priority2`, `priority3`, and `priority4`. Migrated StyleX declarations win over remaining package recipes without depending on generated class names or import timing. The complete stylesheet expects Tailwind CSS v4 processing during this transition, but it does not import Tailwind itself. This prevents duplicate Preflight and utility output.

Set `data-theme="dark"` or the `dark` class on a root element to select the dark recipe. Set `data-theme="light"` for an explicit light island. Override namespaced roles after the imports to apply a product theme.

For a standards-only or narrower integration, import the required layers directly:

```css
@import "@hraness/ui/tokens.css";
@import "@hraness/ui/reset.css";
@import "@hraness/ui/components.css";
@import "@hraness/ui/stylex.css";
```

The built-in recipes are already compiled. Consumers do not need a StyleX compiler to render them. Applications that author local StyleX declarations or pass a typed `xstyle` override must compile their own source with the matching StyleX 0.19 contract. The package disables runtime CSS injection and uses property-specificity resolution. Tailwind utilities and unlayered product CSS retain their existing override authority, except for the shared visually-hidden accessibility recipe. Its offscreen reset uses layered important declarations so conflicting unlayered important rules cannot accidentally expose accessible-only copy. Change the component visibility prop instead of overriding this helper.

## Composition patterns

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

Add one quiet AI handoff to a project or individual content page by passing
its canonical absolute HTTPS URL:

```tsx
import { AskAiAboutThis } from "@hraness/ui";

<AskAiAboutThis url="https://hraness.com/stripe" />;
```

`AskAiAboutThis` renders the visible label “Ask AI about this” followed by real
outbound links to ChatGPT, Claude, Perplexity, and Grok. Each provider receives
the minimal prompt `Tell me about https://hraness.com/stripe`, including the
literal full URL. The component has no client state or framework dependency,
works in server-rendered layouts, wraps on narrow surfaces, and rejects
relative, non-HTTPS, credentialed, or malformed subject URLs.

Use React Aria's `onPress` event for actions. Action controls use the semantic `primary`, `secondary`, `quiet`, and `danger` variants and the `compact`, `default`, `large`, and `transport` sizes. Compact and default controls grow to a 48-by-48-pixel minimum target for coarse pointers; large and transport controls keep their larger block sizes and at least the same inline minimum. Icon-only toggles retain the compact inline size at large and transport densities. `CopyButton` writes one string to the clipboard, announces success, and temporarily swaps to its `copiedLabel`; both labels always occupy the same grid cell, so the button keeps the wider intrinsic width throughout the transition. `IconButton` and `IconLink` require an accessible name and own their hover/focus tooltip; `aria-label` supplies the default visible copy, while controls named by `aria-labelledby` must also provide `tooltip`. Set `IconLink` to `presentation="inline"` when an icon-only destination sits beside typographic content. The inline presentation keeps the link semantics, tooltip, centered 24-pixel glyph target, and focus treatment without persistent action-control chrome, and it intentionally does not accept action sizes or variants or join the coarse action-target family.

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

`ProgressBar`, `Meter`, and `Slider` keep React Aria's accessible range,
keyboard, orientation, and form behavior while their presentation is compiled
with StyleX. Each root accepts a typed `xstyle`; native `style` declarations
remain final. Slider keeps a 20-pixel visible thumb inside a 48-pixel target for
real coarse pointers and the synthetic verification seam. Indeterminate
ProgressBar motion stops under reduced motion, and all three families use
system colors in forced-colors mode.

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

Knob also accepts root `xstyle` and control-only `controlXstyle`. Its control
remains 48 by 48 pixels at both densities while the visible dial is 40 pixels
by default and 32 pixels when compact. Caller control recipes replace its
native focus fallback without changing the protected range-input geometry.

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

## Compatibility and authority boundaries

| Boundary | Package authority | Consumer authority |
| --- | --- | --- |
| Interaction | Native elements and React Aria behavior for names, focus, keyboard, pointer, disabled, pending, selected, and invalid states | Business rules, values, validation policy, and side effects |
| Presentation | Portable tokens, finite component recipes, semantic classes, and `data-slot` values | Product token overrides, page layout, local composition, and intentional caller styles |
| Routing | A framework-neutral bridge for navigation and intent prefetching | Router choice, route ownership, loading, and error behavior |
| Data | None | Application state, persistence, providers, and access policy |
| Composition | Small primitives and bounded structural surfaces | Product content and higher-level patterns, optionally through `@hraness/design-kit` |

`@hraness/ui` is ESM-only and supports React 18 or 19 with the matching React DOM range. It has no dependency on a framework, `@hraness/design-kit`, or a product repository. Consumers upgrade on their own validation schedule.

Documented package exports, semantic component classes, `data-slot` values, and public custom properties are the supported integration surface. Generated StyleX class names are implementation details. Base recipes apply first, finite variants and states apply next, a typed caller `xstyle` applies after them where supported, and a caller's native `style` remains final.

Interactive primitives preserve React Aria state through `data-hovered`, `data-pressed`, `data-selected`, `data-invalid`, `data-focus-visible`, and related attributes. Collapsed disclosure panels remain available to browser find-in-page behavior without retaining expanded-panel inset in the page layout. The shared CSS covers coarse pointers, reduced motion, forced colors, and visible focus.

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

Every primitive accepts `className`. Actions expose separate wrapper and semantic-control classes plus typed StyleX seams. `Button` and `LinkButton` also expose the closed `partXstyles.label` part for product-owned label layout:

```tsx
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  actionControl: { borderRadius: "var(--radius-lg)" },
  actionLabel: { overflow: "hidden", textOverflow: "ellipsis" },
  actionWrapper: { maxWidth: "100%" },
});

<Button
  className="max-w-full"
  controlClassName="rounded-xl"
  controlXstyle={styles.actionControl}
  partXstyles={{ label: styles.actionLabel }}
  variant="quiet"
  xstyle={styles.actionWrapper}
>
  Open application
</Button>
```

`AskAiAboutThis`, `Button`, `CopyButton`, `IconButton`, `IconLink`, `ToggleButton`,
`LinkButton`, `Icon`, `SocialIcon`, `AppearanceIcon`, `Avatar`, `Badge`, `Tag`, `StatusDot`,
`KeyHint`, `PageIntro`, `EmptyState`, `InlineAlert`, `SettingsCard`, `Link`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`CardFooter`, `PressableCard`, `QuietSitePage`, `QuietSiteFooter`,
`SkipLink`, `Separator`, `Form`, `FieldDescription`, `FieldError`, `TextField`,
`TextAreaField`, `SearchField`, `NumberField`, `CheckboxField`, `CheckboxGroup`,
`RadioGroup`, `RadioOption`, `SwitchField`, `NativeSelectField`, `FileField`,
`SelectField`, `ViewportFrame`, `WrappingRow`, `ThemedSurface`, and `Toolbar`
accept a typed StyleX override. Base declarations are applied first, finite
size, tone, shape, and interaction recipes come next, and the caller recipe is
applied last. `CheckboxField` exposes `controlXstyle` separately for its
semantic checkbox label.
Action wrappers accept `xstyle`, while their nested button or anchor accepts
`controlXstyle`. Native hover, press, and focus fallbacks remain active for
empty conditional overrides. An effective control recipe selects explicit
React Aria state composition so the caller remains last; native `style`
declarations still resolve after StyleX. `Button` and `LinkButton` accept only
the documented `partXstyles.label` part.

The shared visually-hidden helper protects accessible-only content without
inline presentation. It owns the `CopyButton` live region, labeled `Spinner`,
hidden labels for `TextField`, `TextAreaField`, `SearchField`, `NumberField`,
`CheckboxField`, `NativeSelectField`, `FileField`, and `SelectField`, and a
`Knob` whose `outputVisibility` is `"visually-hidden"`. These elements retain
the stable `hraness-visually-hidden` hook before their generated StyleX atoms.
Use `showLabel` or `outputVisibility` to change visibility; generated classes
and the helper's important offscreen declarations are implementation details.

`SkipLink` applies `xstyle` to its native anchor without changing its hash,
focus-transfer, or native `:focus` reveal behavior. Native `style` declarations
resolve after the StyleX recipe.
`Separator` resolves its physical horizontal or vertical recipe through React
Aria context before applying `xstyle`. Native `style` declarations remain last.
`Form` remains a native React Aria form with its action, method, validation,
submission handler, ref, and inherited context or caller DOM renderer intact.
Its grid recipe keeps a physical zero minimum width and `var(--space-6)` gap.
Caller `xstyle` resolves after that recipe, and native `style` declarations
remain final.

The field family keeps native inputs, textareas, selects, file controls, and
form submission intact while React Aria continues to own field, group, radio,
switch, number-stepper, and SelectField behavior. Each field root accepts
`xstyle`. Text, textarea, search, number, native-select, and file controls expose
`controlXstyle` plus their input-specific StyleX seam; checkbox, radio, and
switch controls expose `controlXstyle`; checkbox and radio groups expose
`optionsXstyle`; and SelectField exposes `triggerXstyle`. Field descriptions
and errors also accept a typed `xstyle`. Base, finite size and surface, and
explicit React Aria state recipes resolve before the corresponding caller
recipe, while native `style` declarations remain final. Field and number-control
focus-within defaults resolve before `controlXstyle`, so an ordinary caller
override keeps visible focus and a caller pseudo recipe can replace it.
RadioOption, SwitchField, and SelectField condition their native focus fallback
when React Aria focus state or an effective caller recipe is authoritative.
Internal search-clear and number-stepper controls, plus enabled SelectField
options, keep native hover and focus fallbacks because they expose no caller
StyleX seam.

Compact, default, and large fields preserve their intended geometry under both
the real coarse-pointer media query and the synthetic
`--hraness-field-coarse-min` verification seam. This includes number-stepper
columns, search clear buttons, radio and switch controls, SelectField triggers
and options, and the native file button. Migrated recipes use explicit
background color and image declarations: ordinary controls clear inherited
images, `NativeSelectField` retains its two-gradient arrow, and `SelectField`
retains its SVG chevron. Only the native input placeholder and
`::file-selector-button` presentation remain in legacy CSS because those
pseudo-elements are not owned by the compiled component recipes.
Quiet-site landmarks and these surfaces also preserve dynamic StyleX inline
values when merging the native `style` prop, with caller inline declarations
taking precedence.

For logical-size overrides on `QuietSitePage`, `QuietSiteFooter`,
`ViewportFrame`, `WrappingRow`, and `ThemedSurface`, use
StyleX's canonical dashed keys such as `"inline-size"`, `"max-inline-size"`,
and `"min-inline-size"`. Under the pinned StyleX 0.19
property-specificity compiler, the camel-case aliases lower to physical
`width`, `max-width`, and `min-width`. These component `xstyle` types reject
the three camel-case aliases. The canonical keys retain vertical-writing
behavior and share the base recipe's conflict key, so caller-last replacement
remains deterministic. Use `width`, `maxWidth`, or `minWidth` when a physical
override is intentional. `ViewportFrame` also retains its ordered `100vh`,
`100svh`, and `100dvh` height fallbacks in compiled CSS.

`Avatar` intentionally keeps physical `width` and `height` declarations. Its
three finite sizes remain `2rem`, `2.5rem`, and `3.5rem` squares in every
writing mode, equivalent to 32, 40, and 56 pixels at the default root font
size. Caller StyleX recipes can replace either physical dimension before a
native `style` override is applied.

`Badge`, `Tag`, and `StatusDot` keep finite tone or variant sets and preserve
their compact physical geometry. An outline `Tag` continues to read the public
`--hraness-tag-accent` custom property set by `accentColor` or consumer CSS.
Forced-colors mode replaces Badge and Tag borders with `CanvasText`.

`Card` and `PressableCard` share the finite `card`, `neutral`, `accent`, and
`inverse` tones plus `rounded` and `rectangular` shapes. Their descriptions
inherit the literal public `--hraness-card-description` custom property, which
callers may override with native `style` or CSS. One compatibility selector
maps that public property to a private tone value on each Card root, so a nested
Card resets its own description tone. All visual declarations remain in
compiled StyleX. `PressableCard` remains one semantic React Aria button and
keeps its static string `className` API. Its native `style` may be either a
static object or a React Aria state callback; both are merged after compiled
StyleX output. Pointer, pressed, keyboard-focus, disabled, and pending behavior
continue to come from React Aria. Native pseudo-class fallbacks are attached
when a conditional `xstyle` contributes no compiled presentation. Supplying an
effective `xstyle` selects the caller-last path: React Aria state recipes remain
active, and the caller recipe resolves after them without a hidden pseudo-class
rule reverting hover, press, or focus values.

`Toolbar` preserves React Aria's horizontal and vertical arrow-key behavior,
required accessible name, semantic class, slot, ref, and static or render-prop
`style`. Its native `:focus-visible` ring is attached when a conditional
`xstyle` contributes no compiled presentation. Supplying an effective `xstyle`
removes that fallback so a caller focus recipe remains the last compiled
authority.

`KeyHint` remains a server-compatible native `kbd` element. Its semantic class,
slot, ref, attributes, and children remain stable while a typed caller `xstyle`
recipe resolves after its compact presentation. Dynamic StyleX values merge
before the native `style` prop, so native declarations remain final.

`PageIntro`, `EmptyState`, `InlineAlert`, and `SettingsCard` remain
server-compatible native content boundaries. They preserve their optional
regions, caller-selected heading levels, semantic classes, slots, refs, native
attributes, and finite tone or shape attributes. Their base recipe resolves
before a tone or shape recipe and a typed caller `xstyle`; native `style`
declarations remain final. `InlineAlert` is non-live by default. With `isLive`,
danger feedback becomes an assertive alert and the other tones become polite
status regions, while an explicit caller `role` or `aria-live` remains
authoritative. Every alert tone uses the system `CanvasText` border in
forced-colors mode.

`Link` remains an ordinary React Aria destination with a required `href`, stable
semantic class and slot, optional link ref, native attributes, render-prop
children and style, and router-prefetch behavior on focus or hover intent. Its
base, hovered, and focus-visible presentation is compiled with StyleX. A typed
caller `xstyle` is composed last inside the state-aware Link presentation
callbacks, so caller hover and focus-visible recipes retain precedence over the
equivalent React Aria state recipes. Native pseudo-class fallbacks stay attached
when a conditional `xstyle` contributes no compiled presentation and are omitted
for an effective caller recipe. Dynamic StyleX values merge before a static or
state-aware native `style` prop.

`CheckboxField` keeps its required `label`, native checkbox input, form value,
validation, description, React Aria context and render behavior, and stable
field, control, indicator, and label slots. Set `showLabel={false}` to keep the
required label as the accessible name through the shared visually-hidden
helper. The field root accepts `xstyle`; the semantic checkbox control accepts
`controlXstyle`. Both caller recipes resolve after their state recipes, while
the field's native `style` declarations remain final. The control keeps a
40-pixel minimum target and expands to 48 pixels for coarse pointers. Table and
other product layout stays outside this portable primitive.

```tsx
import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import {
  Avatar,
  Card,
  CardDescription,
  CheckboxField,
  Icon,
  KeyHint,
  Link,
  PressableCard,
  QuietSitePage,
  StatusDot,
  Tag,
  ThemedSurface,
  Toolbar,
  WrappingRow,
} from "@hraness/ui";

const styles = stylex.create({
  avatar: {
    backgroundColor: "var(--ui-accent)",
    borderRadius: "var(--radius-sm)",
    height: "3rem",
    width: "3rem",
  },
  quietPage: {
    "max-inline-size": "40rem",
  },
  searchIcon: {
    display: "block",
  },
  statusPill: {
    backgroundColor: "var(--ui-accent)",
    borderColor: "var(--ui-primary)",
  },
  cardOverride: {
    borderRadius: "var(--radius-sm)",
    paddingInline: "var(--space-4)",
  },
  checkbox: {
    gap: "var(--space-3)",
  },
  checkboxControl: {
    backgroundColor: "var(--ui-secondary)",
  },
  structuralRow: {
    "inline-size": "16rem",
  },
  texturedSurface: {
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)",
    backgroundSize: "4px 4px",
  },
  toolbar: {
    borderColor: "var(--ui-primary)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineOffset: "4px",
      outlineStyle: "solid",
      outlineWidth: "3px",
    },
  },
  keyHint: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
  },
  link: {
    color: "var(--ui-foreground)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
    },
    ":hover": {
      textDecorationThickness: "3px",
    },
  },
});

<Icon icon={Search01Icon} xstyle={styles.searchIcon} />;
<Avatar name="Ada Lovelace" xstyle={styles.avatar} />;
<Tag accentColor="#D97706" variant="outline" xstyle={styles.statusPill}>
  Project
</Tag>;
<StatusDot tone="success" />;
<Card tone="accent" xstyle={styles.cardOverride}>
  <CardDescription>Compiled card presentation</CardDescription>
</Card>;
<PressableCard onPress={() => openProject()} xstyle={styles.cardOverride}>
  Open project
</PressableCard>;
<QuietSitePage xstyle={styles.quietPage}>...</QuietSitePage>;
<WrappingRow xstyle={styles.structuralRow}>...</WrappingRow>;
<ThemedSurface tone="accent" xstyle={styles.texturedSurface}>...</ThemedSurface>;
<Toolbar aria-label="Editor actions" xstyle={styles.toolbar}>...</Toolbar>;
<KeyHint xstyle={styles.keyHint}>⌘K</KeyHint>;
<Link href="/reference" xstyle={styles.link}>Reference</Link>;
<CheckboxField
  controlXstyle={styles.checkboxControl}
  label="Include archived projects"
  showLabel={false}
  xstyle={styles.checkbox}
/>;
```

Keep importing `@hraness/ui/styles.css` while legacy and StyleX recipes
coexist. It delivers the generated StyleX stylesheet once alongside the legacy
recipes. A release remains gated on downstream consumers proving this CSS
delivery path; generated declarations are not duplicated into `components.css`.

The package exports `cn` for Tailwind-era consumer class composition. Treat documented component classes and `data-slot` values as stable styling hooks; prefer token overrides for system-wide changes. Generated StyleX class names are implementation details.

## Evidence

These claims were reviewed on September 2, 2026 against the package manifest, public barrel, token stylesheet, component tests, and checked build scripts.

| Claim | Source of truth | Executable evidence |
| --- | --- | --- |
| Package identity, version, peers, and entry points | `package.json` and `portfolio-inventory.json` | `bun run check:portfolio-inventory`, `bun run test:package` |
| Public component and type surface | `src/index.ts` and exported source modules | `bun run typecheck`, `bun run test` |
| Token names, accessibility fallbacks, and layer order | `src/tokens.css`, `src/reset.css`, compiled recipes | `bun run check:stylex-artifacts`, `bun run test` |
| Deterministic package-compiled CSS and JavaScript | Build scripts and committed `dist` | `bun run build`, `bun run check:committed-dist`, `bun run check:stylex-determinism` |
| Packed consumer behavior | Packed Bun and browser fixtures | `bun run test:package`, `bun run test:packed-bun-browser` |
| Pointer, keyboard, writing-mode, and browser cascade behavior | Real gallery scenarios | `bun run test:browser` |

`bun run check` runs the complete required sequence. A passing Markdown contract proves that this README matches checked repository facts; it does not replace package, browser, or consumer validation.

## Frequently asked questions

### Do I need Tailwind CSS?

The complete `@hraness/ui/styles.css` entry expects Tailwind CSS v4 processing while the compatibility bridge exists. A standards-only consumer can import `tokens.css`, `reset.css`, `components.css`, and `stylex.css` directly.

### Do I need a StyleX compiler?

Built-in recipes are already compiled, so ordinary consumers do not. Compile your application with the matching StyleX 0.19 contract only when you author local StyleX declarations or pass `xstyle` recipes.

### Which parts can a product theme?

Override public roles such as `--ui-background`, `--ui-primary`, `--ui-ring`, typography roles, and `--ui-radius` after the package imports. Products can also add local layout and component composition without changing the shared primitive APIs.

### Which hooks are stable?

Use documented exports, semantic classes, `data-slot` values, public custom properties, and typed props. Do not depend on generated StyleX class names.

### Where should application state and product layout live?

Keep them in the product. `@hraness/ui` owns portable primitives and tokens, optional `@hraness/design-kit` owns shared presentation compositions, and each product owns content, state, data, access policy, and local layout.

## Next action

To consume the package, pin the release shown above, import the complete stylesheet, and render `PreviewCard`. To propose a primitive or compatibility change, read [CONTRIBUTING.md](./CONTRIBUTING.md) before editing the public surface.

## Migrating from 0.1

Version 0.2 replaces recipe helpers with semantic, styled primitives and is intentionally breaking. Rename action variants from `default`, `destructive`, `outline`, `ghost`, and `link` to the closest role among `primary`, `danger`, `secondary`, and `quiet`; replace `sm`, `lg`, and `icon` sizes with `compact`, `large`, and `IconButton`/`IconLink`; and replace `TextField isLabelHidden` with `showLabel={false}`. `buttonVariants` and `badgeVariants` are no longer exported. Conventional `ref` values continue to target the semantic button and field root.

## Development and contributions

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## License

MIT
