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
		await render(ReservationSummary, { reservation: { ...base, status: 'scheduled' } });

		expect(text()).toContain('$30.00');
		expect(text()).not.toContain('A slot opened up');
	});
});
