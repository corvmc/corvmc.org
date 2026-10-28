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

	it('draws no closure span on a day without one', async () => {
		const { container } = await render(DayTimeline, { current });
		expect(container.querySelector('[data-closure]')).toBeNull();
	});
});
