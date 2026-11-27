import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES, holdsForDigest } from '#lib/server/db/schema/notification.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

const keysWhere = (delivery: string) =>
	NOTIFICATION_TYPES.filter((t) => t.inAppDelivery === delivery).map((t) => t.key);

describe('holdsForDigest', () => {
	it('never holds an immediate type', () => {
		for (const key of keysWhere('immediate')) {
			expect(holdsForDigest(key, undefined, NOW)).toBe(false);
			expect(holdsForDigest(key, hoursAhead(48), NOW)).toBe(false);
		}
	});

	it('always holds a digest type, whatever it is about', () => {
		for (const key of keysWhere('digest')) {
			expect(holdsForDigest(key, undefined, NOW)).toBe(true);
			expect(holdsForDigest(key, hoursAhead(1), NOW)).toBe(true);
		}
	});

	it('holds a digestIfLater type only when it is more than 24 h away', () => {
		for (const key of keysWhere('digestIfLater')) {
			expect(holdsForDigest(key, undefined, NOW)).toBe(false);
			expect(holdsForDigest(key, hoursAhead(23), NOW)).toBe(false);
			expect(holdsForDigest(key, hoursAhead(24), NOW)).toBe(false);
			expect(holdsForDigest(key, hoursAhead(25), NOW)).toBe(true);
			expect(holdsForDigest(key, hoursAhead(-2), NOW)).toBe(false);
		}
	});

	it('resolves an unknown type immediate', () => {
		expect(holdsForDigest('not_a_type', hoursAhead(48), NOW)).toBe(false);
	});
});

// Class: a time-critical notice delayed. A reminder sent inside 24 h of its
// subject, or the code that opens the door, is useless a day late.
describe('time-critical types', () => {
	const critical = [
		'door_code_ready',
		'reservation_reminder',
		'check_in_reminder',
		'first_visit',
		'volunteer_shift_reminder',
		'orientation_unclaimed',
		'equipment_loan_due',
		'waitlist_slot_available',
		'membership_payment_failed',
		'band_invitation',
		'band_enquiry_received',
		'notification_digest'
	];

	it.each(critical)('%s is immediate', (key) => {
		const type = NOTIFICATION_TYPES.find((t) => t.key === key);
		expect(type?.inAppDelivery).toBe('immediate');
		expect(holdsForDigest(key, hoursAhead(72), NOW)).toBe(false);
	});
});

describe('registry', () => {
	it('lists each key once', () => {
		const keys = NOTIFICATION_TYPES.map((t) => t.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
