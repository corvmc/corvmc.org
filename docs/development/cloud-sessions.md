# Claude Code cloud sessions

A cloud session runs Claude Code on an Anthropic-managed VM instead of your laptop: you start it
from [claude.ai/code](https://claude.ai/code), the mobile app, or `claude --cloud`, it clones this
repo, works, and pushes its branch. Nothing local carries over — **only what is committed**.

This page is the setup, in two halves. The repo half is already done and needs nothing from you.
The environment half is four fields in a dialog at claude.ai/code that only you can fill in, and
until they are, a cloud session cannot install a browser or reach the svelte MCP server.

## What the repo already does

| Piece                                        | Why                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `.env.cloud` (tracked, all dummies)          | `.env` is gitignored and `src/lib/server/auth.ts` throws without `ORIGIN`, so a fresh clone cannot boot |
| `scripts/claude/cloud-session-start.sh`      | SessionStart hook: writes `.env`/`.dev.vars`, installs deps and Chromium, runs `pnpm db:reset`          |
| `.claude/settings.json` `SessionStart` entry | Registers that script, `matcher: startup\|resume`, with a 600s timeout for the first cold install       |

The script exits immediately unless `CLAUDE_CODE_REMOTE=true`, which is set only inside a cloud VM,
so running it on your own machine does nothing. That check is load-bearing: without it the first
`cp` would overwrite your working `.env` — and the live Stripe key in it — with dummies.

Everything else a session reads is already committed and arrives with the clone: `CLAUDE.md`,
`.claude/rules/`, `.claude/skills/`, `.claude/commands/`, `.claude/agents/`, the `PreToolUse` guards
in `scripts/claude/`, and `.mcp.json`. Nothing from your `~/.claude/` does.

## The environment (claude.ai/code → environment settings)

### Network access: **Custom**, "Also include default list of common package managers" checked

Then add:

```
cdn.playwright.dev
mcp.svelte.dev
```

`Trusted` covers npm, GitHub, Docker and `sentry.io`, but **not** Playwright's browser CDN. Without
`cdn.playwright.dev` there is no Chromium on the VM, which takes out the `client` and `storybook`
vitest projects and the entire e2e suite — and takes them out the way a missing browser does, as
whole projects reporting zero tests rather than as an error naming the download.

### Environment variables: **leave empty**

Anyone who can use the environment can read this field, and the repo already supplies a working set
of dummies. Do not paste the local `.env` here: it carries a live `rk_live` Stripe key.

### Setup script

Provisions the VM and is snapshotted, so it runs on the first session in an environment and then
roughly weekly, or whenever this script or the allowlist changes:

```bash
#!/bin/bash
set -x
corepack enable && corepack prepare pnpm@9.15.9 --activate || true
[ -f pnpm-lock.yaml ] && pnpm fetch || true
[ -f pnpm-lock.yaml ] && pnpm install --frozen-lockfile || true
pnpm exec playwright install chromium || true
exit 0
```

Three things about its shape are deliberate:

- **Every line ends in `|| true`.** A non-zero exit blocks the session from starting at all.
- **`pnpm fetch` before `pnpm install`.** The snapshot keeps the pnpm store, which lives outside the
  repo, so it survives the fresh clone each session starts from. `node_modules` may not, which is
  why the SessionStart hook installs again — against a warm store, that is seconds.
- **`corepack prepare pnpm@9.15.9`.** The VM ships its own pnpm, `packageManager` pins 9.15.9, and
  `.npmrc` sets `engine-strict=true`, so a mismatch fails loudly rather than quietly.

The whole script has a ~5 minute budget.

## What works, and what a session should not try

| Works                                                  | Does not                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm check`, `pnpm check:tooling`, scoped vitest runs | Anything that sends: Postmark, Twilio, real Stripe (credentials are dummies) |
| `pnpm db:reset`, `pnpm dev`, the seeded logins         | The Browser pane — cloud sessions have no interactive preview tooling        |
| `pnpm test:unit`, `pnpm test:e2e` (see below)          | The Sentry MCP server — its OAuth needs a browser                            |
| `pnpm lint:changed`, `pnpm db:generate`                | `wrangler deploy`, `wrangler secret`, anything against production            |

Verification is Playwright and `curl`, not screenshots. A change that can only be judged by looking
at it is a change to make locally.

### e2e

The VM is 4 vCPUs and 16 GB. `playwright.config.ts` sets no `workers`, so Playwright would default
to about half the cores, and this suite's timing assertions are load-dominated — the same reason
`e2e/lock.ts` refuses a second suite on one machine. Run it as:

```bash
pnpm test:e2e:prepare
pnpm test:e2e --workers=1
```

The suite needs no `.env`: `playwright.config.ts` passes its own dummy `ORIGIN`,
`BETTER_AUTH_SECRET` and Stripe values to the preview server. It needs Chromium and a prepared state
directory, and nothing else.

### Pushing and queueing

`git push` goes through a proxy and works only against the session's own branch; `gh` is
authenticated the same way. GitHub **GraphQL is restricted to a pinned set of pull-request
operations**, so `gh pr merge --auto` — a GraphQL mutation, and the last step of this repo's
workflow — may come back as `This GraphQL query is not enabled for this session`. If it does, open
the PR, say plainly in the session that auto-merge could not be armed, and leave arming it to the
user or to a local session. Do not work around it with `--admin`, which bypasses the merge queue.

## Troubleshooting

| Symptom                                                 | Cause                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Session start prints `could not write .env`             | `.env.cloud` missing from the clone — check it is still tracked               |
| `playwright install chromium failed` in the startup log | `cdn.playwright.dev` is not on the environment allowlist                      |
| `pnpm db:reset failed`                                  | Run it by hand; the hook hides its output to keep the startup log readable    |
| Session fails to start entirely                         | The environment's setup script exited non-zero — every line needs `\|\| true` |
| `ORIGIN environment variable is required`               | `.env` was not written, or a command overrode `ORIGIN`                        |
