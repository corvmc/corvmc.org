import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import DataList from './DataList.svelte';

type Row = { id: string };
const pageOf = (rows: Row[]) => ({
	rows,
	pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 }
});

// Each row is an input, standing in for a row action's open dialog: what matters
// is whether the element, and what was typed into it, survives a refresh.
const children = createRawSnippet((rows: () => Row[]) => ({
	render: () =>
		`<div>${rows()
			.map((r) => `<input data-row="${r.id}" />`)
			.join('')}</div>`
}));

describe('DataList', () => {
	it('keeps the rendered rows while a refresh is in flight (#2352)', async () => {
		const screen = await render(DataList<Row>, {
			result: Promise.resolve(pageOf([{ id: 'a' }])),
			children
		});
		await vi.waitFor(() => expect(screen.container.querySelector('[data-row="a"]')).not.toBeNull());
		const input = screen.container.querySelector<HTMLInputElement>('[data-row="a"]')!;
		input.value = 'typed';

		await screen.rerender({ result: new Promise(() => {}) });
		// A macrotask: every microtask the old `{#await}` needed to re-pend has run.
		await new Promise((r) => setTimeout(r));

		expect(input.isConnected).toBe(true);
		expect(input.value).toBe('typed');
		expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
	});
});
