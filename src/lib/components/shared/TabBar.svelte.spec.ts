import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TabBarHarness from './TabBar.test.svelte';

/**
 * Regression: `TabBar` rendered only a daisyUI `join`, which does not wrap, and
 * `AppShell`'s <main> is `overflow-x-hidden`. Eight tabs on the staff user
 * record were therefore wider than a phone and the last of them were clipped
 * off the edge with no way to reach them — not scrolled, gone. Three pages had
 * already hand-rolled an `overflow-x-auto` wrapper around this component to
 * dodge it.
 *
 * `collapse` is the fix: below `md` the set becomes one menu whose trigger
 * names the active tab, so every tab stays reachable at any width. Both
 * branches are always in the DOM — which one is visible is a media query — so
 * these assert structure rather than visibility.
 */

const TABS = [
	{ key: 'overview', label: 'Overview', badge: 2 },
	{ key: 'space', label: 'Space' },
	{ key: 'bands', label: 'Bands' },
	{ key: 'volunteer', label: 'Volunteer' },
	{ key: 'money', label: 'Money' },
	{ key: 'comms', label: 'Comms' },
	{ key: 'moderation', label: 'Moderation' },
	{ key: 'account', label: 'Account' }
];

/** The collapsed control, distinguished from the button-group items by its role. */
const trigger = () => page.getByRole('button', { expanded: false }).first();

describe('TabBar collapse', () => {
	it('renders a menu trigger naming the active tab', async () => {
		render(TabBarHarness, { tabs: TABS, active: 'moderation', collapse: true });

		await expect.element(trigger()).toHaveTextContent('Moderation');
		await expect.element(trigger()).toHaveAttribute('aria-haspopup', 'menu');
	});

	it('carries the active tab badge on the trigger', async () => {
		render(TabBarHarness, { tabs: TABS, active: 'overview', collapse: true });

		await expect.element(trigger()).toHaveTextContent('2');
	});

	it('offers every tab in the menu, not just the ones that fit', async () => {
		render(TabBarHarness, { tabs: TABS, active: 'overview', collapse: true });

		await trigger().click();

		for (const tab of TABS) {
			await expect
				.element(page.getByRole('menuitem', { name: new RegExp(tab.label) }))
				.toBeInTheDocument();
		}
	});

	it('reports the chosen tab through onchange', async () => {
		const onchange = vi.fn();
		render(TabBarHarness, { tabs: TABS, active: 'overview', collapse: true, onchange });

		await trigger().click();
		await page.getByRole('menuitem', { name: /Money/ }).click();

		expect(onchange).toHaveBeenCalledWith('money');
	});

	/** Link tabs must stay real anchors in the menu: middle-click and copy-link. */
	it('renders link tabs as anchors inside the menu', async () => {
		render(TabBarHarness, {
			tabs: [
				{ key: 'a', label: 'Pending', href: '/staff/inbox?view=pending' },
				{ key: 'b', label: 'Closed', href: '/staff/inbox?view=closed' }
			],
			active: 'a',
			collapse: true
		});

		await trigger().click();

		await expect
			.element(page.getByRole('menuitem', { name: /Closed/ }))
			.toHaveAttribute('href', '/staff/inbox?view=closed');
	});

	/** Without `collapse` the short bars keep buttons at every width. */
	it('renders no menu trigger when collapse is off', async () => {
		render(TabBarHarness, { tabs: TABS, active: 'overview' });

		await expect.element(page.getByRole('tab', { name: /Overview/ })).toBeInTheDocument();
		expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
	});
});

describe('TabBar semantics', () => {
	/**
	 * The desktop control was a bits-ui ToggleGroup, which is `role="group"` of
	 * toggle buttons. A tab UI that is not announced as tabs loses arrow-key
	 * navigation and "tab 3 of 8" entirely.
	 */
	it('announces itself as a tablist of tabs', async () => {
		render(TabBarHarness, { tabs: TABS, active: 'space', collapse: true });

		await expect.element(page.getByRole('tablist')).toBeInTheDocument();
		await expect
			.element(page.getByRole('tab', { name: /Space/ }))
			.toHaveAttribute('aria-selected', 'true');
	});
});
