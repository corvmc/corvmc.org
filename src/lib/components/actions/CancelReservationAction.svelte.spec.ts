import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Minimal stand-in for a SvelteKit RemoteForm. `<Form>` needs `enhance()` and
 * the issue accessors; the action needs `fields.<name>.as()`. Prefix fidelity
 * (`b:`, `n:`) is not modelled — that is pinned against SvelteKit's own field
 * proxy in `ui/Form/FormField.svelte.spec.ts`, and nothing here depends on it.
 */
vi.mock('$lib/remote/reservations.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		cancelReservation: {
			enhance: () => ({ method: 'POST', action: '?/cancelReservation' }),
			fields: { id: field('id'), reason: field('reason'), allIssues: () => null },
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

const CancelReservationAction = (await import('./CancelReservationAction.svelte')).default;

// Two hours on a fixed instant. The summary formats in venue time, so only the
// duration — a difference between two instants — is safe to assert on.
const reservation = {
	id: 'res-1',
	startsAt: new Date('2026-03-14T19:00:00Z'),
	endsAt: new Date('2026-03-14T21:00:00Z'),
	status: 'confirmed',
	price: 30
} as never;

const open = async () => {
	await page.getByRole('button', { name: 'Cancel' }).click();
	return page.getByRole('dialog');
};

describe('CancelReservationAction', () => {
	it('shows nothing until the trigger is used', async () => {
		await render(CancelReservationAction, { reservation });

		await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	// The trigger is destructive and the modal is the only confirmation step, so
	// it has to name the reservation rather than ask about "this reservation" in
	// the abstract — the staff table shows several at once.
	it('names what is about to be cancelled', async () => {
		await render(CancelReservationAction, { reservation });

		await expect.element(await open()).toBeVisible();
		await expect.element(page.getByText('2 hours', { exact: false })).toBeVisible();
	});

	// Without this the form posts no id at all and the handler cancels nothing —
	// a failure that looks like a successful submit from the outside.
	it('carries the reservation id into the form', async () => {
		await render(CancelReservationAction, { reservation });
		await open();

		const hidden = document.querySelector('input[name="id"]') as HTMLInputElement;
		expect(hidden).not.toBeNull();
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('res-1');
	});

	it('offers no reason box by default', async () => {
		await render(CancelReservationAction, { reservation });
		await open();

		expect(document.querySelector('input[name="reason"]')).toBeNull();
	});

	it('offers a reason box when asked for one', async () => {
		await render(CancelReservationAction, { reservation, showReasonInput: true });
		await open();

		await expect
			.element(page.getByPlaceholder('Reason (optional)'))
			.toHaveAttribute('name', 'reason');
	});
});
