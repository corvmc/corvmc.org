/**
 * The dev and preview ports this checkout owns.
 *
 * The same reasoning as `e2e/state-dir.ts`, applied to the last resource that
 * was still shared machine-wide. That file gave every checkout its own miniflare
 * state because workerd takes real locks on those SQLite files; the port stayed
 * fixed, so two worktrees still raced for `:5173` and `:4173`. A second checkout
 * either lost the bind and silently landed on the next port up — leaving you
 * reading a neighbour's app and wondering why your change is not in it — or, for
 * the preview server, got adopted by the neighbour's Playwright through
 * `reuseExistingServer`.
 *
 * The rule:
 *
 * - The **main checkout keeps the historical ports**. `.claude/launch.json` is
 *   tracked and its `port` is a static number, so it can name exactly one port
 *   per configuration. Leaving the main checkout on 5173/4173 keeps that file
 *   honest where it is used most, and keeps every doc that cites those numbers
 *   correct.
 * - A **worktree gets ports derived from its own path** — stable across runs of
 *   that worktree (so Playwright's `reuseExistingServer` still hits, and you can
 *   bookmark the URL), and disjoint from every other worktree's in practice.
 * - An explicit **`PORT` / `PREVIEW_PORT` in the environment always wins**, so
 *   any of this can be overridden without editing code.
 *
 * Callers pair this with `strictPort`, which is the half that makes a collision
 * loud. Without it vite quietly increments and the mismatch resurfaces later as
 * a test talking to the wrong server.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** Ports the main checkout keeps, and the base of each worktree range. */
const MAIN_DEV_PORT = 5173;
const MAIN_PREVIEW_PORT = 4173;
/** vitest's own `defaultBrowserPort`. */
const MAIN_BROWSER_PORT = 63315;
/**
 * The storybook project runs a **second** browser server, and it defaulted to
 * `defaultBrowserPort` too — the same number `client` already binds. Whichever
 * lost the race reported `Port 63315 is already in use`, which surfaces as
 * "Unit tests" red with the client project's files simply absent and **zero
 * failed tests**, so it reads as flake rather than as a collision.
 */
const MAIN_STORYBOOK_PORT = 63316;

/**
 * Where worktree ports live: high enough to clear the common dev-server numbers,
 * below the ephemeral range the OS allocates from (49152+ on macOS and Linux),
 * and wide enough that collisions between the handful of worktrees a machine
 * carries are vanishingly unlikely.
 */
const WORKTREE_PORT_BASE = 41000;
const WORKTREE_PORT_SPAN = 4000;
/**
 * Dev, preview, the vitest browser API, and storybook's browser API. Each slot
 * is `SPAN / SLOTS` wide.
 *
 * Every widening keeps the earlier slots exactly where they were: two slots
 * across 2000, then three across 3000, now four across 4000 — the slot is 1000
 * wide throughout, so `BASE + slot * 1000 + digest % 1000` is unchanged for
 * every slot that already existed. A worktree's bookmarked URL and Playwright's
 * `reuseExistingServer` both depend on that stability, which is why the span
 * grows with the slot count rather than being divided further.
 */
const WORKTREE_PORT_SLOTS = 4;

/** Worktrees live here — see CLAUDE.md. */
const WORKTREE_MARKER = `${'.claude'}/worktrees/`;

/**
 * The path, in the one spelling every caller must agree on.
 *
 * `playwright.config.ts` derives its port from `e2e/state-dir.ts`'s `REPO_ROOT`
 * (built as `<dir>/e2e/..`) while `vite.config.ts` derives the same port from
 * its own `dirname`. Those are the same directory spelled two ways, and the hash
 * below is a *string* hash — un-normalised, the two would disagree and the suite
 * would poll a port the preview server never binds.
 */
function normalize(root: string): string {
	return resolve(root).replaceAll('\\', '/').replace(/\/+$/, '');
}

export function isWorktree(root: string): boolean {
	return normalize(root).includes(WORKTREE_MARKER);
}

/**
 * A stable offset for `root` inside the worktree range.
 *
 * The three ports must not land on the same number, so each is drawn from its
 * own slice of the range rather than from one hash plus an increment — an
 * increment would let one worktree's preview port equal the next worktree's dev
 * port.
 */
function offsetFor(root: string, slot: 0 | 1 | 2 | 3): number {
	const digest = createHash('sha256').update(normalize(root)).digest('hex').slice(0, 8);
	const span = WORKTREE_PORT_SPAN / WORKTREE_PORT_SLOTS;
	return WORKTREE_PORT_BASE + slot * span + (parseInt(digest, 16) % span);
}

function fromEnv(name: string, env: NodeJS.ProcessEnv): number | null {
	const raw = env[name];
	if (!raw) return null;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(
			`${name} must be a port number between 1 and 65535, got ${JSON.stringify(raw)}`
		);
	}
	return port;
}

/** The port `vite dev` binds for this checkout. */
export function devPort(root: string, env: NodeJS.ProcessEnv = process.env): number {
	return fromEnv('PORT', env) ?? (isWorktree(root) ? offsetFor(root, 0) : MAIN_DEV_PORT);
}

/**
 * The port vitest's browser mode binds for this checkout's `client` project.
 *
 * This was the last shared-by-default resource, and the one that bit hardest,
 * because unlike the dev and preview servers it is not something you start
 * deliberately — `pnpm test:unit` binds it, so two checkouts running their unit
 * suites at once collide without either one having a server running.
 *
 * The collision is total rather than occasional: vitest's `defaultBrowserPort`
 * is the fixed constant **63315**, so every checkout asks for the same number
 * and the second one fails with `Port 63315 is already in use`. The failure
 * reads as three unrelated test failures, because the project never starts and
 * its files are counted as failed.
 *
 * The main checkout keeps 63315 for the same reason it keeps 5173 — it is the
 * documented default, and anything printing a browser-mode URL stays correct.
 */
export function browserPort(root: string, env: NodeJS.ProcessEnv = process.env): number {
	return (
		fromEnv('VITEST_BROWSER_PORT', env) ??
		(isWorktree(root) ? offsetFor(root, 2) : MAIN_BROWSER_PORT)
	);
}

/**
 * The port the **storybook** project's browser server binds.
 *
 * Separate from `browserPort` because they are two servers that start at the
 * same time in one `pnpm test:unit`. Sharing a number is not a worktree problem
 * — it collides on a bare CI runner with nothing else on it.
 */
export function storybookPort(root: string, env: NodeJS.ProcessEnv = process.env): number {
	return (
		fromEnv('VITEST_STORYBOOK_PORT', env) ??
		(isWorktree(root) ? offsetFor(root, 3) : MAIN_STORYBOOK_PORT)
	);
}

/** The port `vite preview` — and therefore the e2e suite — binds for this checkout. */
export function previewPort(root: string, env: NodeJS.ProcessEnv = process.env): number {
	return (
		fromEnv('PREVIEW_PORT', env) ?? (isWorktree(root) ? offsetFor(root, 1) : MAIN_PREVIEW_PORT)
	);
}
