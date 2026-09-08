import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Issues are per-field and settable per test: the point of wrapping these
 * inputs in `FormField` was that a server issue renders a *message*, not just
 * `aria-invalid`, and the over-deduction message is the one that went missing.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/users.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		adjustCredits: {
			enhance: () => ({ method: 'POST', action: '?/adjustCredits' }),
			fields: {
				userId: field('userId'),
				creditType: field('creditType'),
				amount: field('amount'),
				description: field('description'),
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

const AdjustCreditsAction = (await import('./AdjustCreditsAction.svelte')).default;

const open = async (props: Record<string, unknown> = {}) => {
	await render(AdjustCreditsAction, { userId: 'user-1', ...props });
	await page.getByRole('button', { name: 'Adjust' }).click();
	return page.getByRole('dialog');
};

describe('AdjustCreditsAction', () => {
	it('shows nothing until the trigger is used', async () => {
		await render(AdjustCreditsAction, { userId: 'user-1' });

		await expect.element(page.getByRole('button', { name: 'Adjust' })).toBeVisible();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	// Without this the adjustment has no subject and the handler credits nobody.
	it('carries the user id into the form', async () => {
		await open();

		const hidden = document.querySelector('input[name="userId"]') as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('user-1');
	});

	// The same branch-order bug that left `type="select"` fields rendering their
	// options as loose text: no `<select>`, nothing submitted, no error either.
	it('offers both credit types inside a real select', async () => {
		await open();

		const options = document.querySelectorAll('select[name="creditType"] option');
		expect(Array.from(options, (o) => (o as HTMLOptionElement).value)).toEqual([
			'free_hours',
			'equipment_credits'
		]);
	});

	// `type="number"` is set *after* the field spread on purpose — a deduction is
	// entered as a negative number, and a text box gives no sign of that.
	it('takes the amount on a number input', async () => {
		await open();

		const amount = document.querySelector('input[name="amount"]') as HTMLInputElement;
		expect(amount.type).toBe('number');
		expect(amount.placeholder).toBe('Positive to add, negative to deduct');
	});

	// The regression the FormField wrapper was added for: with a bare input, a
	// server issue set `aria-invalid` and rendered no text at all, so an
	// over-deduction looked like a submit that simply did nothing.
	it('renders a server issue as a message beside the field', async () => {
		issues.amount = [{ path: ['amount'], message: 'That would take the balance below zero.' }];
		try {
			await open();

			await expect.element(page.getByText('That would take the balance below zero.')).toBeVisible();
		} finally {
			issues.amount = null;
		}
	});

	it('labels every field it submits', async () => {
		await open();

		for (const label of ['Credit Type', 'Amount', 'Reason']) {
			await expect.element(page.getByText(label, { exact: true })).toBeVisible();
		}
	});
});
