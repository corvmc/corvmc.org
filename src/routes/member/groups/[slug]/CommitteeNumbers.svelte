<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import DateRangeFilter from '#lib/components/ui/DateRangeFilter.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { formatCents } from '#lib/utils/format.js';
	import { formatVolunteerHours, financialCategoryLabels } from '#lib/config.js';
	import { getCommitteeNumbers } from '#lib/remote/reports.remote.js';

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
		<StatCard
			title={m.member_groups_slug_committee_numbers_earned()}
			value={formatCents(r.money.totalsByKind.earned)}
		/>
		<StatCard
			title={m.member_groups_slug_committee_numbers_spent()}
			value={formatCents(r.money.totalsByKind.spent)}
		/>
		<StatCard
			title={m.member_groups_slug_committee_numbers_net()}
			value={formatCents(r.money.netCents)}
		/>
		<StatCard
			title={m.member_groups_slug_committee_numbers_approved_hours()}
			value={formatVolunteerHours(r.volunteering.totalMinutes)}
		/>
	</div>

	<InfoCard title={m.member_groups_slug_committee_numbers_ledger_lines()}>
		<p class="mb-3 text-subtle text-sm">
			{m.member_groups_slug_committee_numbers_entries_recorded_agains()}
		</p>
		{#if r.money.byKind.earned.length + r.money.byKind.spent.length === 0}
			<EmptyState description={m.member_groups_slug_committee_numbers_nothing_recorded_agains()} />
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.member_groups_slug_committee_numbers_line()}</th>
					<th class="text-right">{m.member_amount()}</th>
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

	<InfoCard title={m.member_groups_slug_committee_numbers_project_budgets()}>
		{#if r.projects.length === 0}
			<EmptyState description={m.member_groups_slug_committee_numbers_committee_has_no_projec()} />
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.member_project()}</th>
					<th>{m.member_status()}</th>
					<th class="text-right">{m.member_groups_slug_committee_numbers_budget()}</th>
					<th class="text-right">{m.member_groups_slug_committee_numbers_committed()}</th>
					<th class="text-right">{m.member_groups_slug_committee_numbers_remaining()}</th>
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
				{m.member_groups_slug_committee_numbers_committed_cash_each_pro()}
			</p>
		{/if}
	</InfoCard>
{:catch error}
	<Alert type="error">{m.ui_load_failed({ error: errorMessage(error) })}</Alert>
{/await}
