<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { getJobsPage, createJobForm } from '$lib/remote/contractors.remote';
	import {
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		type ContractorJobStatus
	} from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	/**
	 * The work queue.
	 *
	 * Overdue is called out above the table rather than sorted to the top of it,
	 * for the reason the table cannot express: late is derived — `scheduled` with
	 * a date behind us — so there is no column to sort by that stays true without
	 * something maintaining it.
	 */
	const data = $derived(await getJobsPage());
	const { fields } = createJobForm;

	const contractorOptions = $derived(data.contractors.map((c) => ({ value: c.id, label: c.name })));
	const now = new Date();

	const isLate = (job: { status: string; expectedBackAt: Date | null }) =>
		job.status === 'scheduled' && job.expectedBackAt != null && job.expectedBackAt < now;
</script>

<PageHeader title="Contractor jobs" subtitle="Space" backHref="/staff/contractors">
	<Button href="/staff/contractors" variant="ghost" size="sm">Contractors</Button>
	<Action action={createJobForm} label="New job" modalTitle="New job" successToast="Job opened">
		{#snippet form()}
			<Field
				field={fields.contractorId}
				type="select"
				label="Contractor"
				options={contractorOptions}
			/>
			<Field
				field={fields.summary}
				type="text"
				label="What needs doing"
				description="One line — “Retube the Bassman”, “Replace the breaker panel”."
			/>
			<Field
				field={fields.assetId}
				type="text"
				label="Unit"
				description="The asset id, if this is a repair. Leave blank for building work."
			/>
			<Field field={fields.scheduledFor} type="date" label="When they come" />
			<Field field={fields.expectedBackAt} type="date" label="Promised back" />
			<MoneyField field={fields.quotedCents} label="Quoted" />
			<Field field={fields.notes} type="textarea" label="Notes" />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.overdue.length > 0}
		<Alert type="warning">
			<span class="font-medium">Overdue</span>
			{#each data.overdue as row (row.job.id)}
				<div>
					<a class="link font-medium" href={resolve(`/staff/contractors/jobs/${row.job.id}`)}>
						{row.job.summary}
					</a>
					— {row.contractor.name}, promised back
					{row.job.expectedBackAt ? formatDateShort(row.job.expectedBackAt) : '—'}
				</div>
			{/each}
		</Alert>
	{/if}

	{#if data.jobs.length === 0}
		<EmptyState
			title="No jobs"
			description="Open one when something needs a professional — a repair that goes out to a tech, or work on the building itself."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Job</th>
				<th>Contractor</th>
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
						<div class="text-subtle">
							{#if row.itemName}
								{row.itemName}{row.assetTag ? ` · ${row.assetTag}` : ''}
							{:else}
								Building work
							{/if}
						</div>
					</td>
					<td>
						<a class="link" href={resolve(`/staff/contractors/${row.contractor.id}`)}>
							{row.contractor.name}
						</a>
					</td>
					<td>
						<Badge
							variant={contractorJobStatusBadge[row.job.status as ContractorJobStatus]}
							size="sm"
						>
							{contractorJobStatusLabels[row.job.status as ContractorJobStatus]}
						</Badge>
						{#if isLate(row.job)}
							<Badge variant="error" size="sm">Late</Badge>
						{/if}
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
