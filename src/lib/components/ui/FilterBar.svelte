<script lang="ts">
	/**
	 * Filter toolbar layout. Owns no filter state — pages keep their own `$state`
	 * and pass the controls in.
	 *
	 * Search stays visible at every width; everything else collapses behind a
	 * "Filters" disclosure below the `@lg` container breakpoint. On a phone the
	 * uncollapsed form stacked five full-height rows and pushed every data row
	 * below the fold.
	 */
	import type { Snippet } from 'svelte';
	import { IconFilter } from '@tabler/icons-svelte';
	import Button from './Button.svelte';

	let {
		search,
		children,
		activeCount = 0,
		onclear
	}: {
		/** Always visible; full width below `@lg`. */
		search?: Snippet;
		/** Selects, date ranges, etc. Collapsed on narrow containers. */
		children?: Snippet;
		/** Drives the count badge and whether Clear renders. */
		activeCount?: number;
		onclear?: () => void;
	} = $props();

	const uid = $props.id();
</script>

<div class="mb-4 flex flex-wrap items-end gap-2">
	{#if search}
		<div class="w-full @lg:w-64">{@render search()}</div>
	{/if}

	{#if children}
		<!-- Peer checkbox rather than <details>: <details> cannot be reliably
		     forced open by CSS at wide widths across engines. -->
		<input id="filters-{uid}" type="checkbox" class="peer hidden" />
		<label for="filters-{uid}" class="btn btn-ghost btn-sm @lg:hidden">
			<IconFilter size={16} />
			Filters
			{#if activeCount > 0}
				<span class="badge badge-sm badge-primary">{activeCount}</span>
			{/if}
		</label>

		<!-- `hidden` keeps the controls mounted so their state survives collapsing.
		     Tailwind emits the `@lg:` variant after `hidden`, so it wins on wide
		     containers. `contents` rather than `flex` there: as a flex *item* this
		     wrapper shrinks and wraps its own children onto extra lines, so at wide
		     widths it steps out of layout and the controls join the parent's row. -->
		<div class="hidden w-full flex-wrap items-end gap-2 peer-checked:flex @lg:contents">
			{@render children()}
			{#if activeCount > 0 && onclear}
				<Button variant="ghost" size="sm" onclick={onclear}>Clear</Button>
			{/if}
		</div>
	{/if}
</div>
