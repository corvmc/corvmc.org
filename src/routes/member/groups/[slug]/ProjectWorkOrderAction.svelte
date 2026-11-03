<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { createCommitteeProjectWorkOrderForm } from '#lib/remote/projects.remote.js';

	/** Open unscheduled work on one of the committee's own projects. */
	let {
		project,
		roles
	}: {
		project: { id: string; name: string };
		roles: { value: string; label: string }[];
	} = $props();

	const action = $derived(createCommitteeProjectWorkOrderForm.for(project.id));
</script>

<Action
	{action}
	label={m.member_groups_slug_project_work_order_work_order()}
	aria-label={m.member_groups_slug_project_work_order_aria_label({ name: project.name })}
	modalTitle={m.member_groups_slug_project_work_order_aria_label({ name: project.name })}
	submitLabel={m.member_open()}
	successToast={m.member_groups_slug_project_work_order_success_toast()}
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.projectId.as('hidden', project.id)} />
		<Field
			field={action.fields.volunteerRoleId}
			type="select"
			label={m.member_role()}
			options={roles}
		/>
		<Field
			field={action.fields.notes}
			type="textarea"
			label={m.member_what_needs_doing()}
			description={m.member_groups_slug_project_work_order_description()}
		/>
		<Field
			field={action.fields.dueAt}
			type="date"
			label={m.member_groups_slug_project_work_order_due_by()}
		/>
	{/snippet}
</Action>
