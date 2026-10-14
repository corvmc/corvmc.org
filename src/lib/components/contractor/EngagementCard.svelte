<script lang="ts">
	/**
	 * One contractor's engagement on a work order: its money and its actions.
	 * The actions are gated on status, because two of them move an asset —
	 * booking takes a unit out of service and completing brings it back.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import {
		scheduleJobForm,
		completeJobForm,
		cancelJobForm,
		declineJobForm,
		noShowJobForm,
		recordInvoiceForm
	} from '$lib/remote/contractors.remote';
	import { contractorJobStatusBadge, contractorJobStatusLabels } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import type { getStaffShiftPage } from '$lib/remote/volunteer.remote';

	type Row = Awaited<ReturnType<typeof getStaffShiftPage>>['engagements'][number];
	let { row }: { row: Row } = $props();

	const job = $derived(row.job);
	const open = $derived(job.status === 'asked' || job.status === 'booked');
	const isLate = $derived(
		job.status === 'booked' && job.expectedBackAt != null && job.expectedBackAt < new Date()
	);
	const schedule = $derived(scheduleJobForm.for(job.id));
	const complete = $derived(completeJobForm.for(job.id));
	const cancel = $derived(cancelJobForm.for(job.id));
	const decline = $derived(declineJobForm.for(job.id));
	const noShow = $derived(noShowJobForm.for(job.id));
	const invoice = $derived(recordInvoiceForm.for(job.id));
</script>

<div id="engagement-{job.id}" class="scroll-mt-24">
	<InfoCard title={row.contractor.name}>
		{#snippet header()}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>
					<a class="link" href={resolve(`/staff/contractors/${row.contractor.id}`)}>
						{row.contractor.name}
					</a>
					<Badge variant={contractorJobStatusBadge[job.status]} size="sm" class="ml-1">
						{contractorJobStatusLabels[job.status]}
					</Badge>
					{#if isLate}
						<Badge variant="warning" size="sm">late</Badge>
					{/if}
				</CardTitle>
				<div class="flex flex-wrap gap-1">
					{#if open}
						<Action
							action={schedule}
							label={job.status === 'booked' ? 'Reschedule' : 'Book'}
							variant="ghost"
							size="sm"
							modalTitle={job.status === 'booked' ? 'Reschedule' : 'Book'}
							successToast="Booking saved"
						>
							{#snippet form()}
								<input {...schedule.fields.id.as('hidden', job.id)} />
								<Field field={schedule.fields.scheduledFor} type="date" label="When they come" />
								<Field field={schedule.fields.expectedBackAt} type="date" label="Promised back" />
								{#if job.assetId && job.status !== 'booked'}
									<p class="text-subtle text-sm">
										This takes the unit out of service and writes a repair movement against it.
									</p>
								{/if}
							{/snippet}
						</Action>

						<Action
							action={complete}
							label="Complete"
							variant="ghost"
							size="sm"
							modalTitle="Complete"
							successToast="Completed"
						>
							{#snippet form()}
								<input {...complete.fields.id.as('hidden', job.id)} />
								{#if !job.workOrderResolvedAt && !job.workOrderCancelledAt}
									<p class="text-subtle text-sm">This also marks the work order done.</p>
								{/if}
								<Field field={complete.fields.completedAt} type="date" label="Finished" />
								<MoneyField field={complete.fields.costCents} label="Cost" value={job.costCents} />
								<Field
									field={complete.fields.invoiceRef}
									type="text"
									label="Invoice number"
									value={job.invoiceRef ?? ''}
									description="The number, not the document — invoices are not uploaded."
								/>
								{#if job.assetId}
									<Field
										field={complete.fields.leaveOutOfService}
										type="checkbox"
										label="Leave the unit out of service"
										description="Tick this if the repair did not take."
									/>
								{/if}
								<!-- Donated work is a contributed service, kept apart from spend. -->
								<Field
									field={complete.fields.isDonated}
									type="checkbox"
									label="Donated"
									value={job.isDonated}
									description="They did the work and did not invoice for it. Leave Cost blank."
								/>
								<MoneyField
									field={complete.fields.fairValueCents}
									label="Fair value"
									value={job.fairValueCents}
								/>
								<Field
									field={complete.fields.fairValueBasis}
									type="text"
									label="Basis for that value"
									value={job.fairValueBasis ?? ''}
									description="How the figure was arrived at — their rate card, a quote from another shop. Only used when Donated is ticked."
								/>
							{/snippet}
						</Action>

						{#if job.status === 'asked'}
							<Action
								action={decline}
								label="Decline"
								variant="ghost"
								size="sm"
								modalTitle="They declined"
								submitLabel="Mark declined"
								successToast="Marked declined"
							>
								{#snippet form()}
									<input {...decline.fields.id.as('hidden', job.id)} />
									<p class="text-sm">The work order stays open for the next engagement.</p>
								{/snippet}
							</Action>
						{:else}
							<Action
								action={noShow}
								label="No-show"
								variant="ghost"
								size="sm"
								modalTitle="They did not show"
								submitLabel="Mark no-show"
								successToast="Marked no-show"
							>
								{#snippet form()}
									<input {...noShow.fields.id.as('hidden', job.id)} />
									<p class="text-sm">
										{#if job.assetId}
											The unit stays out of service — it is still broken.
										{/if}
										The work order stays open for the next engagement.
									</p>
								{/snippet}
							</Action>
						{/if}

						<Action
							action={cancel}
							label="Cancel"
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle="Cancel this engagement"
							submitVariant="error"
							successToast="Cancelled"
						>
							{#snippet form()}
								<input {...cancel.fields.id.as('hidden', job.id)} />
								<p class="text-sm">
									{#if job.assetId}
										The unit stays out of service. Calling off the contractor does not mend it — put
										it back by hand if it turned out to be fine.
									{:else}
										The engagement is called off. Nothing else changes.
									{/if}
								</p>
							{/snippet}
						</Action>
					{:else if job.status === 'completed'}
						<!-- Only finished work is billed: every other ending is left out of spend. -->
						<Action
							action={invoice}
							label="Invoice"
							variant="ghost"
							size="sm"
							modalTitle="Record the invoice"
							successToast="Saved"
						>
							{#snippet form()}
								<input {...invoice.fields.id.as('hidden', job.id)} />
								<MoneyField field={invoice.fields.costCents} label="Cost" value={job.costCents} />
								<Field
									field={invoice.fields.invoiceRef}
									type="text"
									label="Invoice number"
									value={job.invoiceRef ?? ''}
								/>
								<Field field={invoice.fields.paidAt} type="date" label="Paid" />
							{/snippet}
						</Action>
					{/if}
				</div>
			</div>
		{/snippet}

		<DefinitionList>
			<Fact label="Scheduled" value={job.scheduledFor ? formatDateShort(job.scheduledFor) : '—'} />
			<Fact
				label="Promised back"
				value={job.expectedBackAt ? formatDateShort(job.expectedBackAt) : '—'}
				class={isLate ? 'text-warning' : ''}
			/>
			<Fact label="Finished" value={job.completedAt ? formatDateShort(job.completedAt) : '—'} />
			<Fact label="Quoted" value={job.quotedCents != null ? formatCents(job.quotedCents) : '—'} />
			<Fact label="Cost">
				<!-- Not "$0": nothing was paid and something was given. -->
				{#if job.isDonated}
					Donated{#if job.fairValueCents != null}
						· worth {formatCents(job.fairValueCents)}{/if}
				{:else}
					{job.costCents != null ? formatCents(job.costCents) : '—'}
				{/if}
			</Fact>
			{#if job.isDonated && job.fairValueBasis}
				<Fact label="Basis" value={job.fairValueBasis} />
			{/if}
			<Fact label="Invoice" value={job.invoiceRef ?? '—'} />
			<Fact label="Paid" value={job.paidAt ? formatDateShort(job.paidAt) : '—'} />
			{#if job.notes}
				<Fact label="Notes" wrap>{job.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>
</div>
