<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import {
		getUserMembership,
		getUserCredits,
		getUserCreditHistory,
		getUserPayments,
		getUserPage
	} from '#lib/remote/users.remote.js';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import Table from '#lib/components/ui/Table.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import CopyableId from '#lib/components/ui/CopyableId.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { AdjustCreditsAction } from '#lib/components/actions/index.js';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { creditsToHours, creditCompCeiling, hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import {
		formatCents,
		formatDateTimeShort,
		formatDateShortYear,
		titleCase
	} from '#lib/utils/format.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';

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
	const compHint = msg.staff_members_id_panels_money_panel_comp_hint_body({
		creditsToHours: creditsToHours(creditCompCeiling.free_hours)
	});
</script>

<RelatedList title={msg.staff_membership_title()} result={getUserMembership(id)}>
	{#snippet children(m)}
		{#if !m.subscription}
			<EmptyState
				title={msg.staff_members_id_panels_money_panel_no_membership_subscripti_title()}
				description={msg.staff_members_id_panels_money_panel_member_free_tier_free_ho_body()}
			/>
		{:else}
			{#if m.subscription.cancelAtPeriodEnd}
				<Alert type="warning" class="mb-3">
					{msg.staff_members_id_panels_money_panel_set_cancel_free_hours_st_body({
						formatDateShortYear: formatDateShortYear(m.subscription.currentPeriodEnd)
					})}
				</Alert>
			{/if}
			<DefinitionList>
				<Fact label={msg.staff_status_label()}
					><Badge variant="success" size="sm">{msg.staff_sustaining_label()}</Badge></Fact
				>

				<Fact label={msg.staff_members_id_panels_money_panel_allocation_label()}
					>{msg.staff_members_id_panels_money_panel_hrs_month_text({
						creditsToHours: creditsToHours(m.allocated)
					})}</Fact
				>

				<Fact label={msg.staff_members_id_panels_money_panel_used_period_label()}
					>{msg.staff_members_id_panels_money_panel_hrs_text({
						creditsToHours: creditsToHours(m.used)
					})}</Fact
				>

				<Fact label={msg.staff_members_id_panels_money_panel_renews_label()}
					>{formatDateShortYear(m.subscription.currentPeriodEnd)}</Fact
				>

				<Fact label={msg.staff_members_id_panels_money_panel_covering_fees_label()}
					>{m.coveringFees
						? msg.staff_yes_text()
						: msg.staff_members_id_panels_money_panel_no_text()}</Fact
				>

				<Fact label={msg.staff_members_id_panels_money_panel_subscription_label()}
					><CopyableId value={m.subscription.id} /></Fact
				>
			</DefinitionList>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={msg.staff_members_id_panels_money_panel_credits_title()}
	result={getUserCredits(id)}
>
	{#snippet children(credits)}
		<div class="mb-3 flex gap-6">
			<div>
				<p class="text-2xl font-medium">{creditsToHours(credits.free_hours ?? 0)}</p>
				<p class="text-muted">{msg.staff_members_id_panels_money_panel_free_hours_text()}</p>
			</div>
			<div>
				<p class="text-2xl font-medium">{credits.equipment_credits ?? 0}</p>
				<p class="text-muted">{msg.staff_members_id_panels_money_panel_equipment_credits_text()}</p>
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
	title={msg.staff_members_id_panels_money_panel_credit_history_title()}
	query={(limit) => getUserCreditHistory(limit ? { userId: id, limit } : { userId: id })}
	toRow={(t) => ({
		...feedItemRow(t),
		context: { label: titleCase(t.source) },
		credit: t
	})}
	empty={{
		title: msg.staff_members_id_panels_money_panel_no_credit_activity_title(),
		description: msg.staff_members_id_panels_money_panel_nothing_has_been_allocat_body()
	}}
>
	{#snippet trailing({ credit })}
		{@const units = (n: number) =>
			credit.creditType === 'free_hours' ? `${creditsToHours(n)} hrs` : String(n)}
		<span class="font-medium" class:text-error={credit.amount < 0}>
			{credit.amount > 0 ? '+' : ''}{units(credit.amount)}
		</span>
		<div class="text-muted text-xs">
			{msg.staff_members_id_panels_money_panel_balance_text({ units: units(credit.balanceAfter) })}
		</div>
	{/snippet}
</ActivityFeedCard>

<RelatedList
	title={msg.staff_members_id_panels_money_panel_payment_records_title()}
	result={getUserPayments(id)}
>
	{#snippet children(payments)}
		{#if payments.length === 0}
			<!-- Rendered even when empty: without it, "no payments" and "the query
			     failed" were indistinguishable — both showed nothing at all. -->
			<EmptyState
				title={msg.staff_members_id_panels_money_panel_no_payments_yet_title()}
				description={msg.staff_members_id_panels_money_panel_payments_appear_here_onc_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{msg.staff_status_label()}</span></th>
					<th>{msg.staff_paid_label()}</th>
					<th class="cell-num">{msg.staff_amount_label()}</th>
					<!-- The Stripe id is diagnostic and tiers away; the link to the
					     reservation is the row's only action and must not (#1229). -->
					<th class="col-extra">{msg.staff_record_label()}</th>
					<th class="w-px"
						><span class="sr-only"
							>{msg.staff_members_id_panels_money_panel_reservation_label()}</span
						></th
					>
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
							<CopyableId
								value={p.id}
								label={msg.staff_members_id_panels_money_panel_stripe_label()}
							/>
						</td>
						<td class="w-px">
							{#if p.reservationId}
								<div class="flex w-max justify-end">
									<Button href="/staff/reservations/{p.reservationId}" variant="ghost" size="xs">
										{msg.staff_members_id_panels_money_panel_view_label()}
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
