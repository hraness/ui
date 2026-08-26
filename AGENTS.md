<!-- kb:context scopes/repository--cdb4ee2aea69 -->
# Contents

- `src/actions.tsx`, `src/fields.tsx`, `src/form.tsx`, `src/select-field.tsx`, and `src/checkbox-group.tsx` – accessible actions and complete form controls.
- `src/collections.tsx`, `src/list-box.tsx`, `src/overlays.tsx`, and `src/toast.tsx` – collection and overlay behavior backed by React Aria Components.
- `src/badge.tsx`, `src/card.tsx`, `src/content.tsx`, `src/data-display.tsx`, `src/feedback.tsx`, `src/icon.tsx`, `src/icon.stylex.ts`, and `src/indicators.tsx` – status, surface, content, data, feedback, and shared icon primitives, including the first package-compiled StyleX recipe.
- `src/navigation.tsx`, `src/quiet-site.tsx`, `src/router.tsx`, `src/skip-link.tsx`, `src/surfaces.tsx`, and `src/toolbar.tsx` – navigation, quiet-site landmarks, framework-neutral router integration, and structural layout primitives.
- `src/lib/utils.ts` – `cn` class composition and Tailwind conflict resolution.
- `src/tokens.css`, `src/reset.css`, `src/components.css`, `src/tailwind.css`, and `src/styles.css` – portable tokens, baseline, legacy recipes namespaced below StyleX, the transition Tailwind bridge, and the ordered public stylesheet.
- `src/*.test.tsx` and `src/lib/*.test.ts` – server-rendered semantics, class recipes, and composition regressions.
- `portfolio-inventory.json` and `scripts/check-portfolio-inventory.ts` – canonical public package inventory and its standalone consistency gate.
- `kb/` – authored repository rationale, maintained synthesis, and durable plans.
- `.agents/skills/` – portable KB and phased-execution workflows.
- `WRITING.md` and `STYLE.md` – internal and public prose contracts.
- `scripts/build-package.ts`, `scripts/stylex-config.ts`, and `scripts/check-stylex-*.ts` – the package-owned StyleX compiler and its artifact and absolute-root determinism gates.
- `package.json`, `tsconfig.json`, and `bun.lock` – built ESM runtime, source type, CSS export, and standalone verification configuration.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, and terms.

# Guidelines

- Use Bun 1.3.14 for repository commands. Keep @hraness/ui ESM-only, publish package-compiled JavaScript with source TypeScript types, and remain compatible with React and React DOM 18 through 19.
- Follow `WRITING.md` for internal prose and `STYLE.md` for public prose.
- Apply unreasonably robust programming when agent work is cheap. Prefer coherent cross-file correctness and focused deterministic evidence to a knowingly weaker design.
- Deliver changes to `main` through a current-head pull request. Keep the stable `Required` CI job green, resolve every review thread, and serialize merges. Human approval stays optional while one regular maintainer would otherwise self-review. Never force-push or bypass the gate.
- Preserve native elements and React Aria Components behavior for accessible names, keyboard and pointer interactions, disabled controls, focus visibility, descriptions, and validation errors.
- Author component-local styles in statically analyzable `*.stylex.ts` modules when StyleX can express the contract. Keep the exact compiler configuration centralized in `scripts/stylex-config.ts`, disable runtime CSS injection, emit `dist/stylex.css`, and require byte-identical JavaScript and CSS across absolute roots.
- Keep legacy recipes inside `components.hraness-ui.legacy` and `dist/stylex.css` inside the `components.hraness-ui.priority1` and `priority2` sublayers. The complete stylesheet must keep `base` below `components`, declare the exact legacy-to-priority2 order before its imports, import each legacy and StyleX stylesheet exactly once, and reject rules placed directly in the `components` parent layer. Keep gallery-only cascade sentinels out of package output.
- Keep Tailwind utility names complete and statically detectable while the compatibility bridge exists. Preserve its internal `@source` integration, namespaced theme roles, `cn`, `tailwind-merge`, and documented import order until a separately evidenced release removes them.
- Keep tokens and reset usable as standards-only CSS. Tailwind directives belong only in `tailwind.css`; remaining CSS retains coarse-pointer, forced-color, reduced-motion, and approved global-boundary behavior.
- Keep semantic variant sets finite and render them as stable data attributes. Preserve documented semantic classes and `data-slot` values. Apply base StyleX recipes first, finite variant and state recipes next, and a typed caller `xstyle` last; keep caller `className` separate and compatible during the migration.
- Keep primitives product-neutral and APIs small. A framework-neutral React Aria router bridge may coordinate navigation and intent prefetching; do not add framework bindings, application state, data access, or one-off product variants.
- Model component states so invalid combinations cannot exist. Parse foreign values from `unknown` before they reach component props or state.
- Keep social and appearance glyph sets finite. Icons remain decorative beside visible text or inside controls with their own accessible names.
- Add a readable deterministic regression test for every behavior, style contract, or public export change. Never snapshot generated StyleX class literals. Test semantic hooks, merge behavior, extracted declarations, and computed precedence instead. Add property tests for parsers, reducers, ordering, round trips, finite variant laws, and other general invariants. Use server-rendered markup when it proves the contract and browser interaction tests when it does not.
- Pin Hraness dependencies to reviewed immutable releases or full commits. Never connect repositories with sibling paths, Git submodules, or coordinated `main` assumptions.
- Extract a shared primitive only after two concrete consumers need the same stable interface. Keep `@hraness/ui` product-neutral and independently releasable; consumers upgrade on their own validation schedule.
- Keep the design seam directional: `@hraness/ui` owns portable accessible primitives and tokens, optional `@hraness/design-kit` owns stable presentation compositions, and each product owns layout, content, state, and its local visual contract. Never add a dependency from this package back to design-kit or a product.
- Freeze public interfaces before parallel lanes begin. Give manifests, lockfiles, generated inventories, and other convergence surfaces one owner while lanes edit disjoint paths.
- Keep mandatory rules in the closest `AGENTS.md`, current procedures in `docs/` when needed, executable contracts in types and tests, and pull-based rationale and plans in `kb/`.
- Run `bun run kb:check:lane` in an independent KB lane. The integrating agent runs `bun run kb:refresh` and `bun run kb:check`.
- Treat the repository as the complete public hraness/ui project. Files and Git prose may use only public package names, paths, commands, examples, and dependencies.
- Keep `portfolio-inventory.json` byte-canonical and consistent with the public package identity, version, repository, and direct `@hraness/*` dependency edges.
- Run `bun run check` before handing off a change.
