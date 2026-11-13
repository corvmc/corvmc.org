import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FirstBookingRules from './FirstBookingRules.svelte';

// The first-booking rules (#2747) read their numbers from the member's notice,
// and the tour lines only appear while an orientation role gives a tour length.

describe('FirstBookingRules', () => {
	it('states the notice in days and the tour length from config', async () => {
		const { container } = await render(FirstBookingRules, {
			noticeMinutes: 2880,
			tourMinutes: 45
		});

		const items = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
		expect(items).toHaveLength(3);
		expect(items[0]).toContain('2');
		expect(items[1]).toContain('45');
	});

	it('leaves the tour out when no tour is held', async () => {
		const { container } = await render(FirstBookingRules, {
			noticeMinutes: 4320,
			tourMinutes: 0
		});

		expect(container.querySelectorAll('li')).toHaveLength(1);
	});
});
