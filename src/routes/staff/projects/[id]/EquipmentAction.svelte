<script lang="ts">
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
	modalTitle="Equipment: {task.title}"
	submitLabel="Save"
	successToast="Saved"
>
	{#snippet form()}
		<input {...edit.fields.projectId.as('hidden', projectId)} />
		<input {...edit.fields.workOrderId.as('hidden', task.id)} />
		<input {...edit.fields.assetId.as('hidden', selected?.id ?? '')} />
		<FormField name="assetId" label="Unit" description="The unit this work is about.">
			<SearchSelect
				search={(q) => searchWorkAssets(q)}
				bind:value={selected}
				labelKey="name"
				descriptionKey="detail"
				placeholder="Search by item, tag or serial..."
			/>
		</FormField>
	{/snippet}
</Action>
