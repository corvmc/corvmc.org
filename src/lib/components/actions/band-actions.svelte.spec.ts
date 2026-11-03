import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '$lib/test/locators';

// One file for the staff band actions: they mock the same two modules, and each
// export below is the stub its own component's spec used before the merge.
// Issues are per-field and settable per test.
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/bands.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	const form = (action: string, names: string[]) => ({
		enhance: () => ({ method: 'POST', action: `?/${action}` }),
		fields: {
			...Object.fromEntries(names.map((name) => [name, field(name)])),
			allIssues: () => null
		},
		result: undefined
	});
	return {
		createBandApi: form('createBandApi', ['ownerId', 'name', 'bio']),
		inviteByEmailApi: form('inviteByEmailApi', ['bandId', 'email', 'role', 'position']),
		addBandMember: form('addBandMember', ['bandId', 'userId', 'role', 'position'])
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

const CreateBandAction = (await import('./CreateBandAction.svelte')).default;
const InviteByEmailAction = (await import('./InviteByEmailAction.svelte')).default;
const InviteMemberAction = (await import('./InviteMemberAction.svelte')).default;

const submit = () =>
	document.querySelector('[role="dialog"] button[type="submit"]') as HTMLButtonElement;

describe('CreateBandAction', () => {
	const OWNERS = [
		{ id: 'user-7', name: 'Jane Doe', email: 'jane@example.dev' },
		{ id: 'user-8', name: 'Janet Ruiz', email: 'janet@example.dev' }
	];

	// `userEvent.type`, not `fill`: bits-ui's Combobox opens on real key events, so
	// a programmatic value set leaves it closed with its results unrendered. The
	// input is then swapped for a badge, which is how we know the pick committed.
	const pick = async (name: string) => {
		const picker = page.getByRole('combobox');
		await picker.click();
		await userEvent.type(picker, name.slice(0, 3));
		await page.getByRole('option', { name: new RegExp(name) }).click();
		await vi.waitFor(() => expect(document.querySelector('[role="combobox"]')).toBeNull());
	};

	// The chip's clear button is named after the person picked.
	const clearPick = (name: string) => page.getByRole('button', { name: new RegExp(name) });

	const open = async () => {
		// The trigger is the container's only button; the dialog portals out of it.
		const { locator } = await render(CreateBandAction, {});
		await locator.getByRole('button').click();
		return page.getByRole('dialog');
	};

	beforeEach(() => {
		// The owner picker searches over the network, not a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(OWNERS)))
		);
	});

	// Staff create bands on someone else's behalf, so the owner is a choice
	// rather than the acting user. Nothing posts an ownerId until one is picked.
	it('posts no owner before one is chosen', async () => {
		await open();

		expect(document.querySelector('input[name="ownerId"]')).toBeNull();
		await expect.element(page.getByRole('combobox')).toBeVisible();
	});

	it('posts the chosen owner', async () => {
		await open();

		await pick('Janet Ruiz');

		const hidden = document.querySelector('input[name="ownerId"]') as HTMLInputElement;
		expect(hidden).not.toBeNull();
		expect(hidden.value).toBe('user-8');
	});

	// The chip's clear button is the only way back, and it is named because a
	// bare ✕ is indistinguishable from the modal's own close button.
	it('lets the choice be taken back', async () => {
		await open();
		await pick('Janet Ruiz');

		await clearPick('Janet Ruiz').click();

		await vi.waitFor(() => {
			expect(document.querySelector('input[name="ownerId"]')).toBeNull();
		});
	});

	// `canSubmit={!!selectedOwner}` only became a real gate in #769; until then it
	// fell into `...rest` and a band could be created with no owner at all.
	it('will not create a band before an owner is chosen', async () => {
		await open();

		await vi.waitFor(() => expect(submit().disabled).toBe(true));
	});

	it('creates one once an owner is chosen, and stops again if that is undone', async () => {
		await open();

		await pick('Janet Ruiz');
		await vi.waitFor(() => expect(submit().disabled).toBe(false));

		await clearPick('Janet Ruiz').click();
		await vi.waitFor(() => expect(submit().disabled).toBe(true));
	});
});

/**
 * The handler turns `BandMemberExistsError` into an issue on `email` — the one
 * outcome a staff member is likely to hit, and the one a bare input rendered as
 * `aria-invalid` and nothing else.
 */
describe('InviteByEmailAction', () => {
	it('renders the "already a member" rejection as a message', async () => {
		const message = 'That person is already in this band.';
		issues.email = [{ path: ['email'], message }];
		try {
			const { locator } = await render(InviteByEmailAction, { bandId: 'band-5' });
			await locator.getByRole('button').click();

			await expect.element(page.getByRole('dialog').getByText(message)).toBeVisible();
		} finally {
			issues.email = null;
		}
	});
});

/**
 * A search box whose value is never submitted, beside a hidden input that is.
 * The person picked has to reach `userId`, and nothing on screen shows that it
 * did — the chip is the component's own state, not the field. So the box
 * carries `userId`'s caption and issues without carrying its value.
 */
describe('InviteMemberAction', () => {
	const MEMBERS = [
		{ id: 'user-3', name: 'Janet Ruiz', email: 'janet@example.dev' },
		{ id: 'user-4', name: 'Jamal Okafor', email: 'jamal@example.dev' }
	];

	const hidden = (name: string) =>
		document.querySelector(
			`[role="dialog"] input[name="${name}"][type="hidden"]`
		) as unknown as HTMLInputElement;

	const open = async () => {
		const { locator } = await render(InviteMemberAction, { bandId: 'band-2' });
		await locator.getByRole('button').click();
		await expect.element(page.getByPlaceholder('Name or email...')).toBeVisible();
		return page.getByRole('dialog');
	};

	// The results list appears only while the query is at least two characters and
	// a fetch has come back, so a programmatic value set leaves it empty.
	const pick = async (name: string) => {
		await userEvent.type(page.getByPlaceholder('Name or email...'), name.slice(0, 3));
		await page.getByRole('button', { name: new RegExp(name) }).click();
	};

	beforeEach(() => {
		// The picker searches a band-scoped API route, not a remote function.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(MEMBERS)))
		);
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

	// "Change" is the only way back, and it has to clear the field, not just the chip.
	it('lets the choice be taken back', async () => {
		await open();
		await pick('Jamal Okafor');
		await vi.waitFor(() => expect(hidden('userId').value).toBe('user-4'));

		// The picked member's row carries the dialog's only plain button besides ✕.
		await page
			.getByRole('dialog')
			.getByCss('button[type="button"]:not([data-dialog-close])')
			.click();

		await vi.waitFor(() => expect(hidden('userId').value).toBe(''));
		await expect.element(page.getByPlaceholder('Name or email...')).toBeVisible();
	});

	// An issue on `userId` has no input of its own to sit beside — it belongs to
	// the picker. Before the wrapper it rendered nowhere at all, and a rejected
	// invite looked like a submit that did nothing.
	it('renders a server issue on the member as a message beside the picker', async () => {
		const message = 'Choose a member to invite.';
		issues.userId = [{ path: ['userId'], message }];
		try {
			const dialog = await open();

			await expect.element(dialog.getByText(message)).toBeVisible();
		} finally {
			issues.userId = null;
		}
	});
});
