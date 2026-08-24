<script lang="ts">
	import Action from '$lib/components/shared/Action.svelte';
	import EventFields from './EventFields.svelte';
	import { type LineupChip } from './LineupEditor.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createBandEventForm } from '$lib/remote/band-events.remote';

	// Resolved props, and a synchronous script — see the note in EventFields.
	const fields = createBandEventForm.fields;

	let { bandId, bandSlug, bandName }: { bandId: string; bandSlug: string; bandName: string } =
		$props();

	// The owner always heads its own bill; the server writes that slot too, but
	// showing it here makes the running order legible while editing. Seeded in an
	// effect rather than in the initializer, which would capture the props once
	// and never track them. The owner's own chip can't be removed, so this can
	// only fire on first render.
	let lineup = $state<LineupChip[]>([]);
	$effect(() => {
		if (lineup.length === 0) {
			lineup = [{ name: bandName, bandId, status: 'confirmed' }];
		}
	});
</script>

<!--
	Create lives in a modal on the list page rather than at its own /create route,
	which is the house rule for create flows. Extracting EventFields is what made
	that nearly free — and it means the field set has one owner again instead of
	drifting between two pages.

	The `form` snippet, never `body`: Action checks `{#if body}` ahead of its
	RemoteForm branch, so a `body` snippet renders the fields bare and posts
	nothing.
-->
<Action
	action={createBandEventForm}
	label="Create Event"
	modalTitle="Create Event"
	maxWidth="max-w-2xl"
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
			<EventFields {fields} {bandId} bind:lineup />
		</div>
	{/snippet}
</Action>
