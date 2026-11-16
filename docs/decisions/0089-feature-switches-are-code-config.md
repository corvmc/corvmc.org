# 0089 Feature switches are code config

- **Date:** 2026-11-16
- **Status:** Accepted
- **Issue:** [#3117](https://github.com/corvmc/corvmc.org/issues/3117)

## Context

Two mechanisms switched features off. Three runtime flags (`directMessages`, `bandAudio`,
`cmcRadio`) lived in KV as `site-config:feature.<flag>`, toggled on System → Features. Two
switches (`classifieds`, `ballots`) lived in `surfaces` in `src/lib/config.ts` (#2116), where
turning one on is a deploy. Production had all five off.

## Decision

1. **One mechanism.** `surfaces` in `src/lib/config.ts` holds all five switches, all `false`.
   Turning one on is a code change and a deploy.
2. **The gates keep their names.** `requireFeature` and `isFeatureEnabled` read `surfaces` and no
   longer touch KV; `requireSurface` stays the universal gate.
3. **No staff toggle.** System → Features, `updateFeatureFlag` and `feature-meta.ts` are removed.
   `/staff/system/features` 308s to `/staff/system`.
4. **A help article's `surface:` frontmatter** can name any of the five.
5. **No `feature.*` site-config key.** `feature-flags.spec.ts` fails on code that registers, reads
   or writes one.
6. **The e2e build turns on what its specs walk** (`directMessages`, `bandAudio`) through
   `VITE_E2E_SURFACES`, read at build time. No production build sets it.

## Alternatives rejected

- **Keep the KV flags beside `surfaces`.** Two mechanisms for one job, and a runtime toggle that
  can launch an unfinished feature without review.
- **Skip the e2e specs for switched-off features.** The messaging and band audio journeys would
  lose their only end-to-end coverage until launch.

## Consequences

- Launching a feature is a PR that flips its switch, reviewed like any other change.
- A `site-config:feature.*` value left in production KV is ignored.
- The staff Music page says that turning the storefront or the station on is a code change.
