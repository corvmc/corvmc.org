import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

const remoteForm = (action: string) => ({
	enhance: () => ({ method: 'POST', action }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) =>
			target[key] ?? {
				as: (type: string, value?: unknown) => ({ type, name: key, value }),
				issues: () => null
			}
	}),
	result: undefined
});

const roster = vi.hoisted(() => ({
	active: [] as { userId: string; role: string; member: { title: string } }[]
}));

vi.mock('#lib/remote/bands.remote.js', () => ({
	transferOwner: remoteForm('?/transferOwner'),
	getBandMembersPage: vi.fn(async () => ({ members: { active: roster.active, pending: [] } }))
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const TransferOwnershipModal = (await import('./TransferOwnershipModal.svelte')).default;
const TransferOwnershipSection = (await import('./TransferOwnershipSection.svelte')).default;

const owner = { userId: 'user-o', role: 'owner', member: { title: 'Lou Reed' } };

const candidates = [
	{ userId: 'user-a', name: 'Moe Tucker' },
	{ userId: 'user-b', name: 'Sterling Morrison' }
];

/**
 * Transferring a band hands it to a person, so the owner names that person.
 * Nothing is chosen for them (#3087).
 */
describe('TransferOwnershipModal', () => {
	it('asks who the new owner is', async () => {
		await render(TransferOwnershipModal, {
			open: true,
			bandId: 'band-1',
			bandName: 'The Velvet Underground',
			candidates,
			onsuccess: () => {}
		});

		const select = page.getByRole('dialog').getByRole('combobox');
		await expect.element(select).toBeVisible();
		await expect.element(select).toHaveValue('');
		// Every candidate is offered, and none is chosen for the owner.
		const values = [...select.element().querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['', 'user-a', 'user-b']);
	});
});

/** The owner's way out lives in Settings (#3226), offered only with someone to hand to. */
describe('TransferOwnershipSection', () => {
	const props = { bandId: 'band-1', bandName: 'The Velvet Underground' };

	it('offers the transfer when another member can take the band', async () => {
		roster.active = [owner, { userId: 'user-a', role: 'member', member: { title: 'Moe Tucker' } }];
		await render(TransferOwnershipSection, props);

		await expect.element(page.getByTestId('transfer-ownership')).toBeVisible();
	});

	it('withholds it when the owner is the only member', async () => {
		roster.active = [owner];
		const screen = await render(TransferOwnershipSection, props);

		await expect.element(screen.getByRole('heading', { level: 2 })).toBeVisible();
		await expect.element(page.getByTestId('transfer-ownership')).not.toBeInTheDocument();
	});
});

/** The owner's way out lives in Settings (#3226), offered only with someone to hand to. */
describe('TransferOwnershipSection', () => {
	const props = { bandId: 'band-1', bandName: 'The Velvet Underground' };

	it('offers the transfer when another member can take the band', async () => {
		roster.active = [owner, { userId: 'user-a', role: 'member', member: { title: 'Moe Tucker' } }];
		await render(TransferOwnershipSection, props);

		await expect.element(page.getByTestId('transfer-ownership')).toBeVisible();
	});

	it('withholds it when the owner is the only member', async () => {
		roster.active = [owner];
		const screen = await render(TransferOwnershipSection, props);

		await expect.element(screen.getByRole('heading', { level: 2 })).toBeVisible();
		await expect.element(page.getByTestId('transfer-ownership')).not.toBeInTheDocument();
	});
});
