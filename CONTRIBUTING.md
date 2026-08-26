# Contributing

Issues and focused pull requests are welcome in the hraness/ui repository.

Open an issue before starting a broad API, dependency, theme-token, or compatibility change. Maintainers review pull requests for accessible semantics, small component APIs, statically analyzable StyleX recipes, type safety, and focused tests. Tailwind compatibility code must remain statically detectable until its documented transition export is removed.

Use Bun 1.3.14 and run the complete local gate before opening a pull request:

```sh
bun install
bun run check
```

Keep interactive behavior in React Aria Components. Put component-local declarations that StyleX can express in a colocated `*.stylex.ts` module. Keep approved global rules in the bounded CSS exports. Include a readable regression test with every behavior, variant, or public export change, and never assert a generated StyleX class literal. The complete gate verifies extracted artifacts and byte-identical builds from different absolute roots. Document any new theme role, StyleX compiler requirement, or temporary Tailwind setup requirement in the README.
