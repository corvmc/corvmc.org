import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The user arrives as a prop now (#569), so there is no remote module left to
// mock — only `$app/paths`, which resolves route paths against a live SvelteKit
// server at runtime.
vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
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
});
