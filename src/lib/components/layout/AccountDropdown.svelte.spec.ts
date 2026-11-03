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

// The trigger is the container's first button; the menu's rows are found by href.
const anchor = (href: string) => document.querySelector<HTMLElement>(`a[href="${href}"]`);
async function link(href: string) {
	await vi.waitFor(() => expect(anchor(href)).not.toBeNull());
	return page.elementLocator(anchor(href)!);
}

describe('AccountDropdown', () => {
	it('renders the signed-in user and opens the menu', async () => {
		const { locator } = await render(AccountDropdown, { me });

		const trigger = locator.getByRole('button').first();
		await expect.element(trigger).toBeVisible();
		expect(anchor('/member/profile')).toBeNull();

		// Menu is collapsed until the trigger is clicked.
		await trigger.click();

		await expect.element(locator.getByText(me.name)).toBeVisible();
		await expect.element(locator.getByText(me.email)).toBeVisible();
		await expect.element(await link('/member/profile')).toBeVisible();
	});

	// The four member-context destinations, which used to be three here and
	// three more in the member sidebar (#1244).
	it('offers every member-context destination', async () => {
		const { locator } = await render(AccountDropdown, { me });
		await locator.getByRole('button').first().click();

		for (const href of [
			'/member/profile',
			'/member/account',
			'/member/purchases',
			'/member/membership'
		]) {
			await expect.element(await link(href)).toBeVisible();
		}
	});

	// It had no active state while the sidebar carried one for the same rows.
	it('latches the row you are on', async () => {
		const { locator } = await render(AccountDropdown, { me });
		await locator.getByRole('button').first().click();

		await expect.element(await link('/member/purchases')).toHaveAttribute('aria-current', 'page');
		await expect.element(await link('/member/profile')).not.toHaveAttribute('aria-current');
	});
});
