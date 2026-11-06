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
	refreshAll: vi.fn(),
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
	const { locator } = await render(ActivateToggleAction, {
		entityId: 'thing-1',
		deactivateAction: remoteForm('deactivate'),
		reactivateAction: remoteForm('reactivate'),
		...props
	});
	// The trigger is the container's only button; the dialog portals out of it.
	await locator.getByRole('button').click();
	return page.getByRole('dialog');
};

// Fixture props, not the component's own copy.
const ENTITY = 'category';
const WARNING = 'Members lose access to every booking on it.';

describe('ActivateToggleAction', () => {
	it('offers to deactivate a live record, and posts to the deactivate handler', async () => {
		await expect.element(await open({ isDeactivated: false })).toBeVisible();

		expect(submitsTo()).toBe('?/deactivate');
	});

	it('offers to reactivate a dead one, and posts to the reactivate handler', async () => {
		await expect.element(await open({ isDeactivated: true })).toBeVisible();

		expect(submitsTo()).toBe('?/reactivate');
	});

	it('names the kind of thing in the question it asks', async () => {
		const dialog = await open({ isDeactivated: false, entityLabel: ENTITY });

		await expect.element(dialog).toMatchTextContent(ENTITY);
	});

	/**
	 * A caller supplies `deactivateWarning` to spell out what deactivating
	 * costs. Reactivating costs none of that, so the warning must not follow the
	 * button across — an undo that warns about the thing it is undoing reads as
	 * a second, worse confirmation.
	 */
	it('warns on the way out', async () => {
		const dialog = await open({ isDeactivated: false, deactivateWarning: WARNING });

		await expect.element(dialog.getByText(WARNING)).toBeVisible();
	});

	it('does not carry the deactivation warning into the reactivation', async () => {
		const dialog = await open({
			isDeactivated: true,
			entityLabel: ENTITY,
			deactivateWarning: WARNING
		});

		await expect.element(dialog).toMatchTextContent(ENTITY);
		expect(submitsTo()).toBe('?/reactivate');
		expect(document.body.textContent).not.toContain(WARNING);
	});
});
