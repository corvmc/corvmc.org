import { describe, it, expect } from 'vitest';
import {
	computeSetTimes,
	equalPoolShares,
	orderSlots,
	POOL_BPS,
	poolShareFits,
	runOfShowWarnings,
	SLOT_MAX
} from './run-of-show';
import type { SetTimeSlot, WarnableSlot } from './run-of-show';

/**
 * The derivation and its warnings, with no database anywhere near them.
 *
 * These are the functions the whole phase rests on: a schedule that is always
 * exactly a function of the lineup is the design, so the walk is worth pinning
 * exactly rather than through a service that also does five other things.
 */

const T0 = new Date('2026-09-12T03:30:00Z'); // 8:30pm club time
const CREATED = new Date('2026-09-01T00:00:00Z');

function slot(over: Partial<SetTimeSlot> & { id: string }): SetTimeSlot {
	return {
		sortOrder: 1,
		createdAt: CREATED,
		setLengthMinutes: 30,
		changeoverMinutes: 10,
		...over
	};
}

function warnable(over: Partial<WarnableSlot> & { id: string }): WarnableSlot {
	return { ...slot(over), name: 'An act', soundcheckAt: null, ...over };
}

describe('computeSetTimes', () => {
	it('starts the first set at the downbeat', () => {
		const times = computeSetTimes(T0, [slot({ id: 'a' })]);
		expect(times.get('a')).toEqual(T0);
	});

	it('adds the set length and the changeover between each pair', () => {
		const times = computeSetTimes(T0, [
			slot({ id: 'a', sortOrder: 1, setLengthMinutes: 30, changeoverMinutes: 10 }),
			slot({ id: 'b', sortOrder: 2, setLengthMinutes: 45, changeoverMinutes: 15 }),
			slot({ id: 'c', sortOrder: 3 })
		]);

		expect(times.get('a')).toEqual(new Date('2026-09-12T03:30:00Z'));
		expect(times.get('b')).toEqual(new Date('2026-09-12T04:10:00Z'));
		expect(times.get('c')).toEqual(new Date('2026-09-12T05:10:00Z'));
	});

	it('walks in sortOrder, not in the order the rows arrived', () => {
		const times = computeSetTimes(T0, [
			slot({ id: 'late', sortOrder: 9 }),
			slot({ id: 'early', sortOrder: 1 })
		]);
		expect(times.get('early')).toEqual(T0);
		expect(times.get('late')).toEqual(new Date('2026-09-12T04:10:00Z'));
	});

	// A production with no downbeat has no schedule. Falling back to the
	// listing's start time would be a second, silent source of truth.
	it('gives every set a null time when there is no downbeat', () => {
		const times = computeSetTimes(null, [slot({ id: 'a' }), slot({ id: 'b', sortOrder: 2 })]);
		expect([...times.values()]).toEqual([null, null]);
	});

	it('breaks a sortOrder tie on createdAt', () => {
		const ordered = orderSlots([
			slot({ id: 'second', sortOrder: 1, createdAt: new Date('2026-09-02T00:00:00Z') }),
			slot({ id: 'first', sortOrder: 1, createdAt: new Date('2026-09-01T00:00:00Z') })
		]);
		expect(ordered.map((s) => s.id)).toEqual(['first', 'second']);
	});
});

describe('runOfShowWarnings', () => {
	const doors = new Date('2026-09-12T03:00:00Z');
	const curfew = new Date('2026-09-12T06:30:00Z');

	function codes(over: Partial<Parameters<typeof runOfShowWarnings>[0]> = {}) {
		return runOfShowWarnings({
			firstSetAt: T0,
			curfewAt: curfew,
			doorsAt: doors,
			slots: [warnable({ id: 'a' })],
			...over
		}).map((w) => w.code);
	}

	it('is silent on a night that fits', () => {
		expect(codes()).toEqual([]);
	});

	it('warns when the running order finishes past curfew', () => {
		expect(
			codes({
				slots: [
					warnable({ id: 'a', sortOrder: 1, setLengthMinutes: 120 }),
					warnable({ id: 'b', sortOrder: 2, setLengthMinutes: 120 })
				]
			})
		).toContain('past_curfew');
	});

	// Computed from the walk, not from a stored `scheduledStartAt`, so a read is
	// never wrong about a night whose recompute has not landed yet.
	it('counts the changeovers towards curfew, not just the sets', () => {
		const warnings = runOfShowWarnings({
			firstSetAt: T0,
			curfewAt: new Date('2026-09-12T04:35:00Z'),
			doorsAt: doors,
			slots: [warnable({ id: 'a', setLengthMinutes: 60, changeoverMinutes: 10 })]
		});
		expect(warnings.map((w) => w.code)).toContain('past_curfew');
	});

	it('warns when the first set starts before doors', () => {
		expect(codes({ doorsAt: new Date('2026-09-12T04:00:00Z') })).toContain('before_doors');
	});

	it('warns about a set over four hours long', () => {
		expect(codes({ slots: [warnable({ id: 'a', setLengthMinutes: 300 })] })).toContain(
			'set_too_long'
		);
	});

	it('warns when a soundcheck is after the first set', () => {
		expect(
			codes({
				slots: [warnable({ id: 'a', soundcheckAt: new Date('2026-09-12T05:00:00Z') })]
			})
		).toContain('soundcheck_after_first_set');
	});

	it('says nothing about a soundcheck hours before the downbeat', () => {
		expect(
			codes({
				slots: [warnable({ id: 'a', soundcheckAt: new Date('2026-09-12T01:00:00Z') })]
			})
		).toEqual([]);
	});

	// A night with no downbeat has no schedule to be late for, but a set length
	// is still a typo whether or not the show has a time yet.
	it('drops the schedule warnings when there is no downbeat, and keeps the rest', () => {
		expect(
			codes({ firstSetAt: null, slots: [warnable({ id: 'a', setLengthMinutes: 300 })] })
		).toEqual(['set_too_long']);
	});
});

describe('the acts pool divides equally', () => {
	it.each([
		[1, [10_000]],
		[2, [5000, 5000]],
		[3, [3333, 3333, 3334]],
		[4, [2500, 2500, 2500, 2500]],
		[7, [1428, 1428, 1428, 1429, 1429, 1429, 1429]]
	])('%i acts → %j', (count, expected) => {
		expect(equalPoolShares(count)).toEqual(expected);
	});

	it('always sums to the whole pool', () => {
		for (let n = 1; n <= SLOT_MAX; n++) {
			expect(equalPoolShares(n).reduce((a, b) => a + b, 0)).toBe(POOL_BPS);
		}
	});

	it('gives the remainder to the acts furthest down the bill', () => {
		// Not a coin toss: the same bill must divide the same way twice.
		expect(equalPoolShares(3)).toEqual(equalPoolShares(3));
		expect(equalPoolShares(3)[2]).toBeGreaterThan(equalPoolShares(3)[0]);
	});

	it('refuses a share that overspends the pool', () => {
		// Three acts at 7000 each — enterable today, and pays out 210% of the pool.
		expect(poolShareFits([7000, 1500], 1500)).toBe(true);
		expect(poolShareFits([7000, 7000], 7000)).toBe(false);
		expect(poolShareFits([], 10_000)).toBe(true);
	});

	it('permits a bill that is still being filled in', () => {
		// Under-allocating is unfinished, not dangerous.
		expect(poolShareFits([3333], 3333)).toBe(true);
	});
});
