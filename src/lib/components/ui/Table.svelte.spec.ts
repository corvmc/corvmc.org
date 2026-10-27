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

// #1965: on a phone a wide table scrolls inside its wrapper while the page does
// not, so the clipped columns need a visible cue on the side that has more.
describe('Table scroll cue', () => {
	const scroller = () =>
		page.getByTestId('primary').element().closest<HTMLElement>('.overflow-x-auto')!;
	const frame = () => scroller().parentElement;

	it('cues the end edge when the table overflows to the right', async () => {
		await render(TableHarness, { width: 348, extra: 3 });
		await expect.element(page.getByTestId('primary')).toBeVisible();

		expect(scroller().scrollWidth).toBeGreaterThan(scroller().clientWidth);
		await expect.poll(() => frame()?.hasAttribute('data-overflow-end')).toBe(true);
		expect(frame()!.hasAttribute('data-overflow-start')).toBe(false);
		expect(getComputedStyle(frame()!, '::after').boxShadow).not.toBe('none');
	});

	it('shows no cue when the table fits', async () => {
		await render(TableHarness, { width: 348 });
		await expect.element(page.getByTestId('primary')).toBeVisible();

		expect(scroller().scrollWidth).toBe(scroller().clientWidth);
		expect(frame()!.hasAttribute('data-overflow-end')).toBe(false);
		expect(frame()!.hasAttribute('data-overflow-start')).toBe(false);
	});

	it('moves the cue to the start edge once scrolled to the end', async () => {
		await render(TableHarness, { width: 348, extra: 3 });
		await expect.poll(() => frame()?.hasAttribute('data-overflow-end')).toBe(true);

		const el = scroller();
		el.scrollLeft = el.scrollWidth;
		await expect.poll(() => frame()!.hasAttribute('data-overflow-start')).toBe(true);
		expect(frame()!.hasAttribute('data-overflow-end')).toBe(false);
	});
});
