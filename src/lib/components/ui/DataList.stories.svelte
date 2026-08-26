<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DataList from './DataList.svelte';

	const { Story } = defineMeta({
		title: 'Shared/DataList',
		// No `component:` here. It makes svelte-csf render `<DataList {...args} />`
		// in addition to each story's own children, and with no `result` arg that
		// render throws on destructuring `{ rows }` — five unhandled errors that
		// fail `pnpm test` while every assertion still passes. Each story below
		// renders the component itself.
		tags: ['autodocs'],
		parameters: {
			docs: {
				description: {
					component:
						'The async envelope every paginated list page shares: pending state, ' +
						'empty state, pagination. It owns no columns and does no fetching — pass ' +
						'it the promise a paginated `query()` already returned.'
				}
			}
		}
	});

	const rows = [
		{ id: '1', name: 'Skyler Santos' },
		{ id: '2', name: 'Taylor Chen' },
		{ id: '3', name: 'Sage Kim' }
	];

	const populated = Promise.resolve({
		rows,
		pagination: { page: 1, pageSize: 20, total: 3, totalPages: 1 }
	});

	const empty = Promise.resolve({
		rows: [],
		pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
	});

	const paged = Promise.resolve({
		rows,
		pagination: { page: 2, pageSize: 20, total: 137, totalPages: 7 }
	});

	// Never resolves — holds the story on the pending state.
	const pending = new Promise<typeof populated extends Promise<infer T> ? T : never>(() => {});
</script>

{#snippet list(items: { id: string; name: string }[])}
	<ul class="menu w-full">
		{#each items as item (item.id)}
			<li><span>{item.name}</span></li>
		{/each}
	</ul>
{/snippet}

<Story name="Populated">
	<DataList result={populated} children={list} />
</Story>

<Story name="Pending">
	<DataList result={pending} children={list} />
</Story>

<Story name="Empty">
	<DataList result={empty} empty="No members found" children={list} />
</Story>

<Story name="Empty with a next action">
	<DataList
		result={empty}
		emptyTitle="Nothing booked yet"
		empty="Reservations you make will show up here."
		actionLabel="Book a session"
		actionHref="/member/reservations"
		children={list}
	/>
</Story>

<Story name="Paginated">
	<DataList result={paged} onpage={() => {}} children={list} />
</Story>
