<script lang="ts" generics="T">
	import { m } from '#lib/paraglide/messages.js';
	import type { ResolvedPathname } from '$app/types';
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
	import type { Pagination as PaginationInfo } from '#lib/types/pagination.js';
	import EmptyState from './EmptyState.svelte';
	import Pagination from './Pagination.svelte';
	import { Latest } from '#lib/latest.svelte.js';

	let {
		result,
		empty = m.ui_no_items_found_body(),
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
		actionHref?: ResolvedPathname;
		/** Omit for un-paginated lists; `Pagination` is then not rendered. */
		onpage?: (page: number) => void;
		children: Snippet<[T[]]>;
	} = $props();

	// Not `{#await result}`: that re-pends on every refresh and remounts each row,
	// open dialogs included (#2352). The last page stays, dimmed, until the next lands.
	const page = new Latest(() => result);
	const settled = $derived(page.current);
	// Thrown from an effect so a rejection still reaches the panel's boundary.
	$effect(() => {
		if (page.error) throw page.error.e;
	});
</script>

<!--
	Not a top-level `await`: the panel layout's boundary `pending` snippet blanks
	the whole page including PageHeader and the filter bar.
-->
{#if !settled}
	<div class="flex justify-center py-12">
		<span class="loading loading-lg loading-spinner"></span>
	</div>
{:else if settled.rows.length === 0}
	<EmptyState title={emptyTitle} description={empty} {actionLabel} {actionHref} />
{:else}
	<div aria-busy={page.loading} class={['transition-opacity', page.loading && 'opacity-60']}>
		{@render children(settled.rows)}
		{#if onpage}
			<Pagination {...settled.pagination} {onpage} />
		{/if}
	</div>
{/if}
