import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * A select decides which questions the IRS gets asked. Only a gift owes the
 * FASB ASU 2020-07 disclosure, so the gift fields are an allow-list — donation
 * or grant — not `kind !== 'purchase'`. That negation was right for three kinds
 * and wrong the moment `opening_balance` arrived, and a fifth kind is exactly
 * the change that reintroduces it.
 */

vi.mock('$lib/remote/inventory.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const names = [
		'itemId',
		'quantity',
		'kind',
		'occurredAt',
		'sourceName',
		'unitValueCents',
		'reference',
		'fairValueBasis',
		'intendedUse',
		'fairValueCents',
		'monetized',
		'paidByUserId',
		'locationId',
		'notes'
	];
	return {
		receiveStock: {
			enhance: () => ({ method: 'POST', action: '?/receiveStock' }),
			fields: {
				...Object.fromEntries(names.map((name) => [name, field(name)])),
				allIssues: () => null
			},
			result: undefined
		},
		getLocations: vi.fn(async () => [{ id: 'loc-1', name: 'Main room', parentId: null }])
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

const ReceiveStockAction = (await import('./ReceiveStockAction.svelte')).default;

const named = (name: string) => document.querySelector(`[role="dialog"] [name="${name}"]`);

const open = async () => {
	await render(ReceiveStockAction, { itemId: 'item-3' });
	await page.getByRole('button', { name: 'Receive' }).click();
	await expect.element(page.getByLabelText('How it arrived')).toBeVisible();
	return page.getByRole('dialog');
};

const arrivedAs = async (label: string) => {
	await userEvent.selectOptions(page.getByLabelText('How it arrived'), [label]);
};

describe('ReceiveStockAction', () => {
	// Without this the receipt has no item and the ledger takes on nothing.
	it('carries the item id into the form', async () => {
		await open();

		const hidden = named('itemId') as unknown as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('item-3');
	});

	it('opens as a purchase, which owes no disclosure', async () => {
		await open();

		expect((named('kind') as unknown as HTMLSelectElement).value).toBe('purchase');
		expect(named('fairValueBasis')).toBeNull();
		expect(named('monetized')).toBeNull();
	});

	for (const gift of ['Donation', 'Grant']) {
		it(`asks a ${gift.toLowerCase()} how its value was arrived at`, async () => {
			await open();

			await arrivedAs(gift);

			await expect.element(page.getByLabelText('How the value was determined')).toBeVisible();
			// ASU 2020-07 discloses sold and utilized gifts on separate lines, and
			// nothing could set this before — every gift on record reads as utilized.
			// Captioned by a `<legend>`, not a `<label for>`, because the checkbox
			// already carries an inline caption of its own.
			expect(named('monetized')).not.toBeNull();
		});
	}

	/**
	 * The kind the allow-list exists for. An opening balance is stock the
	 * collective already had; nobody gave it, so there is no donor, no fair
	 * value to justify and nothing to disclose.
	 */
	it('asks an opening balance none of it', async () => {
		await open();

		await arrivedAs('Already owned');

		await vi.waitFor(() => expect(named('fairValueBasis')).toBeNull());
		expect(named('intendedUse')).toBeNull();
		expect(named('monetized')).toBeNull();
		expect(named('sourceName')).toBeNull();
	});

	// A purchase has a supplier and a gift has a donor. The same field, and the
	// wrong caption on it puts a supplier's name in the donor column.
	it('renames the counterparty for what it is', async () => {
		await open();

		await expect.element(page.getByText('Supplier', { exact: true })).toBeVisible();

		await arrivedAs('Donation');

		await expect.element(page.getByText('Donor / grantor', { exact: true })).toBeVisible();
	});

	// Blank means the collective's own card, which is the common case — so a
	// reimbursement is only owed when somebody is actually named.
	it('posts nobody as having fronted the money until somebody is named', async () => {
		await open();

		const hidden = named('paidByUserId') as unknown as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('');
	});
});
