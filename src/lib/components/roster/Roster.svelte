<script lang="ts" generics="T extends RosterPerson, S extends Record<string, unknown>">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * A list of people (#1994): any query returning `RosterPerson` rows. The roster
	 * owns search, paging, Clear, export, "copy emails" and the side panel; the page
	 * owns its query, its filters and its columns. Filter state comes from
	 * `rosterState()`, so it lives in the URL.
	 */
	import { untrack, type Snippet } from 'svelte';
	import { IconDownload } from '@tabler/icons-svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { withQuery } from '$lib/utils/with-query';
	import type { Pagination } from '$lib/types/pagination';
	import type { RosterPerson } from '$lib/types/roster';
	import type { RosterState } from './roster-state.svelte';
	import RosterTable from './RosterTable.svelte';
	import CopyEmailsButton from './CopyEmailsButton.svelte';

	let {
		roster,
		result,
		empty = m.roster_roster_empty(),
		searchPlaceholder = m.roster_roster_search_placeholder(),
		personLabel = m.roster_name(),
		filters,
		menu,
		summary,
		bulk,
		toolbar,
		exportPath,
		emails,
		lead,
		leadLabel = m.roster_status(),
		leadHead,
		detail,
		aside,
		tone,
		columns,
		cells,
		actions,
		panel
	}: {
		roster: RosterState<S>;
		/** The page's paginated query, already called with `roster.values`. */
		result: Promise<{ rows: T[]; pagination: Pagination }>;
		empty?: string;
		searchPlaceholder?: string;
		/** Header of the person column. */
		personLabel?: string;
		/** Inline filter controls, bound to `roster.values`. */
		filters?: Snippet;
		/** Secondary filters, behind FilterBar's "Filters" button. */
		menu?: Snippet;
		/** The line above the table, given the match count. Defaults to the count. */
		summary?: Snippet<[number]>;
		/** Page-supplied bulk actions, beside export. */
		bulk?: Snippet;
		/** The view's own actions, such as its create button, at the end of the filter row. */
		toolbar?: Snippet;
		/** A resolved `+server.ts` path; the current filters are appended. */
		exportPath?: string;
		/** Every matching address, not just this page's. */
		emails?: () => Promise<string[]>;
		/** A narrow cell before the person, such as a status glyph. */
		lead?: Snippet<[T]>;
		leadLabel?: string;
		/** The lead column's header cell, such as a select-all box; `leadLabel` otherwise. */
		leadHead?: Snippet<[T[]]>;
		/** The person cell's second line. */
		detail?: Snippet<[T]>;
		/** Inline beside the name, such as a badge. */
		aside?: Snippet<[T]>;
		/** `muted` dims a row's cells but leaves its actions at full tone. */
		tone?: (row: T) => 'muted' | undefined;
		/** Header cells for `cells`. */
		columns?: Snippet;
		/** The page's own cells, after the person. */
		cells?: Snippet<[T]>;
		/** The trailing actions cell. */
		actions?: Snippet<[T]>;
		/** Side-panel body; without it a row links to the person's record. */
		panel?: Snippet<[T, { open: boolean }]>;
	} = $props();

	// The live text in the box; `roster.values.q` only moves once it settles.
	let searchText = $state(untrack(() => roster.values.q));

	function clear() {
		searchText = '';
		roster.clear();
	}

	const exportHref = $derived(exportPath ? withQuery(exportPath, roster.query) : null);
</script>

<FilterBar activeCount={roster.activeCount} onclear={clear} {menu} actions={toolbar}>
	{#snippet search()}
		<SearchInput
			bind:value={searchText}
			placeholder={searchPlaceholder}
			onsearch={(q) => {
				roster.values.q = q;
				roster.values.page = 1;
			}}
		/>
	{/snippet}
	{@render filters?.()}
</FilterBar>

<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
	<div class="text-subtle text-sm">
		{#await result then { pagination }}
			{#if summary}
				{@render summary(pagination.total)}
			{:else}
				{pagination.total}
			{/if}
		{/await}
	</div>
	<div class="flex flex-wrap items-center gap-1">
		{@render bulk?.()}
		{#if emails}<CopyEmailsButton {emails} />{/if}
		{#if exportHref}
			<Button href={exportHref} rel="external" download variant="ghost" size="sm">
				<IconDownload size={16} />
				{m.roster_roster_export()}
			</Button>
		{/if}
	</div>
</div>

<DataList {result} {empty} onpage={(p) => (roster.values.page = p)}>
	{#snippet children(rows)}
		<RosterTable
			{rows}
			{personLabel}
			{lead}
			{leadLabel}
			{leadHead}
			{detail}
			{aside}
			{tone}
			{columns}
			{cells}
			{actions}
			{panel}
		/>
	{/snippet}
</DataList>
