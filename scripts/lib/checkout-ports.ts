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

/**
 * Where worktree ports live: high enough to clear the common dev-server numbers,
 * below the ephemeral range the OS allocates from (49152+ on macOS and Linux),
 * and wide enough that collisions between the handful of worktrees a machine
 * carries are vanishingly unlikely.
 */
const WORKTREE_PORT_BASE = 41000;
const WORKTREE_PORT_SPAN = 2000;

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
 * Dev and preview must not land on the same number, so they are drawn from two
 * halves of the range rather than from one hash plus an increment — an
 * increment would let one worktree's preview port equal the next worktree's dev
 * port.
 */
function offsetFor(root: string, half: 0 | 1): number {
	const digest = createHash('sha256').update(normalize(root)).digest('hex').slice(0, 8);
	const span = WORKTREE_PORT_SPAN / 2;
	return WORKTREE_PORT_BASE + half * span + (parseInt(digest, 16) % span);
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

/** The port `vite preview` — and therefore the e2e suite — binds for this checkout. */
export function previewPort(root: string, env: NodeJS.ProcessEnv = process.env): number {
	return (
		fromEnv('PREVIEW_PORT', env) ?? (isWorktree(root) ? offsetFor(root, 1) : MAIN_PREVIEW_PORT)
	);
}
