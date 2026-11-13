<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { createCatalogueTaskForm } from '#lib/remote/tasks.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';

	type Section = { id: string; name: string };

	/**
	 * A task in a project or none; the rest is set on its page, where it lands.
	 * With `projectId`, it is that project's and the project is not asked; its
	 * `sections` are offered, starting at `section`, the group it was opened from.
	 * Opened from a group, it is an icon on that group's row.
	 */
	let {
		projects,
		projectId,
		sections = [],
		section
	}: {
		projects: { id: string; name: string }[];
		projectId?: string;
		sections?: Section[];
		/** The group it opens from; `null` is No section. Leave it out for the bar's button. */
		section?: Section | null;
	} = $props();

	const inGroup = $derived(section !== undefined);
	const remote = $derived(
		inGroup
			? createCatalogueTaskForm.for(`section:${section?.id ?? 'none'}`)
			: createCatalogueTaskForm
	);
	const options = $derived(projects.map((p) => ({ value: p.id, label: p.name })));
	const sectionOptions = $derived(sections.map((s) => ({ value: s.id, label: s.name })));
</script>

<Action
	action={remote}
	label={inGroup
		? m.staff_tasks_new_task_in_section_label({
				name: section?.name ?? m.staff_tasks_no_section_text()
			})
		: m.staff_tasks_new_task_label()}
	iconOnly={inGroup}
	icon={inGroup ? plusIcon : undefined}
	variant={inGroup ? 'ghost' : undefined}
	size={inGroup ? 'xs' : undefined}
	modalTitle={m.staff_tasks_new_task_title()}
	successToast={m.staff_tasks_task_added_toast()}
	data-testid={inGroup ? 'new-task-in-section' : 'new-task'}
	onsuccess={(result) => {
		const id = (result as { id?: string } | undefined)?.id;
		if (id) void goto(resolve('/staff/tasks/[id]', { id }));
	}}
>
	{#snippet form()}
		<Field field={remote.fields.title} type="text" label={m.staff_title_label()} />
		{#if projectId}
			<input {...remote.fields.projectId.as('hidden', projectId)} />
			{#if sectionOptions.length > 0}
				<Field
					field={remote.fields.sectionId}
					type="select"
					label={m.staff_tasks_section_label()}
					placeholder={m.staff_tasks_no_section_text()}
					options={sectionOptions}
					value={section?.id ?? ''}
				/>
			{/if}
		{:else}
			<Field
				field={remote.fields.projectId}
				type="select"
				label={m.staff_project_label()}
				placeholder={m.ui_none_placeholder()}
				{options}
			/>
		{/if}
		<Field field={remote.fields.dueAt} type="date" label={m.staff_tasks_due_date_label()} />
	{/snippet}
</Action>

{#snippet plusIcon()}
	<IconPlus size={16} />
{/snippet}
