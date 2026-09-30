# Contributing

Issues and focused pull requests are welcome in the hraness/ui repository.

Explain a broad API, dependency, theme-token, or compatibility change in the pull request description. Open the pull request and enable auto-merge; the `Required` CI check is the reviewer and merges the change when it passes. Pull requests are held to accessible semantics, small component APIs, statically analyzable StyleX recipes, type safety, and focused tests. The public package remains free of a first-party Tailwind bridge and dependency.

Use Bun 1.3.14 and run the complete local gate before opening a pull request:

```sh
bun install
bunx --no-install playwright-core install chromium
env -u CHROMIUM_EXECUTABLE_PATH bun run check
```

Browser checks use the Chromium provisioned for the pinned `playwright-core` version. They report its resolved executable and version, mute audio, and disable code-sign clones. The command above clears a shell-wide browser selection so this checkout resolves its own pinned browser. `CHROMIUM_EXECUTABLE_PATH` may point only to that provisioned executable; installed Chrome and fallback browsers are rejected. The Vite worker retains its existing process ownership and cleanup checks.

Keep interactive behavior in React Aria Components. Put component-local declarations that StyleX can express in a colocated `*.stylex.ts` module. Keep approved global rules in the bounded CSS exports. Include a readable regression test with every behavior, variant, or public export change, and never assert a generated StyleX class literal. The complete gate verifies extracted artifacts and byte-identical builds from different absolute roots. Document any new theme role, public CSS contract, or StyleX compiler requirement in the README.

## npm

After the GitHub Release, the release workflow's `npm` job publishes the
tagged commit to npm as `@hraness/ui` with a provenance attestation. It uses npm
trusted publishing, so GitHub Actions proves the workflow's identity to npm
and no npm token is stored anywhere. No one needs to approve a release. The
job skips a version that npm already has.

npm only accepts trusted publishing for a package that already exists, so the
job warns and skips until a maintainer does this once:

1. From a clean checkout of the newest `v*` tag, which the release workflow
   has already checked, publish the first version by hand:
   `npm publish --access public --ignore-scripts`.
2. Let this workflow publish from now on:
   `npm trust github @hraness/ui --repo hraness/ui --file release.yml --allow-publish --yes`
   (npm 11.16 or newer).
3. In the package settings on npmjs.com, require two-factor authentication and
   disallow tokens.
