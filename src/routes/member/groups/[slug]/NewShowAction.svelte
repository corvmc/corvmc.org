<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { createShow } from '$lib/remote/productions.remote';

	/**
	 * Open a show, then land on its console. Creating it attaches this committee
	 * to the show's project, so the console is theirs to work on from there.
	 */
	const fields = createShow.fields;
</script>

<Action
	action={createShow}
	label="New show"
	modalTitle="Open a new show"
	submitLabel="Open"
	successToast="Show opened"
	size="sm"
	onsuccess={(result) => {
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`/staff/events/${eventId}/production`));
	}}
>
	{#snippet form()}
		<Field
			field={fields.title}
			label="Name"
			description="A working title is fine. It stays a draft until someone publishes it."
		/>
		<Field field={fields.eventDate} type="date" label="Date" />
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.eventStartTime} type="time" label="Starts" />
			<Field field={fields.eventEndTime} type="time" label="Ends" />
		</div>
	{/snippet}
</Action>
