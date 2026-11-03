<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { adjustListingHold } from '$lib/remote/events.remote';
	import { toLocalTime } from '$lib/utils/format';

	// The hold's window apart from the show's own times: setup and teardown.
	let { eventId, startsAt, endsAt }: { eventId: string; startsAt: Date; endsAt: Date } = $props();

	const fields = adjustListingHold.fields;
</script>

<Action
	action={adjustListingHold}
	label={m.events_edit_hold_edit_hold()}
	variant="ghost"
	size="sm"
	modalTitle={m.events_edit_hold_edit_hold()}
	submitLabel={m.events_save()}
	successToast={m.events_edit_hold_success_toast()}
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<FormField
					field={fields.startTime}
					type="time"
					label={m.events_edit_hold_hold_starts()}
					value={toLocalTime(startsAt)}
					required
				/>
				<FormField
					field={fields.endTime}
					type="time"
					label={m.events_edit_hold_hold_ends()}
					value={toLocalTime(endsAt)}
					required
				/>
			</div>
			<FormField
				field={fields.overrideConflicts}
				type="checkbox"
				label={m.events_edit_hold_book_anyway()}
				description={m.events_edit_hold_description()}
			/>
			<p class="text-muted">
				{m.events_edit_hold_hold_moves_place_keeps_its()}
			</p>
		</div>
	{/snippet}
</Action>
