<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { createGroupSession } from '$lib/remote/group-events.remote';

	/**
	 * Put a session on the calendar — once, or on a repeat.
	 *
	 * Mount-agnostic like the rest of `groups/`: it takes its group as a prop.
	 *
	 * A date and two times rather than two `datetime-local` inputs — the latter
	 * submits no timezone, and the app resolves wall-clock time through its own
	 * `DEFAULT_TIMEZONE`. Same shape the band gig form already uses.
	 */
	let { groupId }: { groupId: string } = $props();

	const fields = createGroupSession.fields;

	// Local, only to show or hide the rest of the repeat block. The submitted
	// value is the checkbox's own; this is not a second source of truth for it.
	let recurring = $state(false);
	let frequency = $state('');

	const frequencyOptions = [
		{ value: 'weekly', label: 'Every week' },
		{ value: 'biweekly', label: 'Every other week' },
		{ value: 'monthly', label: 'Every month' }
	];

	// "Third Thursday" versus "the 17th". Only a monthly series has the choice.
	const monthlyModeOptions = [
		{ value: 'weekday', label: 'Same weekday of the month' },
		{ value: 'monthday', label: 'Same date each month' }
	];
</script>

<Action
	action={createGroupSession}
	label="New session"
	modalTitle="New session"
	submitLabel="Create session"
	successToast="Session created"
	variant="primary"
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />

			<FormField
				field={fields.title}
				type="text"
				label="What is it"
				placeholder="Monthly jam"
				required
			/>

			<FormField
				field={fields.description}
				type="textarea"
				label="Details"
				description="Optional. Shown on the event page."
			/>

			<FormField field={fields.sessionDate} type="date" label="Date" required />

			<div class="grid grid-cols-2 gap-3">
				<FormField field={fields.startTime} type="time" label="Starts" required />
				<FormField field={fields.endTime} type="time" label="Ends" required />
			</div>

			<FormField
				field={fields.reserveRoom}
				type="checkbox"
				label="Hold the practice room"
				description="Free for a program — the booking belongs to the session, and no credits are spent. Leave off if you're meeting somewhere else."
			/>

			<FormField
				field={fields.recurring}
				type="checkbox"
				label="Repeats"
				bind:value={recurring}
				description="Puts the following sessions up automatically, each one published and holding the same room."
			/>

			{#if recurring}
				<div class="space-y-4 border-l-2 border-base-300 pl-4">
					<FormField
						field={fields.recurringFrequency}
						type="select"
						label="How often"
						options={frequencyOptions}
						bind:value={frequency}
						required
					/>

					{#if frequency === 'monthly'}
						<FormField
							field={fields.monthlyMode}
							type="select"
							label="Which day"
							options={monthlyModeOptions}
							value="weekday"
						/>
					{/if}

					<FormField
						field={fields.recurringEndsAt}
						type="date"
						label="Until"
						description="Optional. Leave empty to keep going."
					/>

					<p class="text-subtle">
						If a later date is already booked, that session still goes up — it just doesn't hold the
						room, and you get told which one.
					</p>
				</div>
			{/if}
			field={fields.doorsTime}
			type="time" label="Doors" description="Optional. When people can turn up." />

			<FormField
				field={fields.tags}
				type="text"
				label="Tags"
				placeholder="jazz, jam, all ages"
				description="Optional. Comma separated — how the gig guide filters."
			/>

			<FormField
				field={fields.posterFile}
				type="file"
				label="Poster"
				accept="image/jpeg,image/png,image/webp"
				description="Optional. Shown on the event page and the gig guide."
			/>

			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label="Price"
					placeholder="10.00"
					description="Optional. Leave blank if it's free."
				/>
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label="Tickets at"
					placeholder="https://"
					description="Optional. Where people buy."
				/>
			</div>
		</div>
	{/snippet}
</Action>
