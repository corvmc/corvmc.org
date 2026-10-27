<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { formatDateTimeShort } from '$lib/utils/format';
	import type { RosterRow } from '$lib/types/roster';

	/**
	 * Who is on a list for an event. Presentational: the caller fetches, guards
	 * and titles it. RSVPs are its first list; #1994 generalises the rest.
	 */
	let { rows, atLabel = 'Signed up' }: { rows: RosterRow[]; atLabel?: string } = $props();
</script>

<Table>
	{#snippet head()}
		<th>Name</th>
		<th class="col-support">Email</th>
		<th class="col-extra">{atLabel}</th>
	{/snippet}
	{#each rows as row (row.id)}
		<tr>
			<td class="cell-primary">
				<EntityIdentity ref={row.person} />
			</td>
			<td class="col-support">
				<a class="link" href="mailto:{row.contact}" rel="external">{row.contact}</a>
			</td>
			<td class="col-extra whitespace-nowrap">{formatDateTimeShort(row.at)}</td>
		</tr>
	{/each}
</Table>
