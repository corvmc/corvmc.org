import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FilterBarHarness from './FilterBar.test.svelte';
import '../../../routes/layout.css';

/**
 * The menu's trigger is the only control carrying `aria-expanded` (bits-ui
 * popover); Clear is the button after it. The count is the trigger's badge.
 */
const filters = () => page.getByRole('button', { expanded: false });
const badge = () => filters().element().querySelector('.badge')?.textContent?.trim() ?? null;

describe('FilterBar menu', () => {
	it('keeps inline filters visible and the secondary ones behind Filters', async () => {
		await render(FilterBarHarness, { width: 1100 });

		await expect.element(page.getByLabelText('Category')).toBeVisible();
		await expect.element(page.getByLabelText('Tier')).not.toBeInTheDocument();

		await filters().click();
		await expect.element(page.getByLabelText('Tier')).toBeVisible();
	});

	it('badges the button with the menu count and clears from the bar', async () => {
		await render(FilterBarHarness, { width: 1100 });

		await filters().click();
		await page.getByLabelText('Tier').selectOptions('premium');
		await userEvent.keyboard('{Escape}');

		await expect.element(filters()).toBeVisible();
		await expect.poll(badge).toBe('1');
		await page.getByRole('button').last().click();
		await expect.poll(() => page.getByTestId('cleared').element().textContent).toBe('1');
		await expect.poll(badge).toBeNull();
	});

	it('keeps inline filters inline on a phone rather than adding a second Filters button', async () => {
		await render(FilterBarHarness, { width: 340 });

		await expect.element(page.getByLabelText('Category')).toBeVisible();
		// One disclosure: the popover trigger, and no collapsing `label.btn` beside it.
		expect(document.querySelectorAll('[aria-haspopup], label[for^="filters-"]')).toHaveLength(1);
	});
});
