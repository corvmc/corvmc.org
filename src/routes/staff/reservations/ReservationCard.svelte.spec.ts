import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The folded row on /staff/reservations (#2694): which actions a card offers,
// and that its status and facts follow the card grammar in ui-patterns.
vi.mock('#lib/remote/reservations.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = (action: string) => ({
		enhance: () => ({ method: 'POST', action: `?/${action}` }),
		fields: { id: field('id'), allIssues: () => null },
		result: undefined
	});
	return {
		cashReceivedReservation: form('cashReceivedReservation'),
		noShowReservation: form('noShowReservation'),
		completeReservation: form('completeReservation')
	};
});

vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ReservationCard = (await import('./ReservationCard.svelte')).default;

const past = {
	startsAt: new Date('2020-03-14T19:00:00Z'),
	endsAt: new Date('2020-03-14T21:00:00Z')
};
const future = {
	startsAt: new Date('2099-03-14T19:00:00Z'),
	endsAt: new Date('2099-03-14T21:00:00Z')
};

const reservation = (over: Record<string, unknown> = {}) => ({
	kind: 'reservation',
	id: 'res-1',
	status: 'confirmed',
	bookerType: 'user',
	booker: { type: 'member', id: 'u-1', title: 'Ada Member' },
	recurringSeriesId: null,
	isFirstReservation: false,
	notes: null,
	stripePaymentRecordId: null,
	paidAt: new Date('2020-03-01T00:00:00Z'),
	cashDueCents: 0,
	creditsUsed: 0,
	refundedAt: null,
	...past,
	...over
});

const show = async (over: Record<string, unknown> = {}, current = false) => {
	const { container } = await render(ReservationCard, {
		reservation: reservation(over) as never,
		query: 'status=confirmed',
		current,
		rates: Promise.resolve({ user: 15, group: 15, production: 0, event_listing: 0 } as never)
	});
	return container.querySelector('li')!;
};

const buttons = (li: Element) => li.querySelectorAll('button');

describe('ReservationCard', () => {
	it('offers both settle actions, full width, on a session that ended owing', async () => {
		const li = await show({ paidAt: null, cashDueCents: 3000 });
		expect(buttons(li)).toHaveLength(2);
		for (const b of buttons(li)) expect(b.className).toContain('btn-block');
	});

	it('offers one full-width action on an ended session that is paid', async () => {
		const li = await show();
		expect(buttons(li)).toHaveLength(1);
		expect(buttons(li)[0].className).toContain('btn-block');
	});

	it('offers no action on a session still to come', async () => {
		const li = await show(future);
		expect(buttons(li)).toHaveLength(0);
	});

	// Slot 0: one mark, exception-only, never a labelled badge.
	it('marks a noteworthy status once and an ordinary one not at all', async () => {
		const ordinary = await show();
		expect(ordinary.querySelectorAll('.badge')).toHaveLength(0);
		expect(ordinary.querySelector(':scope > div > [role="img"]')).toBeNull();

		document.body.innerHTML = '';
		const cancelled = await show({ status: 'cancelled' });
		expect(cancelled.querySelectorAll('.badge')).toHaveLength(0);
		expect(cancelled.querySelectorAll(':scope > div > [role="img"]')).toHaveLength(1);
	});

	// Slot 2: every fact carries a label, since no header row names it.
	it('labels each fact', async () => {
		const li = await show({ recurringSeriesId: 'series-1' });
		await expect.poll(() => li.querySelectorAll('dd').length).toBe(2);
		expect(li.querySelectorAll('dt')).toHaveLength(2);
	});

	it('draws no payment fact for an event hold', async () => {
		const li = await show({ bookerType: 'event_listing' });
		expect(li.querySelector('dl')).toBeNull();
	});

	it('keeps the filter query on its link and marks the open row', async () => {
		const li = await show({}, true);
		expect(li.getAttribute('aria-current')).toBe('page');
		expect(
			li.querySelector('a[href$="/staff/reservations/res-1?status=confirmed"]')
		).not.toBeNull();
	});
});
