import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TabBarHarness from './TabBar.test.svelte';
// The `client` project ships no CSS, and which half of a collapsed bar shows is a media query.
import '../../../routes/layout.css';

/**
 * The staff member record's eight tabs once clipped off a phone's edge with no
 * way to reach them. At phone width the collapsed bar is one menu, and its last
 * tab is still reachable; at desktop width it is the tab row.
 */

const PHONE = { width: 375, height: 812 };
const TABS = ['overview', 'space', 'bands', 'volunteer', 'money', 'comms', 'moderation', 'account'];
const tabs = TABS.map((key) => ({ key, label: key }));

const tablist = () => document.querySelector('[role="tablist"]') as HTMLElement;
const trigger = () => document.querySelector('[aria-haspopup="menu"]') as HTMLElement;
// As Playwright reads visible: rendered, and taking up space.
const shown = (el: HTMLElement) => {
	const box = el.getBoundingClientRect();
	return el.checkVisibility() && box.width > 0 && box.height > 0;
};

afterEach(async () => {
	await page.viewport(1280, 800);
});

describe('TabBar at phone width', () => {
	it('swaps the tab row for a menu that reaches the last tab', async () => {
		await page.viewport(PHONE.width, PHONE.height);
		const onchange = vi.fn();
		await render(TabBarHarness, { tabs, active: 'overview', collapse: true, onchange });

		await vi.waitFor(() => expect(shown(trigger())).toBe(true));
		expect(shown(tablist())).toBe(false);

		trigger().click();
		const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
		await vi.waitFor(() => expect(items()).toHaveLength(TABS.length));
		const last = items()[TABS.length - 1];
		expect(shown(last)).toBe(true);
		last.click();

		expect(onchange).toHaveBeenCalledWith('account');
	});

	it('keeps the tab row at desktop width', async () => {
		await page.viewport(1280, 800);
		await render(TabBarHarness, { tabs, active: 'overview', collapse: true });

		await vi.waitFor(() => expect(shown(tablist())).toBe(true));
		expect(shown(trigger())).toBe(false);
	});
});
