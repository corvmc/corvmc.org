import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SearchInput from './SearchInput.svelte';

/**
 * The debounce used to be copied into thirteen list pages. Now that it lives in
 * one place, these are the properties every one of those copies depended on.
 *
 * Keystrokes are dispatched synchronously rather than through `fill`, and the
 * delay is long: under a loaded browser runner an awaited `fill` can take longer
 * than a short debounce, which would make these pass or fail on machine speed
 * rather than on behaviour.
 */
const DELAY = 400;

function type(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SearchInput', () => {
	it('fires once with the final text, not once per keystroke', async () => {
		const onsearch = vi.fn();
		render(SearchInput, { placeholder: 'Search members...', delay: DELAY, onsearch });
		const input = page.getByPlaceholder('Search members...').element() as HTMLInputElement;

		type(input, 'a');
		type(input, 'al');
		type(input, 'ali');
		expect(onsearch).not.toHaveBeenCalled();

		await vi.waitFor(() => expect(onsearch).toHaveBeenCalledTimes(1), { timeout: 5000 });
		expect(onsearch).toHaveBeenCalledWith('ali');
	});

	/**
	 * A page's Clear button empties the field. A keystroke from just before that
	 * must not land afterwards and re-apply a filter the user just cleared.
	 */
	it('cancels a pending search when the value is reset from outside', async () => {
		const onsearch = vi.fn();
		const screen = render(SearchInput, {
			placeholder: 'Search',
			delay: DELAY,
			onsearch,
			value: ''
		});
		const input = page.getByPlaceholder('Search').element() as HTMLInputElement;

		type(input, 'drums');
		await screen.rerender({ value: '' });

		await new Promise((r) => setTimeout(r, DELAY * 3));
		expect(onsearch).not.toHaveBeenCalled();
	});
});
