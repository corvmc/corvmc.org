import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import DataList from './DataList.svelte';

type Row = { id: string };

const children = createRawSnippet((rows: () => Row[]) => ({
	render: () =>
		`<ul>${rows()
			.map((r) => `<li data-row="${r.id}"></li>`)
			.join('')}</ul>`
}));

// Every paginated list page goes through DataList, and the panels render on the
// server (#3158): the first page has to be in the server's HTML, not a spinner.
describe('DataList server rendering', () => {
	it('sends the first page of rows', async () => {
		const { body } = await render(DataList<Row>, {
			props: {
				result: Promise.resolve({
					rows: [{ id: 'a' }],
					pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
				}),
				children
			}
		});

		expect(body).toContain('data-row="a"');
		expect(body).not.toContain('loading-spinner');
	});
});
