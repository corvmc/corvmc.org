import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './NavItem.test.svelte';

// The app stylesheet, for the same reason SplitBar's spec loads it: the
// `client` project ships no CSS and the rule under test is in layout.css.
import '../../../../routes/layout.css';

/**
 * Every nav link in the member, staff and band panels reported `outline: none`
 * under real keyboard focus, while every other control on the page reported
 * `outline: solid 2px` — twelve consecutive invisible stops in the band panel
 * (#991).
 */
describe('NavItem focus visibility', () => {
	it('shows a ring when focused by keyboard', async () => {
		await render(Harness, {});

		const link = document.querySelector<HTMLAnchorElement>('.menu a')!;
		expect(getComputedStyle(link).outlineStyle).toBe('none');

		link.focus();
		// `:focus-visible` needs the browser to believe this was not a click.
		link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

		const ring = getComputedStyle(link);
		expect(ring.outlineStyle).not.toBe('none');
		expect(parseFloat(ring.outlineWidth)).toBeGreaterThan(0);
	});
});
