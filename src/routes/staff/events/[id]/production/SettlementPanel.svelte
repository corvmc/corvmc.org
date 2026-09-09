<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { formatCents } from '$lib/utils/format';
	import type { Settlement } from '$lib/server/production/settlement-service';

	let { settlement }: { settlement: Settlement | null } = $props();

	/** What each act was designated versus what its deal produces. */
	const acts = $derived(settlement?.acts ?? []);
	const topUpTotal = $derived(acts.reduce((t, a) => t + a.topUpCents, 0));
</script>

{#if !settlement}
	<EmptyState title="No production" description="Open one from the event page first." />
{:else}
	<Alert type="info">
		A worksheet, not a payment. Nothing here moves money — it is what the night took, what it cost,
		and what each act is owed under its own deal.
	</Alert>

	<InfoCard title="The night">
		<div class="grid gap-6 sm:grid-cols-4">
			<div>
				<p class="text-muted">Acts' pool</p>
				<p class="text-lg font-medium">{formatCents(settlement.actsPoolCents)}</p>
				<p class="text-xs text-fg-2">What buyers designated</p>
			</div>
			<div>
				<p class="text-muted">Collective</p>
				<p class="text-lg font-medium">{formatCents(settlement.collectiveRevenueCents)}</p>
			</div>
			<div>
				<p class="text-muted">Expenses</p>
				<p class="text-lg font-medium">{formatCents(settlement.expensesCents)}</p>
				{#if settlement.deductibleExpensesCents !== settlement.expensesCents}
					<p class="text-xs text-fg-2">
						{formatCents(settlement.deductibleExpensesCents)} deductible
					</p>
				{/if}
			</div>
			<div>
				<p class="text-muted">Net</p>
				<p class="text-lg font-medium" class:text-error={settlement.netCents < 0}>
					{formatCents(settlement.netCents)}
				</p>
			</div>
		</div>
	</InfoCard>

	<InfoCard title="What each act is owed">
		{#if acts.length === 0}
			<p class="text-fg-2">No acts on the running order yet.</p>
		{:else}
			<Table>
				{#snippet head()}
					<th>Act</th>
					<th class="text-right">Designated</th>
					<th>Deal</th>
					<th class="text-right">Suggested</th>
				{/snippet}
				{#each acts as act (act.slotId)}
					<tr>
						<td>{act.actName ?? 'Not on the bill'}</td>
						<td class="text-right">{formatCents(act.designatedCents)}</td>
						<td class="text-sm text-fg-2">
							{#if act.contributed}
								Donated set
							{:else}
								{#if act.guaranteeCents}{formatCents(act.guaranteeCents)}{/if}
								{#if act.guaranteeCents && act.percentageBps}
									{act.versus ? ' versus ' : ' plus '}
								{/if}
								{#if act.percentageBps}{(act.percentageBps / 100).toFixed(0)}% of the
									{act.againstNet ? 'net' : 'pool'}{/if}
							{/if}
						</td>
						<td class="text-right font-medium">{formatCents(act.suggestedPayoutCents)}</td>
					</tr>
				{/each}
			</Table>

			{#if topUpTotal > 0}
				<!-- The number a programming committee should see: what the guarantees
				     cost beyond what the door designated. Never netted away. -->
				<p class="mt-3 text-sm text-fg-2">
					{formatCents(topUpTotal)} of this is the collective topping up guarantees above what buyers
					designated.
				</p>
			{/if}
		{/if}
	</InfoCard>
{/if}
