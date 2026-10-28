import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatusBadge, { labels } from './StatusBadge.svelte';
import StatusBadgeHarness from './StatusBadge.test.svelte';
import '../../../routes/layout.css';

/**
 * The icon-only form is the one used in every staff table's status column and,
 * now, on the entity cards and chips. `data-tip` is a CSS-only tooltip — it
 * draws through `::before` and is invisible to assistive tech — so without an
 * explicit name these render as an unlabelled graphic and the status is simply
 * unavailable to anyone not looking at it.
 */
describe('StatusBadge accessibility', () => {
	it('names the icon-only form', async () => {
		await render(StatusBadge, { status: 'no_show' });
		const el = document.querySelector('[role="img"]');
		expect(el?.getAttribute('aria-label')).toBe('No show');
	});

	it('uses the humanised label, not the raw enum value', async () => {
		await render(StatusBadge, { status: 'pending_review' });
		// The `labels` override wins over the humanised enum value. Asserting
		// against the map rather than its current wording keeps a relabel in
		// config.ts from reddening this file.
		const name = document.querySelector('[role="img"]')?.getAttribute('aria-label');
		expect(name).toBe(labels.pending_review);
		expect(name).not.toBe('Pending review');
	});

	it('does not double up the name when the label is already visible', async () => {
		await render(StatusBadge, { status: 'no_show', label: true });
		expect(document.querySelector('[role="img"]')).toBeNull();
		expect(document.body.textContent).toContain('No show');
	});

	it('still names a status it has no mapping for', async () => {
		await render(StatusBadge, { status: 'brand_new_thing' });
		expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
			'Brand new thing'
		);
	});
});

/**
 * `responsive` keeps the word at desk widths and drops to the glyph below the
 * col-extra tier (48rem container), where the reservations table runs out of
 * room (#1834). The word was added there for keyboard users (#896), so the
 * glyph has to keep a name and show its tooltip when the row holds focus.
 */
describe('StatusBadge responsive', () => {
	const tooltipOpacity = () => {
		const tip = page.getByRole('img', { name: 'No show' }).element();
		return getComputedStyle(tip, '::before').opacity;
	};

	it('shows the labelled badge at 48rem and up', async () => {
		await render(StatusBadgeHarness, { width: 800 });
		await expect.element(page.getByText('No show')).toBeVisible();
		expect(page.getByRole('img', { name: 'No show' }).elements()).toHaveLength(0);
	});

	it('goes icon-only below 48rem and keeps an accessible name', async () => {
		await render(StatusBadgeHarness, { width: 700 });
		await expect.element(page.getByRole('img', { name: 'No show' })).toBeVisible();
		await expect.element(page.getByText('No show', { exact: true })).not.toBeVisible();
	});

	it('opens the tooltip when the row holds keyboard focus', async () => {
		await render(StatusBadgeHarness, { width: 700 });
		expect(tooltipOpacity()).toBe('0');
		// `userEvent.tab()` never reaches the frame's link here; a script focus
		// with no pointer input before it matches `:focus-visible` the same way.
		(page.getByRole('link').element() as HTMLElement).focus();
		await expect.poll(tooltipOpacity).toBe('1');
	});

	it('leaves the plain labelled badge alone without the prop', async () => {
		await render(StatusBadgeHarness, { width: 700, responsive: false });
		await expect.element(page.getByText('No show')).toBeVisible();
		expect(page.getByRole('img', { name: 'No show' }).elements()).toHaveLength(0);
	});
});
