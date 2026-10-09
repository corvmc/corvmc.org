import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PageHeaderHarness from './PageHeader.test.svelte';

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

		const header = page.getByRole('heading', { name: 'Volunteering' });
		await expect.element(header).toBeInTheDocument();
		expect(classesOf(page.getByRole('button', { name: 'Unsized' }).element())).toContain('btn-sm');
		expect(classesOf(page.getByRole('button', { name: 'New shift' }).element())).toContain(
			'btn-sm'
		);
	});

	it('leaves an explicit size and anything outside the header alone', async () => {
		await render(PageHeaderHarness);

		await expect.element(page.getByRole('button', { name: 'Large' })).toBeInTheDocument();
		expect(classesOf(page.getByRole('button', { name: 'Large' }).element())).toContain('btn-lg');
		expect(classesOf(page.getByRole('button', { name: 'Outside' }).element())).not.toContain(
			'btn-sm'
		);
	});

	it('does not shrink the buttons of a dialog a header action opens', async () => {
		await render(PageHeaderHarness);

		await page.getByRole('button', { name: 'New shift' }).click();
		const dismiss = page.getByRole('dialog').getByRole('button', { name: 'Dismiss' });
		await expect.element(dismiss).toBeVisible();
		expect(classesOf(dismiss.element())).not.toContain('btn-sm');
	});
});
