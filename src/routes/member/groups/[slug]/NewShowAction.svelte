<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { createShow } from '#lib/remote/productions.remote.js';

	/**
	 * Open a show, then land on its console. Creating it attaches this committee
	 * to the show's project, so the console is theirs to work on from there.
	 */
	const fields = createShow.fields;
</script>

<Action
	action={createShow}
	label={m.member_groups_slug_new_show_new_show()}
	modalTitle={m.member_groups_slug_new_show_modal_title()}
	submitLabel={m.member_open()}
	successToast={m.member_groups_slug_new_show_success_toast()}
	size="sm"
	onsuccess={(result) => {
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`staff/events/${eventId}/production`));
	}}
>
	{#snippet form()}
		<Field
			field={fields.title}
			label={m.member_name()}
			description={m.member_groups_slug_new_show_description()}
		/>
		<Field field={fields.eventDate} type="date" label={m.member_date()} />
		<div class="grid grid-cols-2 gap-3">
			<Field
				field={fields.eventStartTime}
				type="time"
				label={m.member_groups_slug_new_show_starts()}
			/>
			<Field field={fields.eventEndTime} type="time" label={m.member_groups_slug_new_show_ends()} />
		</div>
	{/snippet}
</Action>
