<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { adjustListingHold } from '#lib/remote/events.remote.js';
	import { toLocalTime } from '#lib/utils/format.js';

	// The hold's window apart from the show's own times: setup and teardown.
	let { eventId, startsAt, endsAt }: { eventId: string; startsAt: Date; endsAt: Date } = $props();

	const fields = adjustListingHold.fields;
</script>

<Action
	action={adjustListingHold}
	label={m.events_edit_hold_edit_hold_label()}
	variant="ghost"
	size="sm"
	modalTitle={m.events_edit_hold_edit_hold_title()}
	submitLabel={m.events_save_label()}
	successToast={m.events_edit_hold_success_toast()}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<FormField
					field={fields.startTime}
					type="time"
					label={m.events_edit_hold_hold_starts_label()}
					value={toLocalTime(startsAt)}
					required
				/>
				<FormField
					field={fields.endTime}
					type="time"
					label={m.events_edit_hold_hold_ends_label()}
					value={toLocalTime(endsAt)}
					required
				/>
			</div>
			<FormField
				field={fields.overrideConflicts}
				type="checkbox"
				label={m.events_edit_hold_book_anyway_label()}
				description={m.events_edit_hold_description_body()}
			/>
			<p class="text-muted">
				{m.events_edit_hold_hold_moves_place_keeps_its_text()}
			</p>
		</div>
	{/snippet}
</Action>
