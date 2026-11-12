<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One grant application: what was asked and awarded. Its work, reports included, is its project's tasks. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import GrantFields from '#lib/components/grant/GrantFields.svelte';
	import { getGrantDetail, updateGrant, deleteGrant } from '#lib/remote/grants.remote.js';
	import { grantStatusLabels, grantStatusBadge, grantDeadlineLabels } from '#lib/config.js';
	import { formatCents } from '#lib/utils/format.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const id = $derived(params.id);
	const grant = $derived(await getGrantDetail(id));
	const editForm = $derived(updateGrant.for(id));

	const cents = (n: number | null) => (n != null ? formatCents(n) : '—');
</script>

<PageHeader width="3xl" title={grant.funderName} subtitle={m.staff_grants_id_subtitle_body()}>
	<Action
		action={editForm}
		label={m.staff_edit_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_3_title({ title: grant.title })}
		submitLabel={m.staff_save_label()}
		successToast={m.staff_saved_toast()}
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
			{m.staff_grants_id_has_passed_record_once_dealt_body({
				value: grantDeadlineLabels[grant.deadline.kind],
				formatIsoDay: formatIsoDay(grant.deadline.on)
			})}
		</Alert>
	{/if}

	<InfoCard title={grant.title}>
		<DefinitionList>
			<Fact label={m.staff_status_label()}>
				<Badge variant={grantStatusBadge[grant.status]} size="sm">
					{grantStatusLabels[grant.status]}
				</Badge>
			</Fact>
			<Fact label={m.staff_requested_label()} value={cents(grant.amountRequestedCents)} />
			<Fact label={m.staff_grants_id_awarded_label()} value={cents(grant.amountAwardedCents)} />
			<Fact label={m.staff_grants_id_apply_by_label()} value={formatIsoDay(grant.applyBy)} />
			<Fact
				label={m.staff_grants_id_award_period_label()}
				value="{formatIsoDay(grant.startsOn)} – {formatIsoDay(grant.endsOn)}"
			/>
			{#if grant.projectId}
				<Fact label={m.staff_grants_id_project_label()}>
					<a
						class="link"
						href={resolve('/staff/tasks/projects/[id]', { id: grant.projectId })}
						data-testid="grant-project"
					>
						{m.staff_grants_id_view_tasks_label()}
					</a>
				</Fact>
			{/if}
			{#if grant.notes}
				<Fact label={m.staff_notes_label()} wrap>{grant.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		<Action
			action={deleteGrant.for(grant.id)}
			label={m.staff_delete_label()}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle={m.staff_delete_3_title({ title: grant.title })}
			submitLabel={m.staff_delete_label()}
			submitVariant="error"
			successToast={m.staff_deleted_toast()}
			onsuccess={() => goto(resolve('staff/grants'))}
		>
			{#snippet form()}
				<input {...deleteGrant.for(grant.id).fields.id.as('hidden', grant.id)} />
				<p class="text-sm">
					{m.staff_grants_id_row_should_never_have_existed_text()}
				</p>
			{/snippet}
		</Action>
	</div>
</PageContent>
