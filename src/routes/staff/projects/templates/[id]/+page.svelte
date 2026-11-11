<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import {
		dutyListAnchors,
		dutyListAnchorLabels,
		workDoneConditions,
		workDoneConditionLabels
	} from '#lib/config.js';
	import {
		getDutyListPage,
		addDutyListItem,
		updateDutyList,
		updateDutyListItem,
		removeDutyListItem,
		deleteDutyList
	} from '#lib/remote/duty-lists.remote.js';
	import { describeDuration, describeOffset, splitOffset } from '../offsets';
	import { Latest } from '#lib/latest.svelte.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const id = $derived(params.id);
	// Not `{#await}`: a refresh would re-pend it and unmount an open item dialog.
	const data = new Latest(() => getDutyListPage(id));
	$effect(() => {
		if (data.error) throw data.error.e;
	});

	const anchorOptions = dutyListAnchors.map((a) => ({ value: a, label: dutyListAnchorLabels[a] }));

	const kindOptions = [
		{
			value: 'scheduled',
			label: m.staff_project_templates_id_scheduled_shift_with_start_end_label()
		},
		{ value: 'due', label: m.staff_project_templates_id_due_by_work_order_with_label() }
	];
	const unitOptions = [
		{ value: 'minutes', label: m.staff_project_templates_id_minutes_label() },
		{ value: 'hours', label: m.staff_project_templates_id_hours_label() },
		{ value: 'days', label: m.staff_project_templates_id_days_label() }
	];
	const doneWhenOptions = [
		{ value: '', label: m.staff_project_templates_id_only_when_somebody_marks_done_label() },
		...workDoneConditions.map((c) => ({ value: c, label: workDoneConditionLabels[c] }))
	];
	type Item = Awaited<ReturnType<typeof getDutyListPage>>['items'][number];

	const directionOptions = [
		{ value: 'before', label: m.staff_project_templates_id_before_label() },
		{ value: 'after', label: m.staff_project_templates_id_after_label() }
	];
</script>

<!-- Only this template's: on a switch the last one stays until the next lands. -->
{#if data.current?.list.id === id}
	{@const d = data.current}
	{@const anchorLabel = dutyListAnchorLabels[d.list.anchor]}
	{@const roleOptions = d.roles.map((r) => ({ value: r.id, label: r.name }))}
	{@const ownerOptions = [
		{ value: '', label: m.staff_staff_label() },
		...d.committees.map((c) => ({ value: c.id, label: c.name }))
	]}

	<PageHeader title={d.list.name} subtitle={m.staff_project_templates_id_subtitle_body()}>
		<!-- The status its list row shows. It existed on this page only as a
		     toggle inside the Edit modal, so reading it meant opening a form you
		     then had to cancel (#1067). -->
		<StatusBadge status={d.list.isActive ? 'active' : 'archived'} label />
		<Action
			action={updateDutyList}
			label={m.staff_edit_label()}
			variant="ghost"
			modalTitle={m.staff_project_templates_id_edit_template_title()}
			submitLabel={m.staff_save_label()}
			successToast={m.staff_saved_toast()}
		>
			{#snippet form()}
				<input {...updateDutyList.fields.id.as('hidden', d.list.id)} />
				<FormField
					field={updateDutyList.fields.name}
					label={m.staff_name_label()}
					type="text"
					value={d.list.name}
				/>
				<FormField
					field={updateDutyList.fields.description}
					label={m.staff_description_label()}
					type="textarea"
					value={d.list.description ?? ''}
				/>
				<FormField
					field={updateDutyList.fields.anchor}
					label={m.staff_measure_offsets_from_label()}
					type="select"
					options={anchorOptions}
					value={d.list.anchor}
				/>
				<FormField
					field={updateDutyList.fields.startsProduction}
					type="checkbox"
					label={m.staff_production_label()}
					checkboxLabel={m.staff_project_templates_starts_production_checkbox()}
					value={d.list.projectKind === 'production'}
				/>
				<FormField
					field={updateDutyList.fields.isActive}
					type="checkbox"
					label={m.staff_active_label()}
					checkboxLabel={m.staff_project_templates_id_checkbox_label_checkbox()}
					value={d.list.isActive}
				/>
			{/snippet}
		</Action>

		<Action
			action={addDutyListItem}
			label={m.staff_project_templates_id_add_item_label()}
			modalTitle={m.staff_project_templates_id_add_item_2_title()}
			submitLabel={m.staff_add_label()}
			successToast={m.staff_project_templates_id_item_added_toast()}
		>
			{#snippet form()}
				<input {...addDutyListItem.fields.dutyListId.as('hidden', d.list.id)} />
				{@render itemFields(addDutyListItem.fields, roleOptions, ownerOptions)}
			{/snippet}
		</Action>
	</PageHeader>

	<PageContent>
		<!-- Same reason as the badge above: the description was readable only by
		     opening the editor. -->
		{#if d.list.description}
			<p class="text-muted">{d.list.description}</p>
		{/if}

		<InfoCard title={m.staff_items_title()}>
			<p class="mb-3 text-sm text-base-content/70">
				{m.staff_project_templates_id_offsets_measured_from_text({
					toLowerCase: anchorLabel.toLowerCase()
				})}
			</p>
			{#if d.items.length === 0}
				<EmptyState
					title={m.staff_project_templates_id_no_items_yet_title()}
					description={m.staff_project_templates_id_add_work_orders_project_takes_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>{m.staff_role_label()}</th>
						<th class="col-support">{m.staff_owner_label()}</th>
						<th>{m.staff_when_label()}</th>
						<th class="col-support">{m.staff_project_templates_id_text_label()}</th>
						<th class="cell-num">{m.staff_people_label()}</th>
						<th class="col-support cell-num">{m.staff_project_templates_id_tasks_label()}</th>
						<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
					{/snippet}

					{#each d.items as item (item.id)}
						<tr>
							<td>
								<!-- The role as the record it is. `EntityIdentity` at `sm` is the
								     staff table's primary cell, which this was a hand-written
								     copy of — name in bold, muted subline. -->
								{#if item.title}
									<div class="font-medium">{item.title}</div>
								{/if}
								<EntityIdentity ref={item.role} />
								{#if item.notes}
									<div class="line-clamp-1 text-sm text-base-content/60">{item.notes}</div>
								{/if}
							</td>
							<td class="col-support">
								{item.groupName ?? m.staff_staff_text()}
								{#if item.doneWhen}
									<div class="text-sm text-base-content/60">
										{workDoneConditionLabels[item.doneWhen]}
									</div>
								{/if}
							</td>
							<td class="whitespace-nowrap">
								{#if item.offsetMinutes !== null}
									{describeOffset(item.offsetMinutes, anchorLabel)}
								{:else if item.dueOffsetMinutes !== null}
									<Badge variant="ghost"
										>{m.staff_project_templates_id_due_label({
											describeOffset: describeOffset(item.dueOffsetMinutes, anchorLabel)
										})}</Badge
									>
								{/if}
							</td>
							<td class="col-support whitespace-nowrap">
								{item.durationMinutes !== null ? describeDuration(item.durationMinutes) : '—'}
							</td>
							<td class="cell-num">{item.capacity}</td>
							<td class="col-support cell-num">{item.tasks.length}</td>
							<td class="w-px">
								<div class="flex w-max justify-end gap-2">
									<Action
										action={updateDutyListItem.for(item.id)}
										label={m.staff_edit_label()}
										aria-label={m.staff_project_templates_id_aria_label({
											value: item.title ?? item.roleName
										})}
										variant="ghost"
										size="sm"
										modalTitle={m.staff_project_templates_id_edit_item_title()}
										submitLabel={m.staff_save_label()}
										successToast={m.staff_saved_toast()}
									>
										{#snippet form()}
											<input {...updateDutyListItem.for(item.id).fields.id.as('hidden', item.id)} />
											<input
												{...updateDutyListItem
													.for(item.id)
													.fields.dutyListId.as('hidden', d.list.id)}
											/>
											{@render itemFields(
												updateDutyListItem.for(item.id).fields,
												roleOptions,
												ownerOptions,
												item
											)}
										{/snippet}
									</Action>
									<Action
										action={removeDutyListItem}
										label={m.staff_remove_label()}
										variant="ghost"
										size="sm"
										confirm={m.staff_project_templates_id_remove_item_work_orders_already_body()}
										successToast={m.staff_project_templates_id_item_removed_toast()}
									>
										{#snippet form()}
											<input {...removeDutyListItem.fields.id.as('hidden', item.id)} />
											<input {...removeDutyListItem.fields.dutyListId.as('hidden', d.list.id)} />
										{/snippet}
									</Action>
								</div>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		<InfoCard title={m.staff_project_templates_id_danger_zone_title()}>
			<p class="mb-3 text-sm text-base-content/70">
				{m.staff_project_templates_id_work_orders_already_created_from_text()}
			</p>
			<Action
				action={deleteDutyList}
				label={m.staff_project_templates_id_delete_template_label()}
				variant="error"
				outline
				confirm={m.staff_project_templates_id_delete_body({ name: d.list.name })}
				successToast={m.staff_project_templates_id_template_deleted_toast()}
				onsuccess={() => goto(resolve('staff/projects/templates'))}
			>
				{#snippet form()}
					<input {...deleteDutyList.fields.id.as('hidden', d.list.id)} />
				{/snippet}
			</Action>
		</InfoCard>
	</PageContent>
{/if}

{#snippet itemFields(
	fields: typeof addDutyListItem.fields,
	roleOptions: { value: string; label: string }[],
	ownerOptions: { value: string; label: string }[],
	item?: Item
)}
	{@const due = item ? item.offsetMinutes === null && item.dueOffsetMinutes !== null : false}
	{@const offset = splitOffset(item ? (item.offsetMinutes ?? item.dueOffsetMinutes ?? 0) : -180)}
	<FormField
		field={fields.volunteerRoleId}
		label={m.staff_role_label()}
		type="select"
		options={roleOptions}
		value={item?.volunteerRoleId}
	/>
	<FormField
		field={fields.title}
		label={m.staff_title_label()}
		type="text"
		value={item?.title ?? ''}
		description={m.staff_project_templates_id_what_work_order_called_blank_body()}
	/>
	<FormField
		field={fields.groupId}
		label={m.staff_owner_label()}
		type="select"
		options={ownerOptions}
		value={item?.groupId ?? ''}
	/>
	<FormField
		field={fields.doneWhen}
		label={m.staff_project_templates_id_done_when_label()}
		type="select"
		options={doneWhenOptions}
		value={item?.doneWhen ?? ''}
		description={m.staff_project_templates_id_fact_about_show_its_tasks_body()}
	/>
	<FormField
		field={fields.kind}
		label={m.staff_kind_label()}
		type="select"
		options={kindOptions}
		value={due ? 'due' : 'scheduled'}
		description={m.staff_project_templates_id_deadline_item_becomes_unscheduled_body()}
	/>
	<div class="grid gap-4 sm:grid-cols-3">
		<FormField
			field={fields.offsetAmount}
			submitAs="text"
			label={m.staff_project_templates_id_offset_label()}
			type="number"
			value={String(offset.amount)}
		/>
		<FormField
			field={fields.offsetUnit}
			label={m.staff_project_templates_id_unit_label()}
			type="select"
			options={unitOptions}
			value={offset.unit}
		/>
		<FormField
			field={fields.offsetDirection}
			label={m.staff_project_templates_id_direction_label()}
			type="select"
			options={directionOptions}
			value={offset.direction}
		/>
	</div>
	<FormField
		field={fields.durationMinutes}
		submitAs="text"
		label={m.staff_project_templates_id_duration_minutes_label()}
		type="number"
		value={String(item ? (item.durationMinutes ?? '') : 120)}
		description={m.staff_project_templates_id_scheduled_items_only_ignored_dead_body()}
	/>
	<FormField
		field={fields.capacity}
		submitAs="text"
		label={m.staff_project_templates_id_how_many_people_label()}
		type="number"
		value={String(item?.capacity ?? 1)}
	/>
	<FormField
		field={fields.sortOrder}
		submitAs="text"
		label={m.staff_sort_order_label()}
		type="number"
		value={String(item?.sortOrder ?? 0)}
	/>
	<FormField
		field={fields.notes}
		label={m.staff_notes_label()}
		type="textarea"
		value={item?.notes ?? ''}
	/>
	<FormField
		field={fields.tasks}
		label={m.staff_project_templates_id_tasks_label()}
		type="textarea"
		value={item?.tasks.join('\n') ?? ''}
		description={m.staff_project_templates_id_one_per_line_these_become_body()}
	/>
{/snippet}
