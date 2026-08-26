import { describe, it, expect } from 'vitest';
import { createEventSchema } from '$lib/server/db/schema/event';
import { dollarsToCents } from '$lib/utils/event-ticketing';

// Regression: enabling ticketing without a valid price used to pass schema
// validation, then throw inside the event service and surface to the user as a
// 500 "Internal Error". The schema now rejects it as a field-level issue.
describe('createEventSchema ticketing validation', () => {
	const base = {
		title: 'Open Mic Night',
		eventDate: '2026-07-15',
		eventStartTime: '19:00',
		eventEndTime: '22:00'
	};

	it('rejects ticketing enabled with a blank price', () => {
		const result = createEventSchema.safeParse({
			...base,
			ticketingEnabled: true,
			ticketPrice: ''
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes('ticketPrice'))).toBe(true);
		}
	});

	it('rejects ticketing enabled with a zero price', () => {
		const result = createEventSchema.safeParse({
			...base,
			ticketingEnabled: true,
			ticketPrice: '0'
		});
		expect(result.success).toBe(false);
	});

	it('accepts ticketing enabled with a valid price', () => {
		const result = createEventSchema.safeParse({
			...base,
			ticketingEnabled: true,
			ticketPrice: '1500'
		});
		expect(result.success).toBe(true);
	});

	it('accepts ticketing disabled with a blank price', () => {
		const result = createEventSchema.safeParse({
			...base,
			ticketingEnabled: false,
			ticketPrice: ''
		});
		expect(result.success).toBe(true);
	});
});

// A price is what attendees pay wherever they buy — an off-site seller or the
// door — so it no longer depends on us running the checkout.
describe('createEventSchema display price', () => {
	const base = {
		title: 'Gig at the Whiteside',
		eventDate: '2026-07-15',
		eventStartTime: '19:00',
		eventEndTime: '22:00'
	};

	it('accepts a price with ticketing disabled', () => {
		const result = createEventSchema.safeParse({
			...base,
			ticketingEnabled: false,
			ticketPrice: '1800'
		});
		expect(result.success).toBe(true);
	});
});

describe('dollarsToCents', () => {
	it('converts a typed price to whole cents', () => {
		expect(dollarsToCents('10')).toBe(1000);
		expect(dollarsToCents('12.50')).toBe(1250);
		expect(dollarsToCents('$8')).toBe(800);
		expect(dollarsToCents(' 7.99 ')).toBe(799);
	});

	it('reads a blank field as no price', () => {
		expect(dollarsToCents('')).toBeNull();
		expect(dollarsToCents(undefined)).toBeNull();
	});

	// undefined (not null) so the caller can tell a typo from a cleared field.
	it('flags anything that is not a positive amount', () => {
		expect(dollarsToCents('free')).toBeUndefined();
		expect(dollarsToCents('0')).toBeUndefined();
		expect(dollarsToCents('-5')).toBeUndefined();
	});
});
