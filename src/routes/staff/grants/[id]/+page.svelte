<script lang="ts">
	/** One grant application: what was asked, what was awarded, and what is owed back. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import GrantFields from '$lib/components/grant/GrantFields.svelte';
	import GrantReportFields from './GrantReportFields.svelte';
	import {
		getGrantDetail,
		updateGrant,
		deleteGrant,
		addGrantReport,
		updateGrantReport,
		deleteGrantReport
	} from '$lib/remote/grants.remote';
	import { grantStatusLabels, grantStatusBadge, grantDeadlineLabels } from '$lib/config';
	import { formatCents } from '$lib/utils/format';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const grant = $derived(await getGrantDetail(id));
	const editForm = $derived(updateGrant.for(id));

	const cents = (n: number | null) => (n != null ? formatCents(n) : '—');
</script>

<PageHeader width="3xl" title={grant.funderName} subtitle="Grant" backHref="/staff/grants">
	<Action
		action={editForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {grant.title}"
		submitLabel="Save"
		successToast="Saved"
	>
		{#snippet form()}
			<input type="hidden" name="id" value={grant.id} />
			<GrantFields fields={editForm.fields} funders={grant.funders} value={grant} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#if grant.deadline?.overdue}
		<Alert type="warning">
			{grantDeadlineLabels[grant.deadline.kind]}
			{formatIsoDay(grant.deadline.on)} has passed. Record it once it is dealt with.
		</Alert>
	{/if}

	<InfoCard title={grant.title}>
		<DefinitionList>
			<Fact label="Status">
				<Badge variant={grantStatusBadge[grant.status]} size="sm">
					{grantStatusLabels[grant.status]}
				</Badge>
			</Fact>
			<Fact label="Requested" value={cents(grant.amountRequestedCents)} />
			<Fact label="Awarded" value={cents(grant.amountAwardedCents)} />
			<Fact label="Apply by" value={formatIsoDay(grant.applyBy)} />
			<Fact
				label="Award period"
				value="{formatIsoDay(grant.startsOn)} – {formatIsoDay(grant.endsOn)}"
			/>
			{#if grant.notes}
				<Fact label="Notes" wrap>{grant.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title="Reports">
		{#snippet action()}
			<Action
				action={addGrantReport}
				label="Add report"
				variant="ghost"
				size="sm"
				modalTitle="New report deadline"
				submitLabel="Add"
				successToast="Report added"
			>
				{#snippet form()}
					<input type="hidden" name="grantApplicationId" value={grant.id} />
					<GrantReportFields fields={addGrantReport.fields} />
				{/snippet}
			</Action>
		{/snippet}
		{#if grant.reports.length === 0}
			<EmptyState
				title="No reports owed"
				description="Add each report the award requires, with its due date."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>Report</th>
					<th>Due</th>
					<th>Submitted</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each grant.reports as r (r.id)}
					{@const edit = updateGrantReport.for(r.id)}
					<tr>
						<td class="cell-primary font-medium">{r.title}</td>
						<td class="whitespace-nowrap" class:text-error={r.overdue}>{formatIsoDay(r.dueOn)}</td>
						<td class="whitespace-nowrap">{formatIsoDay(r.submittedOn)}</td>
						<td class="w-px whitespace-nowrap">
							<Action
								action={edit}
								label="Edit"
								variant="ghost"
								size="sm"
								modalTitle="Edit {r.title}"
								submitLabel="Save"
								successToast="Saved"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={r.id} />
									<input type="hidden" name="grantApplicationId" value={grant.id} />
									<GrantReportFields fields={edit.fields} value={r} />
								{/snippet}
							</Action>
							<Action
								action={deleteGrantReport.for(r.id)}
								label="Delete"
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Delete {r.title}?"
								submitLabel="Delete"
								submitVariant="error"
								successToast="Deleted"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={r.id} />
									<input type="hidden" name="grantApplicationId" value={grant.id} />
									<p class="text-sm">
										For a report the funder does not require. A sent one gets a Submitted date.
									</p>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		<Action
			action={deleteGrant.for(grant.id)}
			label="Delete"
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle="Delete {grant.title}?"
			submitLabel="Delete"
			submitVariant="error"
			successToast="Deleted"
			onsuccess={() => goto(resolve('/staff/grants'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={grant.id} />
				<p class="text-sm">
					For a row that should never have existed; its reports go with it. An application that was
					turned down is Declined, and a finished award is Closed.
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>
