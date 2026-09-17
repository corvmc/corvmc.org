<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { PAGE_GAP, pageRange, pageWindow } from '$lib/utils/pagination';

	let {
		page = 1,
		totalPages = 1,
		pageSize,
		total,
		unit,
		onpage
	}: {
		page?: number;
		totalPages?: number;
		/** From the `pagination` object a paginated `query()` returns. */
		pageSize?: number;
		total?: number;
		/**
		 * The noun for a list that fits on one page — "rooms", "contractors". With
		 * it the line reads "42 rooms" instead of "Showing 1–42 of 42", which is
		 * what a list of everything actually means.
		 */
		unit?: string;
		/**
		 * Omit on a list that is not paginated — the buttons disappear and only
		 * the total line renders. An unbounded query's rows already *are* the
		 * total, and `ui-patterns.md` requires a list to say so either way.
		 */
		onpage?: (page: number) => void;
	} = $props();

	const size = $derived(pageSize ?? total);
	const items = $derived(pageWindow(page, totalPages));
	const range = $derived(
		size !== undefined && total !== undefined ? pageRange(page, size, total) : null
	);
</script>

{#if totalPages > 1 || range}
	<div class="flex flex-col items-center gap-2">
		{#if totalPages > 1 && onpage}
			<div class="join">
				{#if page > 1}
					<Button
						onclick={() => onpage?.(page - 1)}
						variant="default"
						class="join-item"
						aria-label="Previous page"
					>
						«
					</Button>
				{/if}

				{#each items as item, i (item === PAGE_GAP ? `gap-${i}` : item)}
					{#if item === PAGE_GAP}
						<span class="btn btn-disabled pointer-events-none join-item">…</span>
					{:else}
						<Button
							onclick={() => onpage?.(item)}
							variant="default"
							class="join-item {item === page ? 'btn-active' : ''}"
							aria-current={item === page ? 'page' : undefined}
						>
							{item}
						</Button>
					{/if}
				{/each}

				{#if page < totalPages}
					<Button
						onclick={() => onpage?.(page + 1)}
						variant="default"
						class="join-item"
						aria-label="Next page"
					>
						»
					</Button>
				{/if}
			</div>
		{/if}

		{#if range}
			<p class="tnums text-muted">
				{#if unit && totalPages <= 1}
					{total}
					{unit}
				{:else}
					Showing {range.from}–{range.to} of {total}
				{/if}
			</p>
		{/if}
	</div>
{/if}
