<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

<InfoCard title={m.staff_budget()} {state}>
	{#snippet action()}
		<a class="link text-sm" href={resolve(`/staff/projects/${projectId}`)}>
			{burn.budgetCents === null ? 'Set a budget' : 'Open the project'}
		</a>
	{/snippet}
	<Table>
		{#snippet head()}
			<th>{m.staff_spend()}</th>
			<th class="cell-num">{m.staff_amount()}</th>
		{/snippet}
		<tr>
			<td>{m.staff_events_id_production_show_budget_card_show_expenses()}</td>
			<td class="cell-num">{formatCents(burn.show.expensesCents)}</td>
		</tr>
		<tr>
			<td>{m.staff_events_id_production_show_budget_card_guarantee_top_up()}</td>
			<td class="cell-num">{formatCents(burn.show.guaranteeTopUpCents)}</td>
		</tr>
		{#if otherCents > 0}
			<tr>
				<td>{m.staff_events_id_production_show_budget_card_orders_contracto()}</td>
				<td class="cell-num">{formatCents(otherCents)}</td>
			</tr>
		{/if}
		<tr class="font-medium">
			<td>{m.staff_spent()}</td>
			<td class="cell-num">{formatCents(burn.cash.totalCents)}</td>
		</tr>
		<tr>
			<td>{m.staff_budget()}</td>
			<td class="cell-num">
				{burn.budgetCents === null ? 'None set' : formatCents(burn.budgetCents)}
			</td>
		</tr>
		<tr class="font-medium">
			<td>{m.staff_remaining()}</td>
			<td class="cell-num" class:text-error={over}>
				{burn.remainingCents === null ? '—' : formatCents(burn.remainingCents)}
			</td>
		</tr>
	</Table>
	<p class="mt-3 text-muted text-sm">
		{m.staff_events_id_production_show_budget_card_ticket_revenue_p({
			formatCents: formatCents(burn.show.ticketRevenueCents),
			formatCents2: formatCents(burn.show.actsPoolInCents),
			formatCents3: formatCents(burn.show.actPayoutsCents)
		})}
	</p>
</InfoCard>
