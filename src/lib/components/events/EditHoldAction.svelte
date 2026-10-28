<script lang="ts">
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
	label="Edit Hold"
	variant="ghost"
	size="sm"
	modalTitle="Edit Hold"
	submitLabel="Save"
	successToast="Hold updated"
>
	{#snippet form()}
		<input {...fields.eventId.as('hidden', eventId)} />
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<FormField
					field={fields.startTime}
					type="time"
					label="Hold starts"
					value={toLocalTime(startsAt)}
					required
				/>
				<FormField
					field={fields.endTime}
					type="time"
					label="Hold ends"
					value={toLocalTime(endsAt)}
					required
				/>
			</div>
			<FormField
				field={fields.overrideConflicts}
				type="checkbox"
				label="Book it anyway"
				description="Holds the room even if this double-books it."
			/>
			<p class="text-muted">
				The hold moves in place and keeps its door code. The show's own times are unchanged.
			</p>
		</div>
	{/snippet}
</Action>
