import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatusBadge from './StatusBadge.svelte';

/**
 * The icon-only form is the one used in every staff table's status column and,
 * now, on the entity cards and chips. `data-tip` is a CSS-only tooltip — it
 * draws through `::before` and is invisible to assistive tech — so without an
 * explicit name these render as an unlabelled graphic and the status is simply
 * unavailable to anyone not looking at it.
 */
describe('StatusBadge accessibility', () => {
	it('names the icon-only form', async () => {
		render(StatusBadge, { status: 'no_show' });
		const el = document.querySelector('[role="img"]');
		expect(el?.getAttribute('aria-label')).toBe('No show');
	});

	it('uses the humanised label, not the raw enum value', async () => {
		render(StatusBadge, { status: 'pending_review' });
		// `labels` overrides this one: "Pending review" reads as a state,
		// "Pending_review" reads as a database column.
		expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('In review');
	});

	it('does not double up the name when the label is already visible', async () => {
		render(StatusBadge, { status: 'no_show', label: true });
		expect(document.querySelector('[role="img"]')).toBeNull();
		expect(document.body.textContent).toContain('No show');
	});

	it('still names a status it has no mapping for', async () => {
		render(StatusBadge, { status: 'brand_new_thing' });
		expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
			'Brand new thing'
		);
	});
});
