import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DayTimeline from './DayTimeline.svelte';

/** Anything blocking the room that day is on the one timeline (#1833). */
describe('DayTimeline', () => {
	const current = {
		id: 'res-1',
		startsAt: new Date('2026-11-01T19:00:00Z'),
		endsAt: new Date('2026-11-01T21:00:00Z'),
		bookerType: 'user' as const
	};

	it('draws a same-day closure as a blocked span named by its reason', async () => {
		const { container } = await render(DayTimeline, {
			current,
			closures: [
				{
					id: 'c1',
					reason: 'Deep clean',
					startsAt: new Date('2026-11-01T17:00:00Z'),
					endsAt: new Date('2026-11-01T18:00:00Z')
				}
			]
		});

		const span = container.querySelector('[data-closure]') as HTMLElement;
		expect(span).not.toBeNull();
		expect(span.title).toBe('Closed: Deep clean');
		expect(span.style.width).not.toBe('0%');
	});

	// 9pm PST on Nov 5 to 5am on Nov 6: one closure, seen from both of its days.
	const overnight = {
		id: 'c2',
		reason: 'Floor',
		startsAt: new Date('2026-11-06T05:00:00Z'),
		endsAt: new Date('2026-11-06T13:00:00Z')
	};
	const fifth = '2026-11-05';
	const sixth = '2026-11-06';

	it('runs a closure that crosses midnight to the end of its first day', async () => {
		const { container } = await render(DayTimeline, { day: fifth, closures: [overnight] });

		const span = container.querySelector('[data-closure]') as HTMLElement;
		expect(Number.parseFloat(span.style.left)).toBeCloseTo((12 / 13) * 100, 1);
		expect(Number.parseFloat(span.style.width)).toBeCloseTo((1 / 13) * 100, 1);
	});

	it('draws nothing for a closure that ends before the day it reaches has opened', async () => {
		const { container } = await render(DayTimeline, { day: sixth, closures: [overnight] });
		expect(container.querySelector('[data-closure]')).toBeNull();
	});

	it('starts a closure from the day before at the left edge', async () => {
		const { container } = await render(DayTimeline, {
			day: sixth,
			closures: [{ ...overnight, endsAt: new Date('2026-11-06T20:00:00Z') }]
		});

		const span = container.querySelector('[data-closure]') as HTMLElement;
		expect(Number.parseFloat(span.style.left)).toBe(0);
		expect(Number.parseFloat(span.style.width)).toBeCloseTo((3 / 13) * 100, 1);
	});

	it('takes the day from the current reservation', async () => {
		const { container } = await render(DayTimeline, {
			current: {
				...current,
				startsAt: overnight.startsAt,
				endsAt: new Date('2026-11-06T05:30:00Z')
			},
			closures: [overnight]
		});

		const span = container.querySelector('[data-closure]') as HTMLElement;
		expect(Number.parseFloat(span.style.width)).toBeCloseTo((1 / 13) * 100, 1);
	});

	it('draws no closure span on a day without one', async () => {
		const { container } = await render(DayTimeline, { current });
		expect(container.querySelector('[data-closure]')).toBeNull();
	});
});
