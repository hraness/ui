# Contents

- `contracts.ts` defines the versioned public manifest, graph-receipt, generation, and complete-record types.
- `compiler.ts` owns the pinned Babel and StyleX transform, raw-rule validation, and the single upstream CSS serialization contract.
- `generation.ts` prepares generation-scoped staging, validates package and graph records, and atomically publishes one complete output.
- `bun.ts` and `vite.ts` are the supported one-shot caller build adapters. Vite 7.3.6 and 8.2.1 are the checked contracts; output source maps, serve, watch, and HMR stay disabled.
- `next-dev.ts`, `next-dev-session.ts`, and the two `next-dev-*.cjs` loaders provide the optional Next 16.2.12 Webpack development adapter under genuine Node 24.
- `next-output-settlement.ts` provides optional provider-neutral privacy settlement for one isolated, exact regular-file delivery stage.
- `index.ts` is the explicit build-tool export surface; no build module is reachable from the UI runtime entry.
- `*.test.ts` exercises manifests, graph completeness, mixed-output rejection, permutation invariance, lifecycle failures, and transactional publication.

# Guidelines

- Parse every manifest, receipt, compiler result, and bundler record from `unknown`; reject unknown keys and malformed paths before writing publishable output.
- Preserve the map-free `transform` result. Keep `transformWithMap` opt-in, require a normalized logical source filename, validate version 3 input and output maps, and bind their canonical hashes without implying that a caller's bundler output maps are enabled.
- Bind package metadata to final marked runtime JavaScript, standalone recipe CSS, build-tool modules, compiler options, package identity, and exact tool versions.
- Collect raw StyleX rules from every registered client, lazy, multi-entry, and SSR graph, then call the pinned upstream serializer exactly once during finalization.
- Keep graph outputs and receipts inside a new generation-scoped staging directory. Publish only after every expected graph, template, artifact hash, and stylesheet boundary is complete and verified.
- Reject watch, serve, and HMR in one-shot build adapters. The Next development adapter is the only supported HMR boundary and must reject production, Turbopack, unsupported runtimes, stale snapshots, split compiler revisions, or standalone package recipe CSS.
- Keep the Next development CSS entry equal to `STYLEX_NEXT_DEV_CSS_ENTRY`. Retain old-only atomic identities only while participating client, Node server, and active Edge compilers converge, then invalidate once and prune to current-only. Preserve last-good failure recovery. A changed stable `defineVars` or `createTheme` identity requires a development-server restart.
- Count only compilers that actually consume an owned source or stylesheet graph as participating. An idle or irrelevant Edge compiler must not delay convergence; a relevant Edge compiler must attest the same revision. Register exact existing and missing source and package inputs with native watching so creation, removal, and repaired failures trigger a bounded revision.
- Settle private maps only inside an isolated exact regular-file stage while the caller holds the output lease. Accept only a trusted caller-bound processor, preserve modes and topology, remove exact private maps and terminal references, and expose a separate late revalidation for the outer atomic publisher. Keep provider implementations and credentials out of this package.
- Keep absolute paths, timestamps, process identifiers, and temporary names out of canonical record bytes.
- Keep compiler dependencies outside `src/index.ts` and every production UI runtime output. Build-tool entry points are explicit opt-in imports.
- Preserve the plugin-free `@hraness/ui/styles.css` route. Compiler adopters use one foundation stylesheet and one finalized recipe artifact.
- Add deterministic controls for success after failure, removed inputs, concurrent independent generations, injected publication failures, and terminal child collection.
