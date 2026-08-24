import { describe, expect, it } from 'vitest';
import { devPort, isWorktree, previewPort } from './checkout-ports';

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

	it('rejects a value that is not a port rather than silently falling back', () => {
		expect(() => devPort(MAIN, { PORT: 'no' } as NodeJS.ProcessEnv)).toThrow(/between 1 and 65535/);
		expect(() => devPort(MAIN, { PORT: '99999' } as NodeJS.ProcessEnv)).toThrow(
			/between 1 and 65535/
		);
	});
});
