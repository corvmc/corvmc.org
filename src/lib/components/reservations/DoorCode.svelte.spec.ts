import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DoorCode from './DoorCode.svelte';
import { formatTime } from '#lib/utils/format.js';
import { doorCodeWindow } from '#lib/utils/door-code-window.js';

const startsAt = new Date('2026-07-01T18:00:00-07:00');
const endsAt = new Date('2026-07-01T20:00:00-07:00');
const minutes = (n: number) => new Date(startsAt.getTime() + n * 60_000);

const text = () => document.body.textContent ?? '';

describe('DoorCode', () => {
	it.each(['sm', 'lg'] as const)('states the opening time before the window (%s)', async (size) => {
		await render(DoorCode, { code: '4821', startsAt, endsAt, size, now: minutes(-60 * 24) });

		expect(document.querySelector('[data-door-code="before"]')).not.toBeNull();
		expect(text()).toContain('4821');
		expect(text()).toContain(formatTime(doorCodeWindow({ startsAt, endsAt }).opensAt));
	});

	it('shows the code alone while the window is open', async () => {
		await render(DoorCode, { code: '4821', startsAt, endsAt, now: minutes(30) });

		expect(document.querySelector('[data-door-code="open"]')).not.toBeNull();
		expect(text()).toContain('4821');
		expect(text()).not.toContain(formatTime(doorCodeWindow({ startsAt, endsAt }).opensAt));
	});

	it('drops the digits once the window is over', async () => {
		await render(DoorCode, { code: '4821', startsAt, endsAt, now: minutes(60 * 24) });

		expect(document.querySelector('[data-door-code="over"]')).not.toBeNull();
		expect(text()).not.toContain('4821');
	});

	it('dates the break-glass code from the grace before the start', async () => {
		await render(DoorCode, {
			code: '4821',
			startsAt,
			endsAt,
			kind: 'fallback',
			now: minutes(-10)
		});

		expect(document.querySelector('[data-door-code="open"]')).not.toBeNull();
	});

	it.each(['sm', 'lg'] as const)(
		'states when a booking before runs into the early minutes (%s)',
		async (size) => {
			const bookedUntil = minutes(-4);
			await render(DoorCode, {
				code: '4821',
				startsAt,
				endsAt,
				size,
				bookedUntil,
				now: minutes(-60)
			});

			expect(document.querySelector('[data-door-code-booked-before]')).not.toBeNull();
			expect(text()).toContain(formatTime(bookedUntil));
		}
	);

	it('says nothing of other bookings when none overlaps', async () => {
		await render(DoorCode, {
			code: '4821',
			startsAt,
			endsAt,
			bookedUntil: null,
			now: minutes(-60)
		});

		expect(document.querySelector('[data-door-code-booked-before]')).toBeNull();
	});
});
