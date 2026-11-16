import { describe, it, expect } from 'vitest';
import {
	isAwaitingPayment,
	isTerminalStatus,
	memberPayAction,
	overlappingReservations,
	reservationTrack,
	trackDetail,
	visibleActions,
	type TrackedReservation
} from './reservation-actions';

describe('reservationTrack', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	const ahead = new Date('2026-10-30T12:00:00Z');
	const ended = new Date('2026-10-28T12:00:00Z');
	const base: TrackedReservation = {
		status: 'confirmed',
		bookerType: 'user',
		endsAt: ahead,
		paidAt: null,
		refundedAt: null,
		cashDueCents: 1500
	};
	const track = (extra: Partial<TrackedReservation> = {}) =>
		reservationTrack({ ...base, ...extra }, now);

	it('an upcoming unpaid reservation reads Booked, priced or not', () => {
		expect(track()).toBe('booked');
		expect(track({ cashDueCents: null })).toBe('booked');
	});

	it('Payment due starts when the reservation ends', () => {
		expect(track({ endsAt: ended })).toBe('payment_due');
		expect(track({ endsAt: ended, cashDueCents: null })).toBe('payment_due');
		expect(track({ endsAt: now })).toBe('booked');
	});

	it('credits and comps both read Covered, before and after the session', () => {
		expect(track({ cashDueCents: 0 })).toBe('covered');
		expect(track({ cashDueCents: 0, endsAt: ended, status: 'completed' })).toBe('covered');
	});

	it('paid reads Paid whatever the stored status', () => {
		expect(track({ paidAt: ended, cashDueCents: 0 })).toBe('paid');
		expect(track({ paidAt: ended, cashDueCents: 0, status: 'completed' })).toBe('paid');
	});

	// #669: refund-only leaves the booking standing with its `paidAt`.
	it('money that went back reads Refunded, never Paid or Cancelled', () => {
		expect(track({ paidAt: ended, refundedAt: now })).toBe('refunded');
		expect(track({ status: 'cancelled', refundedAt: now })).toBe('refunded');
		expect(track({ status: 'cancelled', paidAt: ended })).toBe('cancelled');
	});

	it('no-show and waitlisted read as themselves', () => {
		expect(track({ status: 'no_show', paidAt: ended, refundedAt: now })).toBe('no_show');
		expect(track({ status: 'waitlisted' })).toBe('waitlisted');
	});

	it('an event hold is Booked until it ends and never Payment due', () => {
		expect(track({ bookerType: 'production', cashDueCents: null })).toBe('booked');
		expect(track({ bookerType: 'production', cashDueCents: null, endsAt: ended })).toBe('covered');
	});

	it('a completed booking is never Payment due', () => {
		expect(track({ status: 'completed', endsAt: ended })).toBe('covered');
	});
});

describe('trackDetail', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	const base = {
		status: 'confirmed',
		bookerType: 'user',
		endsAt: new Date('2026-10-30T12:00:00Z'),
		paidAt: null,
		refundedAt: null,
		cashDueCents: 0 as number | null,
		creditsUsed: null as number | null
	};

	it('tells credits from a comp on a Covered reservation', () => {
		expect(trackDetail({ ...base, creditsUsed: 2 }, now)).toBe('credits');
		expect(trackDetail({ ...base, creditsUsed: 0 }, now)).toBe('comp');
		expect(trackDetail(base, now)).toBe('comp');
	});

	it('tells a priced balance from one never priced', () => {
		expect(trackDetail({ ...base, cashDueCents: 1500 }, now)).toBe('cash_due');
		expect(trackDetail({ ...base, cashDueCents: null }, now)).toBe('unpriced');
	});

	it('adds nothing to a paid, cancelled or event-hold reservation', () => {
		expect(trackDetail({ ...base, paidAt: now }, now)).toBeNull();
		expect(trackDetail({ ...base, status: 'cancelled' }, now)).toBeNull();
		expect(trackDetail({ ...base, bookerType: 'production' }, now)).toBeNull();
	});
});

describe('isTerminalStatus', () => {
	it('treats completed, cancelled, and no_show as terminal', () => {
		expect(isTerminalStatus('completed')).toBe(true);
		expect(isTerminalStatus('cancelled')).toBe(true);
		expect(isTerminalStatus('no_show')).toBe(true);
	});

	it('treats live statuses as non-terminal', () => {
		expect(isTerminalStatus('confirmed')).toBe(false);
		expect(isTerminalStatus('waitlisted')).toBe(false);
	});
});

describe('visibleActions cash tracking', () => {
	const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
	const pastEnd = new Date(Date.now() - 60 * 60 * 1000);

	it('offers cashReceived for confirmed rows with committed cash due', () => {
		const actions = visibleActions('confirmed', past, pastEnd, null, new Date(), {
			cashDueCents: 1500,
			paidAt: null
		});
		expect(actions.has('cashReceived')).toBe(true);
	});

	it('offers cashReceived for confirmed rows with credits never committed (staff-created)', () => {
		const actions = visibleActions('confirmed', past, pastEnd, null, new Date(), {
			cashDueCents: null,
			paidAt: null
		});
		expect(actions.has('cashReceived')).toBe(true);
	});

	it('does not offer cashReceived once settled or paid', () => {
		expect(
			visibleActions('confirmed', past, pastEnd, null, new Date(), {
				cashDueCents: 0,
				paidAt: null
			}).has('cashReceived')
		).toBe(false);
		expect(
			visibleActions('confirmed', past, pastEnd, null, new Date(), {
				cashDueCents: 1500,
				paidAt: new Date()
			}).has('cashReceived')
		).toBe(false);
	});
});

describe('visibleActions comp (#1818)', () => {
	const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
	const pastEnd = new Date(Date.now() - 60 * 60 * 1000);

	it('offers comp on a confirmed booking with cash still owed', () => {
		for (const cashDueCents of [1500, null]) {
			const actions = visibleActions('confirmed', past, pastEnd, null, new Date(), {
				cashDueCents,
				paidAt: null
			});
			expect(actions.has('comp')).toBe(true);
		}
	});

	it('does not offer comp on a confirmed booking that owes nothing', () => {
		for (const opts of [
			{ cashDueCents: 0, paidAt: null },
			{ cashDueCents: 1500, paidAt: new Date() }
		]) {
			expect(visibleActions('confirmed', past, pastEnd, null, new Date(), opts).has('comp')).toBe(
				false
			);
		}
	});
});

describe('visibleActions refund split (#669)', () => {
	const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
	const pastEnd = new Date(Date.now() - 60 * 60 * 1000);
	const paid = { cashDueCents: 0, paidAt: new Date(), refundedAt: null };

	it('offers both refund actions on a confirmed, paid, unrefunded booking', () => {
		const actions = visibleActions('confirmed', past, pastEnd, 'pr_1', new Date(), paid);
		expect(actions.has('refundAndCancel')).toBe(true);
		expect(actions.has('refundOnly')).toBe(true);
	});

	// `cancel()` rejects a completed booking outright, so offering the combined
	// action there would be a button that can only 400.
	it('offers only the refund-only action on a completed booking', () => {
		const actions = visibleActions('completed', past, pastEnd, 'pr_1', new Date(), paid);
		expect(actions.has('refundAndCancel')).toBe(false);
		expect(actions.has('refundOnly')).toBe(true);
	});

	it('offers neither once the row is refunded', () => {
		const actions = visibleActions('confirmed', past, pastEnd, 'pr_1', new Date(), {
			...paid,
			refundedAt: new Date()
		});
		expect(actions.has('refundAndCancel')).toBe(false);
		expect(actions.has('refundOnly')).toBe(false);
	});

	it('offers neither when there is no payment to refund', () => {
		const actions = visibleActions('confirmed', past, pastEnd, null, new Date(), paid);
		expect(actions.has('refundAndCancel')).toBe(false);
		expect(actions.has('refundOnly')).toBe(false);
	});
});

describe('overlappingReservations', () => {
	const at = (h: number) => new Date(2026, 7, 1, h, 0, 0);
	const current = { id: 'me', startsAt: at(12), endsAt: at(14), status: 'confirmed' };

	it('returns rows whose time range intersects the current reservation', () => {
		const others = [
			{ id: 'a', startsAt: at(13), endsAt: at(15), status: 'confirmed' },
			{ id: 'b', startsAt: at(10), endsAt: at(12), status: 'confirmed' }, // touches, no overlap
			{ id: 'c', startsAt: at(14), endsAt: at(16), status: 'confirmed' } // touches, no overlap
		];
		expect(overlappingReservations(current, others).map((o) => o.id)).toEqual(['a']);
	});

	it('ignores cancelled and waitlisted rows — they do not hold the slot', () => {
		const others = [
			{ id: 'a', startsAt: at(12), endsAt: at(14), status: 'cancelled' },
			{ id: 'b', startsAt: at(12), endsAt: at(14), status: 'waitlisted' }
		];
		expect(overlappingReservations(current, others)).toEqual([]);
	});

	it('reports nothing when the current reservation is terminal or waitlisted', () => {
		const others = [{ id: 'a', startsAt: at(12), endsAt: at(14), status: 'confirmed' }];
		expect(overlappingReservations({ ...current, status: 'cancelled' }, others)).toEqual([]);
		expect(overlappingReservations({ ...current, status: 'waitlisted' }, others)).toEqual([]);
	});

	it('never reports the reservation itself', () => {
		const others = [{ id: 'me', startsAt: at(12), endsAt: at(14), status: 'confirmed' }];
		expect(overlappingReservations(current, others)).toEqual([]);
	});
});

describe('memberPayAction', () => {
	const now = new Date('2026-10-27T18:00:00Z');
	const owed = {
		status: 'confirmed',
		bookerType: 'user',
		paidAt: null,
		refundedAt: null,
		cashDueCents: 1500
	};

	it('a confirmed, unpaid reservation offers payment, unpriced included (#1952)', () => {
		expect(memberPayAction({ ...owed, cashDueCents: null })).toBe('balance');
		expect(memberPayAction(owed)).toBe('balance');
	});

	it('a paid or fully credit-settled confirmed reservation offers nothing', () => {
		expect(memberPayAction({ ...owed, paidAt: now, cashDueCents: 0 })).toBeNull();
		expect(memberPayAction({ ...owed, cashDueCents: 0 })).toBeNull();
	});

	it('a refunded booking or an event hold offers nothing (#2991)', () => {
		expect(memberPayAction({ ...owed, refundedAt: now })).toBeNull();
		expect(memberPayAction({ ...owed, bookerType: 'production' })).toBeNull();
	});

	it('only offers a confirmed balance the server gate accepts', () => {
		expect(isAwaitingPayment(owed)).toBe(true);
		expect(memberPayAction(owed)).toBe('balance');
	});
});
