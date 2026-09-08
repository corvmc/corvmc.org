import { page } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * This equipment picker has been silently empty twice: first it fetched a route
 * that does not exist, then `FormField` rendered its `<option>` children
 * *instead of* the `<select>`, leaving bare text that submitted nothing. Both
 * look identical from outside — a staff loan against no item. So the shape is
 * what is pinned, not either fix: a real `<select>` with a real `<option>` per
 * item.
 */

vi.mock('$lib/remote/inventory.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		createLoan: {
			enhance: () => ({ method: 'POST', action: '?/createLoan' }),
			fields: {
				userId: field('userId'),
				itemId: field('itemId'),
				quantity: field('quantity'),
				requestedPickupDate: field('requestedPickupDate'),
				estimatedReturnDate: field('estimatedReturnDate'),
				memberNotes: field('memberNotes'),
				allIssues: () => null
			},
			result: undefined
		},
		getAvailableItems: vi.fn(async () => [
			{ id: 'item-1', name: 'Fender Blues Deluxe' },
			{ id: 'item-2', name: 'Shure SM58' }
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

const CreateLoanAction = (await import('./CreateLoanAction.svelte')).default;

const equipment = () =>
	document.querySelector('[role="dialog"] select[name="itemId"]') as unknown as HTMLSelectElement;

const open = async () => {
	await render(CreateLoanAction, {});
	await page.getByRole('button', { name: 'New Loan' }).click();
	// The whole form sits behind `await getAvailableItems()`, so wait for a field
	// that is *not* under test — waiting on the equipment select instead would
	// make every test in the file fail slowly for the same reason.
	await expect.element(page.getByLabelText('Quantity')).toBeVisible();
	return page.getByRole('dialog');
};

describe('CreateLoanAction', () => {
	beforeEach(() => {
		// MemberPicker searches over HTTP rather than through a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('[]'))
		);
	});

	it('offers the available equipment inside a real select', async () => {
		await open();

		expect(equipment()).not.toBeNull();
		expect(Array.from(equipment().options, (o) => o.value)).toEqual(['', 'item-1', 'item-2']);
		expect(Array.from(equipment().options, (o) => o.textContent?.trim())).toEqual([
			'-- Select equipment --',
			'Fender Blues Deluxe',
			'Shure SM58'
		]);
	});

	// The exact failure shape of the branch-order bug: `<option>`s rendered as
	// loose text, which reads as a blank field rather than as an error.
	it('leaves no option stranded outside a control', async () => {
		await open();

		const stranded = Array.from(document.querySelectorAll('[role="dialog"] option')).filter(
			(option) => !option.closest('select')
		);
		expect(stranded).toEqual([]);
	});

	// An empty first option that is *selected* reads as a prompt. Without a value
	// of its own the closed select would show the first real item, which is an
	// answer nobody gave.
	it('starts on the prompt rather than on the first item', async () => {
		await open();

		expect(equipment().value).toBe('');
	});

	it('defaults the quantity to one', async () => {
		await open();

		const quantity = document.querySelector(
			'[role="dialog"] input[name="quantity"]'
		) as HTMLInputElement;
		expect(quantity.type).toBe('number');
		expect(quantity.value).toBe('1');
	});

	// Staff raise loans on someone else's behalf, so the borrower is a choice.
	// Nothing posts a borrower until one is picked.
	it('posts no borrower before one is chosen', async () => {
		await open();

		const hidden = document.querySelector(
			'[role="dialog"] input[name="userId"]'
		) as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('');
	});
});
