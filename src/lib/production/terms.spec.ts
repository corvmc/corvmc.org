import { describe, it, expect } from 'vitest';
import { describeTerms } from './terms';
import type { ActTerms } from './terms';

/**
 * One row per line of `docs/specs/project-spec.md#the-deal-shape`, because the
 * console and the band's own page both render this string and the act reading it
 * is the only check on the number.
 */
const none: ActTerms = {
	guaranteeCents: null,
	percentageBps: null,
	versus: false,
	againstNet: false,
	contributed: false
};

describe('describeTerms', () => {
	it('names a donated set, which is the case nothing else could record', () => {
		expect(describeTerms({ ...none, guaranteeCents: 0, percentageBps: 0, contributed: true })).toBe(
			'Donated set'
		);
	});

	it('names a flat fee', () => {
		expect(describeTerms({ ...none, guaranteeCents: 25000 })).toBe('$250.00 flat');
	});

	it('names a pure split', () => {
		expect(describeTerms({ ...none, percentageBps: 7000 })).toBe("70% of the acts' pool");
	});

	// The distinction the spec's table leaves ambiguous: the flag is what makes a
	// guarantee "against" a percentage rather than on top of it.
	it('distinguishes a guarantee against a percentage from one plus a percentage', () => {
		const both = { ...none, guaranteeCents: 30000, percentageBps: 7000 };

		expect(describeTerms({ ...both, versus: true })).toBe("$300.00 versus 70% of the acts' pool");
		expect(describeTerms(both)).toBe("$300.00 plus 70% of the acts' pool");
	});

	it('says when the percentage is of net', () => {
		expect(describeTerms({ ...none, percentageBps: 5000, againstNet: true })).toBe('50% of net');
	});

	it('keeps a fractional percentage rather than rounding it away', () => {
		expect(describeTerms({ ...none, percentageBps: 6750 })).toBe("67.5% of the acts' pool");
	});

	// Distinct from a donated set: nobody has agreed anything yet.
	it('says nothing is agreed when every column is empty', () => {
		expect(describeTerms(none)).toBe('No terms agreed yet');
	});
});
