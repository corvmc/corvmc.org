<script lang="ts" generics="T extends RosterPerson, S extends Record<string, unknown>">
	/**
	 * A list of people (#1994): any query returning `RosterPerson` rows. The roster
	 * owns search, paging, Clear, export, "copy emails" and the side panel; the page
	 * owns its query, its filters and its columns. Filter state comes from
	 * `rosterState()`, so it lives in the URL.
	 */
	import { untrack, type Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { IconCopy, IconDownload } from '@tabler/icons-svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import type { Pagination } from '$lib/types/pagination';
	import type { RosterPerson } from '$lib/types/roster';
	import type { RosterState } from './roster-state.svelte';

	let {
		roster,
		result,
		empty = 'No one here yet.',
		searchPlaceholder = 'Search...',
		personLabel = 'Name',
		filters,
		menu,
		summary,
		bulk,
		exportPath,
		emails,
		lead,
		leadLabel = 'Status',
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

	let copying = $state(false);
	async function copyEmails() {
		if (!emails) return;
		copying = true;
		try {
			const list = await emails();
			if (list.length === 0) {
				toast.info('No email addresses');
				return;
			}
			await navigator.clipboard.writeText(list.join(', '));
			toast.success(`Copied ${list.length} ${list.length === 1 ? 'address' : 'addresses'}`);
		} catch {
			toast.error("Couldn't copy");
		} finally {
			copying = false;
		}
	}

	// An id, not the row: the panel re-reads it from the refreshed list.
	let selectedId = $state<string | null>(null);
	const panelState = $state({ open: false });

	function openPanel(row: T) {
		selectedId = row.personId;
		panelState.open = true;
	}

	const recordHref = (row: T) => resolve(`/staff/members/${row.personId}`);

	// Email has its own column, so the name cell drops the
	// ref's subtitle (which is the email) rather than printing it twice.
	const nameOnly = (row: T) => ({ ...row.member, subtitle: null });

	async function copyEmail(email: string) {
		await navigator.clipboard.writeText(email);
		toast.success('Email copied');
	}
</script>

<FilterBar activeCount={roster.activeCount} onclear={clear} {menu}>
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
		{#if emails}
			<Button variant="ghost" size="sm" onclick={copyEmails} disabled={copying}>
				<IconCopy size={16} />
				Copy emails
			</Button>
		{/if}
		{#if exportHref}
			<Button href={exportHref} rel="external" download variant="ghost" size="sm">
				<IconDownload size={16} />
				Export
			</Button>
		{/if}
	</div>
</div>

<DataList {result} {empty} onpage={(p) => (roster.values.page = p)}>
	{#snippet children(rows)}
		<Table>
			{#snippet head()}
				{#if lead}
					<th class="w-px">
						{#if leadHead}{@render leadHead(rows)}{:else}<span class="sr-only">{leadLabel}</span
							>{/if}
					</th>
				{/if}
				<th>{personLabel}</th>
				<th>Email</th>
				{@render columns?.()}
				{#if actions}<th class="w-px"><span class="sr-only">Actions</span></th>{/if}
			{/snippet}

			{#each rows as row (row.personId)}
				<tr
					class={[
						'hover cursor-pointer',
						// Dims every cell but the actions, which keep their tone.
						tone?.(row) === 'muted' && actions && '[&>td:not(:last-child)]:opacity-60',
						tone?.(row) === 'muted' && !actions && '[&>td]:opacity-60'
					]}
					use:rowLink={panel ? () => openPanel(row) : recordHref(row)}
				>
					{#if lead}<td class="w-px">{@render lead(row)}</td>{/if}

					<!-- `min-w-48`: a long secondary cell could otherwise leave the name two letters. -->
					<td class="cell-primary min-w-48">
						<span class="flex items-center gap-2">
							{#if panel}
								<!-- The keyboard path to the panel, which a row cannot be. -->
								<button type="button" class="min-w-0 text-left" onclick={() => openPanel(row)}>
									<EntityIdentity ref={nameOnly(row)} avatar link={false} />
								</button>
							{:else}
								<EntityIdentity ref={nameOnly(row)} avatar />
							{/if}
							{@render aside?.(row)}
						</span>
						{@render detail?.(row)}
					</td>

					<td class="min-w-0">
						{#if row.email}
							{@const email = row.email}
							<span class="flex items-center gap-1">
								<span class="truncate">{email}</span>
								<Button
									variant="ghost"
									size="xs"
									shape="square"
									class="border-transparent"
									aria-label="Copy email"
									title="Copy email"
									onclick={() => copyEmail(email)}
								>
									<IconCopy size={14} />
								</Button>
							</span>
						{/if}
					</td>

					{@render cells?.(row)}

					{#if actions}<td class="w-px">{@render actions(row)}</td>{/if}
				</tr>
			{/each}
		</Table>

		{@const chosen = panel ? rows.find((r) => r.personId === selectedId) : undefined}
		{#if panel && chosen}
			{@render panel(chosen, panelState)}
		{/if}
	{/snippet}
</DataList>
