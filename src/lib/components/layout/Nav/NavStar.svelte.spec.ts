import { page, userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './NavStar.test.svelte';
import '../../../../routes/layout.css';

/**
 * The star is named "Star" alone, with the row label as its description:
 * Playwright matches button names by substring, so "Star Credits" would have
 * answered e2e's `getByRole('button', { name: 'Edit' })`.
 */
describe('Nav.Item star toggle', () => {
	it('is a pressed-state button described by its row', async () => {
		await render(Harness, {});

		const star = page.getByRole('button', { name: 'Star', exact: true });
		await expect.element(star).toHaveAttribute('aria-pressed', 'false');
		await expect.element(star).toHaveAccessibleDescription('Payments');

		await star.click();
		await expect.element(star).toHaveAttribute('aria-pressed', 'true');
		await star.click();
		await expect.element(star).toHaveAttribute('aria-pressed', 'false');
	});

	it('is reached by keyboard straight after its link, and shows when focused', async () => {
		await render(Harness, {});

		const link = page.getByRole('link', { name: 'Payments' }).element() as HTMLElement;
		const star = page.getByRole('button', { name: 'Star' }).element() as HTMLElement;
		expect(getComputedStyle(star).opacity).toBe('0');

		link.focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(star);
		await expect.poll(() => getComputedStyle(star).opacity).toBe('1');
	});

	it('renders no button on a row that cannot be starred', async () => {
		await render(Harness, { starrable: false });

		await expect.element(page.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
		expect(await page.getByRole('button').elements()).toHaveLength(0);
	});
});
