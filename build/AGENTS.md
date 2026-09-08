# Contents

- `contracts.ts` defines the versioned public manifest, graph-receipt, generation, and complete-record types.
- `compiler.ts` owns the pinned Babel and StyleX transform, raw-rule validation, immutable package serialization, and the versioned final rule-union policy.
- `generation.ts` prepares generation-scoped staging, validates package and graph records, and atomically publishes one complete output.
- `bun.ts` and `vite.ts` are the supported one-shot caller build adapters.
- `next.ts`, `next-contracts.ts`, `next-generation.ts`, `next-plugin.ts`, and `next-loader.*` own the production Next.js discovery, delivery, graph, and receipt boundary.
- `next-ssg.ts` derives the native SSG manifest settlement; `next-auxiliary.ts` records observation-only Next dependency-trace snapshots without following their file lists.
- `next-typescript.ts` owns phase-local TypeScript input projections, exact native type provenance, and physical-project-root environment-file preservation.
- `next-process.ts` owns POSIX child-group cancellation and positive collection before shared-file restoration or lease release.
- `next-dev.ts`, `next-dev-session.ts`, and `next-dev-*.cjs` own the separate opt-in development snapshot, compiler convergence, and native CSS-loader boundary.
- `next-output-settlement.ts` settles private source maps in a caller-owned isolated regular-file stage; it does not change production graph receipt authority.
- `index.ts` is the explicit build-tool export surface; no build module is reachable from the UI runtime entry.
- `*.test.ts` exercises manifests, graph completeness, mixed-output rejection, permutation invariance, lifecycle failures, and transactional publication.

# Guidelines

- Parse every manifest, receipt, compiler result, and bundler record from `unknown`; reject unknown keys and malformed paths before writing publishable output.
- Bind package metadata to final marked runtime JavaScript, standalone recipe CSS, build-tool modules, compiler options, package identity, and exact tool versions.
- Collect raw StyleX rules from every registered client, lazy, multi-entry, and SSR graph, then call the pinned upstream serializer exactly once during finalization.
- Serialize final package-and-graph unions in `components.hraness-stylex` after every registered package's legacy layers. Deduplicate identical rules and reject conflicting identities. Keep package standalone namespaces and compiler identities unchanged.
- Bind generation plans and completion records to schema 2 and `unionPolicySha256`. Keep package manifests and graph receipts on schema 1; require a fresh generation instead of resuming a plan created under another union policy.
- Reserve the entire final union namespace against package foundations and graph CSS, including decoded nested layers and named import layers. Every foundation stylesheet must precede the finalized recipe stylesheet.
- Keep graph outputs and receipts inside a new generation-scoped staging directory. Publish only after every expected graph, template, artifact hash, and stylesheet boundary is complete and verified.
- Production adapters and generation finalization reject watch, serve, HMR, stale or late receipts, incomplete graphs, conflicting rules, output collisions, and any compiler-adopting graph that contains standalone package recipe CSS.
- Keep `stylex-build/next-dev` an explicit separate opt-in for Next 16.2.12 under Webpack 5 and genuine Node 24. Inventory bounded source directories before each compilation, serialize all registered package and application rules with the current union policy, and preserve native CSS delivery. Development snapshots never produce production graph receipts. Ordinary atomic recipe changes retain old rules until the observed client, Node, and Edge compilers converge; a successful observed-empty target can retire participation. Stable `defineVars` and `createTheme` rule replacements require a process restart. Keep Turbopack, Rspack, production use, arbitrary Next versions, and unbounded source inventories closed.
- Prove development updates with frame-level JavaScript/CSS coherence, preserved client state, stale-rule removal, compile-failure recovery, and explicit stable-rule restart controls. Collect the owned browser, processes, streams, and listeners before recording terminal success or removing disposable fixtures.
- Keep absolute paths, timestamps, process identifiers, and temporary names out of canonical record bytes.
- Keep compiler dependencies outside `src/index.ts` and every production UI runtime output. Build-tool entry points are explicit opt-in imports.
- Preserve the plugin-free `@hraness/ui/styles.css` route. Compiler adopters use one foundation stylesheet and one finalized recipe artifact.
- Keep the Next adapter pinned to Next 16.2.12 with webpack and genuine Node 24. Run complete discovery and delivery builds for the client, Node RSC, and Edge RSC targets. Bind each target to the exact repository-source census in the hash-bound plan; an empty target is valid only when the compiler observes no repository source and still emits both target receipts.
- Key the Next output lease by the physical repository root and output directory, independent of evidence-directory choices. Revalidate the plan, package manifests, module and graph receipts, CSS inputs, generated bridge and stylesheet, and settled output bytes immediately before committing the complete record.
- Mark the receipt-producing Next source loader non-cacheable on every invocation. Module cache hits cannot replay attempt-owned receipt writes; preserve webpack's other caches and never relax the complete source census to accept missing receipts.
- Keep Next TypeScript checking enabled in both full native passes. Select a phase-local sibling config through `typescript.tsconfigPath`, inherit authored compiler semantics, preserve resolved source roots and project references, and include the active native type directory. Remove historical root inputs only when their bytes match a prior adapter type inventory. Bind inventories to the pinned pre-webpack type writers and all three graph receipts; unknown or altered files remain errors. Preserve authored config bytes and restore `next-env.d.ts` only from its exact native replacement while holding the physical-project-root TypeScript lease. Native output cleaning is required; preserve previous outputs and receipts.
- A Next complete record proves the StyleX graph, not whole-build integrity or deployment readiness. Keep dependency traces for registered Node server entries separate as observation-only initial/final snapshots. Never use them to authorize dependency copying or exempt JavaScript, CSS, maps, sources, entrypoints, or linked assets. Product packaging and deployment acceptance remain independent gates.
- Add deterministic controls for success after failure, removed inputs, concurrent independent generations, injected publication failures, and terminal child collection.
