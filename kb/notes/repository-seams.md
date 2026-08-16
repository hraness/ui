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

## Related

The normative rules remain in the root `AGENTS.md`. [[documentation-ownership|Documentation ownership]] explains how those rules relate to executable contracts and this pull-based context.
