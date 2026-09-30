# Ask AI mark sources

The artwork in `src/ask-ai-marks.generated.ts` comes from
`@hraness/design-kit` v0.18.1, which vendors `@lobehub/icons-static-svg` 1.95.1.
The selected marks are OpenAI (ChatGPT), Claude, Perplexity, and xAI (Grok).
The Claude and Perplexity marks include both plain and color variants.

The upstream package records source commit
[`49a2130df7bfa5eb1b088261bff20a37e2967789`](https://github.com/lobehub/lobe-icons/tree/49a2130df7bfa5eb1b088261bff20a37e2967789).
Its [MIT license](https://github.com/lobehub/lobe-icons/blob/49a2130df7bfa5eb1b088261bff20a37e2967789/LICENSE),
including the LobeHub copyright and permission notice, is copied verbatim to
`LICENSE` in this directory. It applies to the artwork in both the generated
source and compiled package.

`scripts/sync-ask-ai-marks.ts` selects the marks from the pinned Design Kit
registry and checks that this license matches the vendored upstream notice.
