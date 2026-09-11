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

/**
 * A remote form encodes its own field names, so a hidden input carrying a bare
 * `name` arrives as nothing: Zod rejects a field the page never posted and the
 * issue has no control to render against — a toast saying to fix the
 * highlighted fields, with nothing highlighted (#1019).
 */
describe('SearchSelect posting into a remote form', () => {
	/** What `fields.leaderId` is: `as()` returns the *encoded* attributes. */
	const remoteField = (encoded: string) => ({
		as: (type: string, value?: unknown) => ({ type, name: encoded, value }),
		issues: () => null
	});

	const hidden = () => document.querySelector<HTMLInputElement>('input[type="hidden"]');

	async function pick() {
		await vi.waitFor(() => expect(input()).not.toBeNull());
		await userEvent.click(input());
		await userEvent.type(input(), 'Ada');
		await vi.waitFor(() =>
			expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
		);
		await userEvent.keyboard('{ArrowDown}');
		await userEvent.keyboard('{Enter}');
	}

	it('posts under the name the remote form encoded, not the plain one', async () => {
		await render(SearchSelect, { search, field: remoteField('leaderId_x7') as never });
		await pick();

		await vi.waitFor(() => expect(hidden()).not.toBeNull());
		expect(hidden()!.name).toBe('leaderId_x7');
		expect(hidden()!.value).toBe('u1');
	});

	it('still posts a plain name when given one, for a plain form', async () => {
		await render(SearchSelect, { search, name: 'leaderId' });
		await pick();

		await vi.waitFor(() => expect(hidden()).not.toBeNull());
		expect(hidden()!.name).toBe('leaderId');
	});
});
