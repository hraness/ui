---
title: Stable StyleX extraction across package and consumer builds
type: plan
area: stylex
status: in-progress
---

# Stable StyleX extraction across package and consumer builds

## Outcome

Separately authored UI and caller recipes preserve the same property priorities,
conditional behavior, and caller composition through one finalized application
extraction. A caller's unrelated padding declaration cannot change PageIntro's
compact layout. The package and supported consumer build paths must use one
deterministic extraction contract before ListBox can merge or a release can ship.
Arbitrary independently extracted recipe sheets are not a supported composition
boundary; the adapters must enforce the single-artifact contract they advertise.

This preserves the independent package and consumer ownership described in
[[notes/repository-seams|Repository seams]].

## Evidence

The retained commit `165e839fda614f17b5169cd7883d7c2c0d3730c5` contains the exact
failing gallery and matched-rule diagnostics. At a 390px viewport, both forms of
the 40rem media query match. PageIntro has its default and conditional generated
classes. Its compact alignment and single-column declarations match in
`components.hraness-ui.priority3`, but independently compiled caller defaults
with the same selectors occur in `priority4` and win. The resulting two columns
and 24px gap occupy 342px, the correct content width; overflow and transition
settlement do not explain the result.

StyleX 0.19.0's `processStylexRules` groups rules by
`Math.floor(priority / 1000)` and names layers using each present group's array
index. A legitimate padding shorthand adds a priority-1000 group. Priority-zero
dynamic declarations also affect that inventory. Equal property/value/condition
atoms retain equal selectors across compilations while their layer ranks change.
Consumer bucket 4000 can consequently become `priority5`.

The gallery's old layer regex captured only priorities 1 through 4 before checking
the captured names. It could not reject an unrecognized priority that it never
captured. The regression must enumerate all namespaced layer declarations first.

Commit `360bdcfa3d6eec564122cc5ca18fd8f042c32f15` separately corrects the ListBox
fixture to use the same physical padding keys as its component. Content,
DataTable, and initial ListBox browser checks then pass. This narrower fixture
correction does not establish that arbitrary supported caller recipes are safe.
The next browser assertion reports a 48px outer Slider thumb where 20px is
required. A before/toggled/restored census must distinguish an already incorrect
baseline from state left by the synthetic coarse-pointer probe.

## Scope and constraints

- Keep the existing StyleX 0.19.0 transformation and property-specificity model.
- Preserve the existing package behavior without treating its current four
  occupied positive layers as a cap on valid caller recipes. Pseudo-elements
  and nested conditions produce additional supported priorities.
- Preserve the canonical `base`, `components`, legacy, and positive-layer order,
  conditional specificity, deterministic rule order, and caller-last composition.
- Classify zero-priority output explicitly and preserve the pinned compiler's
  supported registrations, constants, and theme rules. Do not discard valid
  output or admit arbitrary unlayered presentation. A complete metadata union
  determines the final layer inventory once; no partial graph emits recipe CSS.
- Integrate extraction with both package compilation and the publicly supported
  caller build paths. A private gallery-only CSS rewrite is not a solution.
- Keep compiler dependencies outside the production UI import graph. Any public
  build-tool export must be an explicit, separately imported boundary.
- Do not patch installed dependencies, rewrite emitted gallery CSS, silently
  change the compiler version, relax compact/wide layout or color assertions, or
  remove the failing shorthand case.

Prefix isolation alone does not preserve surviving shorthand/longhand priority.
Disabling CSS layers still applies present-group rank through
`addSpecificityLevel`. Disabling that ordering loses the required
property-specificity behavior. These are not accepted partial repairs.

## Dependency-ordered work

1. Preserve the exact failing case and add a packed-consumer matrix in isolated
   compiler processes: dynamic priority-zero rules absent/present crossed with
   padding shorthand absent/present. Use retained dependencies without resolving
   or downloading replacements.
2. Verify duplicate PageIntro defaults, compact and wide behavior, exact-property
   caller replacement, shorthand/longhand precedence, and every output layer.
   Run the pre-fix regression once and retain its bounded failure evidence.
3. Define the concrete extraction API, zero-rule handling, public build-tool
   exports, supported Bun/Vite and server-rendering integration, dependency graph,
   and exact file scope. Independently review this design before changing the
   production compiler or public API.
4. Implement the reviewed extraction boundary for package and caller builds.
   Keep the original negative input as a positive regression after the fix and
   add counterfactual controls that detect independently serialized partial sheets
   or a layer inventory inconsistent with the finalized metadata union.
5. Rebuild and review generated artifacts. Run focused extraction and consumer
   evidence, then the complete canonical package and browser gate on a clean
   candidate. Finish exact-head PR checks and normal protected merge only after
   the supported-consumer contract is green.

## Verification

- The inventory matrix preserves cascade behavior when priority-zero rules,
  shorthand declarations, pseudo-elements, and nested conditions are added.
  Entry and transform permutations produce identical finalized output.
- Compact PageIntro remains one column with start alignment; wide PageIntro
  remains two columns with end alignment. Identical atoms from unrelated caller
  recipes cannot change these contracts.
- Exact-property caller values remain final. More specific physical properties
  retain their documented priority over broader shorthand keys.
- Every namespaced layer in preludes and blocks is enumerated before checking
  the contract derived from the complete metadata union. The existing
  `priority5` negative control detects an unexpected current-package layer;
  valid future union layers are not prohibited by that historical number.
- Real and synthetic coarse-pointer assertions retain their existing dimensions;
  synthetic probes restore their baseline attributes and computed geometry.
- JavaScript and CSS remain byte-identical across absolute build roots. Packed
  React 18/19, Bun browser, Vite, server-rendering, and real browser checks cover
  the reviewed consumer integration. No compiler code enters production output.

## Rejected ordinal normalization proposal

Independent review rejected the following initial proposal as incomplete before
any production implementation. StyleX adds 5000 for a pseudo-element and sums
the priorities of nested conditions. Valid caller rules are not bounded by four
positive buckets. Even a complete absolute-bucket mapping does not preserve
source ordering within one bucket across separately extracted stylesheets.

A concrete source-derived regression is a package recipe containing a blue
`@supports (display: grid)` color and a green `@media (min-width: 1px)` color,
plus an unrelated caller recipe that repeats only the supports atom. Both
conditions match, both selectors have the same specificity, and their priorities
are 3030 and 3200 in the same bucket. A later independent supports stylesheet
reverses the upstream combined-extraction order.

Giving every full numeric priority its own layer is also incorrect. Layers
outrank selector specificity and reverse their order for important declarations.
Three nested supports conditions produce more selector specificity than one
media condition despite a lower numeric priority. The original compiler keeps
those rules within one bucket so specificity can decide. A numeric layer tree
would change that result. The same approach reverses equal-specificity important
hover/focus precedence. These alternatives must remain negative controls, not
implementation shortcuts.

Historical proposal, not implementation instructions:

- Remap each independently extracted ordinal layer to an absolute bucket.
- Retain a fixed priority1-through-priority4 prelude.
- Export compiler options and let each Bun/Vite build emit its own CSS sidecar.
- Exclude valid priority classes to keep the four-layer contract.

All four points are superseded. No adapter signature, extraction algorithm,
whitelist, or independent-sidecar behavior from that proposal is approved. The
combined-extraction section below is the only current design direction, and it
still requires its acceptance gates before implementation.

## Accepted combined extraction design

The replacement proposal publishes the package's raw StyleX rule metadata and
lets the application adapter merge it with all caller metadata before one
upstream serialization. This preserves the compiler's complete ordering,
specificity, important, constant, and RTL behavior instead of approximating the
cascade with additional layer ranks.

This changes the public integration contract. A compiler-adopting application
must load one combined recipe stylesheet and must not also load the package's
independently compiled recipe stylesheet. Tokens, reset, and legacy styles remain
present exactly once. The plugin-free consumer path continues using the ordinary
precompiled package stylesheet. The final design must enforce this distinction
through public build adapters and checked imports, rather than relying on a
gallery-only convention. Browser/SSR, multiple entries and chunks, repeated
builds, sidecar ownership, and accidental mixed-style loading require explicit
evidence. The metadata artifact, exports, and consumer import contract are
implemented as one reviewed package boundary. They remain release candidates
until the final canonical gate, pull request, and immutable release complete.

### Versioned package metadata

Proposed public export `@hraness/ui/stylex-manifest.json` points to
`dist/stylex-manifest.json`. Schema version 1 contains these exact categories:

- `schemaVersion: 1` and a separate compiler-contract version.
- Public package name and version matching the installed `package.json`.
- Exact StyleX/Babel toolchain versions, fixed transformation options, serializer
  options, explicit CSS target options, and a canonical configuration digest.
  Root-dependent compiler input is represented by a documented logical root,
  never an absolute machine path or an ambient Browserslist lookup.
- A sorted inventory of final shipped runtime JavaScript paths and SHA-256 byte
  hashes, plus the standalone compiled CSS path and SHA-256 hash. Paths are
  normalized package-relative names; duplicate, absolute, parent-traversing, or
  nonordinary artifact paths are rejected.
- Canonical raw `Rule[]` metadata, including constants, and its digest. A rule is
  the public tuple `[key, { ltr, rtl?, constKey?, constVal? }, priority]`, parsed
  from `unknown`. Keys and CSS strings are strings; priority is finite and
  nonnegative; optional RTL is string or null; a constant has both a string key
  and string-or-finite-number value. Unknown fields and malformed combinations
  fail with a diagnostic, not an unchecked cast.

The manifest is generated only after final runtime client marking. It hashes
every shipped runtime chunk, not just an earlier unmarked `dist/index.js`.
Build-tool modules are separately inventoried and never client-marked. There is
no self-hash cycle: a graph receipt records the canonical manifest's digest.
At consumption, identity, compiler contract, canonical metadata digest, and every
bound artifact byte are verified before any recipe output is published. Identical
duplicate rules deduplicate; the same key with a different CSS payload,
constant, or priority is an error. Repeated package identities with divergent
manifests fail. The same checks apply across package and graph records.

These are integrity and reproducibility checks, not proof of a publisher's
identity or safety of arbitrary CSS. A self-consistent malicious manifest can
hash malicious assets. Normal pinned dependency resolution establishes the
selected package; the extractor does not invent a security-provenance guarantee.

Acceptance includes mutated marked JavaScript, missing chunks, modified CSS,
wrong package identity/version, unknown schema, compiler/options mismatch,
malformed rules, conflicting duplicate keys, and divergent manifests. Each must
fail before successful output. Absolute-root builds must reproduce the metadata
and all published artifacts without timestamps or machine paths.

### Compiler-adopter stylesheets and package surface

The implemented `@hraness/ui/compiler-foundation.css` exports
`src/compiler-foundation.css`. It declares `base` before `components` and legacy
before compiled recipes, and imports `tokens.css`, package-internal
`compiler-reset.css`, and `components.css` exactly once. The internal reset is
byte-identical to the public `reset.css` except for removing its one fixed
legacy-through-priority4 prelude; a regression check binds that exact relation.
The foundation contains no StyleX recipe CSS, fixed four-layer prelude, utility
CSS directives, or import of `dist/stylex.css`.

A prior transition proposed a second
`@hraness/ui/compiler-foundation-tailwind.css` export backed by
`src/compiler-foundation-tailwind.css` and `src/tailwind.css`. That decision is
superseded: the completed component migration no longer needs a first-party
Tailwind bridge. The package removes both files, their export and package-file
entries, the `tailwind-merge` dependency, and all adapter receipt machinery that
existed only to preserve those directives. Compiler inputs now reject direct
`@source`, `@custom-variant`, and `@theme` directives.

The ordinary `@hraness/ui/styles.css` export remains the complete precompiled
route for plugin-free consumers, while direct tokens/reset/components/stylex
imports remain available as narrower standards-based inputs. Compiler adopters
must not combine that ordinary recipe path with their finalized asset.
`package.json` explicitly publishes the one public compiler foundation, includes
the internal reset in `files` and `sideEffects` without exporting it, and keeps
the metadata and build-tool entry points outside the UI runtime graph. Optional
compiler peers and local development dependencies declare every direct compiler
import. The low-level Babel configuration stays private because options alone
cannot enforce the safe extraction contract.

### Enforceable import and asset boundary

The adapter owns a declared application generation: its JavaScript entry/lazy
graphs, their resolved CSS dependency graphs, emitted local assets, and explicitly
registered HTML/SSR templates. It must enumerate that boundary before claiming
complete protection. It must not claim to inspect arbitrary external HTML,
third-party stylesheets, server-generated links, or remote CSS it does not own.
An unsupported link topology fails or remains outside the advertised integration
contract; it does not silently count as verified.

Before publication, enforce and test these cases:

- Reject direct `@hraness/ui/styles.css` or `@hraness/ui/stylex.css` imports in a
  compiler-adopting generation, including resolved aliases and relative paths
  that identify the verified package's standalone recipe file. Use the new
  foundation path instead of assuming a generic loader can intercept everything.
- Traverse local nested CSS `@import` dependencies, including a product sheet
  importing package `styles.css`. Prove the Vite CSS pipeline exposes the needed
  resolved dependency edges; ordinary JavaScript module hooks are insufficient.
  Unsupported unresolved imports fail closed within the owned asset graph.
- Reject copied package recipe CSS in registered local input/output assets by
  bound-byte matching and a parsed namespaced layer/rule census. Cover an exact
  copy and a minified/reformatted copy. Reserve package recipe namespaces for the
  finalizer, not arbitrary product declarations. This is an owned-asset check,
  not a claim to recognize every adversarial transformation of remote CSS.
- Check registered HTML and SSR template links against the current generation's
  final CSS identity and an explicit stylesheet-owning graph. Keep that graph
  distinct from the optional producer graph that proves which receipt generated
  an HTML template. Every template links the same finalized recipe artifact and
  every CSS output from its declared stylesheet graph exactly once. Detect an
  ordinary standalone link, a missing foundation or combined link, a stale
  prior-generation link, a duplicate graph stylesheet, or a second partial
  recipe asset.
- Validate requested output names as relative, contained, noncolliding paths.
  Refuse a preexisting asset collision or ambiguous output ownership; do not
  overwrite product files or accept a prior combined sheet as this run's result.

Positive controls cover ordinary plugin-free consumers and standards-only
compiler adopters. Negative controls exercise each direct, nested, copied,
template, stale-output, unsupported utility-CSS directive, and collision boundary
on both supported build paths. Reverse foundation/combined asset arrival order
where allowed and require the same layer precedence; do not assert that two
partial recipe sheets commute.

### All-graph lifecycle and finalization

One owner registers all graphs that can coexist in a document before compilation:
client entries, every reachable lazy module, multiple entries, and SSR-only
presentation. A graph seals only after bundler completion and all transform and
metadata writes have settled. Metadata arriving after seal is an error. No graph
emits independently usable recipe CSS.

Separate client and SSR invocations require the same explicit generation and
finalization join. Versioned graph receipts bind graph identity, compiler
contract, package-manifest digests, source/artifact inventory, and successful
completion. The finalizer requires the exact expected graph set and rejects
missing, duplicate-conflicting, stale, or failed receipts. An unsupported build
topology is rejected rather than publishing client-only CSS that omits SSR rules.
The API and on-disk receipt format were reviewed with the lifecycle and are now
the versioned schema-1 contract exercised by the package and consumer fixtures.

After all graphs seal, the sole finalizer validates and unions package and graph
metadata and invokes the upstream serializer once. Its complete inventory defines
the finite layer prelude, including valid pseudo-element and nested-condition
priorities. It retains full within-bucket source ordering, selector specificity,
important declarations, constants, RTL, and supported zero-rule registrations.
No absolute-bucket or full-priority layer rewrite is used.

Required tests permute entry order, transform completion order, package-manifest
order, and separate client/SSR arrival order. They include an SSR-only recipe, a
lazy-only recipe, multiple coexisting entries, duplicate defaults, supports/media
overlap, nested-condition specificity, important hover/focus, pseudo-elements,
and valid zero-priority registrations. Both input orders must produce the same
finalized bytes and the expected real browser behavior.

Generation-isolation tests cover success to failure to success, removed and
renamed modules, deleted lazy imports, concurrent independent generations,
reusing a sealed instance, late metadata, and failed transformations. No metadata
or artifact from one generation may leak into another. Serve, watch, and HMR must
be rejected before writing if they are not implemented and evidenced.

### Transactional success and failure

Each generation builds into its own new, owned staging directory on the target
filesystem. JavaScript, graph receipts, foundation assets, combined CSS, and
registered templates are not presented as a successful output while any graph or
validation remains pending. A late SSR/lazy failure, serializer error, or sidecar
write error invalidates the entire generation.

Only after all writes settle and final artifact hashes, CSS imports, and template
links pass does the owner write a complete-generation record and atomically
promote the staged directory to a new generation-specific output name. A rename
or completion-record failure is a failed build. The command exits successfully
and returns the publishable path only after promotion. It never silently replaces
an existing product directory or advances a deployment pointer. An older complete
generation may remain intact, but cannot be reported as success for the failed
new invocation. Publication/deployment must consume the returned complete record,
not guess success from the presence of an old CSS file.

Inject errors after client completion, during SSR/lazy completion, during
serialization, during CSS/template writes, and at promotion. Verify nonzero exit,
no publishable partial generation, unchanged prior complete output, and no stale
CSS success record. Failed owned staging artifacts may be retained as evidence;
this does not authorize unrelated cleanup.

### Implementation join and verification ownership

The implemented file set includes a build ownership guide, private compiler
configuration/transform, metadata schema/validator, package-manifest generator,
graph collector/receipt format, application finalizer, and public Bun/Vite
adapters. Exact signatures must be reviewed together with the lifecycle above.
Package exports, files, side effects, dependency/lock metadata, the two foundation
CSS entries, and README guidance form one packaging join.

Update `scripts/build-package.ts` and
`scripts/mark-react-client-package.ts` so only runtime outputs are client-marked
and the package manifest binds their final bytes. Include `build/**/*.ts` and
its public types in a checked TypeScript scope. Artifact and determinism checks
must recursively cover runtime chunks, build-tool outputs, types, metadata, and
all CSS; no top-level-only inventory may miss a generated path.

Gallery browser/server, packed Bun, and real Vite browser/SSR fixtures must use
the same public finalization join. Keep precompiled plugin-free checks separate.
The focused regression's cascade model supplements, but does not replace,
computed browser evidence. A compiler-child success requires settled writes,
disposed handles, successful child exit, and parent collection of validated
results. Snapshot files alone never establish a terminal gate or release the
scheduler. The original documentation-only review ended before the separately
authorized implementation join recorded below; generated outputs and execution
count only when their terminal gate receipts are present.

## Recovery

Keep the original source commits and the two diagnostic/fixture checkpoints.
Keep source, manifests, generated artifacts, and review evidence intact after a
red gate. Use separate ordinary commits for the regression and extraction change;
never force-push or merge while the P1 contract failure remains. A correction
that cannot satisfy the complete consumer contract stays unmerged rather than
shipping a partial prefix, mode, or fixture workaround.

## Execution evidence

- 2026-09-04: The ListBox candidate passed typecheck, build, committed-output
  parity, artifact checks, absolute-root determinism, React 18/19 packed consumer
  checks, packed Bun HTTP/asset evidence, and 204 tests with 27,627 assertions.
  Its real-browser gate stopped at the compact Content failure described above.
- 2026-09-04: A diagnostics-only browser run reproduced matching compact rules
  being defeated by equal caller selectors in a higher layer. The physical-key
  fixture correction passed those initial contracts but stopped at the Slider
  target assertion. Neither run establishes browser-wide success.
- 2026-09-04: A restoration census measured the Slider at 20 pixels before the
  synthetic coarse probe, 48 pixels during it, and 48 pixels immediately after
  the attribute and custom properties were restored. The reduced-motion reset
  applies a 0.01ms transition. An independently reviewed test-only correction
  now polls animation frames for exact baseline geometry and no active size
  transition, bounded to two seconds, before retaining full census equality.
  That correction has not yet been executed.
- 2026-09-04: The independently reviewed four-process packed regression began,
  but its first compiler child retained a runtime handle after writing its
  compiled assets and rendered snapshot. The parent has not received terminal
  completion, so this run proves no matrix result. The harness needs an explicit
  terminal child lifecycle before a subsequent execution. Automatic review
  rejected stopping the admitted child; no signal or alternative termination
  occurred. The validation slot remains held pending explicit stop authority.
- 2026-09-04: The user approved terminating only the verified stalled compiler
  child. It exited by `SIGTERM`, its parent command returned 143, the exclusive
  scheduler released, and the original nonterminal evidence remained intact.
  An independently reviewed harness repair moved emitted-runtime evaluation into
  a bounded child, required a settled byte-matching snapshot and unchanged
  runtime hash, drained both pipes, and accepted only an unsignaled zero exit.
- 2026-09-04: The repaired regression ran exactly once through the exclusive
  scheduler and terminated normally. Static-longhand, static-shorthand, and
  dynamic-longhand passed. Dynamic-shorthand alone emitted
  `components.hraness-ui.priority5` and resolved compact PageIntro alignment to
  `end` instead of `start` at 390px. The retained report SHA-256 is
  `cc3a98519319c28a3597cff2ef7d50de1725e0b34c4fd3940665d2b0a8980adc`.
  This is the required pre-fix failure, not validation of a repair.
- 2026-09-04: Independent design review rejected both absolute-bucket remapping
  and full-numeric-priority layers. The reviewers agree that one application-wide
  metadata union is the semantics-preserving direction, with the all-graph and
  mixed-stylesheet joins described above still required.
- 2026-09-04: The coordinator approved the bounded one-union implementation
  join. Public exports, compiler identity, graph receipts, transactional
  finalization, compiler foundations, Bun and Vite adapters, mixed-output
  rejection, lifecycle failures, and real consumer evidence now form one
  dependency-ordered implementation phase.
- 2026-09-04: The available local KB command could not start because its retained
  dependencies were absent. No dependency installation was authorized for this
  design slice. KB percolation, refresh, and checks remain unrun.
- 2026-09-04: The joined compiler candidate exposed Vite's synthetic
  `style.css` label as `originalFileName` when `cssCodeSplit` is disabled. The
  adapter had treated that output label as a root input and failed while looking
  for a file that does not exist. Generated CSS now relies on the already audited
  CSS module graph, while non-CSS emitted assets retain exact provenance and byte
  equality. The isolated Vite adapter suite passes 20 tests and 93 assertions.
- 2026-09-04: A combined adapter run found a separate Bun test-realm leak. A real
  Babel transform replaces `Error.prepareStackTrace`; loading Vite afterward in
  the same Bun 1.3.14 test realm then breaks `follow-redirects` error
  initialization. The canonical test command now uses Bun's per-file `--isolate`
  mode instead of restoring a process-global hook from concurrent production
  compiler code or depending on file order. That run reached 275 passing tests
  and exposed two browser-resolver tests that had relied on a leaked global
  `expect` and a noncanonical `/var` path. Both test assumptions are corrected;
  their focused and complete reruns remain pending behind an admitted exclusive
  repository check.

- 2026-09-04: Independent pre-merge review found two public compiler failures
  before the queued complete suite acquired capacity. The shared collector had
  enabled JSX parsing for every TypeScript module, which rejected legal angle-
  bracket assertions in `.ts`, `.mts`, and `.cts` inputs. Parser features now
  follow the module extension, and a real `.ts` assertion plus `.tsx` control
  passes through the collector. The same review found that an exclusive receipt
  collision could leave its temporary hard-link source inside the canonical
  receipt inventory. Native sibling naming, unconditional cleanup after creation,
  and explicit primary-plus-cleanup error preservation now keep a rejected
  duplicate retryable without hiding whether the canonical target was committed.
  The focused generation/compiler lifecycle suite passes 32 tests and 185
  assertions, including finalization after a rejected duplicate receipt.
- 2026-09-04: The candidate had prematurely changed package metadata and the
  installation example to `v0.5.0` before that immutable tag exists. Those three
  values remain at the current `0.4.10` release for this compiler/ListBox pull
  request. The coordinated version bump belongs to the final release pull request
  after every remaining family and the temporary Tailwind bridge are complete.
  The README contract passes 5 tests and 70 assertions, and the portfolio
  inventory check is green at this boundary.
- 2026-09-04: Authoritative UI main advanced by one disjoint policy-only commit,
  `100d5daadce3e4e66b5f960639631cac35c6715d`. It adds HRA autonomy rules to
  `AGENTS.md` and the `CLAUDE.md` pointer. A merge-tree audit found no conflict
  with the committed ListBox range or compiler work. The candidate must replay
  onto that exact main and retain both policy surfaces before final validation.
- 2026-09-05: The final compiler-boundary review found five additional fail-
  closed gaps before delivery. Bun external/linked maps and all Vite sourcemaps
  could produce files outside the sealed inventory; browser URL decoding could
  change percent-encoded stylesheet paths; HTML ignores self-closing syntax on
  raw-text and inert elements; mutation/finalize lock cleanup could mask a
  primary failure; and Windows drive-letter manifest paths could be parsed as
  URI schemes. The adapters now reject uninventoried sourcemap modes before
  graph preparation, template paths are unencoded, non-void raw/inert elements
  cannot self-close, lock operations preserve primary-plus-cleanup failures, and
  native absolute paths win over URI parsing. The isolated focused generation,
  Bun, and Vite suites initially passed 67 tests with 374 assertions.
- 2026-09-05: Follow-on adversarial browser-tokenizer review closed raw-text
  end-tag, malformed-comment and tag, declarative-shadow-template, foreign-
  namespace, select-insertion-mode, and unquoted-solidus gaps that could have
  let a phantom or hidden stylesheet satisfy the registered-template contract.
  Vite now consumes a graph slot only after revalidating the settled resolved
  config and final Rollup output, so a later concurrent `configResolved`
  mutation fails before preparation and the same generation remains retryable.
  Independent Bun/Vite review is clean. The exact focused compiler suites pass
  72 tests with 420 assertions; the current complete isolated unit suite passes
  285 tests with 28,099 assertions; and current-candidate typecheck is green.
- 2026-09-05: Whole-candidate review found three additional transactional
  failures. Publication-lock close/unlink errors could be discarded after a
  primary finalization failure; a failed dist promotion could lose its original
  error when restoration also failed; and Bun plus receipt validation accepted
  uppercase `FILE:` URLs and foreign drive-letter paths as package externals.
  Cleanup now aggregates primary and cleanup failures, double-failed promotion
  reports both retained trees and both causes, and Bun uses Vite's cross-platform
  local-path fence. The exact three-file regression run passes 64 tests with 364
  assertions, and independent whole-candidate review is clean.
- 2026-09-05: Generated-artifact review rejected Bun 1.3.14's invalid
  re-export-only `dist/build/index.js` before it could be committed. The build
  now gives every public build-tool entry its own non-splitting bundle, keeps
  concrete wrapper declarations in the aggregate entry, and imports all three
  staged modules while asserting their exact export surfaces before promotion.
  The same review exposed dist-relative package-manifest paths that contradicted
  the package-relative verification contract. Runtime, build-tool, and
  standalone CSS inventory now records `dist/...` paths. The guarded build and
  compiler-artifact verification are green; regenerated artifacts still require
  a separate byte/scope review and commit before the canonical full gate.
- 2026-09-06: The final component-family join moved navigation, native Progress,
  collection coarse-pointer and forced-color fallbacks, and shared motion into
  compiled StyleX recipes while retaining only reviewed native pseudo-element,
  card-variable, and synthetic-verification seams in `components.css`. The same
  candidate removed the first-party Tailwind bridge, exports, dependency, and
  adapter-specific preservation machinery. Focused collection/style tests pass
  37 tests with 662 assertions; focused compiler adapters pass 139 tests with 943
  assertions; and coordinated typecheck is green. Independent review found no
  source or compiler defect and required this plan correction plus a fresh
  generated-artifact seal and canonical gate before delivery.

## September 6 validation checkpoint

The combined-metadata direction, bounded implementation join, public API,
standards-based package surface, dependency boundary, generated inventory, and
both adapters have completed independent static review, including the final
browser-tokenizer and whole-candidate reviews above. The remaining component
families and temporary Tailwind compatibility surface are removed in the local
current-main candidate. Focused compiler, generation, Bun, Vite, component,
README, portfolio-inventory, package-lifecycle, and child-reaping controls are
green, as is current-candidate typecheck. A fresh generated-artifact seal,
terminal package/Vite/browser fixtures, canonical full gate, current-main pull
request, protected merge, and immutable release remain. Those steps must
preserve the retained failing matrix, the ordinary precompiled stylesheet route,
and the transactional all-graph contract above.

## September 9 exact Next profile qualification

The shared extraction and component work has since shipped through immutable
UI releases, including v0.5.9 and v0.5.10. The current follow-on PR #65 qualifies
Next 16.3.3 alongside the unchanged 16.2.12 default. It retains exact framework
creator hashes and complete discovery/delivery, graph, source-map, native
TypeScript, proxy, SSG and postprocessing joins. The newer native root-parameter
writer is tested independently for its finite return-type combinations; the
complete static-root fixture proves the empty declaration without claiming
dynamic-root route acceptance.

At source commit `43ce2e024f192e64c03f821c0664c288373fe5c7`, the complete local
Next matrix passed both exact versions, including proxy routing, browser
hydration, CSP, lazy/global-error assets and the separate no-edge build. CI run
`34387412021` passed the canonical gate on an identical integration tree,
including 684 tests, 32,032 assertions, all package and adopter matrices, gallery
acceptance, generated-artifact cleanliness, packing and installed imports.

Release preparation updates the package, lock peer metadata and artifact check
to advertise exactly `16.2.12 || 16.3.3`, keeps the development/default version
at 16.2.12, and adds a manifest regression. Version v0.5.11 is a candidate until
its own generated seal, final gate, current-head CI, protected merge and
immutable release succeed. Earlier green evidence does not replace those
changed-tree gates. Product adoption and production verification remain owned
by each consumer and are not implied by this package qualification.
