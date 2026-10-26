import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FilterBarHarness from './FilterBar.test.svelte';
import '../../../routes/layout.css';

describe('FilterBar menu', () => {
	it('keeps inline filters visible and the secondary ones behind Filters', async () => {
		await render(FilterBarHarness, { width: 1100 });

		await expect.element(page.getByLabelText('Category')).toBeVisible();
		await expect.element(page.getByLabelText('Tier')).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Filters' }).click();
		await expect.element(page.getByLabelText('Tier')).toBeVisible();
	});

	it('badges the button with the menu count and clears from the bar', async () => {
		await render(FilterBarHarness, { width: 1100 });

		await page.getByRole('button', { name: 'Filters' }).click();
		await page.getByLabelText('Tier').selectOptions('premium');
		await userEvent.keyboard('{Escape}');

		await expect.element(page.getByRole('button', { name: 'Filters 1' })).toBeVisible();
		await page.getByRole('button', { name: 'Clear' }).click();
		await expect.element(page.getByTestId('cleared')).toHaveTextContent('1');
		await expect.element(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
	});

	it('keeps inline filters inline on a phone rather than adding a second Filters button', async () => {
		await render(FilterBarHarness, { width: 340 });

		await expect.element(page.getByLabelText('Category')).toBeVisible();
		expect(page.getByRole('button', { name: 'Filters' }).elements()).toHaveLength(1);
	});
});
