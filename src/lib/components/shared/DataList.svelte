<script lang="ts" generics="T">
	/**
	 * The async envelope shared by every paginated list page: pending state,
	 * empty state, and pagination.
	 *
	 * It owns no columns, no data fetching, and no filter state — pass it the
	 * promise a paginated `query()` already returned. That boundary is deliberate:
	 * the component it replaces (`DataTable`, deleted in 525bfff) owned columns
	 * and paging, which is why a change in how data arrived took the whole thing
	 * down with it.
	 */
	import type { Snippet } from 'svelte';
	import type { Pagination as PaginationInfo } from '$lib/server/db/schema/api';
	import EmptyState from './EmptyState.svelte';
	import Pagination from './Pagination.svelte';

	let {
		result,
		empty = 'No items found.',
		emptyTitle,
		actionLabel,
		actionHref,
		onpage,
		children
	}: {
		result: Promise<{ rows: T[]; pagination: PaginationInfo }>;
		empty?: string;
		emptyTitle?: string;
		actionLabel?: string;
		actionHref?: string;
		/** Omit for un-paginated lists; `Pagination` is then not rendered. */
		onpage?: (page: number) => void;
		children: Snippet<[T[]]>;
	} = $props();
</script>

<!--
	`{#await}`, not a top-level `await`: the panel layout's boundary `pending`
	snippet blanks the whole page including PageHeader and the filter bar, so
	suspending would flash the page away on every filter keystroke. Rejections
	still propagate to that boundary.
-->
{#await result}
	<div class="flex justify-center py-12">
		<span class="loading loading-lg loading-spinner"></span>
	</div>
{:then { rows, pagination }}
	{#if rows.length === 0}
		<EmptyState title={emptyTitle} description={empty} {actionLabel} {actionHref} />
	{:else}
		{@render children(rows)}
		{#if onpage}
			<Pagination {...pagination} {onpage} />
		{/if}
	{/if}
{/await}
