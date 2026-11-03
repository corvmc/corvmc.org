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
// The harness's row label: fixture data, not app copy.
const ROW = 'Payments';
const star = () => page.getByRole('button');

describe('Nav.Item star toggle', () => {
	it('is a pressed-state button described by its row', async () => {
		await render(Harness, {});

		await expect.element(star()).toHaveAttribute('aria-pressed', 'false');
		await expect.element(star()).toHaveAccessibleDescription(ROW);
		// The row label is the description only, never part of the name.
		expect(page.getByRole('button', { name: ROW }).elements()).toHaveLength(0);

		await star().click();
		await expect.element(star()).toHaveAttribute('aria-pressed', 'true');
		await star().click();
		await expect.element(star()).toHaveAttribute('aria-pressed', 'false');
	});

	it('is reached by keyboard straight after its link, and shows when focused', async () => {
		await render(Harness, {});

		const link = page.getByRole('link').element() as HTMLElement;
		const button = star().element() as HTMLElement;
		expect(getComputedStyle(button).opacity).toBe('0');

		link.focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(button);
		await expect.poll(() => getComputedStyle(button).opacity).toBe('1');
	});

	it('renders no button on a row that cannot be starred', async () => {
		await render(Harness, { starrable: false });

		await expect.element(page.getByRole('link')).toBeInTheDocument();
		expect(await page.getByRole('button').elements()).toHaveLength(0);
	});
});
