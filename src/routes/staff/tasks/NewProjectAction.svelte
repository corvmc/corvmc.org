<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { createProjectForm } from '#lib/remote/projects.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	type Option = { id: string; name: string };
	let { committees, templates }: { committees: Option[]; templates: Option[] } = $props();

	const { fields } = createProjectForm;
	const committeeOptions = $derived(committees.map((c) => ({ value: c.id, label: c.name })));
	const templateOptions = $derived(templates.map((t) => ({ value: t.id, label: t.name })));
</script>

<Action
	action={createProjectForm}
	label={m.staff_projects_new_project_label()}
	modalTitle={m.staff_projects_new_project_title()}
	successToast={m.staff_projects_success_toast()}
	data-testid="new-project"
	onsuccess={(result) => {
		// A show leaves the Projects list once it has a listing, so land on the project.
		const id = (result as { id?: string } | undefined)?.id;
		if (id) void goto(resolve('/staff/tasks/projects/[id]', { id }));
	}}
>
	{#snippet form()}
		<Field
			field={fields.name}
			type="text"
			label={m.staff_name_label()}
			description={m.staff_projects_what_work_live_room_refresh_body()}
		/>
		<Field field={fields.description} type="textarea" label={m.staff_description_label()} />
		<Field
			field={fields.templateId}
			type="select"
			label={m.staff_template_label()}
			placeholder={m.ui_none_placeholder()}
			options={templateOptions}
		/>
		<Field
			field={fields.groupId}
			type="select"
			label={m.staff_owning_committee_label()}
			placeholder={m.ui_none_placeholder()}
			options={committeeOptions}
			description={m.staff_projects_only_committee_can_own_project_body()}
		/>
		<MoneyField field={fields.budgetCents} label={m.staff_budget_label()} />
		<Field field={fields.startsAt} type="date" label={m.staff_starts_label()} />
		<Field field={fields.endsAt} type="date" label={m.staff_ends_label()} />
	{/snippet}
</Action>
