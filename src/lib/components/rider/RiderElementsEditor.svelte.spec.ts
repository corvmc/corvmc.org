import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RiderElementsEditor from './RiderElementsEditor.svelte';

/**
 * These editors live inside a `<Form>`, and a `<button>` with no `type`
 * defaults to `submit`. Every control here — add, remove, reorder — therefore
 * submitted the form instead of editing the list: the row appeared for one
 * frame, the form saved the list without it, and the page refetched over the
 * top. The rider and packing editors were both unusable, and both said
 * "saved" while doing it.
 */
describe('RiderElementsEditor', () => {
	it('never leaves an editing control able to submit its enclosing form', async () => {
		await render(RiderElementsEditor, { elements: [], roster: [], idPrefix: 'spec' });

		const buttons = await page.getByRole('button').elements();
		const submitters = buttons.filter((b) => (b as HTMLButtonElement).type === 'submit');

		expect(
			submitters.map((b) => b.textContent?.trim() || b.getAttribute('aria-label')),
			'an editing control that submits saves the list without the row it just added'
		).toEqual([]);
	});
});
