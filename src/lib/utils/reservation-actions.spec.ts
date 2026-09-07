import { describe, it, expect } from 'vitest';
import {
	isTerminalStatus,
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
