import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DateRangeFilterHarness from './DateRangeFilter.test.svelte';
import '../../../routes/layout.css';

// At desktop width From, To and the presets sit on one row; FilterBar's 16rem
// search slot used to wrap the labels above their inputs (#1793).

const middle = (el: Element) => {
	const r = el.getBoundingClientRect();
	return r.top + r.height / 2;
};

describe('DateRangeFilter', () => {
	it('puts From, To and the presets on one row at desktop width', async () => {
		await render(DateRangeFilterHarness, { width: 1100 });

		const from = page.getByLabelText('From');
		await expect.element(from).toBeVisible();
		const row = middle(from.element());

		for (const el of [
			page.getByText('From', { exact: true }).element(),
			page.getByLabelText('To').element(),
			page.getByRole('button', { name: 'This year' }).element(),
			page.getByRole('button', { name: 'All time' }).element()
		]) {
			expect(Math.abs(middle(el) - row)).toBeLessThan(4);
		}
	});

	it('keeps each label beside its own input when it wraps on a phone', async () => {
		await render(DateRangeFilterHarness, { width: 340 });

		const to = page.getByLabelText('To');
		await expect.element(to).toBeVisible();
		const label = page.getByText('To', { exact: true }).element();
		expect(Math.abs(middle(label) - middle(to.element()))).toBeLessThan(4);
	});
});
