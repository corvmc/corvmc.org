import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './DefinitionListHarness.svelte';

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
		render(Harness);

		const dl = document.querySelector('dl');
		expect(dl).not.toBeNull();

		const childTags = Array.from(dl!.children).map((el) => el.tagName.toLowerCase());
		expect(childTags).toEqual(['dt', 'dd', 'dt', 'dd', 'dt', 'dd']);
	});

	it('keeps the grid template that makes the label column shrink-to-fit', async () => {
		render(Harness);
		const dl = document.querySelector('dl')!;
		expect(dl.getAttribute('style')).toContain('grid-template-columns: auto 1fr');
	});

	it('renders a plain value via the value prop', async () => {
		render(Harness);
		await expect.element(page_dd(0)).toHaveTextContent('Bass Cabinet');
	});

	it('applies mono styling for ids', async () => {
		render(Harness);
		expect(page_dd(1).className).toContain('font-mono');
	});

	it('renders arbitrary markup passed as children', async () => {
		render(Harness);
		expect(page_dd(2).querySelector('a')?.getAttribute('href')).toBe('#open');
	});
});

function page_dd(index: number): HTMLElement {
	return document.querySelectorAll('dd')[index] as HTMLElement;
}
