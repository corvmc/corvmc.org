import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CalendarHarness from './CalendarSelect.test.svelte';

/**
 * The month was a grid of bare numbers: no arrow keys, no accessible name past
 * the day number, and selection carried by background colour alone. #873.
 */
const RANGE = { min: '2026-09-07', max: '2026-09-20' };

function cell(iso: string) {
	return document.querySelector<HTMLElement>(`[data-date="${iso}"]`)!;
}

describe('CalendarSelect', () => {
	it('names a date in full rather than by its day number', async () => {
		await render(CalendarHarness, RANGE);

		expect(cell('2026-09-09').getAttribute('aria-label')).toBe('Wednesday, September 9, 2026');
	});

	it('says why an unavailable date cannot be picked', async () => {
		await render(CalendarHarness, { ...RANGE, unavailable: ['2026-09-09'] });

		expect(cell('2026-09-09').getAttribute('aria-label')).toContain('unavailable');
		expect(cell('2026-09-09').getAttribute('aria-disabled')).toBe('true');
	});

	it('says a date outside the window is outside it', async () => {
		await render(CalendarHarness, RANGE);

		expect(cell('2026-09-21').getAttribute('aria-label')).toContain('outside');
	});

	it('is one tab stop, not one per date', async () => {
		await render(CalendarHarness, RANGE);

		const tabbable = document.querySelectorAll('[data-date][tabindex="0"]');
		expect(tabbable).toHaveLength(1);
	});

	it('moves a day with the arrow keys and a week with the vertical ones', async () => {
		await render(CalendarHarness, { ...RANGE, value: '2026-09-09' });

		cell('2026-09-09').focus();
		await page
			.getByRole('grid')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(document.activeElement).toBe(cell('2026-09-10'));

		await page
			.getByRole('grid')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(cell('2026-09-17'));
	});

	it('marks the chosen date as selected for a reader, not only in colour', async () => {
		await render(CalendarHarness, { ...RANGE, value: '2026-09-09' });

		expect(cell('2026-09-09').closest('[role="gridcell"]')?.getAttribute('aria-selected')).toBe(
			'true'
		);
		expect(cell('2026-09-10').closest('[role="gridcell"]')?.getAttribute('aria-selected')).toBe(
			'false'
		);
	});

	it('gives the weekday headers their full names', async () => {
		await render(CalendarHarness, RANGE);

		const headers = [...document.querySelectorAll('[role="columnheader"]')].map((h) =>
			h.getAttribute('aria-label')
		);
		expect(headers).toEqual([
			'Sunday',
			'Monday',
			'Tuesday',
			'Wednesday',
			'Thursday',
			'Friday',
			'Saturday'
		]);
	});
});
