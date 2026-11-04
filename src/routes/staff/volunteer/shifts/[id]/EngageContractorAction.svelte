<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { createJobForm } from '#lib/remote/contractors.remote.js';

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
	label={m.staff_engage_contractor()}
	variant="ghost"
	size="sm"
	modalTitle={m.staff_engage_contractor()}
	successToast={m.staff_volunteer_shifts_id_engage_contractor_success_toast()}
	data-testid="engage-contractor"
>
	{#snippet form()}
		<input {...createJobForm.fields.workOrderId.as('hidden', workOrderId)} />
		<Field field={fields.contractorId} type="select" label={m.staff_contractor()} {options} />
		<Field
			field={fields.scheduledFor}
			type="date"
			label={m.staff_volunteer_shifts_id_engage_contractor_when_they_come()}
		/>
		<Field
			field={fields.expectedBackAt}
			type="date"
			label={m.staff_volunteer_shifts_id_engage_contractor_promised_back()}
		/>
		<MoneyField field={fields.quotedCents} label={m.staff_quoted()} />
		<Field field={fields.notes} type="textarea" label={m.staff_notes()} />
	{/snippet}
</Action>
