<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createBandEventForm } from '#lib/remote/band-events.remote.js';

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
	label={m.band_slug_events_create_event_modal_create_event()}
	modalTitle={m.band_slug_events_create_event_modal_create_event()}
	maxWidth="max-w-md"
	submitLabel={m.band_slug_events_create_event_modal_create_event()}
	successToast={m.band_slug_events_create_event_modal_success_toast()}
	size="sm"
	onsuccess={(result) => {
		// `Action` types its success payload as unknown; the remote returns
		// `{ eventId }` on create.
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`band/${bandSlug}/events/${eventId}`));
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
				label={m.band_title()}
				placeholder={m.band_e_g_live_at_venue()}
				maxlength="200"
				required
			/>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField field={fields.eventDate} type="date" label={m.band_date()} required />
				<FormField field={fields.eventStartTime} type="time" label={m.band_start_time()} required />
			</div>
			<p class="text-muted">
				{m.band_slug_events_create_event_modal_saved_as_draft_end_time()}
			</p>
		</div>
	{/snippet}
</Action>
