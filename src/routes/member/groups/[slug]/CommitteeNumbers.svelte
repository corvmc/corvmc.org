<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DateRangeFilter from '$lib/components/ui/DateRangeFilter.svelte';
	import { formatCents } from '$lib/utils/format';
	import { formatVolunteerHours, financialCategoryLabels } from '$lib/config';
	import { getCommitteeNumbers } from '$lib/remote/reports.remote';

	/**
	 * The committee's cut of `/staff/reports`: its projects' budget and cash
	 * burn, the ledger lines tagged to those projects, and hours logged to the
	 * committee. Its own query because only this tab needs it.
	 */
	let { groupId }: { groupId: string } = $props();

	const yearStart = `${new Date().getFullYear()}-01-01`;
	let fromDate = $state(yearStart);
	let toDate = $state('');

	const report = $derived(
		getCommitteeNumbers({ groupId, from: fromDate || undefined, to: toDate || undefined })
	);
</script>

<DateRangeFilter bind:from={fromDate} bind:to={toDate} defaultFrom={yearStart} />

{#await report then r}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard title="Earned" value={formatCents(r.money.totalsByKind.earned)} />
		<StatCard title="Spent" value={formatCents(r.money.totalsByKind.spent)} />
		<StatCard title="Net" value={formatCents(r.money.netCents)} />
		<StatCard title="Approved hours" value={formatVolunteerHours(r.volunteering.totalMinutes)} />
	</div>

	<InfoCard title="Ledger lines">
		<p class="mb-3 text-subtle text-sm">
			Entries recorded against this committee's projects in the range above.
		</p>
		{#if r.money.byKind.earned.length + r.money.byKind.spent.length === 0}
			<EmptyState description="Nothing recorded against these projects in this range." />
		{:else}
			<Table>
				{#snippet head()}
					<th>Line</th>
					<th class="text-right">Amount</th>
				{/snippet}
				{#each [...r.money.byKind.earned, ...r.money.byKind.spent] as line, i (i)}
					<tr>
						<td>{financialCategoryLabels[line.category]}</td>
						<td class="text-right tabular-nums">{formatCents(line.totalCents)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title="Project budgets">
		{#if r.projects.length === 0}
			<EmptyState description="This committee has no projects yet." />
		{:else}
			<Table>
				{#snippet head()}
					<th>Project</th>
					<th>Status</th>
					<th class="text-right">Budget</th>
					<th class="text-right">Committed</th>
					<th class="text-right">Remaining</th>
				{/snippet}
				{#each r.projects as project (project.id)}
					<tr>
						<td class="cell-primary">{project.name}</td>
						<td><StatusBadge status={project.status} label /></td>
						<td class="text-right tabular-nums">
							{project.budgetCents === null ? '—' : formatCents(project.budgetCents)}
						</td>
						<td class="text-right tabular-nums">{formatCents(project.spentCents)}</td>
						<td class="text-right tabular-nums">
							{project.remainingCents === null ? '—' : formatCents(project.remainingCents)}
						</td>
					</tr>
				{/each}
			</Table>
			<p class="mt-3 text-subtle text-sm">
				Committed is cash each project has taken over its whole life, whatever the range above:
				contractors, orders and purchases. Volunteer time and donated goods are not set against a
				budget.
			</p>
		{/if}
	</InfoCard>
{/await}
