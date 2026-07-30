# Contents

- `src/button.tsx` – React Aria action control and exported CVA appearance and size recipes.
- `src/badge.tsx` – non-interactive labels and their exported CVA recipe.
- `src/card.tsx` – card container, header, title, description, content, and footer primitives.
- `src/text-field.tsx` – labelled React Aria input with connected help and validation messages.
- `src/lib/utils.ts` – `cn` class composition and Tailwind conflict resolution.
- `src/*.test.tsx` and `src/lib/*.test.ts` – server-rendered semantics, class recipes, and composition regressions.
- `package.json`, `tsconfig.json`, and `bun.lock` – source-first @hraness/ui package and standalone verification configuration.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, and terms.

# Guidelines

- Use Bun 1.3.14 for repository commands. Keep @hraness/ui source-first, ESM-only, and compatible with React and React DOM 18 through 19.
- Preserve native elements and React Aria Components behavior for accessible names, keyboard and pointer interactions, disabled controls, focus visibility, descriptions, and validation errors.
- Keep Tailwind utility names complete and statically detectable. The package ships no stylesheet, so every setup change must preserve and document the Tailwind v4 `@source` integration and required theme roles.
- Follow the `cva` and `cn` composition contract. Keep variant sets finite, let consumer classes override defaults, and export a recipe only when consumers need it for composition.
- Keep primitives product-neutral and APIs small. Do not add application state, routing, data access, or one-off product variants.
- Add a readable regression test for every behavior, style contract, or public export change. Use server-rendered markup when it proves the contract and browser interaction tests when it does not.
- Treat the repository as the complete public hraness/ui project. Files and Git prose may use only public package names, paths, commands, examples, and dependencies.
- Run `bun run check` before handing off a change.
