<script lang="ts" module>
	import type { EntityRef } from '#lib/types/entity.js';
	import type { ResolvedPathname } from '$app/types';

	/** One report in a triage queue, whichever source it came from (#552). */
	export interface TriageRow {
		id: string;
		/** Already passed through `resolve()` by the page that built the row. */
		href: ResolvedPathname;
		status: string;
		/** What kind of thing was reported — the type column. */
		kind: string;
		/** A record, or plain text where there is none — a building problem's place. */
		subject: EntityRef | string;
		text: string;
		reporter: string;
		createdAt: Date;
		/** A member has appealed the upheld report and staff have not decided it. */
		appealed?: boolean;
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { relativeDay } from '#lib/utils/format.js';

	let { rows, subjectLabel }: { rows: TriageRow[]; subjectLabel: string } = $props();
</script>

<!--
	A table: the reason or note is short and the queue has no row actions, so it
	passes none of the four card tests (ui-patterns.md, "A table, unless the row
	earns a card").
-->
<Table>
	{#snippet head()}
		<th class="w-px"><span class="sr-only">{m.ui_triage_status_label()}</span></th>
		<th class="col-support">{m.ui_triage_type_label()}</th>
		<th>{subjectLabel}</th>
		<th class="cell-primary">{m.ui_triage_reason_label()}</th>
		<th class="col-support">{m.ui_triage_reported_by_label()}</th>
		<th class="col-support">{m.ui_triage_when_label()}</th>
	{/snippet}
	{#each rows as r (r.id)}
		<tr class="hover cursor-pointer" use:rowLink={r.href}>
			<td class="w-px"><StatusBadge status={r.status} label /></td>
			<td class="col-support whitespace-nowrap">{r.kind}</td>
			<td class="whitespace-nowrap">
				{#if typeof r.subject === 'string'}{r.subject}{:else}<EntityIdentity ref={r.subject} />{/if}
			</td>
			<td class="cell-primary truncate">
				{#if r.appealed}
					<Badge variant="warning" size="sm" class="mr-1">{m.ui_triage_appealed_label()}</Badge>
				{/if}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `href` is typed ResolvedPathname; the caller resolved it -->
				<a class="link-hover" href={r.href}>{r.text}</a>
			</td>
			<td class="col-support cell-text truncate">{r.reporter}</td>
			<td class="col-support whitespace-nowrap">{relativeDay(r.createdAt)}</td>
		</tr>
	{/each}
</Table>
