import { page } from 'vitest/browser';
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NavGroupHarness from './NavGroup.test.svelte';
import { readCollapsed, writeCollapsed } from './nav-collapse';
// The app stylesheet, so the flex utilities in the header row resolve against
// real Tailwind output. The `client` project loads no CSS of its own.
import '../../../../routes/layout.css';

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
		await render(NavGroupHarness, { title: 'My Bands' });

		await expect.element(page.getByText('My Bands')).toBeInTheDocument();
		expect(await page.getByRole('button').elements()).toHaveLength(0);
	});

	it('renders expanded by default', async () => {
		await render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'true');
		await expect.element(page.getByRole('link', { name: 'Users' })).toBeVisible();
	});

	it('hides its rows when collapsed, and brings them back', async () => {
		await render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await header('People').click();
		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'false');
		// Out of the accessibility tree, not merely dimmed — which is what makes
		// default-open matter for the e2e suite's role-based selectors.
		expect(await page.getByRole('link', { name: 'Users' }).elements()).toHaveLength(0);

		await header('People').click();
		await expect.element(page.getByRole('link', { name: 'Users' })).toBeVisible();
	});

	it('points aria-controls at the list it toggles', async () => {
		await render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		const id = await header('People').element().getAttribute('aria-controls');
		expect(document.getElementById(id!)).not.toBeNull();
	});

	it('remembers a collapsed group', async () => {
		await render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await header('People').click();

		expect(readCollapsed('staff', 'people')).toBe(true);
	});

	it('restores a remembered collapse after the first paint, not during it', async () => {
		writeCollapsed('staff', 'people', true);
		await render(NavGroupHarness, { collapsible: true, persistKey: 'people' });

		await expect.element(header('People')).toHaveAttribute('aria-expanded', 'false');
		// Hidden, but still in the DOM — the collapse is a class, not an `{#if}`,
		// so nothing was ever server-rendered as missing.
		expect(document.querySelector('a[href="/staff/users"]')).not.toBeNull();
	});

	it('opens a collapsed group that holds the current page, and keeps it open', async () => {
		writeCollapsed('staff', 'people', true);
		const { rerender } = await render(NavGroupHarness, {
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
		await render(NavGroupHarness, {
			collapsible: true,
			persistKey: 'people',
			persistScope: 'member'
		});

		await header('People').click();

		expect(readCollapsed('member', 'people')).toBe(true);
		expect(readCollapsed('staff', 'people')).toBe(false);
	});
});

/**
 * The action shares the title's row. It used to be a sibling of a `w-full`
 * toggle in the collapsible branch, so "All" was pushed onto a line of its own
 * in My Acts and My Groups — the only two groups that pass one (#1022).
 */
describe('NavGroup action slot', () => {
	for (const collapsible of [false, true]) {
		it(`keeps the action on the title's row when collapsible=${collapsible}`, async () => {
			await render(NavGroupHarness, { withAction: true, collapsible, title: 'My Acts' });

			// By its text: the collapsible branch's disclosure toggle is also a
			// `button[type=button]`, and picking that one compares the heading
			// with its own parent, which lines up however the row is laid out.
			const all = [...document.querySelectorAll<HTMLElement>('button')].find(
				(el) => el.textContent?.trim() === 'All'
			)!;
			const heading = [...document.querySelectorAll<HTMLElement>('span')].find(
				(el) => el.textContent === 'My Acts'
			)!;

			// Same row: their vertical centres line up. A wrapped action sits a
			// whole line below, which no tolerance this small would absorb.
			const a = all.getBoundingClientRect();
			const h = heading.getBoundingClientRect();
			expect(Math.abs((a.top + a.bottom) / 2 - (h.top + h.bottom) / 2)).toBeLessThan(4);
		});
	}
});
