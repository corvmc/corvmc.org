<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { createCatalogueTaskForm } from '#lib/remote/tasks.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * A task in a project or none; the rest is set on its page, where it lands.
	 * With `projectId`, it is that project's and the project is not asked.
	 */
	let { projects, projectId }: { projects: { id: string; name: string }[]; projectId?: string } =
		$props();

	const { fields } = createCatalogueTaskForm;
	const options = $derived(projects.map((p) => ({ value: p.id, label: p.name })));
</script>

<Action
	action={createCatalogueTaskForm}
	label={m.staff_tasks_new_task_label()}
	modalTitle={m.staff_tasks_new_task_title()}
	successToast={m.staff_tasks_task_added_toast()}
	data-testid="new-task"
	onsuccess={(result) => {
		const id = (result as { id?: string } | undefined)?.id;
		if (id) void goto(resolve('/staff/tasks/[id]', { id }));
	}}
>
	{#snippet form()}
		<Field field={fields.title} type="text" label={m.staff_title_label()} />
		{#if projectId}
			<input {...fields.projectId.as('hidden', projectId)} />
		{:else}
			<Field
				field={fields.projectId}
				type="select"
				label={m.staff_project_label()}
				placeholder={m.ui_none_placeholder()}
				{options}
			/>
		{/if}
		<Field field={fields.dueAt} type="date" label={m.staff_tasks_due_date_label()} />
	{/snippet}
</Action>
