import { describe, expect, it } from 'vitest';
import { retiredTerms } from '#lib/config.js';
import { capabilityLabel, everyCapability } from './capability-label';

describe('capability labels', () => {
	it('use no retired term (retiredTerms in src/lib/config.ts)', () => {
		const labels = everyCapability.flatMap((g) => [g.label, ...g.caps.map(capabilityLabel)]);
		const unscoped = retiredTerms.filter((t) => !t.keys);
		expect(labels.filter((l) => unscoped.some((t) => t.word.test(l)))).toEqual([]);
	});
});
