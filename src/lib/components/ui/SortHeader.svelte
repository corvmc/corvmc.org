<script lang="ts">
	/**
	 * A sortable `<th>` for `Table`'s `head` snippet. The sort is one token the
	 * page owns (`#lib/utils/sort-token.js`), so it can live in the URL with the
	 * filters, and the query does the sorting. `Table` itself stays unaware.
	 */
	import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-svelte';
	import { nextSort, sortDirection } from '#lib/utils/sort-token.js';

	let {
		label,
		field,
		sort,
		descFirst = false,
		onsort,
		class: className = ''
	}: {
		label: string;
		/** This column's key in the token. */
		field: string;
		/** The current token. */
		sort: string;
		/** First click sorts high to low: for a date where the newest matters. */
		descFirst?: boolean;
		onsort: (next: string) => void;
		class?: string;
	} = $props();

	const direction = $derived(sortDirection(sort, field));
</script>

<th class={className} aria-sort={direction}>
	<button
		type="button"
		class="inline-flex cursor-pointer items-center gap-1 font-[inherit] hover:text-base-content"
		data-sort={field}
		onclick={() => onsort(nextSort(sort, field, descFirst))}
	>
		{label}
		{#if direction === 'ascending'}
			<IconArrowUp size={14} aria-hidden="true" />
		{:else if direction === 'descending'}
			<IconArrowDown size={14} aria-hidden="true" />
		{:else}
			<IconArrowsSort size={14} aria-hidden="true" class="opacity-40" />
		{/if}
	</button>
</th>
