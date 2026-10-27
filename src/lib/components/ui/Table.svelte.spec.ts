import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TableHarness from './Table.test.svelte';
import '../../../routes/layout.css';

const box = (testId: string) => page.getByTestId(testId).element().getBoundingClientRect();

// #1925: on a wide page the primary cell took the slack, leaving a dead gap
// between it and the trailing columns.
describe('Table column packing', () => {
	it('packs columns together on a wide page and leaves the slack after the last', async () => {
		await render(TableHarness, { width: 1200 });
		await expect.element(page.getByTestId('primary')).toBeVisible();

		const primary = box('primary');
		const actions = box('actions');
		expect(primary.height).toBeLessThan(40);
		expect(box('count').left - primary.right).toBeLessThan(2);
		expect(actions.right).toBeLessThan(800);
		// The group header's colspan stops short of the filler cell, so the filler
		// carries the band's fill to the table's far edge.
		const groupRow = page.getByTestId('group').element().closest('tr')!;
		const filler = getComputedStyle(groupRow, '::after');
		expect(filler.display).toBe('table-cell');
		expect(filler.backgroundColor).toBe(
			getComputedStyle(page.getByTestId('group').element()).backgroundColor
		);
	});

	it('still lets the primary cell take the slack on a phone', async () => {
		await render(TableHarness, { width: 340 });
		await expect.element(page.getByTestId('primary')).toBeVisible();

		expect(box('actions').right).toBeGreaterThan(330);
	});
});
