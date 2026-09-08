import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * These two fields are named rather than field-bound — `canSubmit` and the
 * post-success reset both read their values, and a field spread has no two-way
 * binding. That routes their issues through the form context instead of
 * `field.issues()`, so it is worth pinning that a server issue still renders.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/marketing.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		addSubscriber: {
			enhance: () => ({ method: 'POST', action: '?/addSubscriber' }),
			fields: {
				audienceId: field('audienceId'),
				email: field('email'),
				name: field('name'),
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

const AddSubscriberAction = (await import('./AddSubscriberAction.svelte')).default;

const open = async () => {
	await render(AddSubscriberAction, { audienceId: 'aud-3' });
	await page.getByRole('button', { name: 'Add Subscriber' }).click();
	return page.getByRole('dialog');
};

describe('AddSubscriberAction', () => {
	it('carries the audience id into the form', async () => {
		await open();

		const audienceId = document.querySelector(
			'[role="dialog"] input[name="audienceId"]'
		) as unknown as HTMLInputElement;
		expect(audienceId.value).toBe('aud-3');
	});

	it('renders a server issue on the email as a message', async () => {
		issues.email = [{ path: ['email'], message: 'That address is already subscribed.' }];
		try {
			await open();

			await expect.element(page.getByText('That address is already subscribed.')).toBeVisible();
		} finally {
			issues.email = null;
		}
	});

	// `canSubmit` reads `email`, so the binding has to survive the wrapper — if it
	// does not, the submit button never enables and nobody can be added.
	it('enables the submit once an address is typed', async () => {
		await open();

		const submit = page.getByRole('button', { name: 'Add Subscriber', exact: true }).last();
		await expect.element(submit).toBeDisabled();

		await userEvent.fill(page.getByLabelText('Email', { exact: true }), 'nina@example.dev');

		await expect.element(submit).toBeEnabled();
	});
});
