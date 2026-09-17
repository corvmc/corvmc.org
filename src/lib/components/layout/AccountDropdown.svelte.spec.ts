import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The user arrives as a prop now (#569), so there is no remote module left to
// mock — only `$app/paths`, which resolves route paths against a live SvelteKit
// server at runtime, and `$app/state`, which the menu reads to latch the row
// you are on (#1244).
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/member/purchases') }
}));

const me = { id: 'user-1', name: 'Jane Doe', email: 'jane@example.dev', image: null };

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const AccountDropdown = (await import('./AccountDropdown.svelte')).default;

describe('AccountDropdown', () => {
	it('renders the signed-in user and opens the menu', async () => {
		await render(AccountDropdown, { me });

		const trigger = page.getByRole('button', { name: 'Account menu' });
		await expect.element(trigger).toBeVisible();

		// Menu is collapsed until the trigger is clicked.
		await trigger.click();

		await expect.element(page.getByText('Jane Doe')).toBeVisible();
		await expect.element(page.getByText('jane@example.dev')).toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Profile' })).toBeVisible();
	});

	// The four member-context destinations, which used to be three here and
	// three more in the member sidebar (#1244).
	it('offers every member-context destination', async () => {
		await render(AccountDropdown, { me });
		await page.getByRole('button', { name: 'Account menu' }).click();

		for (const label of ['Profile', 'Account', 'Purchases', 'Membership']) {
			await expect.element(page.getByRole('link', { name: label })).toBeVisible();
		}
	});

	// It had no active state while the sidebar carried one for the same rows.
	it('latches the row you are on', async () => {
		await render(AccountDropdown, { me });
		await page.getByRole('button', { name: 'Account menu' }).click();

		await expect
			.element(page.getByRole('link', { name: 'Purchases' }))
			.toHaveAttribute('aria-current', 'page');
		await expect
			.element(page.getByRole('link', { name: 'Profile' }))
			.not.toHaveAttribute('aria-current');
	});
});
