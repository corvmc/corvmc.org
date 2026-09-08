import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * A search box whose value is never submitted, beside a hidden input that is.
 * The person picked has to reach `userId`, and nothing on screen shows that it
 * did — the chip that appears is the component's own state, not the field. A
 * pick that fails to commit invites nobody and reports nothing.
 *
 * Which is also why the search box carries `userId`'s *caption and issues*
 * without carrying its value: an issue on a hidden field has nowhere to render,
 * and the box is the only thing on screen while `userId` is still empty.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/bands.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		addBandMember: {
			enhance: () => ({ method: 'POST', action: '?/addBandMember' }),
			fields: {
				bandId: field('bandId'),
				userId: field('userId'),
				role: field('role'),
				position: field('position'),
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

const InviteMemberAction = (await import('./InviteMemberAction.svelte')).default;

const MEMBERS = [
	{ id: 'user-3', name: 'Janet Ruiz', email: 'janet@example.dev' },
	{ id: 'user-4', name: 'Jamal Okafor', email: 'jamal@example.dev' }
];

const hidden = (name: string) =>
	document.querySelector(
		`[role="dialog"] input[name="${name}"][type="hidden"]`
	) as unknown as HTMLInputElement;

const open = async () => {
	await render(InviteMemberAction, { bandId: 'band-2' });
	await page.getByRole('button', { name: 'Add Member' }).click();
	await expect.element(page.getByPlaceholder('Name or email...')).toBeVisible();
	return page.getByRole('dialog');
};

// The results list appears only while the query is at least two characters and
// a fetch has come back, so a programmatic value set leaves it empty.
const pick = async (name: string) => {
	await userEvent.type(page.getByPlaceholder('Name or email...'), name.slice(0, 3));
	await page.getByRole('button', { name: new RegExp(name) }).click();
};

describe('InviteMemberAction', () => {
	beforeEach(() => {
		// The picker searches a band-scoped API route, not a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(MEMBERS)))
		);
	});

	// Without this the invitation names no band and the handler adds nobody.
	it('carries the band id into the form', async () => {
		await open();

		expect(hidden('bandId').type).toBe('hidden');
		expect(hidden('bandId').value).toBe('band-2');
	});

	it('posts no member before one is chosen', async () => {
		await open();

		expect(hidden('userId').value).toBe('');
	});

	it('posts the member that was picked', async () => {
		await open();

		await pick('Jamal Okafor');

		await vi.waitFor(() => expect(hidden('userId').value).toBe('user-4'));
	});

	// The search box must stay unnamed: give it `userId` and the query text
	// posts as the member id.
	it('submits nothing from the search box itself', async () => {
		await open();

		await userEvent.type(page.getByPlaceholder('Name or email...'), 'Jam');

		expect(page.getByPlaceholder('Name or email...').element().getAttribute('name')).toBeNull();
		expect(hidden('userId').value).toBe('');
	});

	// The search box is replaced by the chosen name, so "Change" is the only way
	// back — and it has to clear the field, not just the chip.
	it('lets the choice be taken back', async () => {
		await open();
		await pick('Jamal Okafor');
		await vi.waitFor(() => expect(hidden('userId').value).toBe('user-4'));

		await page.getByRole('button', { name: 'Change' }).click();

		await vi.waitFor(() => expect(hidden('userId').value).toBe(''));
		await expect.element(page.getByPlaceholder('Name or email...')).toBeVisible();
	});

	// The same branch-order trap `AdjustCreditsAction` documents: options
	// rendered outside a control submit nothing and raise no error.
	it('offers both roles inside a real select', async () => {
		await open();

		const roles = document.querySelector(
			'[role="dialog"] select[name="role"]'
		) as unknown as HTMLSelectElement;
		expect(Array.from(roles.options, (o) => o.value)).toEqual(['member', 'admin']);
	});

	// An issue on `userId` has no input of its own to sit beside — it belongs to
	// the picker. Before the wrapper it rendered nowhere at all, and a rejected
	// invite looked like a submit that did nothing.
	it('renders a server issue on the member as a message beside the picker', async () => {
		issues.userId = [{ path: ['userId'], message: 'Choose a member to invite.' }];
		try {
			await open();

			await expect.element(page.getByText('Choose a member to invite.')).toBeVisible();
		} finally {
			issues.userId = null;
		}
	});

	it('associates every caption with the control it names', async () => {
		await open();

		await expect.element(page.getByLabelText('Search members')).toBeVisible();
		await expect.element(page.getByLabelText('Role')).toBeVisible();
		await expect.element(page.getByLabelText('Position (optional)')).toBeVisible();
	});
});
