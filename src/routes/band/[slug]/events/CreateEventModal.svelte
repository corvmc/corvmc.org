<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createBandEventForm } from '$lib/remote/band-events.remote';

	const fields = createBandEventForm.fields;

	let { bandSlug }: { bandSlug: string } = $props();
</script>

<!--
	Only what the row needs: a title and when it starts (#1822's rule). The end
	time, doors, venue, bill, poster and tickets are all on the event's own page,
	which is the edit form for anyone who can edit — this lands there.

	The `form` snippet, never `body`: Action checks `{#if body}` ahead of its
	RemoteForm branch, so a `body` snippet renders the fields bare and posts
	nothing.
-->
<Action
	action={createBandEventForm}
	label="Create Event"
	modalTitle="Create Event"
	maxWidth="max-w-md"
	submitLabel="Create Event"
	successToast="Event created"
	size="sm"
	onsuccess={(result) => {
		// `Action` types its success payload as unknown; the remote returns
		// `{ eventId }` on create.
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`/band/${bandSlug}/events/${eventId}`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<!-- The band this event belongs to. The guard resolves it from here now
			     that it no longer reads the route's params. -->
			<input {...fields.slug.as('hidden', bandSlug)} />
			<FormField
				field={fields.title}
				type="text"
				label="Title"
				placeholder="e.g. Live at The Venue"
				maxlength="200"
				required
			/>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField field={fields.eventDate} type="date" label="Date" required />
				<FormField field={fields.eventStartTime} type="time" label="Start Time" required />
			</div>
			<p class="text-muted">
				Saved as a draft. The end time, venue, bill, poster and tickets are filled in on the event's
				page next.
			</p>
		</div>
	{/snippet}
</Action>
