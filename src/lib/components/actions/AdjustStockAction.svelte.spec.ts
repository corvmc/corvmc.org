import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The one action that does arithmetic on the operator's behalf. A stocktake
 * produces a *total* off a shelf; the ledger stores a *difference*. Getting the
 * subtraction or its sign wrong writes a correction in the wrong direction and
 * doubles the discrepancy it was meant to close — and nothing on screen would
 * say so, because the box the operator typed in is not the field that submits.
 */

vi.mock('$lib/remote/inventory.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		correctStock: {
			enhance: () => ({ method: 'POST', action: '?/correctStock' }),
			fields: {
				itemId: field('itemId'),
				delta: field('delta'),
				notes: field('notes'),
				allIssues: () => null
			},
			result: undefined
		}
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

const AdjustStockAction = (await import('./AdjustStockAction.svelte')).default;

const delta = () => document.querySelector('input[name="delta"]') as HTMLInputElement;

const open = async (props: Record<string, unknown> = {}) => {
	await render(AdjustStockAction, { itemId: 'item-1', onHand: 8, ...props });
	await page.getByRole('button', { name: 'Stocktake' }).click();
	return page.getByRole('dialog');
};

const count = async (value: string) => {
	await userEvent.fill(page.getByLabelText('Counted on the shelf'), value);
};

describe('AdjustStockAction', () => {
	// Without this the correction has no subject and the handler adjusts nothing.
	it('carries the item id into the form', async () => {
		await open();

		const hidden = document.querySelector('input[name="itemId"]') as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('item-1');
	});

	// A box pre-filled with the number being checked invites confirming the
	// system rather than the shelf, which is the one thing a stocktake is for.
	it('opens with an empty box and nothing to submit', async () => {
		// Read once the dialog is up rather than through a retrying matcher: a
		// pre-filled box is there from the first frame, so retrying only makes the
		// failure slow — it does not make it more likely to be seen.
		await expect.element(await open()).toBeVisible();

		const counted = document.querySelector('input[name="counted"]') as HTMLInputElement;
		expect(counted.value).toBe('');
		expect(delta().value).toBe('');
	});

	it('submits the surplus, not the count, when the shelf holds more', async () => {
		await open();

		await count('12');

		await vi.waitFor(() => expect(delta().value).toBe('4'));
		await expect.element(page.getByText('Adding 4', { exact: false })).toBeVisible();
	});

	// The half that is easy to get wrong by hand, and the half that doubles the
	// error when it is: a shortfall has to submit a negative number.
	it('submits a negative delta when the shelf holds fewer', async () => {
		await open();

		await count('3');

		await vi.waitFor(() => expect(delta().value).toBe('-5'));
		await expect.element(page.getByText('Removing 5', { exact: false })).toBeVisible();
	});

	it('submits zero, and says so, when the count matches', async () => {
		await open();

		await count('8');

		await vi.waitFor(() => expect(delta().value).toBe('0'));
		await expect.element(page.getByText('Matches the record', { exact: false })).toBeVisible();
	});

	// Half a cable is a typo, not a count. Truncating keeps the ledger integral
	// rather than rejecting the entry and losing what was counted.
	it('truncates a fractional count', async () => {
		await open();

		await count('12.7');

		await vi.waitFor(() => expect(delta().value).toBe('4'));
	});

	// `counted` is deliberately named but is not a field of the remote: Zod
	// strips it. The count and the thing submitted are two different inputs, and
	// only one of them reaches the ledger.
	it('keeps the counted box out of what the handler reads', async () => {
		await open();

		await count('12');

		const counted = document.querySelector('input[name="counted"]') as HTMLInputElement;
		expect(counted.type).toBe('number');
		await vi.waitFor(() => expect(delta().value).not.toBe(counted.value));
	});
});
