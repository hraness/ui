# Contributing

Issues and focused pull requests are welcome in the hraness/ui repository.

Explain a broad API, dependency, theme-token, or compatibility change in the pull request description. Open the pull request and enable auto-merge; the `Required` CI check is the reviewer and merges the change when it passes. Pull requests are held to accessible semantics, small component APIs, statically analyzable StyleX recipes, type safety, and focused tests. The public package remains free of a first-party Tailwind bridge and dependency.

Use Bun 1.3.14 and run the complete local gate before opening a pull request:

```sh
bun install
bun run check
```

Keep interactive behavior in React Aria Components. Put component-local declarations that StyleX can express in a colocated `*.stylex.ts` module. Keep approved global rules in the bounded CSS exports. Include a readable regression test with every behavior, variant, or public export change, and never assert a generated StyleX class literal. The complete gate verifies extracted artifacts and byte-identical builds from different absolute roots. Document any new theme role, public CSS contract, or StyleX compiler requirement in the README.
