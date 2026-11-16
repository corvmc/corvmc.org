import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import ReservationCardShell from './ReservationCardShell.svelte';

/**
 * The treatment both panels now share (#566).
 *
 * The tint is `.booked .date-block`, so the track reaching the root as a
 * class is load-bearing — drop it and every card silently un-tints, which no
 * page test would notice.
 */

const card = () => document.querySelector('.reservation-card');

/** Stands in for whatever a panel puts in the card. */
const body = createRawSnippet(() => ({ render: () => '<p>Practice</p>' }));

describe('ReservationCardShell', () => {
	it('puts the track on the root, which is what tints the date block', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'booked',
			children: body
		});

		expect(card()?.classList.contains('booked')).toBe(true);
		expect(document.querySelector('.date-block')).not.toBeNull();
	});

	// `no_show` is one of two tracks whose class carries an underscore, because it
	// comes from the raw enum value rather than a display label.
	it('keeps the underscore in no_show', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'no_show',
			children: body
		});

		expect(card()?.classList.contains('no_show')).toBe(true);
	});

	it('flags a session happening today', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'booked',
			children: body
		});

		expect(document.querySelector('.upcoming-tag')?.textContent?.trim()).toBe('Today');
	});

	// A cancelled or completed session is not "Today" in any useful sense.
	it('does not flag a session that is already over', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'cancelled',
			children: body
		});

		expect(document.querySelector('.upcoming-tag')).toBeNull();
	});

	it('does not flag a paid session that has ended', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			ended: true,
			track: 'paid',
			children: body
		});

		expect(document.querySelector('.upcoming-tag')).toBeNull();
	});

	// An empty footer is padding under every past session, so a card with no
	// controls must not render one.
	it('renders no action row when no actions are passed', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'paid',
			children: body
		});

		expect(card()?.querySelector('.reservation-card-actions')).toBeNull();
	});

	it('puts its actions in the card action row', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			track: 'booked',
			children: body,
			actions: createRawSnippet(() => ({ render: () => '<button class="btn">x</button>' }))
		});

		expect(card()?.querySelector('.card-action-row .btn')).not.toBeNull();
	});
});
