import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// One file for the marketing actions: they mock the same two modules, and each
// export below is the stub its own component's spec used before the merge.
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
		},
		createAudience: {
			enhance: () => ({ method: 'POST', action: '?/createAudience' }),
			fields: { allIssues: () => null },
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
const CreateAudienceAction = (await import('./CreateAudienceAction.svelte')).default;

/**
 * These two fields are named rather than field-bound — `canSubmit` and the
 * post-success reset both read their values, and a field spread has no two-way
 * binding. That routes their issues through the form context instead of
 * `field.issues()`, so it is worth pinning that a server issue still renders.
 */
describe('AddSubscriberAction', () => {
	const open = async () => {
		await render(AddSubscriberAction, { audienceId: 'aud-3' });
		await page.getByRole('button', { name: 'Add Subscriber' }).click();
		return page.getByRole('dialog');
	};

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

		// By role: `required` puts an `aria-hidden` `*` inside the caption, so the
		// label reads "Email*" while the accessible name is "Email".
		await userEvent.fill(page.getByRole('textbox', { name: 'Email' }), 'nina@example.dev');

		await expect.element(submit).toBeEnabled();
	});
});

/**
 * The slug is the public signup URL, and it is derived here to mirror
 * `generateSlug` on the server — which *drops* spaces and punctuation rather
 * than hyphenating them. Two implementations of one rule: if this one drifts,
 * the box shows a URL that is not the URL the audience ends up with, and
 * nothing on either side complains.
 */
describe('CreateAudienceAction', () => {
	const slug = () =>
		document.querySelector('[role="dialog"] input[name="slug"]') as unknown as HTMLInputElement;

	const open = async () => {
		await render(CreateAudienceAction, {});
		await page.getByRole('button', { name: 'New Audience' }).click();
		await expect.element(page.getByLabelText('Name')).toBeVisible();
		return page.getByRole('dialog');
	};

	it('starts with no slug to show', async () => {
		await open();

		expect(slug().value).toBe('');
	});

	// Not `monthly-newsletter`: the server's own `generateSlug` strips anything
	// outside `[a-z0-9-]` instead of turning it into a separator, and a mirror
	// that hyphenates would disagree with the URL the audience actually gets.
	it('derives the slug the way the server does, dropping rather than hyphenating', async () => {
		await open();

		await userEvent.fill(page.getByLabelText('Name'), 'Monthly Newsletter!');

		await vi.waitFor(() => expect(slug().value).toBe('monthlynewsletter'));
	});

	it('shows the signup URL the slug produces', async () => {
		await open();

		await userEvent.fill(page.getByLabelText('Name'), 'Volunteers');

		await expect.element(page.getByText('/subscribe/volunteers')).toBeVisible();
	});

	// A derived slug is a starting point, not a rule. Once somebody has typed
	// their own, later edits to the name must leave it alone — otherwise the
	// URL they chose is overwritten by a typo correction upstream of it.
	it('stops deriving once the slug is edited by hand', async () => {
		await open();

		await userEvent.fill(page.getByLabelText('Name'), 'Volunteers');
		await vi.waitFor(() => expect(slug().value).toBe('volunteers'));

		await userEvent.fill(slug(), 'helpers');
		await userEvent.fill(page.getByLabelText('Name'), 'Volunteer Crew');

		await expect.element(page.getByText('/subscribe/helpers')).toBeVisible();
		expect(slug().value).toBe('helpers');
	});
});
