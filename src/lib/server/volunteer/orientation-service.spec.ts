/**
 * `stateOf` is the whole argument for storing timestamps instead of a status,
 * so it is tested on its own: two of these four answers are ones a stored column
 * would get wrong, and getting them right is why the column does not exist.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));

import { stateOf } from './orientation-service';
import type { MemberOrientation } from '$lib/server/db/schema/volunteer';

const NOW = new Date('2026-09-04T12:00:00Z');
const SOON = new Date('2026-09-06T18:00:00Z');
const GONE = new Date('2026-09-01T18:00:00Z');

function row(over: Partial<MemberOrientation> = {}): MemberOrientation {
	return {
		id: 'mo-1',
		userId: 'u1',
		workOrderId: 'wo-1',
		reservationId: 'res-1',
		scheduledFor: null,
		completedAt: null,
		completedByUserId: null,
		waivedAt: null,
		waivedReason: null,
		waivedByUserId: null,
		notes: null,
		createdAt: NOW,
		updatedAt: NOW,
		...over
	} as MemberOrientation;
}

describe('stateOf', () => {
	it('is pending for a member nobody has recorded anything about', () => {
		expect(stateOf(null, false, NOW)).toBe('pending');
	});

	it('is scheduled while the shift is live and still ahead', () => {
		expect(stateOf(row({ scheduledFor: SOON }), true, NOW)).toBe('scheduled');
	});

	it('falls back to pending when the shift was called off', () => {
		// The booking was cancelled, so the shift is cancelled. A stored status
		// would still read `scheduled` here unless the cascade remembered to
		// rewrite it — which is the write most likely to be missed.
		expect(stateOf(row({ scheduledFor: SOON }), false, NOW)).toBe('pending');
	});

	it('falls back to pending once the time has passed with nobody having run it', () => {
		// An orientation nobody claimed emits no completion event at all, so
		// there is no moment at which anything could have written this back.
		expect(stateOf(row({ scheduledFor: GONE }), true, NOW)).toBe('pending');
	});

	it('is completed once somebody has shown them around', () => {
		expect(stateOf(row({ scheduledFor: GONE, completedAt: GONE }), false, NOW)).toBe('completed');
	});

	it('is waived when staff said it was not needed', () => {
		expect(stateOf(row({ waivedAt: GONE, waivedReason: 'Knows the room' }), false, NOW)).toBe(
			'waived'
		);
	});

	it('lets a real orientation outrank a waiver, whichever landed first', () => {
		const both = row({ completedAt: GONE, waivedAt: GONE, waivedReason: 'Knows the room' });
		expect(stateOf(both, false, NOW)).toBe('completed');
	});
});
