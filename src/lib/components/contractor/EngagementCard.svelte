<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * One contractor's engagement on a work order: its money and its actions.
	 * The actions are gated on status, because two of them move an asset —
	 * booking takes a unit out of service and completing brings it back.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import {
		scheduleJobForm,
		completeJobForm,
		cancelJobForm,
		declineJobForm,
		noShowJobForm,
		recordInvoiceForm,
		reopenJobForm
	} from '#lib/remote/contractors.remote.js';
	import ReopenAction from '#lib/components/actions/ReopenAction.svelte';
	import { contractorJobStatusBadge, contractorJobStatusLabels } from '#lib/config.js';
	import { formatCents, formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import type { getStaffShiftPage } from '#lib/remote/volunteer.remote.js';

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
	const reopen = $derived(reopenJobForm.for(job.id));
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
						<Badge variant="warning" size="sm">{m.contractor_engagement_card_late()}</Badge>
					{/if}
				</CardTitle>
				<div class="flex flex-wrap gap-1">
					{#if open}
						<Action
							action={schedule}
							label={job.status === 'booked'
								? m.contractor_engagement_card_reschedule()
								: m.contractor_engagement_card_book()}
							variant="ghost"
							size="sm"
							modalTitle={job.status === 'booked'
								? m.contractor_engagement_card_reschedule()
								: m.contractor_engagement_card_book()}
							successToast={m.contractor_engagement_card_booking_saved()}
							data-testid="engagement-schedule"
						>
							{#snippet form()}
								<input {...schedule.fields.id.as('hidden', job.id)} />
								<Field
									field={schedule.fields.scheduledFor}
									type="date"
									label={m.contractor_engagement_card_when_they_come()}
								/>
								<Field
									field={schedule.fields.expectedBackAt}
									type="date"
									label={m.contractor_engagement_card_promised_back()}
								/>
								{#if job.assetId && job.status !== 'booked'}
									<p class="text-subtle text-sm">
										{m.contractor_engagement_card_takes_unit_out_service_writes()}
									</p>
								{/if}
							{/snippet}
						</Action>

						<Action
							action={complete}
							label={m.contractor_engagement_card_complete()}
							variant="ghost"
							size="sm"
							modalTitle={m.contractor_engagement_card_complete()}
							successToast={m.contractor_engagement_card_completed()}
							data-testid="engagement-complete"
						>
							{#snippet form()}
								<input {...complete.fields.id.as('hidden', job.id)} />
								{#if !job.workOrderResolvedAt && !job.workOrderCancelledAt}
									<p class="text-subtle text-sm">
										{m.contractor_engagement_card_also_marks_work_order_done()}
									</p>
								{/if}
								<Field
									field={complete.fields.completedAt}
									type="date"
									label={m.contractor_engagement_card_finished()}
								/>
								<MoneyField
									field={complete.fields.costCents}
									label={m.contractor_engagement_card_cost()}
									value={job.costCents}
								/>
								<Field
									field={complete.fields.invoiceRef}
									type="text"
									label={m.contractor_engagement_card_invoice_number()}
									value={job.invoiceRef ?? ''}
									description={m.contractor_engagement_card_number_not_document_invoices_not()}
								/>
								{#if job.assetId}
									<Field
										field={complete.fields.leaveOutOfService}
										type="checkbox"
										label={m.contractor_engagement_card_leave_unit_out_service()}
										description={m.contractor_engagement_card_tick_if_repair_did_not()}
									/>
								{/if}
								<!-- Donated work is a contributed service, kept apart from spend. -->
								<Field
									field={complete.fields.isDonated}
									type="checkbox"
									label={m.contractor_engagement_card_donated()}
									value={job.isDonated}
									description={m.contractor_engagement_card_they_did_work_did_not()}
								/>
								<MoneyField
									field={complete.fields.fairValueCents}
									label={m.contractor_engagement_card_fair_value()}
									value={job.fairValueCents}
								/>
								<Field
									field={complete.fields.fairValueBasis}
									type="text"
									label={m.contractor_engagement_card_basis_value()}
									value={job.fairValueBasis ?? ''}
									description={m.contractor_engagement_card_how_figure_was_arrived_at()}
								/>
							{/snippet}
						</Action>

						{#if job.status === 'asked'}
							<Action
								action={decline}
								label={m.contractor_engagement_card_decline()}
								variant="ghost"
								size="sm"
								modalTitle={m.contractor_engagement_card_they_declined()}
								submitLabel={m.contractor_engagement_card_mark_declined()}
								successToast={m.contractor_engagement_card_marked_declined()}
							>
								{#snippet form()}
									<input {...decline.fields.id.as('hidden', job.id)} />
									<p class="text-sm">{m.contractor_engagement_card_work_order_stays_open_next()}</p>
								{/snippet}
							</Action>
						{:else}
							<Action
								action={noShow}
								label={m.contractor_engagement_card_no_show()}
								variant="ghost"
								size="sm"
								modalTitle={m.contractor_engagement_card_they_did_not_show()}
								submitLabel={m.contractor_engagement_card_mark_no_show()}
								successToast={m.contractor_engagement_card_marked_no_show()}
							>
								{#snippet form()}
									<input {...noShow.fields.id.as('hidden', job.id)} />
									<p class="text-sm">
										{#if job.assetId}{m.contractor_engagement_card_unit_stays_out_service_still()}{/if}
										{m.contractor_engagement_card_work_order_stays_open_next()}
									</p>
								{/snippet}
							</Action>
						{/if}

						<Action
							action={cancel}
							label={m.contractor_engagement_card_cancel()}
							variant="ghost"
							size="sm"
							class="text-error"
							modalTitle={m.contractor_engagement_card_cancel_engagement()}
							submitVariant="error"
							successToast={m.contractor_engagement_card_cancelled()}
						>
							{#snippet form()}
								<input {...cancel.fields.id.as('hidden', job.id)} />
								<p class="text-sm">
									{#if job.assetId}{m.contractor_engagement_card_unit_stays_out_service_calling()}{:else}{m.contractor_engagement_card_engagement_called_off_nothing_els()}{/if}
								</p>
							{/snippet}
						</Action>
					{:else if job.status === 'completed'}
						<!-- Only finished work is billed: every other ending is left out of spend. -->
						<Action
							action={invoice}
							label={m.contractor_engagement_card_invoice()}
							variant="ghost"
							size="sm"
							modalTitle={m.contractor_engagement_card_record_invoice()}
							successToast={m.contractor_engagement_card_saved()}
						>
							{#snippet form()}
								<input {...invoice.fields.id.as('hidden', job.id)} />
								<MoneyField
									field={invoice.fields.costCents}
									label={m.contractor_engagement_card_cost()}
									value={job.costCents}
								/>
								<Field
									field={invoice.fields.invoiceRef}
									type="text"
									label={m.contractor_engagement_card_invoice_number()}
									value={job.invoiceRef ?? ''}
								/>
								<Field
									field={invoice.fields.paidAt}
									type="date"
									label={m.contractor_engagement_card_paid()}
								/>
							{/snippet}
						</Action>
					{/if}
					{#if !open}
						<ReopenAction action={reopen} id={job.id} capability="contractor.reopen">
							{(job.scheduledFor
								? m.contractor_engagement_card_back_booked_ledger_entries_stay
								: m.contractor_engagement_card_back_asked_ledger_entries_stay)()}
						</ReopenAction>
					{/if}
				</div>
			</div>
		{/snippet}

		<DefinitionList>
			<Fact
				label={m.contractor_engagement_card_scheduled()}
				value={job.scheduledFor ? formatDateShort(job.scheduledFor) : '—'}
			/>
			<Fact
				label={m.contractor_engagement_card_promised_back()}
				value={job.expectedBackAt ? formatDateShort(job.expectedBackAt) : '—'}
				class={isLate ? 'text-warning' : ''}
			/>
			<Fact
				label={m.contractor_engagement_card_finished()}
				value={job.completedAt ? formatDateShort(job.completedAt) : '—'}
			/>
			<Fact
				label={m.contractor_engagement_card_quoted()}
				value={job.quotedCents != null ? formatCents(job.quotedCents) : '—'}
			/>
			<Fact label={m.contractor_engagement_card_cost()}>
				<!-- Not "$0": nothing was paid and something was given. -->
				{#if job.isDonated}{m.contractor_engagement_card_donated()}{#if job.fairValueCents != null}{m.contractor_engagement_card_worth(
							{ formatCents: formatCents(job.fairValueCents) }
						)}{/if}
				{:else}
					{job.costCents != null ? formatCents(job.costCents) : '—'}
				{/if}
			</Fact>
			{#if job.isDonated && job.fairValueBasis}
				<Fact label={m.contractor_engagement_card_basis()} value={job.fairValueBasis} />
			{/if}
			<Fact label={m.contractor_engagement_card_invoice()} value={job.invoiceRef ?? '—'} />
			<Fact
				label={m.contractor_engagement_card_paid()}
				value={job.paidAt ? formatDateShort(job.paidAt) : '—'}
			/>
			{#if job.notes}
				<Fact label={m.contractor_engagement_card_notes()} wrap>{job.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>
</div>
