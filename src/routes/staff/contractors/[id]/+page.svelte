<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		getContractorDetail,
		updateContractorForm,
		archiveContractorForm
	} from '$lib/remote/contractors.remote';
	import {
		contractorTradeLabels,
		contractorTrades,
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		type ContractorTrade,
		type ContractorJobStatus
	} from '$lib/config';
	import { formatCents, formatDateShort, toLocalDate } from '$lib/utils/format';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * One contractor, and everything they have ever done for us.
	 *
	 * The job history is the reason the table exists at all — "when were they
	 * last in" is unanswerable from a free-text name — so it is the body of the
	 * page rather than a panel on it.
	 */
	const data = $derived(await getContractorDetail(page.params.id!));
	const { fields } = updateContractorForm;
	const archiveFields = archiveContractorForm.fields;

	const tradeOptions = contractorTrades.map((t) => ({
		value: t,
		label: contractorTradeLabels[t]
	}));
</script>

<PageHeader
	title={data.contractor.name}
	subtitle={contractorTradeLabels[data.contractor.trade as ContractorTrade]}
	backHref="/staff/contractors"
>
	<Action
		action={updateContractorForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {data.contractor.name}"
		successToast="Saved"
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', data.contractor.id)} />
			<Field field={fields.name} type="text" label="Name" value={data.contractor.name} />
			<Field
				field={fields.trade}
				type="select"
				label="Trade"
				options={tradeOptions}
				value={data.contractor.trade}
			/>
			<Field
				field={fields.contactName}
				type="text"
				label="Contact"
				value={data.contractor.contactName ?? ''}
			/>
			<Field field={fields.phone} type="tel" label="Phone" value={data.contractor.phone ?? ''} />
			<Field field={fields.email} type="email" label="Email" value={data.contractor.email ?? ''} />
			<Field
				field={fields.licenseNumber}
				type="text"
				label="Licence number"
				value={data.contractor.licenseNumber ?? ''}
			/>
			<Field
				field={fields.insuranceExpiresAt}
				type="date"
				label="Insurance expires"
				description="Leave blank if we hold no certificate."
				value={data.contractor.insuranceExpiresAt
					? toLocalDate(data.contractor.insuranceExpiresAt)
					: ''}
			/>
			<Field
				field={fields.notes}
				type="textarea"
				label="Notes"
				value={data.contractor.notes ?? ''}
			/>
		{/snippet}
	</Action>

	<Action
		action={archiveContractorForm}
		label={data.contractor.archivedAt ? 'Bring back' : 'Archive'}
		variant="ghost"
		size="sm"
		modalTitle={data.contractor.archivedAt ? 'Bring back' : 'Archive'}
		successToast="Saved"
	>
		{#snippet form()}
			<input {...archiveFields.id.as('hidden', data.contractor.id)} />
			<!--
				A real boolean, not the string: `as('hidden', …)` is typed to the
				field. Unchecked booleans are never submitted, which is why the
				schema defaults to false — so the un-archive case works whether the
				`false` reaches the server or is filled in by the default.
			-->
			<input {...archiveFields.archived.as('hidden', !data.contractor.archivedAt)} />
			<p class="text-sm">
				{#if data.contractor.archivedAt}
					They will show in the pickers again.
				{:else}
					They stay out of the pickers and no new job can be opened against them. Their history is
					untouched.
				{/if}
			</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.contractor.archivedAt}
		<Alert type="info">
			<span class="font-medium">Archived</span>
			Archived {formatDateShort(data.contractor.archivedAt)}. The history below stays.
		</Alert>
	{/if}

	{#if data.contractor.insuranceExpiresAt && data.contractor.insuranceExpiresAt < new Date()}
		<Alert type="error">
			<span class="font-medium">Insurance expired</span>
			Their certificate ran out {formatDateShort(data.contractor.insuranceExpiresAt)}.
		</Alert>
	{/if}

	<InfoCard title="Details">
		<dl class="grid gap-3 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-xs">Contact</dt>
				<dd>{data.contractor.contactName ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Phone</dt>
				<dd>{data.contractor.phone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Email</dt>
				<dd>{data.contractor.email ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Licence</dt>
				<dd>{data.contractor.licenseNumber ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">Insurance</dt>
				<dd>
					{#if data.contractor.insuranceExpiresAt}
						{formatDateShort(data.contractor.insuranceExpiresAt)}
					{:else}
						<span class="text-subtle">Not on file</span>
					{/if}
				</dd>
			</div>
		</dl>
		{#if data.contractor.notes}
			<p class="mt-4 text-sm">{data.contractor.notes}</p>
		{/if}
	</InfoCard>

	{#if data.jobs.length === 0}
		<EmptyState title="No jobs yet" description="Nothing has been sent to them." />
	{:else}
		<Table>
			{#snippet head()}
				<th>Job</th>
				<th>Status</th>
				<th>When</th>
				<th class="cell-num">Cost</th>
			{/snippet}
			{#each data.jobs as row (row.job.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/contractors/jobs/${row.job.id}`)}>
							{row.job.summary}
						</a>
						{#if row.itemName}
							<div class="text-subtle">
								{row.itemName}{row.assetTag ? ` · ${row.assetTag}` : ''}
							</div>
						{/if}
					</td>
					<td>
						<Badge
							variant={contractorJobStatusBadge[row.job.status as ContractorJobStatus]}
							size="sm"
						>
							{contractorJobStatusLabels[row.job.status as ContractorJobStatus]}
						</Badge>
					</td>
					<td>
						{#if row.job.completedAt}
							{formatDateShort(row.job.completedAt)}
						{:else if row.job.scheduledFor}
							{formatDateShort(row.job.scheduledFor)}
						{:else}
							—
						{/if}
					</td>
					<td class="cell-num">
						{row.job.costCents != null ? formatCents(row.job.costCents) : '—'}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
