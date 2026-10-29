import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './DefinitionListHarness.svelte';
import OverflowHarness from './DefinitionListOverflowHarness.svelte';

describe('DefinitionList + Fact', () => {
	/**
	 * The layout is a two-column CSS grid declared on the `<dl>`, which only
	 * aligns when the `<dt>`s and `<dd>`s are *direct* children of it. `Fact` is
	 * a component, so if it ever grows a wrapper element — or someone "tidies"
	 * it into a `<div>` — the columns silently collapse into one and every
	 * detail page in the staff panel loses its label gutter. Nothing about that
	 * failure throws, so assert the structure.
	 */
	it('renders dt/dd as direct children of the dl, with no wrapper', async () => {
		await render(Harness);

		const dl = document.querySelector('dl');
		expect(dl).not.toBeNull();

		const childTags = Array.from(dl!.children).map((el) => el.tagName.toLowerCase());
		expect(childTags).toEqual(['dt', 'dd', 'dt', 'dd', 'dt', 'dd']);
	});

	// A `1fr` track cannot shrink below its content's min-content width, so one
	// unwrappable value (a nowrap badge row) widened the value column past its
	// container and every paragraph beside it scrolled sideways instead of
	// wrapping. The value column has to be allowed to be narrower than its widest
	// child.
	it('keeps the value column inside its container when a value cannot wrap', async () => {
		await render(OverflowHarness);
		const dl = document.querySelector('dl')!;
		// The client project loads no Tailwind, so the `grid` class does nothing here.
		dl.style.display = 'grid';
		const paragraph = document.querySelectorAll('dd')[1] as HTMLElement;
		expect(paragraph.getBoundingClientRect().right).toBeLessThanOrEqual(
			dl.getBoundingClientRect().right
		);
	});

	it('renders a plain value via the value prop', async () => {
		await render(Harness);
		await expect.element(page_dd(0)).toHaveTextContent('Bass Cabinet');
	});

	it('applies mono styling for ids', async () => {
		await render(Harness);
		expect(page_dd(1).className).toContain('font-mono');
	});

	it('renders arbitrary markup passed as children', async () => {
		await render(Harness);
		expect(page_dd(2).querySelector('a')?.getAttribute('href')).toBe('#open');
	});
});

function page_dd(index: number): HTMLElement {
	return document.querySelectorAll('dd')[index] as HTMLElement;
}
