import { describe, expect, it } from 'vitest';
import { browserPort, devPort, isWorktree, previewPort, storybookPort } from './checkout-ports';

const MAIN = '/Users/someone/Projects/corvmc-svelte';
const TREE_A = '/Users/someone/Projects/corvmc-svelte/.claude/worktrees/sharp-bohr-8eb1b8';
const TREE_B = '/Users/someone/Projects/corvmc-svelte/.claude/worktrees/staff-panel-nav-5524a9';

/** No `PORT`/`PREVIEW_PORT` leaking in from the shell the tests run in. */
const NO_ENV = {} as NodeJS.ProcessEnv;

describe('isWorktree', () => {
	it('tells a worktree from the main checkout', () => {
		expect(isWorktree(MAIN)).toBe(false);
		expect(isWorktree(TREE_A)).toBe(true);
	});
});

describe('the main checkout', () => {
	it('keeps the historical ports, because .claude/launch.json names them statically', () => {
		expect(devPort(MAIN, NO_ENV)).toBe(5173);
		expect(previewPort(MAIN, NO_ENV)).toBe(4173);
	});

	it("keeps vitest's own default browser port", () => {
		expect(browserPort(MAIN, NO_ENV)).toBe(63315);
	});
});

describe('a worktree', () => {
	it('gets ports of its own, off the shared ones', () => {
		for (const port of [devPort(TREE_A, NO_ENV), previewPort(TREE_A, NO_ENV)]) {
			expect(port).not.toBe(5173);
			expect(port).not.toBe(4173);
		}
	});

	it('stays below the ephemeral range the OS allocates from', () => {
		// Anything at 49152+ can be handed to an unrelated socket between runs,
		// which would turn a stable port into an intermittent bind failure.
		for (const port of [devPort(TREE_A, NO_ENV), previewPort(TREE_B, NO_ENV)]) {
			expect(port).toBeGreaterThanOrEqual(41000);
			expect(port).toBeLessThan(43000);
		}
	});

	it('is stable across calls, so reuseExistingServer still hits', () => {
		expect(devPort(TREE_A, NO_ENV)).toBe(devPort(TREE_A, NO_ENV));
		expect(previewPort(TREE_A, NO_ENV)).toBe(previewPort(TREE_A, NO_ENV));
	});

	it('never collides dev with preview — the two halves of the range are disjoint', () => {
		// Drawn from one hash plus an increment, one worktree's preview port could
		// equal the next worktree's dev port. Two halves is what rules that out.
		expect(devPort(TREE_A, NO_ENV)).not.toBe(previewPort(TREE_A, NO_ENV));
		expect(devPort(TREE_A, NO_ENV)).not.toBe(previewPort(TREE_B, NO_ENV));
		expect(devPort(TREE_B, NO_ENV)).not.toBe(previewPort(TREE_A, NO_ENV));
	});

	it('differs from a sibling worktree, which is the whole point', () => {
		expect(devPort(TREE_A, NO_ENV)).not.toBe(devPort(TREE_B, NO_ENV));
		expect(previewPort(TREE_A, NO_ENV)).not.toBe(previewPort(TREE_B, NO_ENV));
		expect(browserPort(TREE_A, NO_ENV)).not.toBe(browserPort(TREE_B, NO_ENV));
	});

	/**
	 * The regression this was added for. vitest's `defaultBrowserPort` is the
	 * fixed constant 63315, so before this every worktree asked for the same
	 * number and the second `pnpm test:unit` on the machine failed to bind. The
	 * damage was disproportionate to the cause: the `client` project never
	 * started, and its files were reported as ordinary test failures.
	 */
	it('never leaves a worktree on the shared vitest default', () => {
		expect(browserPort(TREE_A, NO_ENV)).not.toBe(63315);
		expect(browserPort(TREE_B, NO_ENV)).not.toBe(63315);
	});

	it('keeps the browser port clear of dev and preview', () => {
		const a = browserPort(TREE_A, NO_ENV);
		expect(a).not.toBe(devPort(TREE_A, NO_ENV));
		expect(a).not.toBe(previewPort(TREE_A, NO_ENV));
		// And of a *sibling's* — the reason each port gets its own slice of the
		// range rather than one hash plus an increment.
		expect(a).not.toBe(devPort(TREE_B, NO_ENV));
		expect(a).not.toBe(previewPort(TREE_B, NO_ENV));
	});

	it('widening the range to three slots left dev and preview where they were', () => {
		// The old span was 2000 across 2 slots; the new one is 3000 across 3. Each
		// slot is still 1000 wide and the first two bases are unchanged, so a
		// bookmarked URL and reuseExistingServer both survive this change.
		expect(devPort(TREE_A, NO_ENV)).toBeLessThan(42000);
		expect(previewPort(TREE_A, NO_ENV)).toBeGreaterThanOrEqual(42000);
		expect(previewPort(TREE_A, NO_ENV)).toBeLessThan(43000);
		expect(browserPort(TREE_A, NO_ENV)).toBeGreaterThanOrEqual(43000);
		expect(browserPort(TREE_A, NO_ENV)).toBeLessThan(44000);
	});
});

describe('path normalisation', () => {
	/**
	 * The load-bearing one. `playwright.config.ts` derives the port from
	 * `state-dir.ts`'s `REPO_ROOT`, built as `<dir>/e2e/..`, while `vite.config.ts`
	 * derives it from its own `dirname`. Same directory, two spellings — and a
	 * string hash would put them on different ports, leaving Playwright polling a
	 * port the preview server never binds.
	 */
	it('gives one port for the same directory however it is spelled', () => {
		const spellings = [TREE_A, `${TREE_A}/`, `${TREE_A}/e2e/..`, `${TREE_A}/./`];
		const ports = new Set(spellings.map((p) => previewPort(p, NO_ENV)));
		expect(ports.size).toBe(1);
	});
});

describe('environment overrides', () => {
	it('lets PORT and PREVIEW_PORT win', () => {
		expect(devPort(TREE_A, { PORT: '3000' } as NodeJS.ProcessEnv)).toBe(3000);
		expect(previewPort(MAIN, { PREVIEW_PORT: '3001' } as NodeJS.ProcessEnv)).toBe(3001);
	});

	it('lets VITEST_BROWSER_PORT win', () => {
		expect(browserPort(TREE_A, { VITEST_BROWSER_PORT: '3002' } as NodeJS.ProcessEnv)).toBe(3002);
	});

	it('rejects a value that is not a port rather than silently falling back', () => {
		expect(() => devPort(MAIN, { PORT: 'no' } as NodeJS.ProcessEnv)).toThrow(/between 1 and 65535/);
		expect(() => devPort(MAIN, { PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(
			/between 1 and 65535/
		);
	});
});

describe('storybookPort', () => {
	/**
	 * The bug this exists for: storybook's browser server defaulted to vitest's
	 * `defaultBrowserPort`, which is the same number `client` binds. Two browser
	 * servers start in one `pnpm test:unit`, so the loser reported
	 * `Port 63315 is already in use` — and it surfaced as the client project's
	 * files missing from the run with **zero failed tests**, which reads as flake.
	 */
	it('never matches the client browser port', () => {
		expect(storybookPort(MAIN, NO_ENV)).not.toBe(browserPort(MAIN, NO_ENV));
		expect(storybookPort(TREE_A, NO_ENV)).not.toBe(browserPort(TREE_A, NO_ENV));
		expect(storybookPort(TREE_B, NO_ENV)).not.toBe(browserPort(TREE_B, NO_ENV));
	});

	it('differs per worktree, like the others', () => {
		expect(storybookPort(TREE_A, NO_ENV)).not.toBe(storybookPort(TREE_B, NO_ENV));
	});

	it('takes an explicit override', () => {
		expect(storybookPort(TREE_A, { VITEST_STORYBOOK_PORT: '61234' })).toBe(61234);
	});

	it('sits in its own slot, clear of the other three', () => {
		expect(storybookPort(TREE_A, NO_ENV)).toBeGreaterThanOrEqual(44000);
		expect(storybookPort(TREE_A, NO_ENV)).toBeLessThan(45000);
	});
});

describe('widening the slot range', () => {
	/**
	 * Adding a slot widens the span so the slot width stays 1000 — every port
	 * that already existed keeps its exact number. A worktree's bookmarked URL
	 * and Playwright's `reuseExistingServer` both depend on that, and a slot
	 * width change would silently move all of them.
	 */
	it('leaves dev, preview and browser exactly where they were', () => {
		for (const tree of [TREE_A, TREE_B]) {
			expect(devPort(tree, NO_ENV)).toBeGreaterThanOrEqual(41000);
			expect(devPort(tree, NO_ENV)).toBeLessThan(42000);
			expect(previewPort(tree, NO_ENV)).toBeGreaterThanOrEqual(42000);
			expect(previewPort(tree, NO_ENV)).toBeLessThan(43000);
			expect(browserPort(tree, NO_ENV)).toBeGreaterThanOrEqual(43000);
			expect(browserPort(tree, NO_ENV)).toBeLessThan(44000);
		}
	});

	it('gives all four a distinct port in one worktree', () => {
		const ports = [
			devPort(TREE_A, NO_ENV),
			previewPort(TREE_A, NO_ENV),
			browserPort(TREE_A, NO_ENV),
			storybookPort(TREE_A, NO_ENV)
		];
		expect(new Set(ports).size).toBe(4);
	});
});
