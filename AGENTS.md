<!-- kb:context scopes/repository--cdb4ee2aea69 -->
# Contents

- `src/actions.tsx`, `src/fields.tsx`, `src/form.tsx`, `src/select-field.tsx`, and `src/checkbox-group.tsx` – accessible actions and complete form controls.
- `src/collections.tsx`, `src/list-box.tsx`, `src/overlays.tsx`, and `src/toast.tsx` – collection and overlay behavior backed by React Aria Components.
- `src/badge.tsx`, `src/card.tsx`, `src/content.tsx`, `src/data-display.tsx`, `src/feedback.tsx`, `src/icon.tsx`, and `src/indicators.tsx` – status, surface, content, data, feedback, and shared icon primitives.
- `src/navigation.tsx`, `src/quiet-site.tsx`, `src/router.tsx`, `src/skip-link.tsx`, `src/surfaces.tsx`, and `src/toolbar.tsx` – navigation, quiet-site landmarks, framework-neutral router integration, and structural layout primitives.
- `src/lib/utils.ts` – `cn` class composition and Tailwind conflict resolution.
- `src/tokens.css`, `src/reset.css`, `src/components.css`, `src/tailwind.css`, and `src/styles.css` – portable tokens, baseline, component recipes, Tailwind integration, and the ordered public stylesheet.
- `src/*.test.tsx` and `src/lib/*.test.ts` – server-rendered semantics, class recipes, and composition regressions.
- `portfolio-inventory.json` and `scripts/check-portfolio-inventory.ts` – canonical public package inventory and its standalone consistency gate.
- `kb/` – authored repository rationale, maintained synthesis, and durable plans.
- `.agents/skills/` – portable KB and phased-execution workflows.
- `WRITING.md` and `STYLE.md` – internal and public prose contracts.
- `package.json`, `tsconfig.json`, and `bun.lock` – source-first @hraness/ui package and standalone verification configuration.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, and terms.

# Guidelines

- Use Bun 1.3.14 for repository commands. Keep @hraness/ui source-first, ESM-only, and compatible with React and React DOM 18 through 19.
- Follow `WRITING.md` for internal prose and `STYLE.md` for public prose.
- Apply unreasonably robust programming when agent work is cheap. Prefer coherent cross-file correctness and focused deterministic evidence to a knowingly weaker design.
- Deliver changes to `main` through a current-head pull request. Keep the stable `Required` CI job green, resolve every review thread, and serialize merges. Human approval stays optional while one regular maintainer would otherwise self-review. Never force-push or bypass the gate.
- Preserve native elements and React Aria Components behavior for accessible names, keyboard and pointer interactions, disabled controls, focus visibility, descriptions, and validation errors.
- Keep Tailwind utility names complete and statically detectable. Preserve the stylesheet's internal `@source` integration, namespaced theme roles, and documented import order.
- Keep tokens and reset usable as standards-only CSS. Tailwind directives belong only in `tailwind.css`; component styling retains coarse-pointer, forced-color, reduced-motion, and consumer-override behavior.
- Keep semantic variant sets finite, render them as stable data attributes, and use `cn` for consumer class composition.
- Keep primitives product-neutral and APIs small. A framework-neutral React Aria router bridge may coordinate navigation and intent prefetching; do not add framework bindings, application state, data access, or one-off product variants.
- Model component states so invalid combinations cannot exist. Parse foreign values from `unknown` before they reach component props or state.
- Keep social and appearance glyph sets finite. Icons remain decorative beside visible text or inside controls with their own accessible names.
- Add a readable deterministic regression test for every behavior, style contract, or public export change. Add property tests for parsers, reducers, ordering, round trips, finite variant laws, and other general invariants. Use server-rendered markup when it proves the contract and browser interaction tests when it does not.
- Pin Hraness dependencies to reviewed immutable releases or full commits. Never connect repositories with sibling paths, Git submodules, or coordinated `main` assumptions.
- Extract a shared primitive only after two concrete consumers need the same stable interface. Keep `@hraness/ui` product-neutral and independently releasable; consumers upgrade on their own validation schedule.
- Keep the design seam directional: `@hraness/ui` owns portable accessible primitives and tokens, optional `@hraness/design-kit` owns stable presentation compositions, and each product owns layout, content, state, and its local visual contract. Never add a dependency from this package back to design-kit or a product.
- Freeze public interfaces before parallel lanes begin. Give manifests, lockfiles, generated inventories, and other convergence surfaces one owner while lanes edit disjoint paths.
- Keep mandatory rules in the closest `AGENTS.md`, current procedures in `docs/` when needed, executable contracts in types and tests, and pull-based rationale and plans in `kb/`.
- Run `bun run kb:check:lane` in an independent KB lane. The integrating agent runs `bun run kb:refresh` and `bun run kb:check`.
- Treat the repository as the complete public hraness/ui project. Files and Git prose may use only public package names, paths, commands, examples, and dependencies.
- Keep `portfolio-inventory.json` byte-canonical and consistent with the public package identity, version, repository, and direct `@hraness/*` dependency edges.
- Run `bun run check` before handing off a change.
