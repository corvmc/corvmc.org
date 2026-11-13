<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { setTaskSection } from '#lib/remote/volunteer.remote.js';

	/** Moves a project's task between its project's sections, or to none (#2653). */
	let {
		workOrderId,
		sectionId,
		sections
	}: {
		workOrderId: string;
		sectionId: string | null;
		sections: { id: string; name: string }[];
	} = $props();

	const move = $derived(setTaskSection.for(workOrderId));
	const options = $derived(sections.map((s) => ({ value: s.id, label: s.name })));
</script>

<Action
	action={move}
	label={m.staff_tasks_change_section_label()}
	variant="ghost"
	size="sm"
	modalTitle={m.staff_tasks_change_section_title()}
	successToast={m.staff_tasks_section_changed_toast()}
	data-testid="change-section"
>
	{#snippet form()}
		<input {...move.fields.id.as('hidden', workOrderId)} />
		<Field
			field={move.fields.sectionId}
			type="select"
			label={m.staff_tasks_section_label()}
			placeholder={m.staff_tasks_no_section_placeholder()}
			{options}
			value={sectionId ?? ''}
		/>
	{/snippet}
</Action>
