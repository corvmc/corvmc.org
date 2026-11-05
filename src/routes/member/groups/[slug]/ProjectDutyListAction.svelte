<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { applyDutyListToProjectForm } from '#lib/remote/projects.remote.js';
	import { toastWarnings } from '#lib/utils/toast-warnings.js';

	/** Stamp one of the project templates into the committee's own project. */
	let {
		project,
		dutyLists
	}: {
		project: { id: string; name: string };
		dutyLists: { id: string; name: string }[];
	} = $props();

	const action = $derived(applyDutyListToProjectForm.for(project.id));
	const options = $derived(dutyLists.map((l) => ({ value: l.id, label: l.name })));
</script>

<Action
	{action}
	label={m.member_groups_slug_project_duty_list_apply_template()}
	aria-label={m.member_groups_slug_project_duty_list_aria_label({ name: project.name })}
	modalTitle={m.member_groups_slug_project_duty_list_aria_label({ name: project.name })}
	submitLabel={m.member_apply()}
	successToast={m.member_groups_slug_project_duty_list_success_toast()}
	onsuccess={toastWarnings}
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.projectId.as('hidden', project.id)} />
		<Field
			field={action.fields.dutyListId}
			type="select"
			label={m.member_groups_slug_project_duty_list_template()}
			{options}
		/>
		<Field
			field={action.fields.reason}
			type="text"
			label={m.member_groups_slug_project_duty_list_reason_if_applying_agai()}
		/>
	{/snippet}
</Action>
