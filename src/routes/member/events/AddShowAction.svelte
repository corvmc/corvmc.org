<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createListing } from '$lib/remote/community-events.remote';

	const fields = createListing.fields;
</script>

<!--
	Only what the listing needs to exist (ui-patterns, "Create forms ask only for
	what the record needs"): the schema's title, date and start time, plus the
	venue the manage form will not save without. Everything else is on the
	manage page this lands on.
-->
<Action
	action={createListing}
	label="Add a show"
	modalTitle="Add a show"
	maxWidth="max-w-md"
	submitLabel="Create Event"
	successToast="Draft saved"
	variant="primary"
	size="sm"
	onsuccess={(result) => {
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`/member/events/${eventId}/manage`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField
				field={fields.title}
				type="text"
				label="Title"
				placeholder="e.g. Paper Wolves at The Whiteside"
				maxlength="200"
				required
			/>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField field={fields.eventDate} type="date" label="Date" required />
				<FormField field={fields.eventStartTime} type="time" label="Start Time" required />
			</div>
			<FormField
				field={fields.location}
				type="text"
				label="Venue"
				placeholder="e.g. The Whiteside Theatre"
				maxlength="500"
				required
			/>
			<p class="text-muted">Saved as a draft only you can see.</p>
		</div>
	{/snippet}
</Action>
