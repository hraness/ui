# Contents

- `next.config.mjs` configures the packed public `@hraness/ui/stylex-build/next-dev` export for Next 16.2.12 development under Webpack.
- `app/` contains client, Node server, active or inactive Edge, lazy, unvisited, failure-recovery, stable-variable, theme, native-CSS, and native-asset witnesses.
- `app/stylex-dev.css` is the exact public native-CSS marker imported by the application layout.
- `verify.ts` drives frame-level browser assertions across ordinary atomic edits, compiler convergence, failure recovery, source creation and removal, and explicit restart boundaries.

# Guidelines

- Keep the fixture self-contained, deterministic, loopback-only, and loadable from a packed package under genuine Node 24 with `next dev --webpack`. Do not add Turbopack or production-build claims.
- Keep `app/stylex-dev.css` byte-equal to `STYLEX_NEXT_DEV_CSS_ENTRY` and import it once from the root layout. Do not add presentation rules to the marker file.
- Exercise both an active Edge route and the derived no-Edge application. An inactive Edge compiler must not block client and Node server convergence.
- For ordinary atomic recipes, prove that every painted frame has coherent JavaScript and CSS, that form state survives native HMR, and that converged output removes stale rules. Preserve last-good browser CSS during a reported compilation failure and prove recovery through exact existing and missing watch inputs.
- Treat stable `stylex.defineVars` and `stylex.createTheme` replacements as an explicit restart boundary. Prove the fail-closed diagnostic and recovery after restart; never describe that transition as seamless HMR.
- Restore every disposable source byte, terminate the owned process group and listener, reject external requests, and leave the authored fixture unchanged after success.
