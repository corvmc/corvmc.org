import { describe, it, expect } from 'vitest';
import { ReservationFilters, adjacentId, urlFilterQuery } from './filters.svelte';

describe('ReservationFilters', () => {
	it('writes back the filter keys it was seeded with', () => {
		const query =
			'q=the%20band&booker=group&date=custom&from=2026-01-01&to=2026-01-31&status=payment_due&page=2';
		const filters = new ReservationFilters(new URLSearchParams(query));
		expect(filters.urlQuery).toBe(query);
	});

	it('is empty for the default view', () => {
		expect(new ReservationFilters(new URLSearchParams()).urlQuery).toBe('');
	});

	it('drops dates outside a custom range and unknown values', () => {
		const filters = new ReservationFilters(
			new URLSearchParams('date=next_7&from=2026-01-01&status=bogus&booker=bogus')
		);
		expect(filters.urlQuery).toBe('date=next_7');
	});

	it('reads a status value from before the track as the track it became', () => {
		const status = (value: string) =>
			new ReservationFilters(new URLSearchParams(`status=${value}`)).status;
		expect(status('confirmed')).toBe('booked');
		expect(status('completed')).toBe('paid');
		expect(status('waitlisted')).toBe('waitlisted');
		expect(status('cancelled')).toBe('cancelled');
		expect(status('payment_due')).toBe('payment_due');
	});

	it('compares against the URL by filter keys alone', () => {
		const url = new URL('https://x.test/staff/reservations/r1?access&date=any&recurring=1');
		expect(urlFilterQuery(url)).toBe(new ReservationFilters(url.searchParams).urlQuery);
	});
});

describe('adjacentId', () => {
	const ids = ['a', 'b', 'c'];

	it('steps up and down the list', () => {
		expect(adjacentId(ids, 'b', -1)).toBe('a');
		expect(adjacentId(ids, 'b', 1)).toBe('c');
	});

	it('stops at either end and for a reservation not in the list', () => {
		expect(adjacentId(ids, 'a', -1)).toBeUndefined();
		expect(adjacentId(ids, 'c', 1)).toBeUndefined();
		expect(adjacentId(ids, 'z', 1)).toBeUndefined();
	});
});
