import { describe, expect, it } from 'vitest';
import { splitDoorTake } from './settlement-service';

/**
 * The split is pure arithmetic over three columns, so it is tested without a
 * database — `getSettlement` around it is the part that needs one.
 */
describe('splitDoorTake', () => {
	const at = (cents: number | null, percent: number | null = null, count: number | null = null) =>
		splitDoorTake({ doorCashCents: cents, doorCount: count, doorSplitActsPercent: percent });

	// Null is "nobody counted", which the worksheet has to distinguish from a
	// night that genuinely took nothing.
	it('is absent until somebody counts, and present at zero', () => {
		expect(at(null)).toBeNull();
		expect(at(0)).toMatchObject({ cashCents: 0, actsCents: 0, collectiveCents: 0 });
	});

	it('applies the house rule when the show does not override it', () => {
		expect(at(100_00)).toMatchObject({
			actsPercent: 70,
			actsCents: 70_00,
			collectiveCents: 30_00,
			overridden: false
		});
	});

	it('applies the show’s own split when it has one', () => {
		expect(at(100_00, 50)).toMatchObject({
			actsPercent: 50,
			actsCents: 50_00,
			collectiveCents: 50_00,
			overridden: true
		});
	});

	// An override equal to the house rule is still an override: somebody typed
	// it, and raising the default later must not silently move this show.
	it('records an override that matches the default as an override', () => {
		expect(at(100_00, 70)?.overridden).toBe(true);
	});

	// The house absorbs the rounding. A cent is not worth a policy, but it is
	// worth being deterministic about.
	it('never loses a cent, and leaves the remainder with the collective', () => {
		const take = at(1_01, 70);
		expect(take?.actsCents).toBe(71);
		expect(take!.actsCents + take!.collectiveCents).toBe(1_01);
	});

	it('gives everything away at 100 and nothing at 0', () => {
		expect(at(50_00, 100)).toMatchObject({ actsCents: 50_00, collectiveCents: 0 });
		expect(at(50_00, 0)).toMatchObject({ actsCents: 0, collectiveCents: 50_00 });
	});

	it('carries the headcount through untouched, including none', () => {
		expect(at(50_00, null, 120)?.count).toBe(120);
		expect(at(50_00)?.count).toBeNull();
	});
});
