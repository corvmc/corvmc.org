<script lang="ts" module>
	import type { EntityRef } from '$lib/types/entity';

	/** One report in a triage queue, whichever source it came from (#552). */
	export interface TriageRow {
		id: string;
		href: string;
		status: string;
		/** What kind of thing was reported — the type column. */
		kind: string;
		subject: EntityRef;
		text: string;
		reporter: string;
		createdAt: Date;
	}
</script>

<script lang="ts">
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { rowLink } from '$lib/actions/row-link';
	import { relativeDay } from '$lib/utils/format';

	let { rows, subjectLabel }: { rows: TriageRow[]; subjectLabel: string } = $props();
</script>

<!--
	A table: the reason or note is short and the queue has no row actions, so it
	passes none of the four card tests (ui-patterns.md, "A table, unless the row
	earns a card").
-->
<Table>
	{#snippet head()}
		<th class="w-px"><span class="sr-only">Status</span></th>
		<th class="col-support">Type</th>
		<th>{subjectLabel}</th>
		<th class="cell-primary">Reason</th>
		<th class="col-support">Reported by</th>
		<th class="col-support">When</th>
	{/snippet}
	{#each rows as r (r.id)}
		<tr class="hover cursor-pointer" use:rowLink={r.href}>
			<td class="w-px"><StatusBadge status={r.status} label /></td>
			<td class="col-support whitespace-nowrap">{r.kind}</td>
			<td class="whitespace-nowrap"><EntityIdentity ref={r.subject} /></td>
			<td class="cell-primary truncate"><a class="link-hover" href={r.href}>{r.text}</a></td>
			<td class="col-support truncate">{r.reporter}</td>
			<td class="col-support whitespace-nowrap">{relativeDay(r.createdAt)}</td>
		</tr>
	{/each}
</Table>
