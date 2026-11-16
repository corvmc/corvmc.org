<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { publishCommitteeProjectEventForm } from '#lib/remote/projects.remote.js';

	/** Put one of the committee's own project events on the calendar. */
	let { event }: { event: { id: string; title: string } } = $props();

	const action = $derived(publishCommitteeProjectEventForm.for(event.id));
</script>

<Action
	{action}
	label={m.member_publish_label()}
	aria-label={m.member_publish_2_label({ title: event.title })}
	modalTitle={m.member_groups_slug_project_event_publish_modal_title({ title: event.title })}
	submitLabel={m.member_publish_label()}
	successToast={m.member_published_toast()}
	variant="ghost"
	size="xs"
>
	{#snippet form()}
		<input {...action.fields.id.as('hidden', event.id)} />
		<p class="text-sm">
			{m.member_groups_slug_project_event_publish_goes_public_calenda_text()}
		</p>
	{/snippet}
</Action>
