import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NavItem from './NavItem.svelte';

/**
 * `NavItem` decides `active` by exact pathname equality, which means no row at
 * all lights up on a detail page — `/staff/users/abc` matched nothing. Panels
 * that resolve their own active row (the staff sidebar matches on longest
 * href) pass `active` instead. The built-in behaviour has to stay exactly as
 * it was, because member and band still rely on it.
 */

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/staff/users') }
}));

const link = (name: string) => page.getByRole('link', { name });

describe('NavItem active state', () => {
	it('matches the current pathname exactly when no override is given', async () => {
		render(NavItem, { href: '/staff/users', label: 'Users' });

		await expect.element(link('Users')).toHaveClass(/active/);
	});

	it('leaves a parent path inactive without an override', async () => {
		render(NavItem, { href: '/staff', label: 'Dashboard' });

		await expect.element(link('Dashboard')).not.toHaveClass(/active/);
	});

	it('lets an override light a row the pathname does not match', async () => {
		render(NavItem, { href: '/staff/events', label: 'Events', active: true });

		await expect.element(link('Events')).toHaveClass(/active/);
	});

	it('lets an override turn off a row the pathname does match', async () => {
		render(NavItem, { href: '/staff/users', label: 'Users', active: false });

		await expect.element(link('Users')).not.toHaveClass(/active/);
	});

	it('does not leak the override onto the anchor', async () => {
		render(NavItem, { href: '/staff/users', label: 'Users', active: true });

		await expect.element(link('Users')).not.toHaveAttribute('active');
	});
});
