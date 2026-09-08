import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The handler turns `BandMemberExistsError` into an issue on `email` — the one
 * outcome a staff member is likely to hit, and the one a bare input rendered as
 * `aria-invalid` and nothing else.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/bands.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		inviteByEmailApi: {
			enhance: () => ({ method: 'POST', action: '?/inviteByEmailApi' }),
			fields: {
				bandId: field('bandId'),
				email: field('email'),
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

const InviteByEmailAction = (await import('./InviteByEmailAction.svelte')).default;

const open = async () => {
	await render(InviteByEmailAction, { bandId: 'band-5' });
	await page.getByRole('button', { name: 'Invite by Email' }).click();
	return page.getByRole('dialog');
};

describe('InviteByEmailAction', () => {
	it('carries the band id into the form', async () => {
		await open();

		const bandId = document.querySelector(
			'[role="dialog"] input[name="bandId"]'
		) as unknown as HTMLInputElement;
		expect(bandId.value).toBe('band-5');
	});

	// The branch-order trap `AdjustCreditsAction` documents: `<option>` children
	// passed to a `type="select"` field render as loose text with no control
	// around them, so the role posts nothing and raises no error either.
	it('offers both roles inside a real select that posts one', async () => {
		await open();

		const roles = document.querySelector(
			'[role="dialog"] select[name="role"]'
		) as unknown as HTMLSelectElement;
		expect(Array.from(roles.options, (o) => o.value)).toEqual(['member', 'admin']);
		expect(roles.value).toBe('member');
	});

	it('renders the "already a member" rejection as a message', async () => {
		issues.email = [{ path: ['email'], message: 'That person is already in this band.' }];
		try {
			await open();

			await expect.element(page.getByText('That person is already in this band.')).toBeVisible();
		} finally {
			issues.email = null;
		}
	});

	// `exact` because the dialog itself is labelled "Invite by Email", and a
	// substring match resolves to both.
	it('associates every caption with the control it names', async () => {
		await open();

		await expect.element(page.getByLabelText('Email', { exact: true })).toBeVisible();
		await expect.element(page.getByLabelText('Role', { exact: true })).toBeVisible();
		await expect.element(page.getByLabelText('Position (optional)')).toBeVisible();
	});
});
