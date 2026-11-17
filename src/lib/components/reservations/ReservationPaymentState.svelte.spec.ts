import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReservationPaymentState from './ReservationPaymentState.svelte';

// Both reservation detail pages state the money this way (#3131).

const state = () =>
	document.querySelector('[data-payment-state]')?.getAttribute('data-payment-state');

describe('ReservationPaymentState', () => {
	it.each([
		['refunded', null, 'refunded'],
		['paid', null, 'paid'],
		['covered', 'credits', 'covered'],
		['booked', 'unpriced', 'unpriced'],
		['booked', 'cash_due', 'cash_due']
	] as const)('reads %s / %s as %s', async (track, trackDetail, expected) => {
		await render(ReservationPaymentState, { track, trackDetail, cashDueCents: 1500 });
		expect(state()).toBe(expected);
	});

	it('names the amount still owed', async () => {
		await render(ReservationPaymentState, {
			track: 'payment_due',
			trackDetail: 'cash_due',
			cashDueCents: 1500
		});
		expect(document.querySelector('[data-payment-state="cash_due"]')?.textContent).toContain(
			'15.00'
		);
	});

	it('says nothing for a cancelled booking', async () => {
		await render(ReservationPaymentState, {
			track: 'cancelled',
			trackDetail: null,
			cashDueCents: null
		});
		expect(state()).toBeUndefined();
	});
});
