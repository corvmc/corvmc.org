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
	it('tells a comp-only staffer their ceiling under the amount (#579)', async () => {
		const dialog = await open({ amountHint: 'Up to 2 hrs of free hours. An admin can add more.' });
		await expect.element(dialog.getByText('Up to 2 hrs of free hours')).toBeVisible();
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
});

/**
 * `canSubmit` only became a real gate in #769 — before that it fell into
 * `...rest` and landed on the trigger as a stray attribute. `ui/Action.svelte`'s
 * own spec owns the plumbing; what is pinned here is this component's predicate,
 * `amount !== 0 && description.trim().length > 0`.
 */
describe('AdjustCreditsAction, what it will let staff submit', () => {
	const submit = () =>
		document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement;

	const amount = (v: string) =>
		page.getByPlaceholder('Positive to add, negative to deduct').fill(v);
	const reason = (v: string) => page.getByPlaceholder('Why is this adjustment being made?').fill(v);

	// The state the modal opens in. Committing it writes a ledger row saying
	// nothing happened, against a balance nobody changed.
	it('refuses an adjustment of zero', async () => {
		await open();

		await vi.waitFor(() => expect(submit().disabled).toBe(true));
	});

	// The reason is all a later reader has to go on, and whitespace is not one —
	// hence `.trim()` rather than a length check on the raw value.
	it('refuses an amount with a blank reason', async () => {
		await open();
		await amount('5');
		await reason('   ');

		await vi.waitFor(() => expect(submit().disabled).toBe(true));
	});

	it('allows an amount with a reason', async () => {
		await open();
		await amount('5');
		await reason('Comped a session');

		await vi.waitFor(() => expect(submit().disabled).toBe(false));
	});

	// The gate is `!== 0`, not `> 0`. A deduction is the case the placeholder
	// advertises, so a `> 0` predicate would block every one of them while
	// leaving the field that invites them in place.
	it('allows a deduction', async () => {
		await open();
		await amount('-3');
		await reason('Reversing a mistaken credit');

		await vi.waitFor(() => expect(submit().disabled).toBe(false));
	});
});
