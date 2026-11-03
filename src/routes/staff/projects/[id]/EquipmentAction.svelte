<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { setTaskEquipmentForm } from '$lib/remote/tasks.remote';
	import { searchWorkAssets } from '$lib/remote/maintenance-schedules.remote';
	import type { Task } from './task-view';

	/** The unit the task is about. Clearing the picker takes it off. */
	let { task, projectId, label }: { task: Task; projectId: string; label: string } = $props();

	type AssetOption = { id: string; name: string; detail: string | null };
	const current = (): AssetOption | null =>
		task.assetId
			? {
					id: task.assetId,
					name: `${task.assetName ?? 'Equipment'}${task.assetTag ? ` · ${task.assetTag}` : ''}`,
					detail: null
				}
			: null;
	let selected = $state<AssetOption | null>(untrack(current));
	const edit = $derived(setTaskEquipmentForm.for(task.id));
</script>

<Action
	action={edit}
	{label}
	variant="ghost"
	size="xs"
	class="justify-start font-normal"
	modalTitle={m.staff_projects_id_equipment_modal_title({ title: task.title })}
	submitLabel={m.staff_save()}
	successToast={m.staff_saved()}
>
	{#snippet form()}
		<input {...edit.fields.projectId.as('hidden', projectId)} />
		<input {...edit.fields.workOrderId.as('hidden', task.id)} />
		<input {...edit.fields.assetId.as('hidden', selected?.id ?? '')} />
		<FormField
			name="assetId"
			label={m.staff_unit()}
			description={m.staff_projects_id_equipment_description()}
		>
			<SearchSelect
				search={(q) => searchWorkAssets(q)}
				bind:value={selected}
				labelKey="name"
				descriptionKey="detail"
				placeholder={m.staff_search_by_item_tag_serial()}
			/>
		</FormField>
	{/snippet}
</Action>
