import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { CONFIRMATION_WINDOW_DAYS, UNCONFIRMED_RELEASE_NOTICE } from '$lib/config';
import UnconfirmedNotice from './UnconfirmedNotice.svelte';

/**
 * `cancelUnconfirmedReservations()` cancels anything still `scheduled` at its
 * start time. Before #895 the only member-facing copy was "Confirm from Sep 15",
 * which names a date without naming what passes with it — so the sentence, not
 * the date, is what this component exists to say.
 */

const DAY = 24 * 60 * 60 * 1000;
const text = () => document.body.textContent ?? '';

describe('UnconfirmedNotice', () => {
	it('says what happens to a booking nobody confirms', async () => {
		await render(UnconfirmedNotice, { startsAt: new Date(Date.now() + 9 * DAY) });

		expect(text()).toContain(UNCONFIRMED_RELEASE_NOTICE);
	});

	it('names the day confirming opens while it is still shut', async () => {
		await render(UnconfirmedNotice, {
			startsAt: new Date(Date.now() + (CONFIRMATION_WINDOW_DAYS + 6) * DAY)
		});

		expect(text()).toContain('Confirmation opens');
	});

	// Inside the window every surface using this offers Confirm, so a date would
	// tell a member to wait for something they can already do.
	it('drops the date once confirming has opened', async () => {
		await render(UnconfirmedNotice, { startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000) });

		expect(text()).not.toContain('Confirmation opens');
		expect(text()).toContain(UNCONFIRMED_RELEASE_NOTICE);
	});
});
