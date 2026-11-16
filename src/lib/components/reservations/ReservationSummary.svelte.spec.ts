import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReservationSummary from './ReservationSummary.svelte';

/**
 * A promoted waitlist entry showed "$30.00 · Due in 14 days" — the money line
 * for an ordinary booking, read off the session date — while the offer itself
 * expired in 24 hours. Two deadlines, and the wrong one was the only one on
 * screen (#1005).
 */
const base = {
	startsAt: new Date(Date.now() + 14 * 86400000),
	endsAt: new Date(Date.now() + 14 * 86400000 + 2 * 3600000),
	price: 30
};

const text = () => document.body.textContent ?? '';

describe('ReservationSummary, waitlisted', () => {
	it('shows the offer clock instead of a price once a slot is offered', async () => {
		await render(ReservationSummary, {
			reservation: {
				...base,
				status: 'waitlisted',
				waitlistExpiresAt: new Date(Date.now() + 20 * 3600000)
			}
		});

		expect(text()).toContain('A slot opened up');
		expect(text()).toContain('Confirm by');
		expect(text()).not.toContain('$30.00');
	});

	it('says nothing about an offer while still merely queued', async () => {
		await render(ReservationSummary, {
			reservation: { ...base, status: 'waitlisted', waitlistExpiresAt: null }
		});

		expect(text()).not.toContain('A slot opened up');
	});

	it('says nothing about an offer once it has lapsed', async () => {
		await render(ReservationSummary, {
			reservation: {
				...base,
				status: 'waitlisted',
				waitlistExpiresAt: new Date(Date.now() - 3600000)
			}
		});

		expect(text()).not.toContain('A slot opened up');
	});

	it(`leaves an ordinary booking's money line alone`, async () => {
		await render(ReservationSummary, { reservation: { ...base, status: 'confirmed' } });

		expect(text()).toContain('$30.00');
		expect(text()).not.toContain('A slot opened up');
	});
});

/** The money line follows the track (#2861); the card's badge carries the word. */
describe('ReservationSummary, money line', () => {
	const row = { ...base, status: 'confirmed', bookerType: 'user', cashDueCents: 3000 };
	const when = (r: object) => render(ReservationSummary, { reservation: { ...row, ...r } });

	it('says when an upcoming unpaid booking is due', async () => {
		await when({});
		expect(text()).toContain('$30.00');
		expect(text()).toContain('Due in');
	});

	it('dates a payment, and a refund ahead of the payment it undid', async () => {
		await when({ paidAt: new Date('2026-03-01T20:00:00Z') });
		expect(text()).toContain('Paid Mar 1');

		document.body.innerHTML = '';
		await when({
			paidAt: new Date('2026-03-01T20:00:00Z'),
			refundedAt: new Date('2026-03-05T20:00:00Z')
		});
		expect(text()).toContain('Refunded Mar 5');
		expect(text()).not.toContain('Paid');
	});

	it('leaves the price alone once the session has ended owing', async () => {
		const ended = new Date(Date.now() - 86400000);
		await when({ startsAt: new Date(ended.getTime() - 7200000), endsAt: ended });
		expect(text()).toContain('$30.00');
		expect(text()).not.toContain('Due');
	});
});
