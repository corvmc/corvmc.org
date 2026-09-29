<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { formatCents } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import type { ProjectBurn } from '$lib/server/project/project-service';

	/**
	 * The show's budget against what it has spent, from its project's burn.
	 * Pass-through money is shown beneath and never counted: the acts' pool was
	 * never the collective's.
	 */
	let { projectId, burn }: { projectId: string; burn: ProjectBurn } = $props();

	const over = $derived(burn.remainingCents !== null && burn.remainingCents < 0);
	const otherCents = $derived(
		burn.cash.contractorCents + burn.cash.purchaseOrderCents + burn.cash.acquisitionCents
	);
	const state = $derived(
		burn.budgetCents === null
			? 'No budget set'
			: `${formatCents(burn.cash.totalCents)} of ${formatCents(burn.budgetCents)}`
	);
</script>

<InfoCard title="Budget" {state}>
	{#snippet action()}
		<a class="link text-sm" href={resolve(`/staff/projects/${projectId}`)}>
			{burn.budgetCents === null ? 'Set a budget' : 'Open the project'}
		</a>
	{/snippet}
	<Table>
		{#snippet head()}
			<th>Spend</th>
			<th class="cell-num">Amount</th>
		{/snippet}
		<tr>
			<td>Show expenses</td>
			<td class="cell-num">{formatCents(burn.show.expensesCents)}</td>
		</tr>
		<tr>
			<td>Guarantee top-ups</td>
			<td class="cell-num">{formatCents(burn.show.guaranteeTopUpCents)}</td>
		</tr>
		{#if otherCents > 0}
			<tr>
				<td>Orders, contractors and acquisitions</td>
				<td class="cell-num">{formatCents(otherCents)}</td>
			</tr>
		{/if}
		<tr class="font-medium">
			<td>Spent</td>
			<td class="cell-num">{formatCents(burn.cash.totalCents)}</td>
		</tr>
		<tr>
			<td>Budget</td>
			<td class="cell-num">
				{burn.budgetCents === null ? 'None set' : formatCents(burn.budgetCents)}
			</td>
		</tr>
		<tr class="font-medium">
			<td>Remaining</td>
			<td class="cell-num" class:text-error={over}>
				{burn.remainingCents === null ? '—' : formatCents(burn.remainingCents)}
			</td>
		</tr>
	</Table>
	<p class="mt-3 text-muted text-sm">
		Ticket revenue {formatCents(burn.show.ticketRevenueCents)}. Passing through to the acts, and not
		counted as spend: {formatCents(burn.show.actsPoolInCents)} in, {formatCents(
			burn.show.actPayoutsCents
		)} paid out.
	</p>
</InfoCard>
