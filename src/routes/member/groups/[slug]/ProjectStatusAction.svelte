<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { setCommitteeProjectStatusForm } from '#lib/remote/projects.remote.js';
	import { projectStatusOptions, type ProjectStatus } from '#lib/config.js';

	/** Move one of the committee's own projects along. Budget and burn stay on the staff page. */
	let { project }: { project: { id: string; name: string; status: ProjectStatus } } = $props();

	const action = $derived(setCommitteeProjectStatusForm.for(project.id));
</script>

<Action
	{action}
	label={m.member_status_label()}
	aria-label={m.member_groups_slug_project_status_aria_label({ name: project.name })}
	modalTitle={m.member_groups_slug_project_status_modal_title()}
	submitLabel={m.member_save_label()}
	successToast={m.member_groups_slug_project_status_success_toast()}
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', project.id)} />
		<Field
			field={action.fields.status}
			type="select"
			label={m.member_status_label()}
			options={projectStatusOptions}
			value={project.status}
		/>
	{/snippet}
</Action>
