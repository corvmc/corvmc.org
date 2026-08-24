import { page } from 'vitest/browser';
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NavGroupHarness from './NavGroup.test.svelte';
import { readCollapsed, writeCollapsed } from './nav-collapse';

/**
 * The staff sidebar outgrew a list that was always fully expanded, so groups
 * became collapsible. Three properties matter and none is visible in the
 * template:
 *
 *  - it renders open, always, on the server and on the first client paint —
 *    e2e selects staff nav links by role, and a collapsed group is `display:
 *    none`, so a stored preference leaking into the initial render would take
 *    those links out of the accessibility tree;
 *  - the choice survives a reload;
 *  - navigating into a collapsed group opens it, because a highlighted row you
 *    cannot see is worse than no highlight at all.
 */

const header = (name: string) => page.getByRole('button', { name });

beforeEach(() => localStorage.clear());

describe('NavGroup', () => {
	it('leaves the plain group untouched — no button, no disclosure', async () => {
		render(NavGroupHarness, { title: 'My Bands' });

		await expect.element(page.getByText('My Bands')).toBeInTheDocument();
		expect(await page.getByRole('button').elements()).toHaveLength(0);
	});

	it('renders expanded by default', async () => {
		render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'true');
		await expect.element(page.getByRole('link', { name: 'Users' })).toBeVisible();
	});

	it('hides its rows when collapsed, and brings them back', async () => {
		render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await header('People').click();
		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'false');
		// Out of the accessibility tree, not merely dimmed — which is what makes
		// default-open matter for the e2e suite's role-based selectors.
		expect(await page.getByRole('link', { name: 'Users' }).elements()).toHaveLength(0);

		await header('People').click();
		await expect.element(page.getByRole('link', { name: 'Users' })).toBeVisible();
	});

	it('points aria-controls at the list it toggles', async () => {
		render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		const id = await header('People').element().getAttribute('aria-controls');
		expect(document.getElementById(id!)).not.toBeNull();
	});

	it('remembers a collapsed group', async () => {
		render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await header('People').click();

		expect(readCollapsed('staff', 'people')).toBe(true);
	});

	it('restores a remembered collapse after the first paint, not during it', async () => {
		writeCollapsed('staff', 'people', true);
		render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'false');
		// Hidden, but still in the DOM — the collapse is a class, not an `{#if}`,
		// so nothing was ever server-rendered as missing.
		expect(document.querySelector('a[href="/staff/users"]')).not.toBeNull();
	});

	it('opens a collapsed group that holds the current page, and keeps it open', async () => {
		writeCollapsed('staff', 'people', true);
		const { rerender } = render(NavGroupHarness, {
			collapsible: true,
			persistKey: 'people',
			containsActive: false
		});
		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'false');

		await rerender({ collapsible: true, persistKey: 'people', containsActive: true });

		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'true');
		expect(readCollapsed('staff', 'people')).toBe(false);
	});

	it('keeps each panel\u2019s record to itself', async () => {
		render(NavGroupHarness, { collapsible: true, persistKey: 'people', persistScope: 'member' });

		await header('People').click();

		expect(readCollapsed('member', 'people')).toBe(true);
		expect(readCollapsed('staff', 'people')).toBe(false);
	});
});
