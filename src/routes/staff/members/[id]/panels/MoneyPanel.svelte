<script lang="ts">
	import {
		getUserMembership,
		getUserCredits,
		getUserCreditHistory,
		getUserPayments,
		getUserPage
	} from '$lib/remote/users.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import CopyableId from '$lib/components/ui/CopyableId.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { AdjustCreditsAction } from '$lib/components/actions';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { creditsToHours, creditCompCeiling, hasCapability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import {
		formatCents,
		formatDateTimeShort,
		formatDateShortYear,
		titleCase
	} from '$lib/utils/format';
	import { ActivityFeedCard, feedItemRow } from '$lib/components/ui/ActivityFeed';

	let { id }: { id: string } = $props();

	function refreshCredits() {
		void getUserCredits(id).refresh();
		void getUserCreditHistory({ userId: id }).refresh();
		void getUserPage(id).refresh();
	}

	// The staff layout has already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canAdjust = $derived(hasCapability(caps, 'credit.adjust'));
	const canComp = $derived(hasCapability(caps, 'credit.comp'));
	const compHint = `Up to ${creditsToHours(creditCompCeiling.free_hours)} hrs of free hours. An admin can add more.`;
</script>

<RelatedList title="Membership" result={getUserMembership(id)}>
	{#snippet children(m)}
		{#if !m.subscription}
			<EmptyState
				title="No membership subscription"
				description="This member is on the free tier. Free hours only arrive with a sustaining membership."
			/>
		{:else}
			{#if m.subscription.cancelAtPeriodEnd}
				<Alert type="warning" class="mb-3">
					Set to cancel on {formatDateShortYear(m.subscription.currentPeriodEnd)}. Free hours stop
					allocating after that.
				</Alert>
			{/if}
			<DefinitionList>
				<Fact label="Status"><Badge variant="success" size="sm">Sustaining</Badge></Fact>

				<Fact label="Allocation">{creditsToHours(m.allocated)} hrs a month</Fact>

				<Fact label="Used this period">{creditsToHours(m.used)} hrs</Fact>

				<Fact label="Renews">{formatDateShortYear(m.subscription.currentPeriodEnd)}</Fact>

				<Fact label="Covering fees">{m.coveringFees ? 'Yes' : 'No'}</Fact>

				<Fact label="Subscription"><CopyableId value={m.subscription.id} /></Fact>
			</DefinitionList>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title="Credits" result={getUserCredits(id)}>
	{#snippet children(credits)}
		<div class="mb-3 flex gap-6">
			<div>
				<p class="text-2xl font-medium">{creditsToHours(credits.free_hours ?? 0)}</p>
				<p class="text-muted">Free Hours</p>
			</div>
			<div>
				<p class="text-2xl font-medium">{credits.equipment_credits ?? 0}</p>
				<p class="text-muted">Equipment Credits</p>
			</div>
		</div>
		{#if canAdjust || canComp}
			<AdjustCreditsAction
				userId={id}
				onsuccess={refreshCredits}
				amountHint={canAdjust ? undefined : compHint}
			/>
		{/if}
	{/snippet}
</RelatedList>

<!--
	The ledger. A balance with no history was the standing complaint: "where did
	my free hours go?" is a database question until the transactions are on the
	page next to the number they add up to.
-->
<ActivityFeedCard
	title="Credit history"
	query={(limit) => getUserCreditHistory(limit ? { userId: id, limit } : { userId: id })}
	toRow={(t) => ({
		...feedItemRow(t),
		context: { label: titleCase(t.source) },
		credit: t
	})}
	empty={{
		title: 'No credit activity',
		description: 'Nothing has been allocated, spent or adjusted yet.'
	}}
>
	{#snippet trailing({ credit })}
		{@const units = (n: number) =>
			credit.creditType === 'free_hours' ? `${creditsToHours(n)} hrs` : String(n)}
		<span class="font-medium" class:text-error={credit.amount < 0}>
			{credit.amount > 0 ? '+' : ''}{units(credit.amount)}
		</span>
		<div class="text-muted text-xs">balance {units(credit.balanceAfter)}</div>
	{/snippet}
</ActivityFeedCard>

<RelatedList title="Payment records" result={getUserPayments(id)}>
	{#snippet children(payments)}
		{#if payments.length === 0}
			<!-- Rendered even when empty: without it, "no payments" and "the query
			     failed" were indistinguishable — both showed nothing at all. -->
			<EmptyState
				title="No payments yet"
				description="Payments appear here once this member pays for a reservation or membership."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Paid</th>
					<th class="cell-num">Amount</th>
					<!-- The Stripe id is diagnostic and tiers away; the link to the
					     reservation is the row's only action and must not (#1229). -->
					<th class="col-extra">Record</th>
					<th class="w-px"><span class="sr-only">Reservation</span></th>
				{/snippet}
				{#each payments as p (p.id)}
					<tr class="hover">
						<td class="w-px"><StatusBadge status={p.status} /></td>
						<!-- Method was its own column; it qualifies the payment, so it is
						     the subline. -->
						<td class="cell-primary">
							<div class="font-medium whitespace-nowrap">
								{formatDateTimeShort(new Date(p.paidAt))}
							</div>
							<div class="text-muted">{p.paymentMethod}</div>
						</td>
						<td class="cell-num font-medium">{formatCents(p.amountCents)}</td>
						<td class="col-extra">
							<CopyableId value={p.id} label="Stripe" />
						</td>
						<td class="w-px">
							{#if p.reservationId}
								<div class="flex w-max justify-end">
									<Button href="/staff/reservations/{p.reservationId}" variant="ghost" size="xs">
										View
									</Button>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
