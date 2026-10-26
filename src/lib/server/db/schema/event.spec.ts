import { describe, it, expect } from 'vitest';
import { createEventSchema, eventKinds } from '$lib/server/db/schema/event';
import { eventKindLabels } from '$lib/config';
import { dollarsToCents } from '$lib/utils/event-ticketing';

// #1822's rule: the create form holds what the row needs, and nothing else
// reaches the insert — tickets, the room and repeating are set on the event page.
describe('createEventSchema', () => {
	it('drops everything the row does not need', () => {
		const result = createEventSchema.safeParse({
			title: 'Open Mic Night',
			eventDate: '2026-07-15',
			eventStartTime: '19:00',
			eventEndTime: '22:00',
			ticketingEnabled: true,
			reserveSpace: true,
			recurring: true
		});
		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			title: 'Open Mic Night',
			kind: 'show',
			eventDate: '2026-07-15',
			eventStartTime: '19:00',
			eventEndTime: '22:00'
		});
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

// The labels live in config because a component may not import the schema, so
// nothing in the type system ties the two lists together. This does.
describe('eventKindLabels', () => {
	it('names every kind and nothing else', () => {
		expect(Object.keys(eventKindLabels).sort()).toEqual([...eventKinds].sort());
	});
});
