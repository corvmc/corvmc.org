<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { createGroupSession } from '$lib/remote/group-events.remote';

	/**
	 * Put a session on the calendar, and optionally hold the room for it.
	 *
	 * Mount-agnostic like the rest of `groups/`: it takes its group as a prop.
	 *
	 * A date and two times rather than two `datetime-local` inputs — the latter
	 * submits no timezone, and the app resolves wall-clock time through its own
	 * `DEFAULT_TIMEZONE`. Same shape the band gig form already uses.
	 */
	let { groupId }: { groupId: string } = $props();

	const fields = createGroupSession.fields;
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
	onfailure={() => toast.error('Could not create the session')}
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
		</div>
	{/snippet}
</Action>
