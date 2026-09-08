import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * One button standing in for two opposite operations, chosen by a boolean.
 * Label, colour, question and handler all flip with it, so a component that
 * reads the flag backwards offers a green "Reactivate" that deactivates, and
 * says nothing about it. The two remote forms arrive as props, so this needs
 * no module mock — the fakes below are the whole surface `Action` touches.
 */

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ActivateToggleAction = (await import('./ActivateToggleAction.svelte')).default;

const remoteForm = (name: string) =>
	({
		enhance: () => ({ method: 'POST', action: `?/${name}` }),
		fields: {
			id: {
				as: (type: string, value?: unknown) => ({ type, name: 'id', value }),
				issues: () => null
			},
			allIssues: () => null
		},
		result: undefined
	}) as never;

const submitsTo = () =>
	(document.querySelector('[role="dialog"] form') as HTMLFormElement).getAttribute('action');

const open = async (props: { isDeactivated: boolean } & Record<string, unknown>) => {
	await render(ActivateToggleAction, {
		entityId: 'thing-1',
		deactivateAction: remoteForm('deactivate'),
		reactivateAction: remoteForm('reactivate'),
		...props
	});
	const label = props.isDeactivated ? 'Reactivate' : 'Deactivate';
	await page.getByRole('button', { name: label }).first().click();
	return page.getByRole('dialog');
};

describe('ActivateToggleAction', () => {
	it('offers to deactivate a live record, and posts to the deactivate handler', async () => {
		await expect.element(await open({ isDeactivated: false })).toBeVisible();

		expect(submitsTo()).toBe('?/deactivate');
	});

	it('offers to reactivate a dead one, and posts to the reactivate handler', async () => {
		await expect.element(await open({ isDeactivated: true })).toBeVisible();

		expect(submitsTo()).toBe('?/reactivate');
	});

	// Colour is the only cue before the dialog opens, and it reads as the
	// direction of travel: red takes something away, green gives it back.
	it('colours the trigger by the direction of travel', async () => {
		await render(ActivateToggleAction, {
			entityId: 'thing-1',
			isDeactivated: false,
			deactivateAction: remoteForm('deactivate'),
			reactivateAction: remoteForm('reactivate')
		});

		await expect.element(page.getByRole('button', { name: 'Deactivate' })).toHaveClass(/btn-error/);
	});

	it('colours the reactivate trigger the other way', async () => {
		await render(ActivateToggleAction, {
			entityId: 'thing-1',
			isDeactivated: true,
			deactivateAction: remoteForm('deactivate'),
			reactivateAction: remoteForm('reactivate')
		});

		await expect
			.element(page.getByRole('button', { name: 'Reactivate' }))
			.toHaveClass(/btn-success/);
	});

	it('names the kind of thing in the question it asks', async () => {
		await open({ isDeactivated: false, entityLabel: 'category' });

		await expect.element(page.getByText('Deactivate this category?')).toBeVisible();
	});

	/**
	 * A caller supplies `deactivateWarning` to spell out what deactivating
	 * costs. Reactivating costs none of that, so the warning must not follow the
	 * button across — an undo that warns about the thing it is undoing reads as
	 * a second, worse confirmation.
	 */
	it('warns on the way out', async () => {
		await open({
			isDeactivated: false,
			deactivateWarning: 'Members lose access to every booking on it.'
		});

		await expect
			.element(page.getByText('Members lose access to every booking on it.'))
			.toBeVisible();
	});

	it('does not carry the deactivation warning into the reactivation', async () => {
		await expect
			.element(
				await open({
					isDeactivated: true,
					entityLabel: 'category',
					deactivateWarning: 'Members lose access to every booking on it.'
				})
			)
			.toBeVisible();

		await expect.element(page.getByText('Reactivate this category?')).toBeVisible();
		expect(document.body.textContent).not.toContain('Members lose access');
	});

	// Without this the toggle names no record and the handler flips nothing.
	it('carries the record id into the form', async () => {
		await open({ isDeactivated: false });

		const hidden = document.querySelector('[role="dialog"] input[name="id"]') as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('thing-1');
	});
});
