<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { publishCommitteeProjectEventForm } from '$lib/remote/projects.remote';

	/** Put one of the committee's own project events on the calendar. */
	let { event }: { event: { id: string; title: string } } = $props();

	const action = $derived(publishCommitteeProjectEventForm.for(event.id));
</script>

<Action
	{action}
	label="Publish"
	aria-label={`Publish ${event.title}`}
	modalTitle="Publish {event.title}?"
	submitLabel="Publish"
	successToast="Published"
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', event.id)} />
		<p class="text-sm">
			It goes on the public calendar. Publishing is refused if the listing is still missing
			something, and the reason is shown.
		</p>
	{/snippet}
</Action>
