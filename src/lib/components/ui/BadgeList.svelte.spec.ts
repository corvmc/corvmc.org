import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BadgeListZebraHarness from './BadgeList.test.svelte';
import '../../../routes/layout.css';
import '../../../routes/panel-theme.css';

// #1967: a ghost badge's fill and border were both base-200, the zebra stripe,
// so on every other roster row a role chip read as plain text.
describe('BadgeList on a zebra panel table', () => {
	it('keeps an edge distinct from the striped row behind it', async () => {
		await render(BadgeListZebraHarness);
		await expect.element(page.getByText('Booking Lead')).toBeVisible();

		const row = getComputedStyle(page.getByTestId('striped').element()).backgroundColor;
		const chip = getComputedStyle(page.getByText('Booking Lead').element());
		expect(row).not.toBe('rgba(0, 0, 0, 0)');
		expect(chip.borderTopColor).not.toBe(row);
	});
});
