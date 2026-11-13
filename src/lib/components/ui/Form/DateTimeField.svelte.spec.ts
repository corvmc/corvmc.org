import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './DateTimeField.test.svelte';

/** What the form around the control would post. */
function submitted() {
	const form = page.getByTestId('harness').element() as HTMLFormElement;
	// eslint-disable-next-line no-restricted-syntax -- reading what a plain form posts is the point
	const data = new FormData(form);
	return { date: data.get('eventDate'), time: data.get('eventStartTime') };
}

const shown = () => page.getByTestId('date-time-trigger').element().textContent?.trim();

describe('DateTimeField', () => {
	it('starts from the values it was given', async () => {
		await render(Harness);
		expect(submitted()).toEqual({ date: '2026-11-13', time: '19:00' });
	});

	it('posts a picked day, shows it, and counts it as an edit', async () => {
		const oninput = vi.fn();
		await render(Harness, { oninput });
		const before = shown();
		await page.getByTestId('date-time-trigger').click();
		const day = document.querySelector('[data-value="2026-11-20"] [role="button"]');
		await userEvent.click(day as HTMLElement);

		await vi.waitFor(() => expect(submitted()).toEqual({ date: '2026-11-20', time: '19:00' }));
		expect(oninput).toHaveBeenCalled();
		expect(shown()).not.toBe(before);
	});

	it('posts a changed start time without changing the day', async () => {
		const oninput = vi.fn();
		await render(Harness, { oninput });
		await page.getByTestId('date-time-trigger').click();
		await userEvent.fill(page.getByLabelText('Start time'), '20:30');

		await vi.waitFor(() => expect(submitted()).toEqual({ date: '2026-11-13', time: '20:30' }));
		expect(oninput).toHaveBeenCalled();
	});
});
