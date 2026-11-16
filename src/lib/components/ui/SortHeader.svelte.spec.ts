import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SortHeaderHarness from './SortHeader.test.svelte';

const header = (field: string) => document.querySelector(`th:has([data-sort="${field}"])`)!;
const token = () => page.getByTestId('sort').element().textContent;

describe('SortHeader', () => {
	it('marks only the sorted column, and flips it on a second click', async () => {
		await render(SortHeaderHarness, { sort: 'name' });
		expect(header('name').getAttribute('aria-sort')).toBe('ascending');
		expect(header('seen').getAttribute('aria-sort')).toBe('none');

		(header('name').querySelector('button') as HTMLButtonElement).click();
		await expect.poll(token).toBe('-name');
		await expect.poll(() => header('name').getAttribute('aria-sort')).toBe('descending');
	});

	it('starts a newest-first column descending', async () => {
		await render(SortHeaderHarness, { sort: 'name' });
		(header('seen').querySelector('button') as HTMLButtonElement).click();
		await expect.poll(token).toBe('-seen');
		await expect.poll(() => header('name').getAttribute('aria-sort')).toBe('none');
	});
});
