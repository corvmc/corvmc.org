<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		getLoan,
		getAvailableEquipment,
		scheduleLoanForm as schedule,
		checkoutLoanForm as checkout
	} from '$lib/remote/equipment.remote';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { CancelLoanAction, MarkReturnedAction } from '$lib/components/shared/actions';
	import Form, { Field, SubmitButton, Select } from '$lib/components/shared/Form';
	import { EntityChip } from '$lib/components/shared/entity';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { formatDate, formatCents } from '$lib/utils/format';

	const { fields: scheduleFields } = schedule;
	const { fields: checkoutFields } = checkout;

	let id = $derived(page.params.id!);
	let loan = $derived(await getLoan(id));
	let availableEquipment = $derived(await getAvailableEquipment());

	let chargePreview = $derived.by(() => {
		if (loan.status !== 'checked_out' || !loan.dailyRateCents || !loan.checkedOutAt) return null;
		const now = new Date();
		const ms = now.getTime() - new Date(loan.checkedOutAt).getTime();
		const days = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
		return { days, total: loan.dailyRateCents * days };
	});
</script>

<PageHeader
	subtitle="Equipment Loan"
	title={loan.equipmentName ?? 'Free-form Request'}
	backHref="/staff/equipment/loans"
>
	<StatusBadge status={loan.status} />
	{#if loan.isOverdue}
		<Badge variant="error" size="md">Overdue</Badge>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="grid gap-6 lg:grid-cols-2 mb-6">
		<!-- Loan Details -->
		<InfoCard title="Loan Details">
			<DefinitionList>
				<Fact label="Loan ID" mono>{loan.id}</Fact>

				<Fact label="Member">
					<EntityChip ref={loan.member} />
				</Fact>

				<Fact label="Equipment">
					{#if loan.equipmentName}
						<a href={resolve(`/staff/equipment/${loan.equipmentId}`)} class="link"
							>{loan.equipmentName}</a
						>
						{#if loan.categoryName}
							<Badge variant="outline" size="xs" class="ml-1">{loan.categoryName}</Badge>
						{/if}
					{:else}
						<span class="italic opacity-60">Not yet assigned</span>
					{/if}
				</Fact>

				<Fact label="Quantity">{loan.quantity}</Fact>

				<Fact label="Requested pickup">{formatDate(loan.requestedPickupDate)}</Fact>

				{#if loan.scheduledPickupDate}
					<Fact label="Scheduled pickup">{formatDate(loan.scheduledPickupDate)}</Fact>
				{/if}

				{#if loan.dueDate}
					<Fact label="Due date" class={loan.isOverdue ? 'text-error' : ''}
						>{formatDate(loan.dueDate)}</Fact
					>
				{/if}

				{#if loan.checkedOutAt}
					<Fact label="Checked out">{formatDate(loan.checkedOutAt)}</Fact>
				{/if}

				{#if loan.returnedAt}
					<Fact label="Returned">{formatDate(loan.returnedAt)}</Fact>
				{/if}

				{#if loan.dailyRateCents != null}
					<Fact label="Daily rate">{formatCents(loan.dailyRateCents)}/day</Fact>
				{/if}

				{#if loan.totalChargeCents != null}
					<Fact label="Total charge">{formatCents(loan.totalChargeCents)}</Fact>
				{/if}

				{#if loan.creditsCents != null && loan.creditsCents > 0}
					<Fact label="Paid via credits">{formatCents(loan.creditsCents)}</Fact>
				{/if}

				{#if loan.cashCents != null && loan.cashCents > 0}
					<Fact label="Paid via cash/card">{formatCents(loan.cashCents)}</Fact>
				{/if}
			</DefinitionList>

			{#if loan.memberNotes}
				<div class="mt-4">
					<h4 class="text-muted font-semibold mb-1">Member Notes</h4>
					<p class="text-sm bg-base-200 rounded p-2">{loan.memberNotes}</p>
				</div>
			{/if}

			{#if loan.staffNotes}
				<div class="mt-4">
					<h4 class="text-muted font-semibold mb-1">Staff Notes</h4>
					<p class="text-sm bg-base-200 rounded p-2">{loan.staffNotes}</p>
				</div>
			{/if}
		</InfoCard>

		<!-- Actions Panel -->
		<InfoCard title="Actions">
			{#if loan.status === 'requested'}
				<h4 class="text-sm font-semibold mb-3">Schedule Pickup</h4>
				<Form remote={schedule} successToast="Pickup scheduled" class="space-y-3">
					<input {...scheduleFields.loanId.as('hidden', id)} />
					{#if !loan.equipmentId}
						<Field name="equipmentId" label="Assign Equipment">
							<Select class="w-full" name="equipmentId" required>
								<option value="" disabled selected>Select equipment...</option>
								{#each availableEquipment as eq (eq.id)}
									{#if eq.availableQuantity > 0}
										<option value={eq.id}>{eq.name} ({eq.availableQuantity} available)</option>
									{/if}
								{/each}
							</Select>
						</Field>
					{:else}
						<input {...scheduleFields.equipmentId.as('hidden', loan.equipmentId)} />
					{/if}
					<Field name="scheduledPickupDate" type="date" label="Pickup Date" />
					<div class="flex gap-2">
						<SubmitButton label="Schedule" variant="primary" size="sm" />
						<CancelLoanAction
							loanId={id}
							label="Cancel Request"
							confirm="Cancel this loan request?"
						/>
					</div>
				</Form>
			{:else if loan.status === 'scheduled'}
				<h4 class="text-sm font-semibold mb-3">Mark as Checked Out</h4>
				<Form remote={checkout} successToast="Checked out" class="space-y-3">
					<input {...checkoutFields.loanId.as('hidden', id)} />
					<Field name="dueDate" type="date" label="Due Date" />
					<div class="flex gap-2">
						<SubmitButton label="Check Out" variant="primary" size="sm" />
						<CancelLoanAction loanId={id} />
					</div>
				</Form>
			{:else if loan.status === 'checked_out'}
				<h4 class="text-sm font-semibold mb-3">Mark as Returned</h4>

				{#if chargePreview}
					<div class="bg-base-200 rounded p-3 mb-3 text-sm">
						<p>
							<strong>Charge preview:</strong>
							{chargePreview.days} day{chargePreview.days !== 1 ? 's' : ''} × {formatCents(
								loan.dailyRateCents ?? 0
							)}/day = <strong>{formatCents(chargePreview.total)}</strong>
						</p>
					</div>
				{/if}

				<MarkReturnedAction
					loanId={id}
					chargeMessage={chargePreview
						? `Charge preview: ${chargePreview.days} day${chargePreview.days !== 1 ? 's' : ''} × ${formatCents(loan.dailyRateCents ?? 0)}/day = ${formatCents(chargePreview.total)}`
						: undefined}
				/>
			{:else}
				<p class="text-muted">
					This loan is <strong>{loan.status}</strong>. No actions available.
				</p>
			{/if}
		</InfoCard>
	</div>
</PageContent>
