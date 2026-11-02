<script lang="ts" generics="T extends RosterPerson">
	/**
	 * A roster's rows (#1994): person, email, then the page's own cells. `Roster`
	 * wraps it with search, paging and export for a page-sized list; a short list
	 * inside a card uses it bare. A row opens `panel` when given, else the
	 * viewer's own page for the person.
	 */
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { IconCopy } from '@tabler/icons-svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { getEntityViewer } from '$lib/components/ui/entity/context';
	import { entityHref } from '$lib/utils/entity-href';
	import { rowLink } from '$lib/actions/row-link';
	import type { RosterPerson } from '$lib/types/roster';

	let {
		rows,
		personLabel = 'Name',
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
		rows: T[];
		/** Header of the person column. */
		personLabel?: string;
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
		/** Side-panel body; without it a row links to the person's page. */
		panel?: Snippet<[T, { open: boolean }]>;
	} = $props();

	const viewer = getEntityViewer();

	// An id, not the row: the panel re-reads it from the refreshed list.
	let selectedId = $state<string | null>(null);
	const panelState = $state({ open: false });

	function openPanel(row: T) {
		selectedId = row.personId;
		panelState.open = true;
	}

	/** No page the viewer can reach means no row click, not a 403. */
	function rowTarget(node: HTMLElement, row: T) {
		if (panel) return rowLink(node, () => openPanel(row));
		const href = entityHref(row.member, viewer);
		return href ? rowLink(node, href) : undefined;
	}

	// Email has its own column, so the name cell drops the ref's subtitle when
	// it is the email, rather than printing it twice.
	const nameRef = (row: T) =>
		row.member.subtitle === row.email ? { ...row.member, subtitle: null } : row.member;

	async function copyEmail(email: string) {
		await navigator.clipboard.writeText(email);
		toast.success('Email copied');
	}

	const chosen = $derived(panel ? rows.find((r) => r.personId === selectedId) : undefined);
</script>

<Table>
	{#snippet head()}
		{#if lead}
			<th class="w-px">
				{#if leadHead}{@render leadHead(rows)}{:else}<span class="sr-only">{leadLabel}</span>{/if}
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
				'hover',
				// Dims every cell but the actions, which keep their tone.
				tone?.(row) === 'muted' && actions && '[&>td:not(:last-child)]:opacity-60',
				tone?.(row) === 'muted' && !actions && '[&>td]:opacity-60'
			]}
			use:rowTarget={row}
		>
			{#if lead}<td class="w-px">{@render lead(row)}</td>{/if}

			<!-- `min-w-48`: a long secondary cell could otherwise leave the name two letters. -->
			<td class="cell-primary min-w-48">
				<span class="flex items-center gap-2">
					{#if panel}
						<!-- The keyboard path to the panel, which a row cannot be. -->
						<button type="button" class="min-w-0 text-left" onclick={() => openPanel(row)}>
							<EntityIdentity ref={nameRef(row)} avatar link={false} />
						</button>
					{:else}
						<EntityIdentity ref={nameRef(row)} avatar />
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

{#if panel && chosen}
	<!-- Keyed, so a second person's panel starts fresh rather than on the last one's tab. -->
	{#key chosen.personId}
		{@render panel(chosen, panelState)}
	{/key}
{/if}
