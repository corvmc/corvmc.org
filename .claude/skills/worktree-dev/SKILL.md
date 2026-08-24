---
name: worktree-dev
description: Set up and run the dev server, Storybook, or the browser preview from inside a git worktree under .claude/worktrees/. Use when a worktree has no node_modules or no .env, when the dev server won't boot from a worktree, or when :5173 seems to belong to someone else.
---

# Running a dev server from a worktree

A fresh worktree under `.claude/worktrees/` has **no `node_modules`, no `.env`, and no
`.dev.vars`** — `git worktree add` copies tracked files only. Set those up before anything will
boot.

## Setup

1. **Dependencies.** Symlink rather than reinstalling:

   ```bash
   ln -s ../../../node_modules node_modules
   ```

   Vite already tolerates this: `vite.config.ts` passes
   `fs.realpathSync(path.resolve(dirname, 'node_modules'))` to `server.fs.allow`. Without that
   entry a symlinked `node_modules` 403s, which breaks hydration and the `client` vitest project
   in ways that look like application bugs.

2. **Secrets.** Copy `.env` and `.dev.vars` from the main checkout — **copy, don't symlink**.
   Editing through a symlink writes into the main checkout and leaks into every other worktree.
   Restore the original if you replaced one.

3. **Port.** Handled for you: `scripts/lib/checkout-ports.ts` gives every worktree its own dev and
   preview port, derived from its path, so `:5173` and `:4173` stay the main checkout's. Vite binds
   with `strictPort`, so if the port really is taken you get a clear bind failure instead of a
   silent bump onto a neighbour's next port.

   Print this worktree's ports — the dev server also announces them on boot:

   ```bash
   pnpm worktree:ports
   ```

   `ORIGIN` must match the port you actually serve on; a mismatch fails auth and Sentry gating
   rather than erroring cleanly. Override both with `PORT` / `PREVIEW_PORT` if you need to.

4. **Launch.** `.claude/launch.json` is tracked and its `port` is a single static number, so its
   entries name the _main_ checkout's ports. From a worktree, start the browser pane with the URL
   instead of the name — `preview_start` with `{url: "http://localhost:<dev port>"}`, taking the
   port from step 3. Never run a dev server through Bash.

## Live Stripe key

The shared `.env` carries a live `rk_live` key. Do not exercise Stripe-touching flows in local QA:
checkout, cash-received, full-credit settle, refunds.

## Browser pane auth

The Browser pane keeps its own cookie jar — it is not your Chrome, and restarting the preview
discards its session. Anything that needs a logged-in user belongs in a Playwright e2e test, not
in a manual pane click-through.
