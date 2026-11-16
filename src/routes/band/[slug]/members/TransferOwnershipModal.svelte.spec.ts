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

vi.mock('#lib/remote/bands.remote.js', () => ({
	transferOwner: remoteForm('?/transferOwner')
}));

const TransferOwnershipModal = (await import('./TransferOwnershipModal.svelte')).default;

const candidates = [
	{ userId: 'user-a', name: 'Moe Tucker' },
	{ userId: 'user-b', name: 'Sterling Morrison' }
];

/**
 * Transferring a band hands it to a person, so the owner names that person.
 * The membership panel opened this with the first member already chosen (#3087).
 */
describe('TransferOwnershipModal', () => {
	it('asks who the new owner is when no member was chosen', async () => {
		await render(TransferOwnershipModal, {
			open: true,
			bandId: 'band-1',
			bandName: 'The Velvet Underground',
			candidates,
			selectedId: null,
			onsuccess: () => {}
		});

		const select = page.getByRole('dialog').getByRole('combobox');
		await expect.element(select).toBeVisible();
		await expect.element(select).toHaveValue('');
		// Every candidate is offered, and none is chosen for the owner.
		const values = [...select.element().querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['', 'user-a', 'user-b']);
	});

	it('keeps the member whose row was clicked', async () => {
		await render(TransferOwnershipModal, {
			open: true,
			bandId: 'band-1',
			bandName: 'The Velvet Underground',
			candidates,
			selectedId: 'user-b',
			onsuccess: () => {}
		});

		await expect.element(page.getByRole('dialog').getByRole('combobox')).toHaveValue('user-b');
	});
});
