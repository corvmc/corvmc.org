---
name: worktree-dev
description: Set up and run the dev server, Storybook, or the browser preview from inside a git worktree under .claude/worktrees/. Use when a worktree has no node_modules or no .env, when the dev server won't boot from a worktree, or when :5173 seems to belong to someone else.
---

# Running a dev server from a worktree

A fresh worktree under `.claude/worktrees/` has **no `node_modules`, no `.env`, and no
`.dev.vars`** — `git worktree add` copies tracked files only. Set those up before anything will
boot.

## Setup

1. **Dependencies.** Install them, per worktree:

   ```bash
   pnpm install --frozen-lockfile
   ```

   **It costs almost no disk.** pnpm keeps one copy of every package in a global store
   (`pnpm store path`) and brings it into a project by cloning, not copying — on APFS that is
   copy-on-write, so the blocks are shared until something writes to them. Measured on this
   machine: cloning a 200 MB file changed free space by **8 KB**. `du` reports a worktree's
   `node_modules` as over a gigabyte, but that is its logical size, not what the volume gave up.

   This used to say to symlink `../../../node_modules` instead. Don't: it buys a saving that was
   never real, and costs three things that are.

   - **The shared install drifts from the lockfile.** A worktree rebased onto a `main` that added
     a dependency gets a build that fails to resolve it and a `pnpm check` error in a file nobody
     touched. It reads as a mystery, not as stale deps.
   - **There is no safe way to refresh it.** Running `pnpm install` from a worktree whose
     `node_modules` is a symlink makes pnpm treat the shared directory as a foreign modules dir
     and offer to **purge and reinstall it from scratch** — which pulls the floor out from under
     every other worktree and any suite running in one.
   - **Vite has to be told to allow it.** `vite.config.ts` passes
     `fs.realpathSync(path.resolve(dirname, 'node_modules'))` to `server.fs.allow` for this reason;
     without that entry a symlinked `node_modules` 403s, breaking hydration and the `client`
     vitest project in ways that look like application bugs. That workaround stays — it is
     harmless — but a real install does not need it.

   `pnpm install` may exit non-zero on the `prepare` script (`lefthook install` refuses when the
   hooks path is already set from the main checkout). The install itself has finished by then;
   the hooks are already installed and shared. Check for the package you needed rather than
   trusting the exit code.

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
