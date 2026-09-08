import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Two defaults here cannot live in the schema, and one set of fields appears
 * only when it can be acted on. An unchecked box is simply absent from
 * `FormData`, so a schema `.default()` for "members can borrow this" would win
 * over whatever the operator did and could not be turned off — it is set in the
 * form instead. Getting either default backwards is silent: the record saves.
 */

vi.mock('$lib/remote/inventory.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const names = [
		'name',
		'description',
		'categoryId',
		'kind',
		'unitOfMeasure',
		'gtin',
		'isLoanable',
		'reorderPoint',
		'reorderQuantity',
		'resourceId',
		'notes'
	];
	return {
		createItem: {
			enhance: () => ({ method: 'POST', action: '?/createItem' }),
			fields: {
				...Object.fromEntries(names.map((name) => [name, field(name)])),
				allIssues: () => null
			},
			result: undefined
		},
		getEquipmentCategories: vi.fn(async () => [
			{ id: 'cat-1', name: 'Amplifiers' },
			{ id: 'cat-2', name: 'Microphones' }
		])
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const AddItemAction = (await import('./AddItemAction.svelte')).default;

const named = (name: string) => document.querySelector(`[role="dialog"] [name="${name}"]`);

const open = async () => {
	await render(AddItemAction, {});
	await page.getByRole('button', { name: 'Add Item' }).first().click();
	await expect.element(page.getByLabelText('Tracked as')).toBeVisible();
	return page.getByRole('dialog');
};

describe('AddItemAction', () => {
	// A stocktake is overwhelmingly one record per physical thing, and `bulk` is
	// what opens the reorder fields — so the common case was the one being
	// corrected on every entry.
	it('opens on the common case, one record per thing', async () => {
		await open();

		expect((named('kind') as unknown as HTMLSelectElement).value).toBe('serialized');
	});

	// You do not restock a Blues Deluxe to a par level, so these appear only
	// where they can be acted on rather than sitting greyed out.
	it('asks nothing about reordering a serialized item', async () => {
		await open();

		expect(named('reorderPoint')).toBeNull();
		expect(named('reorderQuantity')).toBeNull();
	});

	it('asks about reordering once the item is a count', async () => {
		await open();

		await userEvent.selectOptions(page.getByLabelText('Tracked as'), ['Bulk — a count']);

		await expect.element(page.getByLabelText('Reorder at')).toBeVisible();
		await expect.element(page.getByLabelText('Reorder quantity')).toBeVisible();
	});

	// Most of what CMC owns is there to be borrowed; "consumable" is the
	// exception a person opts into, so the box starts checked.
	it('assumes a new item can be borrowed', async () => {
		await open();

		expect((named('isLoanable') as unknown as HTMLInputElement).checked).toBe(true);
	});

	// The category list is this component's own query rather than a prop, so an
	// empty select here is a silently uncategorised item.
	it('offers the categories it loaded, inside a real select', async () => {
		await open();

		const categories = named('categoryId') as unknown as HTMLSelectElement;
		expect(Array.from(categories.options, (o) => o.value)).toEqual(['cat-1', 'cat-2']);
	});

	it('defaults the unit to a single thing', async () => {
		await open();

		expect((named('unitOfMeasure') as unknown as HTMLSelectElement).value).toBe('each');
	});
});
