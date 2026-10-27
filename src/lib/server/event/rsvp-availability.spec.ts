import { describe, it, expect } from 'vitest';
import { rsvpClosedReason } from './rsvp-availability';

const NOW = new Date('2026-11-10T20:00:00Z');
const HOUR = 3600_000;
const upcoming = {
	status: 'published',
	ticketingEnabled: false,
	startsAt: new Date(NOW.getTime() + 24 * HOUR),
	endsAt: new Date(NOW.getTime() + 26 * HOUR)
};

describe('rsvpClosedReason', () => {
	it('is open for a published, unticketed, upcoming event', () => {
		expect(rsvpClosedReason(upcoming, NOW)).toBeNull();
	});

	it('stays open while the event is running', () => {
		const running = {
			...upcoming,
			startsAt: new Date(NOW.getTime() - HOUR),
			endsAt: new Date(NOW.getTime() + HOUR)
		};
		expect(rsvpClosedReason(running, NOW)).toBeNull();
	});

	it('closes a cancelled event', () => {
		expect(rsvpClosedReason({ ...upcoming, status: 'cancelled' }, NOW)).toBe('cancelled');
	});

	it.each(['draft', 'pending_review', 'rejected'])('closes a %s event as unpublished', (status) => {
		expect(rsvpClosedReason({ ...upcoming, status }, NOW)).toBe('unpublished');
	});

	it('sends a ticketed event to its tickets', () => {
		expect(rsvpClosedReason({ ...upcoming, ticketingEnabled: true }, NOW)).toBe('ticketed');
	});

	it('closes an event that has ended', () => {
		const past = {
			...upcoming,
			startsAt: new Date(NOW.getTime() - 26 * HOUR),
			endsAt: new Date(NOW.getTime() - 24 * HOUR)
		};
		expect(rsvpClosedReason(past, NOW)).toBe('past');
	});

	it('reports cancelled before past, so a dead show says why', () => {
		const cancelledPast = {
			status: 'cancelled',
			ticketingEnabled: false,
			startsAt: new Date(NOW.getTime() - 26 * HOUR),
			endsAt: new Date(NOW.getTime() - 24 * HOUR)
		};
		expect(rsvpClosedReason(cancelledPast, NOW)).toBe('cancelled');
	});
});
