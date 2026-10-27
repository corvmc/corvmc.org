import { describe, expect, it } from 'vitest';
import { byDueAt, isOverdue } from './work-order-due';

const d = (iso: string) => new Date(iso);
const row = (id: string, dueAt: string | null, createdAt: string) => ({
	id,
	dueAt: dueAt ? d(dueAt) : null,
	createdAt: d(createdAt)
});

describe('byDueAt (#1966)', () => {
	it('orders soonest due first, undated last, creation as the tiebreak', () => {
		// The seeded schedule, in the creation order `listWorkOrders` returns it.
		const rows = [
			row('none-1', null, '2026-10-01T00:00:00Z'),
			row('oct30', '2026-10-30T17:00:00Z', '2026-10-02T00:00:00Z'),
			row('nov5', '2026-11-05T17:00:00Z', '2026-10-03T00:00:00Z'),
			row('oct23', '2026-10-23T17:00:00Z', '2026-10-04T00:00:00Z'),
			row('none-2', null, '2026-10-05T00:00:00Z'),
			row('oct28-late', '2026-10-28T17:00:00Z', '2026-10-07T00:00:00Z'),
			row('oct28-early', '2026-10-28T17:00:00Z', '2026-10-06T00:00:00Z'),
			row('none-3', null, '2026-10-08T00:00:00Z')
		];

		expect(
			[...rows]
				.reverse()
				.sort(byDueAt)
				.map((r) => r.id)
		).toEqual([
			'oct23',
			'oct28-early',
			'oct28-late',
			'oct30',
			'nov5',
			'none-1',
			'none-2',
			'none-3'
		]);
	});
});

describe('isOverdue (#1966)', () => {
	const now = d('2026-10-27T18:00:00Z');

	it('is overdue once the due moment has passed', () => {
		expect(isOverdue({ dueAt: d('2026-10-23T17:00:00Z') }, now)).toBe(true);
	});

	it('is not overdue before it is due, or with no deadline', () => {
		expect(isOverdue({ dueAt: d('2026-10-28T17:00:00Z') }, now)).toBe(false);
		expect(isOverdue({ dueAt: null }, now)).toBe(false);
	});
});
