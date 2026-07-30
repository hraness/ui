# Contributing

Issues and focused pull requests are welcome in the hraness/ui repository.

Open an issue before starting a broad API, dependency, theme-token, or compatibility change. Maintainers review pull requests for accessible semantics, small component APIs, statically detectable Tailwind classes, type safety, and focused tests.

Use Bun 1.3.14 and run the complete local gate before opening a pull request:

```sh
bun install
bun run check
```

Keep interactive behavior in React Aria Components. Include a readable regression test with every behavior, variant, or public export change. Document any new theme role or Tailwind setup requirement in the README.
