import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './PageHeaderFold.test.svelte';
// The `client` project ships no CSS, and the squeeze is a layout outcome.
import '../../../routes/layout.css';

// At phone width a header with four actions squeezed its title to "Fo…" (#1910).

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const PHONE = { width: 390, height: 844 };

function titleFits() {
	const heading = page.getByRole('heading', { name: 'Folk Circle' }).element() as HTMLElement;
	const row = heading.closest('[data-page-header]')!.firstElementChild as HTMLElement;
	const column = [...row.children].find((child) => child.contains(heading))!;
	const text = heading.querySelector('span') ?? heading;
	return {
		// The column, not the h1: the h1 is only as wide as its text.
		share: column.getBoundingClientRect().width / row.getBoundingClientRect().width,
		clipped: text.scrollWidth > text.clientWidth
	};
}

afterEach(async () => {
	await page.viewport(1280, 800);
});

describe('PageHeader at phone width', () => {
	it('keeps the title readable when a header without a menu has four actions', async () => {
		await page.viewport(PHONE.width, PHONE.height);
		await render(Harness, { shape: 'inline' });
		await expect.element(page.getByRole('heading', { name: 'Folk Circle' })).toBeVisible();

		const { share, clipped } = titleFits();
		expect(share).toBeGreaterThanOrEqual(0.5);
		expect(clipped).toBe(false);
	});

	it('folds the secondary actions into the ••• menu, keeping primary and title', async () => {
		await page.viewport(PHONE.width, PHONE.height);
		await render(Harness, { shape: 'folded' });
		await expect.element(page.getByRole('heading', { name: 'Folk Circle' })).toBeVisible();

		const { share, clipped } = titleFits();
		expect(share).toBeGreaterThanOrEqual(0.5);
		expect(clipped).toBe(false);

		await expect.element(page.getByRole('button', { name: 'Edit project' })).toBeVisible();
		await expect.element(page.getByText('Budget')).not.toBeVisible();

		await page.getByLabelText('More actions').click();
		await expect.element(page.getByRole('link', { name: 'Budget' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Archive' })).toBeVisible();

		await page.getByRole('button', { name: 'Apply duty list' }).click();
		await expect.element(page.getByRole('dialog').getByText('Apply it?')).toBeVisible();
	});

	it('leaves the secondary actions inline above the phone breakpoint', async () => {
		await render(Harness, { shape: 'folded' });

		await expect.element(page.getByRole('link', { name: 'Budget' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Apply duty list' })).toBeVisible();
		await expect.element(page.getByText('Archive')).not.toBeVisible();
	});
});
