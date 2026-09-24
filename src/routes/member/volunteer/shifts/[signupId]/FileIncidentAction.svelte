<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { clubToday, incidentCategories, incidentCategoryLabels } from '$lib/config';
	import { fileShowIncidentForm } from '$lib/remote/incidents.remote';
	import { getMyShift } from '$lib/remote/volunteer.remote';

	let { eventId, signupId }: { eventId: string; signupId: string } = $props();

	const { fields } = fileShowIncidentForm;
	const categoryOptions = incidentCategories.map((c) => ({
		value: c,
		label: incidentCategoryLabels[c]
	}));
</script>

<Action
	action={fileShowIncidentForm}
	label="Report an incident"
	modalTitle="Report an incident"
	submitLabel="Send to staff"
	successToast="Sent. Staff will review it."
	variant="default"
	size="sm"
	outline
	onsuccess={() => void getMyShift(signupId).refresh()}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.occurredOn} type="date" label="Date" value={clubToday()} />
			<Field field={fields.occurredAt} type="time" label="Time" />
		</div>
		<Field field={fields.category} type="select" label="Kind" options={categoryOptions} />
		<Field field={fields.summary} type="text" label="Summary" description="One line." />
		<Field field={fields.description} type="textarea" label="What happened" />
		<Field field={fields.location} type="text" label="Where" />
		<p class="text-muted text-wrap">
			Staff review what you send and complete the record. You will see what you filed here, and
			nothing else in the log.
		</p>
	{/snippet}
</Action>
