import { describe, it, expect } from 'vitest';
import {
	isAwaitingPayment,
	isOverdue,
	isTerminalStatus,
	memberPayAction,
	overlappingReservations,
	reservationPaymentState,
	visibleActions
} from './reservation-actions';

describe('reservationPaymentState', () => {
	const base = { status: 'confirmed' as const, refundedAt: null };

	it('cash/online paid → paid', () => {
		expect(reservationPaymentState({ ...base, paidAt: new Date(), cashDueCents: 0 })).toBe('paid');
	});

	it('cash owed at door → cash_due', () => {
		expect(reservationPaymentState({ ...base, paidAt: null, cashDueCents: 500 })).toBe('cash_due');
	});

	it('not yet settled (scheduled) → unpaid', () => {
		expect(
			reservationPaymentState({
				status: 'scheduled',
				paidAt: null,
				cashDueCents: null,
				refundedAt: null
			})
		).toBe('unpaid');
	});

	it('fully credit-covered → credits (the bug: must not read as comped)', () => {
		expect(
			reservationPaymentState({ ...base, paidAt: null, cashDueCents: 0, creditsUsed: 2 })
		).toBe('credits');
	});

	it('zero-charge waiver → comped', () => {
		expect(
			reservationPaymentState({ ...base, paidAt: null, cashDueCents: 0, creditsUsed: 0 })
		).toBe('comped');
		expect(reservationPaymentState({ ...base, paidAt: null, cashDueCents: 0 })).toBe('comped');
	});

	it('paid takes priority over credits when both present', () => {
		expect(
			reservationPaymentState({ ...base, paidAt: new Date(), cashDueCents: 0, creditsUsed: 1 })
		).toBe('paid');
	});

	it('cancelled and refunded → refunded, cancelled alone → cancelled', () => {
		expect(reservationPaymentState({ status: 'cancelled', refundedAt: new Date() })).toBe(
			'refunded'
		);
		expect(reservationPaymentState({ status: 'cancelled', refundedAt: null })).toBe('cancelled');
	});

	/**
	 * The whole of #573. Having been charged is not evidence of having been
	 * repaid: `reservation-service` writes `refundedAt` *inside* the try around
	 * `refund()`, so a refund that throws leaves a cancelled booking with a
	 * payment record and no refund — and the old inference called that
	 * "refunded" to the member whose money we still have.
	 */
	it('cancelled with a payment but no refund → cancelled, not refunded', () => {
		expect(
			reservationPaymentState({ status: 'cancelled', paidAt: new Date(), refundedAt: null })
		).toBe('cancelled');
	});

	/**
	 * #669: "Refund only" leaves the booking standing (a comp after the fact),
	 * so the row is still `confirmed` with a `paidAt` on it. `paidAt` used to be
	 * read first, and staff saw "Paid" on money that had already gone back.
	 */
	it('refunded but not cancelled → refunded, not paid', () => {
		expect(
			reservationPaymentState({
				status: 'confirmed',
				paidAt: new Date(),
				cashDueCents: 0,
				refundedAt: new Date()
			})
		).toBe('refunded');
	});

	it('refunded on a completed booking → refunded, not paid', () => {
		expect(
			reservationPaymentState({
				status: 'completed',
				paidAt: new Date(),
				cashDueCents: 0,
				refundedAt: new Date()
			})
		).toBe('refunded');
	});

	it('no_show → no_show', () => {
		expect(
			reservationPaymentState({ status: 'no_show', paidAt: new Date(), refundedAt: null })
		).toBe('no_show');
	});

	it('confirmed with credits never committed (staff-created) → unpaid, not comped', () => {
		expect(reservationPaymentState({ ...base, paidAt: null, cashDueCents: null })).toBe('unpaid');
	});

	it('completed with credits never committed → unpaid, not comped', () => {
		expect(
			reservationPaymentState({
				status: 'completed',
				paidAt: null,
				cashDueCents: null,
				refundedAt: null
			})
		).toBe('unpaid');
	});
});

describe('isTerminalStatus', () => {
	it('treats completed, cancelled, and no_show as terminal', () => {
		expect(isTerminalStatus('completed')).toBe(true);
		expect(isTerminalStatus('cancelled')).toBe(true);
		expect(isTerminalStatus('no_show')).toBe(true);
	});

	it('treats live statuses as non-terminal', () => {
		expect(isTerminalStatus('scheduled')).toBe(false);
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
			{ id: 'c', startsAt: at(14), endsAt: at(16), status: 'scheduled' } // touches, no overlap
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
	const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000);

	it('a confirmed, unpaid reservation that already ended still offers payment (#1952)', () => {
		const ended = { status: 'confirmed', startsAt: hoursFromNow(-26), paidAt: null };
		expect(memberPayAction({ ...ended, cashDueCents: null }, now)).toBe('balance');
		expect(memberPayAction({ ...ended, cashDueCents: 1500 }, now)).toBe('balance');
	});

	it('a paid or fully credit-settled confirmed reservation offers nothing', () => {
		const base = { status: 'confirmed', startsAt: hoursFromNow(-26) };
		expect(memberPayAction({ ...base, paidAt: now, cashDueCents: 0 }, now)).toBeNull();
		expect(memberPayAction({ ...base, paidAt: null, cashDueCents: 0 }, now)).toBeNull();
	});

	it('a scheduled slot pays to reserve only before its confirmation window opens', () => {
		const scheduled = { status: 'scheduled', paidAt: null, cashDueCents: null };
		expect(memberPayAction({ ...scheduled, startsAt: hoursFromNow(24 * 30) }, now)).toBe('reserve');
		expect(memberPayAction({ ...scheduled, startsAt: hoursFromNow(-2) }, now)).toBeNull();
	});

	it('only offers a confirmed balance the server gate accepts', () => {
		const r = { status: 'confirmed', startsAt: hoursFromNow(-2), paidAt: null, cashDueCents: 500 };
		expect(isAwaitingPayment(r)).toBe(true);
		expect(memberPayAction(r, now)).toBe('balance');
	});
});

describe('isOverdue', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	const ended = new Date('2026-10-28T12:00:00Z');
	const base = { status: 'confirmed', endsAt: ended, paidAt: null, cashDueCents: 1500 };

	it('a confirmed session that ended with a balance owed', () => {
		expect(isOverdue(base, now)).toBe(true);
		expect(isOverdue({ ...base, cashDueCents: null }, now)).toBe(true);
	});

	it('a completed or no-show session never paid', () => {
		expect(isOverdue({ ...base, status: 'completed' }, now)).toBe(true);
		expect(isOverdue({ ...base, status: 'no_show' }, now)).toBe(true);
	});

	it('not before the session ends', () => {
		expect(isOverdue({ ...base, endsAt: new Date('2026-10-29T13:00:00Z') }, now)).toBe(false);
	});

	it('not once paid, refunded, settled to zero or cancelled', () => {
		expect(isOverdue({ ...base, paidAt: ended }, now)).toBe(false);
		expect(isOverdue({ ...base, refundedAt: ended }, now)).toBe(false);
		expect(isOverdue({ ...base, cashDueCents: 0 }, now)).toBe(false);
		expect(isOverdue({ ...base, status: 'cancelled' }, now)).toBe(false);
	});
});
