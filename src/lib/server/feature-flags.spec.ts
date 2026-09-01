import { describe, it, expect } from 'vitest';
import { ALL_FLAGS } from './feature-flags';
import { DEFAULTS } from './site-config/site-config-service';

/**
 * A feature flag is spelled out in three hand-maintained places: the
 * `FeatureFlag` union and `ALL_FLAGS` here, and a `feature.*` default in the
 * site-config service. A fourth list used to live in `settings.remote.ts` as
 * `VALID_FLAGS`; it drifted, omitting `contentFlags`, so the settings page
 * rendered a Content Flags toggle that threw 400 on click. That list is now an
 * alias of `ALL_FLAGS`, and this suite guards the rest of the set.
 */
describe('feature flags', () => {
	const flagDefaults = Object.keys(DEFAULTS).filter((key) => key.startsWith('feature.'));

	it('gives every flag in ALL_FLAGS a site-config default', () => {
		const missing = ALL_FLAGS.filter((flag) => !(`feature.${flag}` in DEFAULTS));
		expect(missing).toEqual([]);
	});

	it('has no orphaned feature.* default without a flag', () => {
		const known = new Set(ALL_FLAGS.map((flag) => `feature.${flag}`));
		const orphaned = flagDefaults.filter((key) => !known.has(key));
		expect(orphaned).toEqual([]);
	});

	it('defaults every flag to a boolean', () => {
		for (const key of flagDefaults) {
			expect(typeof DEFAULTS[key]).toBe('boolean');
		}
	});

	it('lists no duplicates', () => {
		expect(new Set(ALL_FLAGS).size).toBe(ALL_FLAGS.length);
	});
});
