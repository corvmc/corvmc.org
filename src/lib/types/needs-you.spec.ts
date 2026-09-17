import { describe, expect, it } from 'vitest';
import { sortNeedsYou, type NeedsYouItem } from './needs-you';

const at = (iso: string | null, rank: number, kind = 'loan-due'): NeedsYouItem => ({
	kind: kind as NeedsYouItem['kind'],
	title: `${kind} ${iso ?? 'undated'}`,
	href: '/member' as NeedsYouItem['href'],
	label: 'Go',
	dueAt: iso ? new Date(iso) : null,
	rank
});

describe('sortNeedsYou', () => {
	it('puts the soonest deadline first', () => {
		const sorted = sortNeedsYou([
			at('2026-10-01T00:00:00Z', 5),
			at('2026-09-18T00:00:00Z', 5),
			at('2026-09-20T00:00:00Z', 5)
		]);

		expect(sorted.map((i) => i.dueAt?.toISOString().slice(0, 10))).toEqual([
			'2026-09-18',
			'2026-09-20',
			'2026-10-01'
		]);
	});

	it('sorts an overdue item ahead of everything, because it already failed', () => {
		const sorted = sortNeedsYou([at('2026-09-20T00:00:00Z', 0), at('2026-09-01T00:00:00Z', 9)]);

		expect(sorted[0].dueAt?.toISOString().slice(0, 10)).toBe('2026-09-01');
	});

	// The decision #1245 asked for: an invitation with no expiry is not more
	// urgent than a room you lose on Friday, however long it has been waiting.
	it('puts every dated item ahead of every undated one', () => {
		const sorted = sortNeedsYou([at(null, 0), at('2030-01-01T00:00:00Z', 9), at(null, 1)]);

		expect(sorted.map((i) => i.dueAt !== null)).toEqual([true, false, false]);
	});

	it('breaks a tie on rank, so two things due the same instant have one order', () => {
		const sorted = sortNeedsYou([at('2026-09-20T00:00:00Z', 3), at('2026-09-20T00:00:00Z', 1)]);

		expect(sorted.map((i) => i.rank)).toEqual([1, 3]);
	});

	it('orders the undated ones by rank', () => {
		expect(sortNeedsYou([at(null, 12), at(null, 10), at(null, 11)]).map((i) => i.rank)).toEqual([
			10, 11, 12
		]);
	});

	it('does not mutate its input', () => {
		const items = [at('2026-10-01T00:00:00Z', 0), at('2026-09-01T00:00:00Z', 0)];
		sortNeedsYou(items);

		expect(items[0].dueAt?.toISOString().slice(0, 10)).toBe('2026-10-01');
	});
});
