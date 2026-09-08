# Contents

- `build.mjs` runs the same production generation through Vite 7.3.6 and 8.2.1, verifies receipts and rejection controls, and renders the emitted SSR module.
- `src/` contains the hydrated package consumer, independent second entry, lazy module, SSR-only recipe, and nested compiler foundation.
- `type-contract.ts` checks the public adapter against each installed Vite declaration set.
- `diagnostics.ts` caps process diagnostics while preserving exact first and last bytes.

# Guidelines

- Use the packed public package. Do not import repository source or replace the compiler, adapter, runtime, or generation finalizer.
- Keep this fixture production-only with source maps disabled. Hidden, inline, copied, and late-enabled maps must fail without a complete graph receipt.
- Keep both client entries, the lazy import, native interaction, independent SSR graph, nested foundation, and one finalized package/caller union observable.
- Run the matrix only through the repository's exclusive validation scheduler. Retain failed evidence and close every owned browser, server, and child process.
