<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import type { getProjectsPage } from '$lib/remote/projects.remote';
	import { isProjectArchived, type ProjectView } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { rowLink } from '$lib/actions/row-link';

	type ProjectRow = Awaited<ReturnType<typeof getProjectsPage>>['projects'][number];

	let { projects, view }: { projects: ProjectRow[]; view: ProjectView } = $props();

	/** One line: "May 3 – 17", "May 3 – Jun 2", "May 3 onward". */
	function dateRange(start: Date | null, end: Date | null): string {
		if (!start) return '—';
		if (!end) return `${formatDateShort(start)} onward`;
		const [sm, sd] = formatDateShort(start).split(' ');
		const [em, ed] = formatDateShort(end).split(' ');
		return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd} – ${em} ${ed}`;
	}
</script>

<!-- No actions column to end the row, so the name takes the slack (#1968). -->
<Table packed={false}>
	{#snippet head()}
		<th class="w-px"><span class="sr-only">{m.staff_projects_projects_table_progress()}</span></th>
		<th>{m.staff_project()}</th>
		<th>{m.staff_projects_projects_table_committees()}</th>
		<th>{m.staff_projects_projects_table_dates()}</th>
		<th class="cell-num">{m.staff_budget()}</th>
		<th class="cell-num">{m.staff_spent()}</th>
	{/snippet}
	{#each projects as row (row.project.id)}
		<tr class="hover" use:rowLink={resolve(`/staff/projects/${row.project.id}`)}>
			<td class="w-px">
				{#if row.progress.total === 0}
					<span class="text-fg-3" title={m.staff_no_tasks_yet()}>—</span>
				{:else}
					{@const pct = Math.round((row.progress.done / row.progress.total) * 100)}
					<div
						class="radial-progress rounded-full text-[0.5rem] shadow-[inset_0_0_0_3px_var(--color-base-300)] {pct ===
						100
							? 'text-success'
							: 'text-primary'}"
						style="--value:{pct}; --size:1.5rem; --thickness:3px"
						role="progressbar"
						aria-valuenow={pct}
						aria-label={m.staff_projects_projects_table_aria_label({
							done: row.progress.done,
							total: row.progress.total
						})}
						title={m.staff_projects_projects_table_aria_label({
							done: row.progress.done,
							total: row.progress.total
						})}
					></div>
				{/if}
			</td>
			<td class="cell-primary">
				<a class="link font-medium" href={resolve(`/staff/projects/${row.project.id}`)}>
					{row.project.name}
				</a>
				{#if view === 'all' && isProjectArchived(row.project.status)}
					<Badge size="sm" variant="ghost">{m.staff_archived()}</Badge>
				{/if}
				{#if row.burn.contributed.volunteerMinutes > 0}
					<div class="text-subtle">
						{m.staff_projects_projects_table_volunteer_hours({
							round: Math.round(row.burn.contributed.volunteerMinutes / 60)
						})}
					</div>
				{/if}
			</td>
			<td class="whitespace-nowrap" title={row.committeeNames.join(', ') || undefined}>
				{#if row.committeeNames.length === 0}
					<span class="text-muted">{m.staff_projects_projects_table_unowned()}</span>
				{:else}
					{row.committeeNames[0]}
					{#if row.committeeNames.length > 1}
						<span class="text-muted">+{row.committeeNames.length - 1}</span>
					{/if}
				{/if}
			</td>
			<td class="whitespace-nowrap">{dateRange(row.project.startsAt, row.project.endsAt)}</td>
			<td class="cell-num">
				{row.project.budgetCents === null
					? m.staff_none_set()
					: formatCents(row.project.budgetCents)}
			</td>
			<td class="cell-num">
				<span
					class={row.burn.remainingCents !== null && row.burn.remainingCents < 0
						? 'font-medium text-error'
						: ''}
				>
					{formatCents(row.burn.cash.totalCents)}
				</span>
			</td>
		</tr>
	{/each}
</Table>
