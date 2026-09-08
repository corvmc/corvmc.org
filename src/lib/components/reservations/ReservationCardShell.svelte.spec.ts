import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import ReservationCardShell from './ReservationCardShell.svelte';

/**
 * The treatment both panels now share (#566).
 *
 * The band panel drew a booking as a plain row with a status badge while the
 * member panel drew a tear-off date block tinted by status, so one record read
 * as two objects. What is pinned here is the part that must survive: the status
 * reaching the root as a class (the tint is `.confirmed .date-block`, so a
 * dropped class silently un-tints every card) and the ribbon rule.
 */

const card = () => document.querySelector('.reservation-card');

/** Stands in for whatever a panel puts in the card. */
const body = createRawSnippet(() => ({ render: () => '<p>Practice</p>' }));

describe('ReservationCardShell', () => {
	it('puts the status on the root, which is what tints the date block', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			status: 'confirmed',
			children: body
		});

		expect(card()?.classList.contains('confirmed')).toBe(true);
		expect(document.querySelector('.date-block')).not.toBeNull();
	});

	// `no_show` is the one status whose class carries an underscore, because it
	// comes from the raw enum value rather than a display label.
	it('keeps the underscore in no_show', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			status: 'no_show',
			children: body
		});

		expect(card()?.classList.contains('no_show')).toBe(true);
	});

	it('flags a session happening today', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			status: 'confirmed',
			children: body
		});

		expect(document.querySelector('.upcoming-tag')?.textContent?.trim()).toBe('Today');
	});

	// A cancelled or completed session is not "Today" in any useful sense.
	it('does not flag a session that is already over', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			status: 'cancelled',
			children: body
		});

		expect(document.querySelector('.upcoming-tag')).toBeNull();
	});

	// The action row straddles the bottom border and is 20px of dead space when
	// empty, so a card with no controls must not render one.
	it('renders no action row when no actions are passed', async () => {
		await render(ReservationCardShell, {
			startsAt: new Date(),
			status: 'completed',
			children: body
		});

		expect(card()?.querySelector('.h-0')).toBeNull();
	});
});
