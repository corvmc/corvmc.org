import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './ListFilters.test.svelte';
import '../../../routes/layout.css';

const state = () => JSON.parse(page.getByTestId('state').element().textContent ?? '{}');

describe('ListFilters', () => {
	it('returns to page 1 on any change, and Clear resets every filter', async () => {
		await render(Harness);

		await page.getByTestId('type-filter').selectOptions('b');
		await expect.poll(state).toMatchObject({ type: 'b', page: 1 });

		await page.getByRole('searchbox').fill('wolves');
		await expect.poll(state).toMatchObject({ search: 'wolves' });

		await page.getByTestId('status-filter').selectOptions('open');
		await expect.poll(state).toMatchObject({ status: 'open' });

		// Clear is the only button in the bar besides the date trigger.
		const buttons = page.getByRole('button');
		await buttons.last().click();
		await expect.poll(state).toEqual({
			type: '',
			search: '',
			range: 'from_today',
			status: '',
			page: 1
		});
		await expect.element(page.getByRole('searchbox')).toHaveValue('');
	});

	it('lets the page react to a status before the page resets', async () => {
		await render(Harness);

		await page.getByTestId('status-filter').selectOptions('closed');
		await expect.poll(state).toMatchObject({ status: 'closed', range: 'any', page: 1 });
	});

	it('shows the status dot only when the page asks for it', async () => {
		await render(Harness);
		await expect.element(page.getByTestId('status-dot')).not.toBeInTheDocument();

		await render(Harness, { dot: true });
		await expect.element(page.getByTestId('status-dot')).toBeInTheDocument();
	});
});
