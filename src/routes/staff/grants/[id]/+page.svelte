<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One grant application: what was asked, what was awarded, and what is owed back. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import GrantFields from '#lib/components/grant/GrantFields.svelte';
	import GrantReportFields from './GrantReportFields.svelte';
	import {
		getGrantDetail,
		updateGrant,
		deleteGrant,
		addGrantReport,
		updateGrantReport,
		deleteGrantReport
	} from '#lib/remote/grants.remote.js';
	import { grantStatusLabels, grantStatusBadge, grantDeadlineLabels } from '#lib/config.js';
	import { formatCents } from '#lib/utils/format.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const grant = $derived(await getGrantDetail(id));
	const editForm = $derived(updateGrant.for(id));

	const cents = (n: number | null) => (n != null ? formatCents(n) : '—');
</script>

<PageHeader width="3xl" title={grant.funderName} subtitle={m.staff_grants_id_subtitle()}>
	<Action
		action={editForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_3({ title: grant.title })}
		submitLabel={m.staff_save()}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...editForm.fields.id.as('hidden', grant.id)} />
			<GrantFields fields={editForm.fields} funders={grant.funders} value={grant} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="3xl">
	{#if grant.deadline?.overdue}
		<Alert type="warning">
			{m.staff_grants_id_has_passed_record_once_dealt({
				value: grantDeadlineLabels[grant.deadline.kind],
				formatIsoDay: formatIsoDay(grant.deadline.on)
			})}
		</Alert>
	{/if}

	<InfoCard title={grant.title}>
		<DefinitionList>
			<Fact label={m.staff_status()}>
				<Badge variant={grantStatusBadge[grant.status]} size="sm">
					{grantStatusLabels[grant.status]}
				</Badge>
			</Fact>
			<Fact label={m.staff_requested()} value={cents(grant.amountRequestedCents)} />
			<Fact label={m.staff_grants_id_awarded()} value={cents(grant.amountAwardedCents)} />
			<Fact label={m.staff_grants_id_apply_by()} value={formatIsoDay(grant.applyBy)} />
			<Fact
				label={m.staff_grants_id_award_period()}
				value="{formatIsoDay(grant.startsOn)} – {formatIsoDay(grant.endsOn)}"
			/>
			{#if grant.notes}
				<Fact label={m.staff_notes()} wrap>{grant.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_reports()}>
		{#snippet action()}
			<Action
				action={addGrantReport}
				label={m.staff_grants_id_add_report()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_grants_id_new_report_deadline()}
				submitLabel={m.staff_add()}
				successToast={m.staff_grants_id_report_added()}
			>
				{#snippet form()}
					<input {...addGrantReport.fields.grantApplicationId.as('hidden', grant.id)} />
					<GrantReportFields fields={addGrantReport.fields} />
				{/snippet}
			</Action>
		{/snippet}
		{#if grant.reports.length === 0}
			<EmptyState
				title={m.staff_grants_id_no_reports_owed()}
				description={m.staff_grants_id_description()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_report()}</th>
					<th>{m.staff_due()}</th>
					<th>{m.staff_submitted()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
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
								label={m.staff_edit()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_edit_3({ title: r.title })}
								submitLabel={m.staff_save()}
								successToast={m.staff_saved()}
								data-testid="edit-report"
							>
								{#snippet form()}
									<input {...edit.fields.id.as('hidden', r.id)} />
									<input {...edit.fields.grantApplicationId.as('hidden', grant.id)} />
									<GrantReportFields fields={edit.fields} value={r} />
								{/snippet}
							</Action>
							<Action
								action={deleteGrantReport.for(r.id)}
								label={m.staff_delete()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_delete_3({ title: r.title })}
								submitLabel={m.staff_delete()}
								submitVariant="error"
								successToast={m.staff_deleted()}
							>
								{#snippet form()}
									<input {...deleteGrantReport.for(r.id).fields.id.as('hidden', r.id)} />
									<input
										{...deleteGrantReport
											.for(r.id)
											.fields.grantApplicationId.as('hidden', grant.id)}
									/>
									<p class="text-sm">
										{m.staff_grants_id_report_funder_does_not_require()}
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
			label={m.staff_delete()}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle={m.staff_delete_3({ title: grant.title })}
			submitLabel={m.staff_delete()}
			submitVariant="error"
			successToast={m.staff_deleted()}
			onsuccess={() => goto(resolve('staff/grants'))}
		>
			{#snippet form()}
				<input {...deleteGrant.for(grant.id).fields.id.as('hidden', grant.id)} />
				<p class="text-sm">
					{m.staff_grants_id_row_should_never_have_existed()}
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>
