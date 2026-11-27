import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FirstBookingCard from './FirstBookingCard.svelte';

// The dashboard's prompt for a member with no booking (#3410).

const slot = (date: string, startTime: string, endTime: string) => ({
	date,
	startTime,
	endTime,
	startsAt: new Date(`${date}T${startTime}:00-08:00`),
	endsAt: new Date(`${date}T${endTime}:00-08:00`)
});

const links = (container: HTMLElement) => [
	...container.querySelectorAll('[data-testid="first-booking"] a')
];

describe('FirstBookingCard', () => {
	it('renders nothing once the member has booked', async () => {
		const { container } = await render(FirstBookingCard, { firstBooking: null });

		expect(container.querySelector('[data-testid="first-booking"]')).toBeNull();
	});

	it('links each slot to the booking page with its date, start and end', async () => {
		const { container } = await render(FirstBookingCard, {
			firstBooking: {
				slots: [slot('2026-12-01', '15:00', '17:00'), slot('2026-12-02', '17:30', '19:30')]
			}
		});

		const urls = links(container).map((a) => new URL(a.getAttribute('href')!, 'http://x'));
		expect(urls.map((u) => u.pathname)).toEqual(['/member/reservations', '/member/reservations']);
		expect(urls.map((u) => Object.fromEntries(u.searchParams))).toEqual([
			{ date: '2026-12-01', start: '15:00', end: '17:00' },
			{ date: '2026-12-02', start: '17:30', end: '19:30' }
		]);
		expect(links(container).every((a) => a.hasAttribute('data-sveltekit-reload'))).toBe(true);
	});

	it('links to the booking page alone when no slot is open', async () => {
		const { container } = await render(FirstBookingCard, { firstBooking: { slots: [] } });

		expect(links(container).map((a) => a.getAttribute('href'))).toEqual(['/member/reservations']);
	});
});
