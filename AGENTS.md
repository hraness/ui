# Contents

- `src/actions.tsx`, `src/fields.tsx`, `src/form.tsx`, `src/select-field.tsx`, and `src/checkbox-group.tsx` – accessible actions and complete form controls.
- `src/collections.tsx`, `src/list-box.tsx`, `src/overlays.tsx`, and `src/toast.tsx` – collection and overlay behavior backed by React Aria Components.
- `src/badge.tsx`, `src/card.tsx`, `src/content.tsx`, `src/data-display.tsx`, `src/feedback.tsx`, `src/icon.tsx`, and `src/indicators.tsx` – status, surface, content, data, feedback, and shared icon primitives.
- `src/navigation.tsx`, `src/quiet-site.tsx`, `src/router.tsx`, `src/skip-link.tsx`, `src/surfaces.tsx`, and `src/toolbar.tsx` – navigation, quiet-site landmarks, framework-neutral router integration, and structural layout primitives.
- `src/lib/utils.ts` – `cn` class composition and Tailwind conflict resolution.
- `src/tokens.css`, `src/reset.css`, `src/components.css`, `src/tailwind.css`, and `src/styles.css` – portable tokens, baseline, component recipes, Tailwind integration, and the ordered public stylesheet.
- `src/*.test.tsx` and `src/lib/*.test.ts` – server-rendered semantics, class recipes, and composition regressions.
- `package.json`, `tsconfig.json`, and `bun.lock` – source-first @hraness/ui package and standalone verification configuration.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, and terms.

# Guidelines

- Use Bun 1.3.14 for repository commands. Keep @hraness/ui source-first, ESM-only, and compatible with React and React DOM 18 through 19.
- Preserve native elements and React Aria Components behavior for accessible names, keyboard and pointer interactions, disabled controls, focus visibility, descriptions, and validation errors.
- Keep Tailwind utility names complete and statically detectable. Preserve the stylesheet's internal `@source` integration, namespaced theme roles, and documented import order.
- Keep tokens and reset usable as standards-only CSS. Tailwind directives belong only in `tailwind.css`; component styling retains coarse-pointer, forced-color, reduced-motion, and consumer-override behavior.
- Keep semantic variant sets finite, render them as stable data attributes, and use `cn` for consumer class composition.
- Keep primitives product-neutral and APIs small. A framework-neutral React Aria router bridge may coordinate navigation and intent prefetching; do not add framework bindings, application state, data access, or one-off product variants.
- Keep social and appearance glyph sets finite. Icons remain decorative beside visible text or inside controls with their own accessible names.
- Add a readable regression test for every behavior, style contract, or public export change. Use server-rendered markup when it proves the contract and browser interaction tests when it does not.
- Treat the repository as the complete public hraness/ui project. Files and Git prose may use only public package names, paths, commands, examples, and dependencies.
- Run `bun run check` before handing off a change.
