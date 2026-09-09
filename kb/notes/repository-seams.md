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
  - src
---

# Repository seams

Hraness UI publishes portable accessible primitives, finite semantic variants, tokens, reset rules, and framework-neutral router integration. Native semantics and React Aria behavior are the interaction contract. Products own their layout, content, application state, data access, and local visual specification.

The design seam is directional. `@hraness/ui` is the primitive layer. Consumers may add an immutable `@hraness/design-kit` release for stable presentation compositions, then keep final product composition in the product. Never create a dependency from UI back to design-kit or to a product.

Consumers pin reviewed immutable releases or full commits and validate upgrades on their own schedule. Do not use sibling paths, Git submodules, or coordinated `main` workflows. Add a shared primitive only after two concrete consumers need the same stable interface. Keep Direct workbenches development-only. Freeze public interfaces before parallel work and give inventories, manifests, locks, generated artifacts, and release convergence surfaces one owner.

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

## Related

The normative rules remain in the root `AGENTS.md`. [[documentation-ownership|Documentation ownership]] explains how those rules relate to executable contracts and this pull-based context.
