# Packed Bun metafile diagnostics

This recovery bundle records how Bun 1.3.14 reports selected imports and plugin
loads in an existing packed consumer build. It is diagnostic-only. It does not
run browser acceptance, certify an adapter, or establish release readiness.
The bundle is not a package export or part of the production build graph.

## Observation modes

| Mode | Import selection | Package metadata and fixed path probes |
| --- | --- | --- |
| `single-package` | Importer contains `react-aria-components`; import path contains `Collection.mjs` | `react-aria-components`, its package-boundary metadata, exports entry, and private Collection module |
| `cross-package` | Importer contains `react-aria-components`; import path contains `openLink.mjs` | Both `react-aria-components` and `react-aria`, including the exports/private and private/utils openLink candidates |

Each observation retains the raw metafile, ordered input keys, matching importer
metadata and import keys, and three possible import resolutions: relative to
the importer, build root, and process working directory. Plugin `onLoad`
observations retain start/completion/rejection state, namespace, path, loader,
returned-content size, and SHA-256. Package observations retain name, version,
`sideEffects`, whether that property is authored, and the metadata SHA-256.
Path probes record type, mode, size, physical path, and ordinary-file SHA-256.

Build options, plugin results, and the original build result are forwarded
without replacing the compiler or forcing metafile generation. A missing
metafile remains visible as missing evidence. The observer adds no source
transform. It can affect timing and reports observation failures as errors.

## Run an isolated diagnostic

Use an already prepared consumer whose dependencies came from a known packed
archive and retained manifest. This driver does not install dependencies,
unpack an archive, or prepare a consumer. Record the archive and lockfile
identities separately with the experiment; the raw diagnostic is not a
reproducibility receipt.

The selected entry must be a reviewed **build-only** script that ends after
building. Do not select the browser smoke orchestrator or an entry that starts
servers or detached processes. A dynamically imported script can execute its
own code; this driver is not a sandbox for untrusted entries.
The entry runs as an imported module and must build at module top level. Entries
that depend on `import.meta.main` or their own command-line arguments are not
supported by this driver.

Set `CONSUMER_ROOT` to its existing physical directory and `DIAGNOSTIC_OUTPUT`
to an existing caller-owned private directory (mode `0700`) outside both the
consumer and this repository. Relative CLI directory arguments resolve from
the invocation directory. The entry is a normalized consumer-relative path.
Queue the command through the same scheduler used for other native builds.

```sh
bun diagnostics/packed-bun-metafile/run.ts \
  --mode single-package \
  --consumer "$CONSUMER_ROOT" \
  --entry build.ts \
  --output "$DIAGNOSTIC_OUTPUT"
```

Use a separate output directory for `--mode cross-package`. Receipts use the
original `diagnostic-build-N.json` or `cross-package-diagnostic-build-N.json`
names, exclusive creation, and mode `0600`. Existing results are never replaced
or removed. The driver restores `Bun.build` and the working directory after the
entry returns or throws. After a completed observed entry, it deliberately
throws “Diagnostic build completed; browser phase deliberately not started.”
That nonzero exit is intentional, not an acceptance pass. Other failures must
be inspected separately.

## Privacy and retained evidence

Raw metafiles, plugin errors, package data, and path probes can contain local
filesystem provenance. Keep generated JSON private and review it before
sharing. This public bundle contains no historical raw output or host paths.
Original experiments and their source remain separate evidence; these portable
scripts do not claim byte-identical receipts or repeat their execution.

Unlike the original exploratory probes, this driver will not hash a path that
escapes the selected consumer, including through a symlink. It still reports
the proposed path and boundary failure. Individual input files and serialized
receipts have a 64 MiB bound. Unsupported topology, changing input identity,
invalid arguments, or existing output names fail visibly.

## Source checks

```sh
bun test ./diagnostics/packed-bun-metafile/observer.test.ts
```

These tests inject fake builds and an in-memory observation sink. They do not
invoke `Bun.build`, create receipts, or run a browser. A fresh experiment remains
a separate, scheduled operation.
