<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { updateGroupSession } from '$lib/remote/group-events.remote';
	import { DEFAULT_TIMEZONE } from '$lib/config';

	/**
	 * Move, rename, or change what a session does with the room.
	 *
	 * The room follows a move: `updateGroupSession` re-runs the conflict check
	 * against everything but this session's own reservation, then moves the held
	 * window. The checkbox can also take a room the session never held or give
	 * one back, which before #1108 meant cancelling and recreating.
	 */
	let {
		groupId,
		session,
		onchanged
	}: {
		groupId: string;
		session: {
			id: string;
			title: string;
			description: string | null;
			startsAt: Date;
			endsAt: Date | null;
			reservesRoom: boolean;
			doorsAt: Date | null;
			tags: string | null;
			externalTicketUrl: string | null;
			ticketPrice: number | null;
		};
		onchanged: () => void;
	} = $props();

	const fields = updateGroupSession.fields;

	// The form takes a date and two wall-clock times, so the stored instants have
	// to come back out in the app's own zone — reading them off the viewer's
	// browser would shift a session for anyone travelling.
	const parts = (d: Date) =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: DEFAULT_TIMEZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		})
			.format(d)
			.split(', ');

	const start = $derived(parts(session.startsAt));
	const end = $derived(session.endsAt ? parts(session.endsAt) : null);
	const doors = $derived(session.doorsAt ? parts(session.doorsAt)[1] : null);

	// Stored in cents; the field takes dollars, as the band gig form's does.
	const centsToDollars = (cents: number | null) => (cents == null ? '' : (cents / 100).toFixed(2));
</script>

<Action
	action={updateGroupSession.for(session.id)}
	label="Edit"
	aria-label={`Edit ${session.title}`}
	modalTitle="Edit session"
	submitLabel="Save"
	successToast="Session updated"
	variant="ghost"
	size="xs"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<input {...fields.eventId.as('hidden', session.id)} />

			<FormField
				field={fields.title}
				type="text"
				label="What is it"
				value={session.title}
				required
			/>

			<FormField
				field={fields.description}
				type="textarea"
				label="Details"
				value={session.description ?? ''}
				description="Optional. Shown on the event page."
			/>

			<FormField field={fields.sessionDate} type="date" label="Date" value={start[0]} required />

			<div class="grid grid-cols-2 gap-3">
				<FormField field={fields.startTime} type="time" label="Starts" value={start[1]} required />
				<FormField
					field={fields.endTime}
					type="time"
					label="Ends"
					value={end ? end[1] : ''}
					required
				/>
			</div>

			<FormField
				field={fields.reserveRoom}
				type="checkbox"
				label="Hold the practice room"
				value={session.reservesRoom}
				description="Free for a program — no credits are spent. Unticking gives the room back without calling the session off."
			/>
			field={fields.doorsTime}
			type="time" label="Doors" value={doors ?? ''}
			description="Optional. When people can turn up." />

			<FormField
				field={fields.tags}
				type="text"
				label="Tags"
				value={session.tags ?? ''}
				placeholder="jazz, jam, all ages"
				description="Optional. Comma separated — how the gig guide filters."
			/>

			<FormField
				field={fields.posterFile}
				type="file"
				label="Poster"
				description="Optional. Replaces the current one."
				accept="image/jpeg,image/png,image/webp"
			/>

			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label="Price"
					value={centsToDollars(session.ticketPrice)}
					placeholder="10.00"
					description="Optional. Leave blank if it's free."
				/>
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label="Tickets at"
					value={session.externalTicketUrl ?? ''}
					placeholder="https://"
					description="Optional. Where people buy."
				/>
			</div>

			<p class="text-subtle">
				Moving a session moves the room it holds. If the new time is taken, the save is refused
				rather than double-booking.
			</p>
		</div>
	{/snippet}
</Action>
