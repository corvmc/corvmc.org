<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDate, formatDateShort } from '#lib/utils/format.js';
	import {
		retireRecurringWork,
		updateRecurringWork,
		type getRecurringWorkPage
	} from '#lib/remote/maintenance-schedules.remote.js';
	import { every } from './every';

	type Page = Awaited<ReturnType<typeof getRecurringWorkPage>>;

	let {
		series: s,
		projectOptions,
		open = $bindable(false)
	}: {
		series: Page['schedules'][number];
		projectOptions: { value: string; label: string }[];
		open?: boolean;
	} = $props();
</script>

<Modal bind:open title={s.name} placement="end" maxWidth="max-w-xl">
	<div class="space-y-4">
		{#if !s.retiredAt}
			<div class="flex gap-2">
				{#if s.openWorkOrderId}
					<Button
						href={resolve('/staff/volunteer/shifts/[id]', { id: s.openWorkOrderId })}
						variant="ghost"
						size="sm"
						>{m.staff_volunteer_schedule_recurring_recurring_panel_open_work_label()}</Button
					>
				{/if}
				<Action
					action={updateRecurringWork.for(s.id)}
					label={m.staff_edit_label()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_edit_2_title({ name: s.name })}
					submitLabel={m.staff_save_label()}
					successToast={m.staff_saved_toast()}
				>
					{#snippet form()}
						{@const fields = updateRecurringWork.for(s.id).fields}
						<input {...fields.id.as('hidden', s.id)} />
						<FormField
							field={updateRecurringWork.for(s.id).fields.name}
							label={m.staff_name_label()}
							type="text"
							value={s.name}
						/>
						<FormField
							field={updateRecurringWork.for(s.id).fields.intervalDays}
							submitAs="text"
							label={m.staff_repeat_every_days_label()}
							type="number"
							value={String(s.intervalDays)}
						/>
						<FormField
							field={updateRecurringWork.for(s.id).fields.capacity}
							submitAs="text"
							label={m.staff_how_many_people_label()}
							type="number"
							value={String(s.capacity)}
						/>
						<FormField
							field={updateRecurringWork.for(s.id).fields.projectId}
							label={m.staff_project_label()}
							type="select"
							options={projectOptions}
							value={s.projectId ?? ''}
						/>
						<FormField
							field={updateRecurringWork.for(s.id).fields.notes}
							label={m.staff_notes_label()}
							type="textarea"
							value={s.notes ?? ''}
						/>
					{/snippet}
				</Action>
				<Action
					action={retireRecurringWork.for(s.id)}
					label={m.staff_retire_label()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_volunteer_schedule_recurring_recurring_panel_retire_title({
						name: s.name
					})}
					submitLabel={m.staff_retire_label()}
					submitVariant="error"
					successToast={m.staff_retired_toast()}
				>
					{#snippet form()}
						{@const fields = retireRecurringWork.for(s.id).fields}
						<input {...fields.id.as('hidden', s.id)} />
						<p>{m.staff_volunteer_schedule_recurring_recurring_panel_no_new_wo_text()}</p>
					{/snippet}
				</Action>
			</div>
		{/if}

		<DefinitionList>
			<Fact
				label={m.staff_repeats_label()}
				value={s.retiredAt ? 'Retired' : every(s.intervalDays)}
			/>
			<Fact label={m.staff_role_label()} value={s.roleName} />
			<Fact
				label={m.staff_volunteer_schedule_recurring_recurring_panel_people_label()}
				value={String(s.capacity)}
			/>
			{#if s.groupName}<Fact label={m.staff_committee_label()} value={s.groupName} />{/if}
			{#if s.projectName}<Fact label={m.staff_project_label()} value={s.projectName} />{/if}
			{#if s.assetId && s.assetName}
				<Fact label={m.staff_equipment_label()}>
					<a class="link" href={resolve('/staff/inventory/assets/[id]', { id: s.assetId })}
						>{s.assetName}</a
					>
				</Fact>
			{/if}
			{#if s.openDueAt}<Fact
					label={m.staff_volunteer_schedule_recurring_recurring_panel_next_due_label()}
					value={formatDateShort(s.openDueAt)}
				/>{/if}
			{#if s.assignees.length > 0}<Fact
					label={m.staff_text_2_label()}
					value={s.assignees.join(', ')}
				/>{/if}
			<Fact
				label={m.staff_last_closed_label()}
				value={s.lastClosedAt ? formatDate(s.lastClosedAt) : 'Never'}
			/>
			{#if s.notes}<Fact label={m.staff_notes_label()} wrap value={s.notes} />{/if}
		</DefinitionList>
	</div>
</Modal>
