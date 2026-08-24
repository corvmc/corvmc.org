<script lang="ts">
	import {
		getUserMembership,
		getUserCredits,
		getUserCreditHistory,
		getUserPayments,
		getUserOverview
	} from '$lib/remote/users.remote';
	import { RelatedList } from '$lib/components/shared/entity';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import CopyableId from '$lib/components/shared/CopyableId.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import { AdjustCreditsAction } from '$lib/components/shared/actions';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { creditsToHours } from '$lib/config';
	import { formatCents, formatDateTimeShort, formatDateShortYear } from '$lib/utils/format';

	let { id }: { id: string } = $props();

	// The ledger pages in place. `page` is local state rather than a URL param:
	// the URL already carries the tab, and paging a card inside a tab is not a
	// destination anybody links to.
	let creditPage = $state(1);

	function refreshCredits() {
		void getUserCredits(id).refresh();
		void getUserCreditHistory({ userId: id, page: creditPage }).refresh();
		void getUserOverview(id).refresh();
	}
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
		<AdjustCreditsAction userId={id} onsuccess={refreshCredits} />
	{/snippet}
</RelatedList>

<!--
	The ledger. A balance with no history was the standing complaint: "where did
	my free hours go?" is a database question until the transactions are on the
	page next to the number they add up to.
-->
<InfoCard title="Credit history">
	<DataList
		result={getUserCreditHistory({ userId: id, page: creditPage })}
		emptyTitle="No credit activity"
		empty="Nothing has been allocated, spent or adjusted yet."
		onpage={(p) => (creditPage = p)}
	>
		{#snippet children(rows)}
			<Table>
				{#snippet head()}
					<th>When</th>
					<th class="col-support">Reason</th>
					<th class="cell-num">Change</th>
					<th class="col-extra cell-num">Balance</th>
				{/snippet}
				{#each rows as t (t.id)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="font-medium whitespace-nowrap">
								{formatDateTimeShort(new Date(t.createdAt))}
							</div>
							<div class="text-muted">{t.description}</div>
						</td>
						<td class="col-support">{t.source.replace(/_/g, ' ')}</td>
						<td class="cell-num font-medium" class:text-error={t.amount < 0}>
							{t.amount > 0 ? '+' : ''}{t.creditType === 'free_hours'
								? `${creditsToHours(t.amount)} hrs`
								: t.amount}
						</td>
						<td class="col-extra cell-num opacity-60">
							{t.creditType === 'free_hours'
								? `${creditsToHours(t.balanceAfter)} hrs`
								: t.balanceAfter}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</InfoCard>

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
					<th class="col-extra">Record</th>
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
							<div class="flex items-center gap-2">
								<CopyableId value={p.id} label="Stripe" />
								{#if p.reservationId}
									<Button href="/staff/reservations/{p.reservationId}" variant="ghost" size="xs">
										View
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
