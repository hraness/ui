---
title: Repository seams
type: concept
tags:
  - architecture
  - dependencies
  - repositories
repository_scopes:
  - AGENTS.md
  - kb
  - WRITING.md
  - STYLE.md
  - package.json
  - portfolio-inventory.json
  - build/bun.ts
  - build/bun.test.ts
  - src
---

# Repository seams

Hraness UI publishes portable accessible primitives, finite semantic variants, tokens, reset rules, and framework-neutral router integration. Native semantics and React Aria behavior are the interaction contract. Products own their layout, content, application state, data access, and local visual specification.

The design seam is directional. `@hraness/ui` is the primitive layer. Consumers may add an immutable `@hraness/design-kit` release for stable presentation compositions, then keep final product composition in the product. Never create a runtime dependency from UI back to design-kit or to a product; design-kit itself peer-declares UI. Shared authored data still flows one way through a development-time design-kit pin that feeds generators vendoring committed modules into UI. `AskAiAboutThis` carries its provider marks this way, and the freshness check fails if the vendored copy drifts from the pinned registry.

Consumers pin reviewed immutable releases or full commits and validate upgrades on their own schedule. Do not use sibling paths, Git submodules, or coordinated `main` workflows. Add a shared primitive only after two concrete consumers need the same stable interface. Keep Direct workbenches development-only. Freeze public interfaces before parallel work and give inventories, manifests, locks, generated artifacts, and release convergence surfaces one owner.

Runtime dependency ranges also affect fresh consumers: the repository lockfile
does not constrain another project's dependency resolution. UI pins
`@hugeicons/core-free-icons` to `4.2.3`, whose published archive resolves its ESM
imports with exact filename casing. The `4.3.4` archive has six grid-icon import
paths whose filenames use an uppercase `X`, such as `Grid2X2CheckIcon.js` instead
of the imported `Grid2x2CheckIcon.js`, so Node cannot import it on a case-sensitive
filesystem. The earlier `^4.2.2` range admitted that broken release even while
UI's own lockfile retained `4.2.3`. Any future icon upgrade must qualify the
published archive and fresh packed-package Node import on Linux before widening
or replacing this pin.

Compiler compatibility is also an explicit package contract. The Next adapter
qualifies exactly 16.2.12 and 16.3.3, with 16.2.12 retained as the default.
An adopter selecting 16.3.3 sets the same exact version in its build runner and
Next configuration; the installed framework and all creator, graph, type and
postprocessing receipts must agree. The optional package peer declares those
two versions, not a range of untested releases. The packed-consumer matrix
checks each profile independently. Its static-root fixture and separate
root-parameter writer probe do not claim dynamic-root route acceptance.
The extraction plan records the [[plans/stable-stylex-consumer-extraction|qualification evidence and remaining delivery gates]].

The compiler's property-validation policy must also be explicit. StyleX 0.19
defaults to silently omitting unsupported shorthand declarations under
property-specificity resolution. A successful transform can therefore lose a
border even when TypeScript accepts the source. The compiler contract selects
`propertyValidationMode: "throw"`; mapped and unmapped transforms share that
option, and focused tests inspect emitted longhands as well as rejection.
Supported shorthand declarations, including `font`, keep their existing
behavior. Product browser comparisons remain necessary to catch valid CSS
whose inherited variables or cascade differ from its source presentation.

Changing this policy changes the canonical compiler hash. Package manifests
and graph generations from silent-validation releases cannot be relabeled or
mixed into a new compiler generation. Rebuild participating shared packages
and product graphs in dependency order, then validate each immutable consumer
upgrade. Existing standalone stylesheets retain their original identity.

## Bun ReactDOM self-references

Bun 1.3.14 can report ReactDOM's CommonJS `require("react-dom")` as a raw
`import-statement` whose path is `react-dom`, without `original`, attributes,
or a resolved witness for that import kind. The adapter recognizes four finite
ReactDOM 19.2.3 importer profiles:

- `cjs/react-dom-client.production.js`
- `cjs/react-dom-server-legacy.browser.production.js`
- `cjs/react-dom-server.bun.production.js`
- `cjs/react-dom-server.browser.production.js`

Each profile binds the importer, package manifest, and public `index.js` root
to their source hashes. The raw edge must keep its exact kind and shape, and
both files must belong to the pinned package scope in the one resolver-visible
installation. Resolution policy and snapshot revalidation also apply.

The root must already be both an authoritative graph input and an observed
source. Its `require` export conditions select `index.js`; the metadata label
does not turn the original CommonJS call into an ES module import. That root
executes `checkDCE` before loading its production child, so the graph preserves
the importer-to-root and root-to-child edges. A direct edge to the child would
omit executed code. These profiles prove only the four pinned self-references;
another importer needs its own native evidence and source identity.

Native production graphs built for Bun from `react-dom/server` and
`react-dom/server.browser` include both the legacy renderer and a modern
streaming renderer. The legacy renderer's resolved edge can supply the sole
`react-dom` input witness for the streaming renderer's raw edge. An isolated
legacy fixture therefore misses the streaming failure when that witness
disappears. Regressions must cover the complete public-entry graphs with no
usable `react-dom` input witnesses, preserve their native source and input
inventory, and prove each renderer's edge to the observed root independently.
Recovering one edge through its pinned profile does not create native witness
evidence for another edge. The root-to-child edge must also survive settlement.
The [Bun adapter](../../build/bun.ts) and its
[regression tests](../../build/bun.test.ts) own the executable proof.

## AskAi static provider accents

`AskAiAboutThis` uses a finite set of provider colors. Literal provider StyleX
recipes compile the accent-dependent `backgroundColor`, `backgroundImage`,
`color`, and `outline` expressions so the default server-rendered component
emits no `style` attributes. These paint rules stay in the compiler's priority
layers; StyleX 0.19 emits custom-property atoms outside those layers. Keep the
vendored artwork, provider colors and links, and forced-color glyph behavior
with that presentation. The caller's explicit root `style` remains a separate
composition contract: merge it after the root's StyleX presentation.
The [component](../../src/ask-ai.tsx),
[recipes](../../src/ask-ai.stylex.ts), and
[regression tests](../../src/ask-ai.test.tsx) own this boundary.

[UI #85](https://github.com/hraness/ui/pull/85), commit
[`827c07f`](https://github.com/hraness/ui/commit/827c07ffd69ed09738bdbddb530a86b428a52db0),
introduced inline `--_ask-ai-accent` declarations in v0.5.19. After UI v0.5.24
repaired the Bun public-server graph importer issue, Slopcamera's retained
renderer reached its existing `Site renderer introduced inline styling` guard and rejected
exactly four default icon declarations: `#0f1014`, `#d97757`, `#22b8cd`, and
`#1a1a1a`. Consumer styling and the guard had not changed. This separates
successful dependency-graph construction from the consumer's rendered-markup
contract; both need their own evidence. Moving these finite values into
component recipes preserves the compiler policy while allowing strict
consumers to keep their inline-style guard.

## Related

The normative rules remain in the root `AGENTS.md`. [[documentation-ownership|Documentation ownership]] explains how those rules relate to executable contracts and this pull-based context.
