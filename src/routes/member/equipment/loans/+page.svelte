<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatDate, formatCents } from '$lib/utils/format';
	import { CancelLoanAction } from '$lib/components/actions';
	import Button from '$lib/components/ui/Button.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import { getMemberEquipmentLoans } from '$lib/remote/inventory.remote';

	let pastPage = $state(1);
	// The active set comes back whole; history pages, because history is the
	// half that grows (#1039).
	let data = $derived(await getMemberEquipmentLoans({ pastPage }));

	let activeTab = $state<'active' | 'past'>('active');
</script>

<PageHeader title={m.member_equipment_loans_title()}>
	<Button href="/member/equipment" variant="ghost" size="sm"
		>{m.member_equipment_loans_browse_catalog()}</Button
	>
</PageHeader>
<PageContent>
	<TabBar
		tabs={[
			// Not "Active": the set includes loans still `requested`, which staff
			// have not approved yet (#896).
			{ key: 'active', label: m.member_equipment_loans_current(), badge: data.active.length },
			// The real total, not the length of the page in hand — the badge used to
			// read 50 forever.
			{ key: 'past', label: m.member_equipment_loans_past(), badge: data.past.pagination.total }
		]}
		active={activeTab}
		onchange={(key) => (activeTab = key as 'active' | 'past')}
	/>

	<!--
		Tables, not cards: two facts and one conditional action on a past loan,
		and on an active one seven facts at a single type weight in a left-pinned
		column — where the due date, the only one with a deadline, read exactly
		like the rate. Each label was also encoded three times (icon, hidden
		word, tooltip); as column headers that apparatus goes (#1042).
	-->
	{#if activeTab === 'active'}
		{#if data.active.length === 0}
			<EmptyState
				message={m.member_equipment_loans_message()}
				actionLabel={m.member_equipment_loans_action_label()}
				actionHref="/member/equipment"
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.member_status()}</span></th>
					<th class="cell-primary">{m.member_item()}</th>
					<th class="col-support whitespace-nowrap">{m.member_equipment_loans_pickup()}</th>
					<th class="whitespace-nowrap">{m.member_due()}</th>
					<th class="col-extra cell-num whitespace-nowrap">{m.member_equipment_loans_cost()}</th>
					<th class="w-px"><span class="sr-only">{m.member_actions()}</span></th>
				{/snippet}

				{#each data.active as loan (loan.id)}
					<tr class="hover">
						<td class="w-px whitespace-nowrap"><StatusBadge status={loan.status} label /></td>
						<td class="cell-primary">
							<!-- `loan.ref`, not a second fallback written by hand: `listLoans`
							     already computes the title and said "(free-form request)"
							     where this said "Free-form Request" (#1035). -->
							<span class="font-medium">{loan.ref.title}</span>
							{#if loan.quantity > 1}
								<span class="text-subtle">&times;{loan.quantity}</span>
							{/if}
							{#if loan.memberNotes}
								<div class="truncate text-subtle">{loan.memberNotes}</div>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{formatDate(loan.scheduledPickupDate ?? loan.requestedPickupDate)}
							{#if !loan.scheduledPickupDate}
								<div class="text-subtle">{m.member_equipment_loans_requested()}</div>
							{/if}
						</td>
						<!-- The one fact with a deadline on it, so it keeps a full column
						     rather than a tier that drops at 512px. -->
						<td class="whitespace-nowrap">
							{#if loan.dueDate}
								<span class:text-error={loan.isOverdue}>{formatDate(loan.dueDate)}</span>
								{#if loan.isOverdue}
									<Badge variant="error" size="xs">{m.member_overdue()}</Badge>
								{/if}
							{:else if loan.estimatedReturnDate}
								<span class="text-subtle">~{formatDate(loan.estimatedReturnDate)}</span>
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>
						<td class="col-extra cell-num whitespace-nowrap">
							{#if loan.estimatedCostCents != null}
								{loan.estimatedCostCents === 0 ? 'Free' : formatCents(loan.estimatedCostCents)}
							{:else if loan.dailyRateCents != null}
								{m.member_equipment_loans_day({ formatCents: formatCents(loan.dailyRateCents) })}
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>
						<td class="w-px">
							{#if loan.status === 'requested' || loan.status === 'scheduled'}
								<div class="flex w-max">
									<CancelLoanAction
										loanId={loan.id}
										label={m.member_cancel()}
										confirm="Cancel this loan request?"
									/>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{:else if data.past.rows.length === 0}
		<p class="py-8 text-center opacity-60">{m.member_equipment_loans_no_past_loans()}</p>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.member_status()}</span></th>
				<th class="cell-primary">{m.member_item()}</th>
				<th class="col-support whitespace-nowrap">{m.member_equipment_loans_returned()}</th>
				<th class="cell-num whitespace-nowrap">{m.member_equipment_loans_charged()}</th>
			{/snippet}

			{#each data.past.rows as loan (loan.id)}
				<tr class="hover">
					<td class="w-px whitespace-nowrap"><StatusBadge status={loan.status} label /></td>
					<td class="cell-primary truncate">{loan.ref.title}</td>
					<td class="col-support whitespace-nowrap">
						{loan.returnedAt ? formatDate(loan.returnedAt) : '—'}
					</td>
					<td class="cell-num whitespace-nowrap">
						{#if loan.totalChargeCents != null}
							{formatCents(loan.totalChargeCents)}
							{#if loan.creditsCents && loan.creditsCents > 0}
								<div class="text-subtle">
									{m.member_equipment_loans_credits({
										formatCents: formatCents(loan.creditsCents)
									})}
								</div>
							{/if}
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination {...data.past.pagination} onpage={(p) => (pastPage = p)} />
	{/if}
</PageContent>
