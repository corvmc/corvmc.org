<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { createJobForm } from '$lib/remote/contractors.remote';

	/** Engages a contractor on this work order; a project's task has its own picker. */
	let {
		workOrderId,
		contractors
	}: { workOrderId: string; contractors: { id: string; name: string }[] } = $props();

	const { fields } = createJobForm;
	const options = $derived(contractors.map((c) => ({ value: c.id, label: c.name })));
</script>

<Action
	action={createJobForm}
	label="Engage contractor"
	variant="ghost"
	size="sm"
	modalTitle="Engage contractor"
	successToast="Contractor engaged"
>
	{#snippet form()}
		<input type="hidden" name="workOrderId" value={workOrderId} />
		<Field field={fields.contractorId} type="select" label="Contractor" {options} />
		<Field field={fields.scheduledFor} type="date" label="When they come" />
		<Field field={fields.expectedBackAt} type="date" label="Promised back" />
		<MoneyField field={fields.quotedCents} label="Quoted" />
		<Field field={fields.notes} type="textarea" label="Notes" />
	{/snippet}
</Action>
