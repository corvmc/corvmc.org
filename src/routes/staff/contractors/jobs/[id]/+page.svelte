<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import {
		getJobDetail,
		scheduleJobForm,
		completeJobForm,
		cancelJobForm,
		recordInvoiceForm
	} from '$lib/remote/contractors.remote';
	import {
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		type ContractorJobStatus
	} from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * One job.
	 *
	 * The actions are gated on status rather than always shown, because two of
	 * them move an asset: scheduling takes a unit out of service and completing
	 * brings it back. An action that silently does nothing on a finished job is
	 * worse than an action that is not there.
	 */
	const data = $derived(await getJobDetail(page.params.id!));
	const job = $derived(data.job);

	const scheduleFields = scheduleJobForm.fields;
	const completeFields = completeJobForm.fields;
	const cancelFields = cancelJobForm.fields;
	const invoiceFields = recordInvoiceForm.fields;

	const open = $derived(job.status === 'draft' || job.status === 'scheduled');
	const contractorName = $derived(
		data.contractors.find((c) => c.id === job.contractorId)?.name ?? 'Unknown'
	);
	const isLate = $derived(
		job.status === 'scheduled' && job.expectedBackAt != null && job.expectedBackAt < new Date()
	);
</script>

<PageHeader title={job.summary} subtitle={contractorName} backHref="/staff/contractors/jobs">
	{#if open}
		<Action
			action={scheduleJobForm}
			label={job.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
			size="sm"
			modalTitle="Schedule"
			successToast="Scheduled"
		>
			{#snippet form()}
				<input {...scheduleFields.id.as('hidden', job.id)} />
				<Field field={scheduleFields.scheduledFor} type="date" label="When they come" />
				<Field field={scheduleFields.expectedBackAt} type="date" label="Promised back" />
				{#if job.assetId && job.status !== 'scheduled'}
					<p class="text-subtle text-sm">
						This takes the unit out of service and writes a repair movement against it.
					</p>
				{/if}
			{/snippet}
		</Action>

		<Action
			action={completeJobForm}
			label="Complete"
			size="sm"
			modalTitle="Complete"
			successToast="Completed"
		>
			{#snippet form()}
				<input {...completeFields.id.as('hidden', job.id)} />
				<Field field={completeFields.completedAt} type="date" label="Finished" />
				<MoneyField field={completeFields.costCents} label="Cost" value={job.costCents} />
				<Field
					field={completeFields.invoiceRef}
					type="text"
					label="Invoice number"
					value={job.invoiceRef ?? ''}
					description="The number, not the document — invoices are not uploaded."
				/>
				{#if job.assetId}
					<Field
						field={completeFields.leaveOutOfService}
						type="checkbox"
						label="Leave the unit out of service"
						description="Tick this if the repair did not take."
					/>
				{/if}
			{/snippet}
		</Action>

		<Action
			action={cancelJobForm}
			label="Cancel"
			variant="ghost"
			size="sm"
			modalTitle="Cancel this job"
			successToast="Cancelled"
		>
			{#snippet form()}
				<input {...cancelFields.id.as('hidden', job.id)} />
				<p class="text-sm">
					{#if job.assetId}
						The unit stays out of service. Calling off the contractor does not mend it — put it back
						by hand if it turned out to be fine.
					{:else}
						The job is called off. Nothing else changes.
					{/if}
				</p>
			{/snippet}
		</Action>
	{:else}
		<Action
			action={recordInvoiceForm}
			label="Invoice"
			variant="ghost"
			size="sm"
			modalTitle="Record the invoice"
			successToast="Saved"
		>
			{#snippet form()}
				<input {...invoiceFields.id.as('hidden', job.id)} />
				<MoneyField field={invoiceFields.costCents} label="Cost" value={job.costCents} />
				<Field
					field={invoiceFields.invoiceRef}
					type="text"
					label="Invoice number"
					value={job.invoiceRef ?? ''}
				/>
				<Field field={invoiceFields.paidAt} type="date" label="Paid" />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if isLate}
		<Alert type="warning">
			<span class="font-medium">Overdue</span>
			Promised back {job.expectedBackAt ? formatDateShort(job.expectedBackAt) : '—'}.
		</Alert>
	{/if}

	<InfoCard title="Job">
		<dl class="grid gap-3 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-xs">Status</dt>
				<dd>
					<Badge variant={contractorJobStatusBadge[job.status as ContractorJobStatus]} size="sm">
						{contractorJobStatusLabels[job.status as ContractorJobStatus]}
					</Badge>
				</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Contractor</dt>
				<dd>
					<a class="link" href={resolve(`/staff/contractors/${job.contractorId}`)}>
						{contractorName}
					</a>
				</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Subject</dt>
				<dd>
					{#if job.assetId}
						<a class="link" href={resolve(`/staff/inventory/assets/${job.assetId}`)}>The unit</a>
					{:else}
						Building work
					{/if}
				</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Scheduled</dt>
				<dd>{job.scheduledFor ? formatDateShort(job.scheduledFor) : '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Promised back</dt>
				<dd>{job.expectedBackAt ? formatDateShort(job.expectedBackAt) : '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Finished</dt>
				<dd>{job.completedAt ? formatDateShort(job.completedAt) : '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Quoted</dt>
				<dd>{job.quotedCents != null ? formatCents(job.quotedCents) : '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Cost</dt>
				<dd>{job.costCents != null ? formatCents(job.costCents) : '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Invoice</dt>
				<dd>{job.invoiceRef ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Paid</dt>
				<dd>{job.paidAt ? formatDateShort(job.paidAt) : '—'}</dd>
			</div>
		</dl>
		{#if job.notes}
			<p class="mt-4 text-sm">{job.notes}</p>
		{/if}
	</InfoCard>
</PageContent>
