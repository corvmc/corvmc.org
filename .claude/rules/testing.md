---
paths:
  - '**/*.test.ts'
  - '**/*.spec.ts'
  - 'e2e/**'
---

# Tests

Three vitest projects in `vite.config.ts`: `client` (chromium, `*.svelte.{test,spec}.ts`),
`server` (node, `vmForks` pool), and `storybook`. `expect.requireAssertions` is on globally, so a
test that asserts nothing fails.

- **Scope the run.** Cost is dominated by per-file module-graph evaluation, not by assertions —
  a targeted path is far cheaper than the suite. Compare warm runs to warm runs.
- A `"timed out in 5000ms"` failure on a cold `.vite` cache is usually an in-test `await import`,
  not flakiness. Hoist the import.
- **Don't merge sibling `.test.ts` and `.spec.ts` files** to share imports. Their preambles are
  fixtures: unioning the `vi.mock` calls silently stubs out the very thing the other file was
  testing for real.
- Test SQL without a database by rendering drizzle fragments through `SQLiteSyncDialect` (see
  `src/lib/server/authorization.spec.ts`). `better-sqlite3` isn't built in CI, so mock only
  `$lib/server/db`.
- **Both browser-mode projects get their own port**, via `browserPort()` and
  `storybookBrowserPort()` in the same helper. vitest's default is the fixed constant 63315, so
  before this every checkout asked for the same number — and so did `client` and `storybook`
  within one run. Neither reads as a port problem: **the project simply never starts**, so the run
  reports every test passing over a file count that is short. Watch the file total, not just the
  test total: `206 passed (231)` with `2766 passed (2766)` is 25 files that never ran.
- **`maxWorkers` is halved outside CI.** The `server` project's `vmForks` pool takes a fresh VM
  context per file and is memory-hungry by design; several worktrees running suites at once would
  each claim nearly every core until the OOM killer took one. That surfaces as `Worker exited
unexpectedly`, or as a bare SIGKILL, and never as anything about the tests.

## e2e

- **Assertions get 15s and tests get 60s**, set once in `playwright.config.ts` — not Playwright's
  5s/30s. A new assertion needs no `{ timeout: 15000 }`; the ~110 that carry one are redundant but
  kept, because they record which assertions their author knew were slow.
- **Run with `--workers=1` locally.** `playwright.config.ts` sets no worker count, so a many-core
  machine fans out and the suite goes red on contention where CI's narrower runner passes.
  Re-running without `--workers=1` will not fix it.
- D1 setup happens in `e2e/prepare.ts`, before Playwright starts — `pnpm test:e2e` runs it first.
  It builds the suite's own state directory (`.wrangler/e2e-state`, see `e2e/state-dir.ts`), which
  the preview server then holds alone. Seeds go through `withPlatformDb`/`withPlatformEnv`
  (miniflare, prepare only); a read-back from inside a test goes through `readLocalDb`, which
  reads the same SQLite file without starting a second workerd over it.
- **Assert against the database through `expect.poll`, never a bare read.** `readLocalDb` opens
  the file the preview server is still writing through workerd, so a row the page has already
  stopped rendering can still read stale to a fresh reader. The UI assertion passing does not
  establish visibility for the next line. `suggestions.e2e.ts` and `volunteering.e2e.ts` keep a
  `DB_POLL` constant for this; a one-shot read is only safe once a poll in the same test has
  already seen the write.
- **Retries do not rescue a mutating test.** `retries: 2` on CI helps a test that fails _before_ it
  writes. One that fails _after_ has already spent the fixture row it needs, so the retry starts
  from data the fixture never described and fails differently — and the job is red either way.
  Per-test seeding is not the escape hatch: a mid-run write is a second writer on the files the
  preview server holds. See the note at `retries` in `playwright.config.ts`.
- A red run keeps `.wrangler/e2e-state` on purpose, and the next `e2e/prepare.ts` clears it — or
  rebuilds the directory outright when its schema and drizzle's journal disagree, the one state
  that used to need `rm -rf .wrangler/e2e-state` by hand (`journalDisagreesWithSchema`).
- Fixtures must reset KV rate-limit counters; they survive between runs, and the failure surfaces
  as unrelated state that nothing in the test ever touched.
- A spec that mutates a seeded row owns that row. The fixture seeds a disposable band per mutating
  spec (`SEED_RENAME_BAND_*` for the address change, `SEED_RETITLE_BAND_*` for the rename) rather
  than borrowing one another spec asserts on. Restoring at the end of the test is not a substitute:
  a success toast is often the _previous_ save's, so the assertion passes instantly and the restore
  can still be in flight when Playwright closes the page.
- **Ports are per-checkout.** The main checkout keeps :5173/:4173; a worktree gets its own pair,
  derived from its path by `scripts/lib/checkout-ports.ts` and bound with `strictPort` so a
  collision is loud rather than a silent bump to the next number. So an orphaned preview you need
  to kill is one in _this_ checkout — `reuseExistingServer` can no longer adopt a sibling
  worktree's server, because it is not on this checkout's port.
- **One suite per machine.** `e2e/lock.ts` refuses a second run before it builds, naming the
  checkout that holds the lock. Ports and state are isolated per checkout, but CPU is not, and
  these assertions are load-dominated: two overlapping suites redden whole spec files in both runs
  with failure sets that barely intersect. If a run died and left the lock, the error prints the
  `rm` for it.
- A whole-suite red run can still be workerd dying on `SQLITE_BUSY_RECOVERY` — but since the state
  directory is the suite's own, that means a second `pnpm test:e2e` in this same checkout, not a
  dev server, and the lock above should now have refused it first.
- `playwright.config.ts` spawns `npm run build && npm run preview` for its web server. That is
  fine — it only delegates to `package.json`. Leave it alone.
