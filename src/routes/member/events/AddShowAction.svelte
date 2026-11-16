<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createListing } from '#lib/remote/community-events.remote.js';

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
	label={m.member_events_add_show_add_show_label()}
	modalTitle={m.member_events_add_show_add_show_title()}
	maxWidth="max-w-md"
	submitLabel={m.member_events_add_show_submit_label()}
	successToast={m.member_events_add_show_success_toast()}
	variant="primary"
	size="sm"
	data-testid="add-show"
	onsuccess={(result) => {
		const eventId = (result as { eventId?: string } | undefined)?.eventId;
		if (eventId) goto(resolve(`member/events/${eventId}/manage`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField
				field={fields.title}
				type="text"
				label={m.member_title_label()}
				placeholder={m.member_events_add_show_e_g_paper_wolves_at_placeholder()}
				maxlength="200"
				required
			/>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<FormField field={fields.eventDate} type="date" label={m.member_date_label()} required />
				<FormField
					field={fields.eventStartTime}
					type="time"
					label={m.member_start_time_label()}
					required
				/>
			</div>
			<FormField
				field={fields.location}
				type="text"
				label={m.member_venue_label()}
				placeholder={m.member_events_add_show_e_g_whiteside_theatre_placeholder()}
				maxlength="500"
				required
			/>
			<p class="text-muted">{m.member_events_add_show_saved_as_draft_only_can_text()}</p>
		</div>
	{/snippet}
</Action>
