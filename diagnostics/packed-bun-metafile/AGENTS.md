# Contents

- `README.md` describes the two observation modes, prerequisites, intentional diagnostic stop, and private output boundary.
- `observer.ts` contains pure argument, metafile-selection, and injected build-observation helpers.
- `run.ts` applies the observer to one explicitly selected, existing build-only entry under Bun 1.3.14.
- `observer.test.ts` checks arguments and instrumentation without running a build or writing receipts.

# Guidelines

- Keep this bundle diagnostic-only and outside package exports and acceptance gates. A recorded build is not browser, release, or migration acceptance.
- Preserve both Collection.mjs single-package and openLink.mjs cross-package observations. Forward original build options, plugin results, failures, and the build result unchanged.
- Keep raw metafiles, filesystem paths, errors, and receipts in a caller-owned private output directory outside the consumer and this repository. Never commit experiment output or actual host provenance.
- Accept explicit consumer, entry, mode, and output arguments. Do not install, unpack archives, provision a browser, or select a private checkout implicitly.
- Run only the pure colocated tests in the edit loop. An actual diagnostic build requires the repository's normal build scheduling and an explicitly reviewed build-only entry.
