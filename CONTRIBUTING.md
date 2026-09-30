# Contributing

Issues and focused pull requests are welcome in the hraness/ui repository.

Explain a broad API, dependency, theme-token, or compatibility change in the pull request description. Open the pull request and enable auto-merge; the `Required` CI check is the reviewer and merges the change when it passes. Pull requests are held to accessible semantics, small component APIs, statically analyzable StyleX recipes, type safety, and focused tests. The public package remains free of a first-party Tailwind bridge and dependency.

Use Bun 1.3.14 and run the local gate before opening a pull request:

```sh
bun install
bun run check:quick
```

Run the focused package, browser, or adopter smoke for the behavior you changed. The full `bun run check` runs as parallel jobs behind CI's `Required` check. Run the full chain locally when a change spans every adopter surface. Changes to Next build caching or stale-state handling also require the complete local `bun run test:next-adopter` so it checks consecutive builds in the same consumer.

Keep interactive behavior in React Aria Components. Put component-local declarations that StyleX can express in a colocated `*.stylex.ts` module. Keep approved global rules in the bounded CSS exports. Include a readable regression test with every behavior, variant, or public export change, and never assert a generated StyleX class literal. The complete gate verifies extracted artifacts and byte-identical builds from different absolute roots. Document any new theme role, public CSS contract, or StyleX compiler requirement in the README.

## Releases

The release workflow checks the exact tagged commit, its main-branch ancestry, stable version ordering, and the complete CI suite. It then packs that checked source once with npm 11.19.0 and Bun 1.3.14, records its source commit, tree, SHA256, and SHA512 integrity, and creates a signed GitHub provenance attestation. It rejects archive files absent from that Git tree, including ignored build leftovers.

The archive, `SHA256SUMS`, `release.json`, and `provenance.jsonl` are uploaded to a draft release. The workflow downloads and verifies the package identity, bytes, and signed source before publishing the immutable GitHub Release, then verifies its published assets again. An existing release must match the same source and bytes and contain exactly those assets; the workflow never replaces its assets. Install from the versioned archive URL shown in the README.

## npm

After the GitHub Release, the optional `npm` job downloads and verifies the
canonical archive, then publishes those same bytes to npm as `@hraness/ui`
with a provenance attestation. It uses npm
trusted publishing, so GitHub Actions proves the workflow's identity to npm
and no npm token is stored anywhere. No one needs to approve a release. The
job verifies an existing version's identity, integrity, provenance, and downloaded bytes instead of publishing it again. npm availability does not block the canonical GitHub package.

npm only accepts trusted publishing for a package that already exists, so the
job warns and skips until a maintainer does this once:

1. Download and verify the package archive from the newest immutable GitHub Release, then publish that file by hand:
   `npm publish ./hraness-ui-<version>.tgz --access public --ignore-scripts`.
2. Let this workflow publish from now on:
   `npm trust github @hraness/ui --repo hraness/ui --file release.yml --allow-publish --yes`
   (npm 11.16 or newer).
3. In the package settings on npmjs.com, require two-factor authentication and
   disallow tokens.
