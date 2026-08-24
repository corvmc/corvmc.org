<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { PAGE_GAP, pageRange, pageWindow } from '$lib/utils/pagination';

	let {
		page,
		totalPages,
		pageSize,
		total,
		onpage
	}: {
		page: number;
		totalPages: number;
		/** From the `pagination` object a paginated `query()` returns. */
		pageSize?: number;
		total?: number;
		onpage: (page: number) => void;
	} = $props();

	const items = $derived(pageWindow(page, totalPages));
	const range = $derived(
		pageSize !== undefined && total !== undefined ? pageRange(page, pageSize, total) : null
	);
</script>

{#if totalPages > 1 || range}
	<div class="flex flex-col items-center gap-2">
		{#if totalPages > 1}
			<div class="join">
				{#if page > 1}
					<Button
						onclick={() => onpage(page - 1)}
						variant="default"
						class="join-item"
						aria-label="Previous page"
					>
						«
					</Button>
				{/if}

				{#each items as item, i (item === PAGE_GAP ? `gap-${i}` : item)}
					{#if item === PAGE_GAP}
						<span class="join-item btn btn-disabled pointer-events-none">…</span>
					{:else}
						<Button
							onclick={() => onpage(item)}
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
						onclick={() => onpage(page + 1)}
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
			<p class="text-muted tnums">
				Showing {range.from}–{range.to} of {total}
			</p>
		{/if}
	</div>
{/if}
