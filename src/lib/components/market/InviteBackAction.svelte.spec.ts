import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

vi.mock('#lib/remote/market.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	const form = {
		enhance: () => ({ method: 'POST', action: '?/inviteBack' }),
		fields: {
			vendorId: field('vendorId'),
			inviteBack: field('inviteBack'),
			note: field('note'),
			allIssues: () => null
		},
		result: undefined
	};
	return { inviteBackForm: { for: () => form } };
});

vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const InviteBackAction = (await import('./InviteBackAction.svelte')).default;

const vendor = (inviteBack: boolean | null) => ({
	id: 'v-1',
	businessName: 'Second Spin Records',
	inviteBack,
	inviteBackNote: null
});

async function open(inviteBack: boolean | null) {
	const { locator } = await render(InviteBackAction, { vendor: vendor(inviteBack) });
	await locator.getByRole('button').click();
	const dialog = page.getByRole('dialog');
	return {
		select: dialog.getByRole('combobox'),
		save: dialog.getByCss('button[type="submit"]')
	};
}

// #2827: the select started on "Invite back", so one press of Save recorded it
// for a vendor nobody had judged.
describe('InviteBackAction', () => {
	it('starts with nothing chosen and cannot be saved until a choice is made', async () => {
		const { select, save } = await open(null);

		await expect.element(select).toHaveValue('');
		await expect.element(save).toBeDisabled();

		await userEvent.selectOptions(select, 'no');
		await expect.element(save).toBeEnabled();
	});

	it.each([
		[true, 'yes'],
		[false, 'no']
	])('shows a recorded answer (%s) as recorded', async (recorded, value) => {
		const { select, save } = await open(recorded);

		await expect.element(select).toHaveValue(value);
		await expect.element(save).toBeEnabled();
	});
});
