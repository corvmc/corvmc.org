import { describe, it, expect } from 'vitest';
import { prunable } from './prune-snapshots.mjs';

/**
 * `prunable` is the whole decision, so it is the whole test: everything else in the script is
 * `git ls-tree` and `rmSync`. The properties below are the ones that make deleting a snapshot
 * safe — get any of them wrong and the failure is a `db:generate` that diffs against the wrong
 * base, which produces a migration that looks plausible and is not.
 */
describe('prunable', () => {
	const dirs = ['20260101000000_a', '20260102000000_b', '20260103000000_c'];

	it('keeps the newest snapshot — it is what `generate` diffs against', () => {
		expect(prunable(dirs, new Set(dirs))).not.toContain('20260103000000_c');
	});

	it('keeps a migration that is not yet on origin/main', () => {
		// The in-flight case: a PR generating two migrations needs the older one's snapshot,
		// because `d1-safe-rebuild --check` reads it to derive the foreign-key graph.
		const merged = new Set(['20260101000000_a']);
		expect(prunable(dirs, merged)).toEqual(['20260101000000_a']);
	});

	it('prunes nothing when origin/main cannot be read', () => {
		// Failing open costs disk. Failing closed deletes a snapshot an unmerged migration needs.
		expect(prunable(dirs, null)).toEqual([]);
	});

	it('prunes nothing from an empty migrations folder', () => {
		expect(prunable([], new Set())).toEqual([]);
	});

	it('never prunes the newest even when every migration is merged', () => {
		// The steady state on `main`: one snapshot survives, and it is always the head.
		const kept = dirs.filter((d) => !prunable(dirs, new Set(dirs)).includes(d));
		expect(kept).toEqual(['20260103000000_c']);
	});
});
