import { describe, it, expect } from 'vitest';
import { ALL_FLAGS } from '$lib/server/feature-flags';
import { featureMeta } from './feature-meta';

// The two assertions `feature-flags.spec.ts` already gives the `FeatureFlag`
// union, `ALL_FLAGS`, the `feature.*` defaults and `VALID_FLAGS` — applied to
// the list that had none. Drift here is silent in both directions: a stale key
// renders a toggle that `updateFeatureFlag` rejects with a 400, and a missing
// key means a live flag cannot be switched on from anywhere. `directMessages`
// was the second case for as long as the tab has existed.

describe('featureMeta', () => {
	it('gives every flag in ALL_FLAGS a toggle', () => {
		const missing = ALL_FLAGS.filter((flag) => !(flag in featureMeta));
		expect(missing).toEqual([]);
	});

	it('has no entry for a flag that no longer exists', () => {
		const known = new Set<string>(ALL_FLAGS);
		const orphaned = Object.keys(featureMeta).filter((flag) => !known.has(flag));
		expect(orphaned).toEqual([]);
	});

	it('labels and describes every entry', () => {
		for (const meta of Object.values(featureMeta)) {
			expect(meta.label.length).toBeGreaterThan(0);
			expect(meta.description.length).toBeGreaterThan(0);
		}
	});
});
