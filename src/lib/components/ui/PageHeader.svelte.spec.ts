import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PageHeaderHarness from './PageHeader.test.svelte';
import '$lib/test/locators';

// Header actions are one size whatever the caller passes or omits; an unsized
// Action used to fall back to md beside sm siblings (#1831).

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('PageHeader actions', () => {
	it('gives an unsized Button and Action the header size', async () => {
		await render(PageHeaderHarness);

		await expect.element(page.getByRole('heading', { level: 1 })).toBeInTheDocument();
		expect(classesOf(page.getByTestId('unsized').element())).toContain('btn-sm');
		expect(classesOf(page.getByTestId('new-shift').element())).toContain('btn-sm');
	});

	it('leaves an explicit size and anything outside the header alone', async () => {
		await render(PageHeaderHarness);

		await expect.element(page.getByTestId('large')).toBeInTheDocument();
		expect(classesOf(page.getByTestId('large').element())).toContain('btn-lg');
		expect(classesOf(page.getByTestId('outside').element())).not.toContain('btn-sm');
	});

	it('does not shrink the buttons of a dialog a header action opens', async () => {
		await render(PageHeaderHarness);

		await page.getByTestId('new-shift').click();
		// A confirm dialog's footer is Dismiss, then the action.
		const dismiss = page.getByRole('dialog').getByCss('.modal-action button').first();
		await expect.element(dismiss).toBeVisible();
		expect(classesOf(dismiss.element())).not.toContain('btn-sm');
	});
});
