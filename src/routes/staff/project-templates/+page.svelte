<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getDutyLists, createDutyList } from '$lib/remote/duty-lists.remote';
	import { dutyListAnchors, dutyListAnchorLabels } from '$lib/config';

	let lists = $derived(getDutyLists());

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));
	const autoApplyOptions = [
		{ value: '', label: m.staff_never() },
		{ value: 'production.created', label: m.staff_when_production_created() }
	];
</script>

<PageHeader
	title={m.staff_project_templates_project_templates()}
	subtitle={m.staff_project_templates_subtitle()}
>
	<Action
		action={createDutyList}
		label={m.staff_project_templates_new_template()}
		modalTitle={m.staff_project_templates_modal_title()}
		submitLabel={m.staff_project_templates_submit_label()}
		successToast={m.staff_project_templates_success_toast()}
	>
		{#snippet form()}
			<FormField field={createDutyList.fields.name} label={m.staff_name()} type="text" />
			<FormField
				field={createDutyList.fields.description}
				label={m.staff_description()}
				type="textarea"
				description={m.staff_project_templates_shown_when_choosing_template_apply()}
			/>
			<FormField
				field={createDutyList.fields.anchor}
				label={m.staff_measure_offsets_from()}
				type="select"
				options={anchorOptions}
				description={m.staff_project_templates_every_item_timed_from()}
			/>
			<FormField
				field={createDutyList.fields.autoApplyOn}
				label={m.staff_apply_automatically()}
				type="select"
				options={autoApplyOptions}
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#await lists then rows}
		{#if rows.length === 0}
			<EmptyState
				title={m.staff_project_templates_no_templates_yet()}
				description={m.staff_project_templates_template_set_work_orders_project()}
			/>
		{:else}
			<InfoCard title={m.staff_project_templates_templates()}>
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
						<th>{m.staff_name()}</th>
						<th>{m.staff_project_templates_anchor()}</th>
						<th class="cell-num">{m.staff_items()}</th>
					{/snippet}

					{#each rows as list (list.id)}
						<tr use:rowLink={`/staff/project-templates/${list.id}`}>
							<td>
								<StatusBadge status={list.isActive ? 'active' : 'archived'} label />
							</td>
							<td>
								<div class="font-medium">{list.name}</div>
								{#if list.description}
									<div class="line-clamp-1 text-sm text-base-content/60">{list.description}</div>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{dutyListAnchorLabels[list.anchor]}
							</td>
							<td class="cell-num">{list.itemCount}</td>
						</tr>
					{/each}
				</Table>
				<Pagination total={rows.length} unit="templates" />
			</InfoCard>
		{/if}
	{/await}
</PageContent>
