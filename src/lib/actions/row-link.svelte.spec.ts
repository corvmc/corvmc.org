import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { goto } from '$app/navigation';
// The bug is CSS-driven: daisyUI sets `pointer-events: none` on an open
// dropdown's trigger, and the `client` project ships no CSS of its own.
import '../../routes/layout.css';
import RowLinkHarness from './RowLink.test.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

describe('rowLink', () => {
	beforeEach(() => vi.mocked(goto).mockClear());

	it('navigates on a click in a plain cell', async () => {
		await render(RowLinkHarness);
		await page.getByText('Name cell').click();
		expect(goto).toHaveBeenCalledWith('/row');
	});

	it('runs a callback in place of navigating', async () => {
		const open = vi.fn();
		await render(RowLinkHarness, { to: open });
		await page.getByText('Name cell').click();
		expect(open).toHaveBeenCalledOnce();
		expect(goto).not.toHaveBeenCalled();
	});

	// mousedown focuses the trigger, the dropdown opens, the trigger stops taking
	// pointer events, and the click lands on the cell behind it.
	it('opens the row actions menu instead of navigating', async () => {
		await render(RowLinkHarness);
		await page.getByRole('button', { name: 'Row actions' }).click();
		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByText('Menu body')).toBeVisible();
	});

	it('leaves a click inside the open menu alone', async () => {
		await render(RowLinkHarness);
		await page.getByRole('button', { name: 'Row actions' }).click();
		await page.getByText('Menu body').click();
		expect(goto).not.toHaveBeenCalled();
	});
});
