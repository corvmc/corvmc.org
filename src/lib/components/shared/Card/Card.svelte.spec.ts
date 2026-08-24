import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CardHarness from './CardHarness.svelte';

/**
 * `card bg-base-100 shadow` and `card bg-base-100 shadow-sm` were both in
 * circulation — 26 places and 24 — despite ui-patterns.md having always said to
 * use `shadow`. These pin the settled answer so it cannot drift back.
 */
const card = () => document.querySelector('.card') as HTMLElement;
const body = () => document.querySelector('.card-body') as HTMLElement;

describe('Card', () => {
	it('is a base-100 surface with a shadow by default', async () => {
		render(CardHarness);

		await expect.element(page.getByText('$24.00')).toBeVisible();
		expect([...card().classList]).toEqual(
			expect.arrayContaining(['card', 'bg-base-100', 'shadow'])
		);
		expect(card().classList).not.toContain('shadow-sm');
	});

	it('swaps the shadow for a border when bordered', async () => {
		render(CardHarness, { bordered: true });

		await expect.element(page.getByText('$24.00')).toBeVisible();
		expect([...card().classList]).toEqual(expect.arrayContaining(['border', 'border-base-300']));
		expect(card().classList).not.toContain('shadow');
	});

	it('takes a tone', async () => {
		render(CardHarness, { tone: 'base-200' });

		await expect.element(page.getByText('$24.00')).toBeVisible();
		expect(card().classList).toContain('bg-base-200');
	});

	it('lays the body out as a row on request', async () => {
		render(CardHarness, { row: true });

		await expect.element(page.getByText('$24.00')).toBeVisible();
		expect([...body().classList]).toEqual(
			expect.arrayContaining(['flex-row', 'items-center', 'justify-between'])
		);
	});

	it('tightens padding without touching the rest of the body', async () => {
		render(CardHarness, { padding: 'sm' });

		await expect.element(page.getByText('$24.00')).toBeVisible();
		expect([...body().classList]).toEqual(expect.arrayContaining(['card-body', 'p-4']));
	});
});

describe('CardTitle', () => {
	it('is an h3 by default', async () => {
		render(CardHarness);

		await expect.element(page.getByRole('heading', { name: 'Payment', level: 3 })).toBeVisible();
	});

	/** `level` is the page outline, `size` is how loud it looks — never conflate them. */
	it('changes heading level without changing size', async () => {
		render(CardHarness, { level: 2, size: 'lg' });

		const heading = page.getByRole('heading', { name: 'Payment', level: 2 });
		await expect.element(heading).toBeVisible();
		expect((heading.element() as HTMLElement).classList).toContain('text-lg');
	});
});
