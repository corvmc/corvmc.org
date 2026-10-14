<script lang="ts">
	import { workOrderHref } from '$lib/utils/work-order-href';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { getJobsPage, createJobForm } from '$lib/remote/contractors.remote';
	import {
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		contractorJobViews,
		contractorJobViewLabels,
		type ContractorJobStatus,
		type ContractorJobView
	} from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { withQuery } from '$lib/utils/with-query';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	/**
	 * Every contractor engagement, across every work order, one filter at a
	 * time. Late and Awaiting invoice are derived on the server, so a row's Late
	 * badge and the Late tab are the same predicate.
	 */
	const parseView = (raw: string | null): ContractorJobView =>
		contractorJobViews.includes(raw as never) ? (raw as ContractorJobView) : 'open';
	let view = $state<ContractorJobView>(parseView(page.url.searchParams.get('view')));

	// Mirrors the filter into the URL; local state stays the source of truth.
	$effect(() => {
		const href = withQuery(
			resolve('/staff/contractors/jobs'),
			view === 'open' ? '' : `view=${view}`
		);
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	const { fields } = createJobForm;
	const now = new Date();

	const data = $derived(await getJobsPage({ view }));
	const contractorOptions = $derived(data.contractors.map((c) => ({ value: c.id, label: c.name })));

	const isLate = (job: { status: string; expectedBackAt: Date | null }) =>
		job.status === 'booked' && job.expectedBackAt != null && job.expectedBackAt < now;

	const emptyCopy: Record<ContractorJobView, string> = {
		open: 'Nobody is asked or booked. Open a job when something needs a professional — a repair that goes out to a tech, or work on the building itself.',
		late: 'Every booked job is inside the date it was promised back.',
		'awaiting-invoice': 'Every finished job has its cost recorded, or was donated.',
		all: 'Open one when something needs a professional — a repair that goes out to a tech, or work on the building itself.'
	};
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
				field={fields.title}
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
	<TabBar
		tabs={contractorJobViews.map((key) => ({
			key,
			label: contractorJobViewLabels[key],
			badge: data.counts[key]
		}))}
		active={view}
		onchange={(key) => (view = key as ContractorJobView)}
	/>

	{#if data.jobs.length === 0}
		<EmptyState title="No jobs" description={emptyCopy[view]} />
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
						<a
							class="link font-medium"
							href="{resolve(
								workOrderHref({ id: row.job.workOrderId, projectId: row.job.projectId })
							)}#engagement-{row.job.id}"
						>
							{row.job.title}
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
						{#if isLate(row.job) && row.job.expectedBackAt}
							<div class="text-subtle">
								promised back {formatDateShort(row.job.expectedBackAt)}
							</div>
						{/if}
					</td>
					<td class="cell-num">
						{#if row.job.isDonated}
							Donated{#if row.job.fairValueCents != null}
								· worth {formatCents(row.job.fairValueCents)}{/if}
						{:else if row.job.costCents != null}
							{formatCents(row.job.costCents)}
						{:else if row.job.status === 'completed'}
							<span class="text-warning">Awaiting invoice</span>
						{:else}
							—
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={data.jobs.length} unit="jobs" />
	{/if}
</PageContent>
