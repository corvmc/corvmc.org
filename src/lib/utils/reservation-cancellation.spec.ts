import { describe, it, expect } from 'vitest';
import { describeCancellation } from './reservation-cancellation';
import { reservationCancellerLabels, reservationCancellers } from '$lib/config';

// 2026-09-03 23:15 UTC is 4:15 PM in the venue's zone.
const AT = new Date('2026-09-03T23:15:00Z');

describe('describeCancellation', () => {
	it('names the staff member who cancelled, and when', () => {
		expect(
			describeCancellation({ cancelledBy: 'staff', cancelledByName: 'Jane Doe', cancelledAt: AT })
		).toBe('Cancelled by staff (Jane Doe), Thu, Sep 3, 4:15 PM.');
	});

	it('says a member cancelled', () => {
		expect(
			describeCancellation({ cancelledBy: 'member', cancelledByName: 'Sam', cancelledAt: AT })
		).toBe('Cancelled by member (Sam), Thu, Sep 3, 4:15 PM.');
	});

	it('says a band owner cancelled', () => {
		expect(
			describeCancellation({ cancelledBy: 'owner', cancelledByName: null, cancelledAt: AT })
		).toBe('Cancelled by band owner, Thu, Sep 3, 4:15 PM.');
	});

	it('reads as automatic for a job, never naming a person', () => {
		expect(
			describeCancellation({ cancelledBy: 'system', cancelledByName: 'Stray', cancelledAt: AT })
		).toBe('Cancelled automatically, Thu, Sep 3, 4:15 PM.');
	});

	it('leaves out what an unrecorded row does not know', () => {
		expect(
			describeCancellation({ cancelledBy: null, cancelledByName: null, cancelledAt: null })
		).toBe('Cancelled.');
		expect(
			describeCancellation({ cancelledBy: 'staff', cancelledByName: null, cancelledAt: null })
		).toBe('Cancelled by staff.');
	});

	it('labels every canceller', () => {
		for (const c of reservationCancellers) expect(reservationCancellerLabels[c]).toBeTruthy();
		expect(Object.keys(reservationCancellerLabels).sort()).toEqual(
			[...reservationCancellers].sort()
		);
	});
});
