import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DateRangeFilterHarness from './DateRangeFilter.test.svelte';
import '../../../routes/layout.css';

// At desktop width From, To and the presets sit on one row; FilterBar's 16rem
// search slot used to wrap the labels above their inputs (#1793).

/** The `<label>` naming an input: located by its `for`, not its text. */
const labelOf = (input: Element) => document.querySelector(`label[for="${input.id}"]`)!;

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

		// Every preset, not only the first and last: the whole set shares the row.
		for (const el of [
			labelOf(from.element()),
			page.getByLabelText('To').element(),
			...page.getByRole('button').elements()
		]) {
			expect(Math.abs(middle(el) - row)).toBeLessThan(4);
		}
	});

	it('keeps each label beside its own input when it wraps on a phone', async () => {
		await render(DateRangeFilterHarness, { width: 340 });

		const to = page.getByLabelText('To');
		await expect.element(to).toBeVisible();
		const label = labelOf(to.element());
		expect(Math.abs(middle(label) - middle(to.element()))).toBeLessThan(4);
	});
});
