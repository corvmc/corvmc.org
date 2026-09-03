import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// The interesting behaviour is the collision retry, which needs the `max(...)`
// read and the UPDATE to be separately programmable — so `select()` answers
// from a queue and `update()` from a list of outcomes.

let selectResultQueue: unknown[][] = [];
/** One entry per UPDATE, in order: rows to return, or an Error to throw. */
let updateOutcomes: (unknown[] | Error)[] = [];
const updateSets: unknown[] = [];

function chainableSelect() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResultQueue.length > 0 ? selectResultQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

const updateFn = vi.fn(() => ({
	set: (values: unknown) => {
		updateSets.push(values);
		return {
			where: () => ({
				returning: () => {
					const outcome = updateOutcomes.shift();
					if (outcome instanceof Error) return Promise.reject(outcome);
					return Promise.resolve(outcome ?? []);
				}
			})
		};
	}
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainableSelect(),
		update: (...args: unknown[]) => updateFn(...(args as []))
	}
}));

import { assignMemberNumber, getUserByMemberNumber } from './member-number-service';

const UNIQUE_ERROR = () =>
	new Error('D1_ERROR: UNIQUE constraint failed: user.member_number: SQLITE_CONSTRAINT');

beforeEach(() => {
	selectResultQueue = [];
	updateOutcomes = [];
	updateSets.length = 0;
	updateFn.mockClear();
});

describe('assignMemberNumber', () => {
	it('issues one past the highest number ever handed out', async () => {
		selectResultQueue = [
			[{ memberNumber: null }], // the user, unnumbered
			[{ max: 141 }] // max(member_number)
		];
		updateOutcomes = [[{ memberNumber: 142 }]];

		expect(await assignMemberNumber('u1')).toBe(142);
		expect(updateSets).toEqual([{ memberNumber: 142 }]);
	});

	it('starts at 1 when nobody has a number yet', async () => {
		selectResultQueue = [[{ memberNumber: null }], [{ max: null }]];
		updateOutcomes = [[{ memberNumber: 1 }]];

		expect(await assignMemberNumber('u1')).toBe(1);
		expect(updateSets).toEqual([{ memberNumber: 1 }]);
	});

	it('is idempotent — an account that already has a number keeps it', async () => {
		selectResultQueue = [[{ memberNumber: 7 }]];

		expect(await assignMemberNumber('u1')).toBe(7);
		expect(updateFn).not.toHaveBeenCalled();
	});

	it('retries once when a concurrent signup took the number, re-reading the max', async () => {
		selectResultQueue = [
			[{ memberNumber: null }],
			[{ max: 141 }], // both signups compute 142
			[{ memberNumber: null }], // re-read after the collision
			[{ max: 142 }] // the winner's number is visible now
		];
		updateOutcomes = [UNIQUE_ERROR(), [{ memberNumber: 143 }]];

		expect(await assignMemberNumber('u1')).toBe(143);
		expect(updateSets).toEqual([{ memberNumber: 142 }, { memberNumber: 143 }]);
	});

	it('rethrows when the retry collides too, rather than looping', async () => {
		selectResultQueue = [
			[{ memberNumber: null }],
			[{ max: 141 }],
			[{ memberNumber: null }],
			[{ max: 141 }]
		];
		updateOutcomes = [UNIQUE_ERROR(), UNIQUE_ERROR()];

		await expect(assignMemberNumber('u1')).rejects.toThrow(/UNIQUE constraint failed/);
		expect(updateFn).toHaveBeenCalledTimes(2);
	});

	it('does not retry an error that is not a uniqueness collision', async () => {
		selectResultQueue = [[{ memberNumber: null }], [{ max: 3 }]];
		updateOutcomes = [new Error('D1_ERROR: no such table: user')];

		await expect(assignMemberNumber('u1')).rejects.toThrow(/no such table/);
		expect(updateFn).toHaveBeenCalledTimes(1);
	});

	it('returns null for a user that does not exist', async () => {
		selectResultQueue = [[]];

		expect(await assignMemberNumber('nope')).toBeNull();
		expect(updateFn).not.toHaveBeenCalled();
	});

	it('returns null rather than throwing when the row is numbered mid-flight twice', async () => {
		// The UPDATE matches nothing because `member_number IS NULL` no longer
		// holds. Both passes see it; nothing is left to report but "no number
		// from me", and the caller treats that as cosmetic.
		selectResultQueue = [
			[{ memberNumber: null }],
			[{ max: 5 }],
			[{ memberNumber: null }],
			[{ max: 5 }]
		];
		updateOutcomes = [[], []];

		expect(await assignMemberNumber('u1')).toBeNull();
	});
});

describe('getUserByMemberNumber', () => {
	it('returns the account behind a number', async () => {
		selectResultQueue = [[{ id: 'u1', name: 'Jeff' }]];
		expect(await getUserByMemberNumber(142)).toEqual({ id: 'u1', name: 'Jeff' });
	});

	it('returns null when no row matches', async () => {
		selectResultQueue = [[]];
		expect(await getUserByMemberNumber(9999)).toBeNull();
	});
});
