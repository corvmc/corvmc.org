<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { getDutyLists, createDutyList } from '#lib/remote/duty-lists.remote.js';
	import { dutyListAnchors, dutyListAnchorLabels } from '#lib/config.js';
	import StaffViews from '../../StaffViews.svelte';
	import { projectViews } from '../views';

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));

	const rows = $derived(await getDutyLists());
</script>

<PageHeader
	title={m.staff_projects_title()}
	documentTitle={m.staff_project_templates_project_templates_title()}
>
	<StaffViews views={projectViews} active="templates" />
</PageHeader>

<PageContent>
	<div class="flex justify-end">
		<Action
			size="sm"
			action={createDutyList}
			label={m.staff_project_templates_new_template_label()}
			modalTitle={m.staff_project_templates_modal_title()}
			submitLabel={m.staff_project_templates_submit_label()}
			successToast={m.staff_project_templates_success_toast()}
		>
			{#snippet form()}
				<FormField field={createDutyList.fields.name} label={m.staff_name_label()} type="text" />
				<FormField
					field={createDutyList.fields.description}
					label={m.staff_description_label()}
					type="textarea"
					description={m.staff_project_templates_shown_when_choosing_template_apply_body()}
				/>
				<FormField
					field={createDutyList.fields.anchor}
					label={m.staff_measure_offsets_from_label()}
					type="select"
					options={anchorOptions}
					description={m.staff_project_templates_every_item_timed_from_body()}
				/>
				<FormField
					field={createDutyList.fields.startsProduction}
					type="checkbox"
					label={m.staff_production_label()}
					checkboxLabel={m.staff_project_templates_starts_production_checkbox()}
				/>
			{/snippet}
		</Action>
	</div>
	{#if rows.length === 0}
		<EmptyState
			title={m.staff_project_templates_no_templates_yet_title()}
			description={m.staff_project_templates_template_set_work_orders_project_body()}
		/>
	{:else}
		<InfoCard title={m.staff_project_templates_templates_title()}>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_name_label()}</th>
					<th>{m.staff_project_templates_anchor_label()}</th>
					<th class="cell-num">{m.staff_items_label()}</th>
				{/snippet}

				{#each rows as list (list.id)}
					<tr use:rowLink={`/staff/projects/templates/${list.id}`}>
						<td>
							<StatusBadge status={list.isActive ? 'active' : 'archived'} label />
						</td>
						<td class="cell-primary">
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
</PageContent>
