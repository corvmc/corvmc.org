import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import SearchSelect from './SearchSelect.svelte';
import Harness from './SearchSelect.test.svelte';

/**
 * A mouse could pick a recipient and a keyboard could not: the list appeared,
 * an option highlighted, and no key committed it, so Send request stayed
 * disabled with nothing saying why (#1004).
 */
const PEOPLE = [
	{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
	{ id: 'u2', name: 'Alan Turing', email: 'alan@example.com' }
];

const search = async (q: string) =>
	PEOPLE.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"], input')!;
const chip = () => document.querySelector('.badge');

describe('SearchSelect keyboard selection', () => {
	it('commits the highlighted option on Enter', async () => {
		let picked: { id: string } | null = null;
		await render(SearchSelect, { search, onselect: (v: any) => (picked = v) });

		await vi.waitFor(() => expect(input()).not.toBeNull());
		await userEvent.click(input());
		await userEvent.type(input(), 'Ada');
		await vi.waitFor(() =>
			expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
		);

		await userEvent.keyboard('{ArrowDown}');
		await userEvent.keyboard('{Enter}');

		await expect.poll(() => picked).not.toBeNull();
		expect(chip()?.textContent).toContain('Ada Lovelace');
	});
});

/**
 * The component works in isolation, so the failure is contextual: the real
 * caller nests it in a `<label class="fieldset">` inside a bits-ui Modal.
 * Bisected here rather than guessed.
 */
describe('SearchSelect keyboard selection, in context', () => {
	for (const [name, props] of [
		['wrapped in a label', { inLabel: true }],
		['inside a modal', { inModal: true }],
		['inside a modal, wrapped in a label', { inModal: true, inLabel: true }]
	] as const) {
		it(`commits on Enter when ${name}`, async () => {
			let picked: unknown = null;
			await render(Harness, { search, onselect: (v: unknown) => (picked = v), ...props });

			await vi.waitFor(() => expect(input()).not.toBeNull());
			await userEvent.click(input());
			await userEvent.type(input(), 'Ada');
			await vi.waitFor(() =>
				expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
			);

			await userEvent.keyboard('{ArrowDown}');
			await userEvent.keyboard('{Enter}');

			await expect.poll(() => picked).not.toBeNull();
		});
	}
});
