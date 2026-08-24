<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { formatDate, formatCents } from '$lib/utils/format';
	import { CancelLoanAction } from '$lib/components/shared/actions';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		IconHash,
		IconCalendar,
		IconCalendarCheck,
		IconClock,
		IconCoin
	} from '@tabler/icons-svelte';
	import { getMemberEquipmentLoans } from '$lib/remote/equipment.remote';

	let data = $derived(await getMemberEquipmentLoans());

	let activeTab = $state<'active' | 'past'>('active');
</script>

<PageHeader title="My Equipment Loans">
	<Button href="/member/equipment" variant="ghost" size="sm">Browse Catalog</Button>
</PageHeader>
<PageContent>
	<!-- Tabs -->
	<div role="tablist" class="tabs-bordered tabs">
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'active'}
			onclick={() => (activeTab = 'active')}
		>
			Active ({data.active.length})
		</button>
		<button
			role="tab"
			class="tab"
			class:tab-active={activeTab === 'past'}
			onclick={() => (activeTab = 'past')}
		>
			Past ({data.past.length})
		</button>
	</div>

	<!-- Loan Cards -->
	{#if activeTab === 'active'}
		{#each data.active as loan (loan.id)}
			<div class="card border bg-base-100 shadow-sm">
				<CardBody padding="sm">
					<div class="flex items-start justify-between">
						<div>
							<h3 class="font-semibold">
								{loan.equipmentName ?? 'Free-form Request'}
							</h3>
							<div class="mt-1 flex gap-2">
								<StatusBadge status={loan.status} />
								{#if loan.isOverdue}
									<Badge variant="error">Overdue</Badge>
								{/if}
							</div>
						</div>
						{#if loan.status === 'requested' || loan.status === 'scheduled'}
							<CancelLoanAction
								loanId={loan.id}
								label="Cancel"
								confirm="Cancel this loan request?"
							/>
						{/if}
					</div>

					<dl class="mt-2 grid gap-x-4 gap-y-1 text-sm" style="grid-template-columns: auto 1fr;">
						{#if loan.quantity > 1}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Quantity">
								<IconHash size={14} /><span class="hidden sm:inline">Qty</span>
							</dt>
							<dd>{loan.quantity}</dd>
						{/if}
						<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Requested pickup">
							<IconCalendar size={14} /><span class="hidden sm:inline">Pickup</span>
						</dt>
						<dd>{formatDate(loan.requestedPickupDate)}</dd>
						{#if loan.estimatedReturnDate}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Estimated return">
								<IconCalendar size={14} /><span class="hidden sm:inline">Est. Return</span>
							</dt>
							<dd>{formatDate(loan.estimatedReturnDate)}</dd>
						{/if}
						{#if loan.estimatedCostCents != null}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Estimated cost">
								<IconCoin size={14} /><span class="hidden sm:inline">Est. Cost</span>
							</dt>
							<dd>
								{loan.estimatedCostCents === 0 ? 'Free' : formatCents(loan.estimatedCostCents)}
							</dd>
						{/if}
						{#if loan.scheduledPickupDate}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Confirmed pickup">
								<IconCalendarCheck size={14} /><span class="hidden sm:inline">Confirmed</span>
							</dt>
							<dd>{formatDate(loan.scheduledPickupDate)}</dd>
						{/if}
						{#if loan.dueDate}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Due date">
								<IconClock size={14} /><span class="hidden sm:inline">Due</span>
							</dt>
							<dd class:text-error={loan.isOverdue}>{formatDate(loan.dueDate)}</dd>
						{/if}
						{#if loan.dailyRateCents != null}
							<dt class="opacity-60 tooltip flex items-center gap-1" data-tip="Daily rate">
								<IconCoin size={14} /><span class="hidden sm:inline">Rate</span>
							</dt>
							<dd>{formatCents(loan.dailyRateCents)}/day</dd>
						{/if}
					</dl>

					{#if loan.memberNotes}
						<p class="mt-2 rounded bg-base-200 p-2 text-subtle">{loan.memberNotes}</p>
					{/if}
				</CardBody>
			</div>
		{:else}
			<p class="text-center opacity-60 py-8">No active loans.</p>
		{/each}
	{:else}
		{#each data.past as loan (loan.id)}
			<div class="card border bg-base-100 opacity-80 shadow-sm">
				<CardBody padding="sm">
					<div class="flex items-start justify-between">
						<h3 class="font-semibold">{loan.equipmentName ?? 'Free-form Request'}</h3>
						<StatusBadge status={loan.status} />
					</div>

					<dl class="mt-2 grid gap-x-4 gap-y-1 text-sm" style="grid-template-columns: auto 1fr;">
						{#if loan.returnedAt}
							<dt class="opacity-60">Returned</dt>
							<dd>{formatDate(loan.returnedAt)}</dd>
						{/if}
						{#if loan.totalChargeCents != null}
							<dt class="opacity-60">Charged</dt>
							<dd>
								{formatCents(loan.totalChargeCents)}
								{#if loan.creditsCents && loan.creditsCents > 0}
									<span class="text-subtle">({formatCents(loan.creditsCents)} credits)</span>
								{/if}
							</dd>
						{/if}
					</dl>
				</CardBody>
			</div>
		{:else}
			<p class="text-center opacity-60 py-8">No past loans.</p>
		{/each}
	{/if}
</PageContent>
