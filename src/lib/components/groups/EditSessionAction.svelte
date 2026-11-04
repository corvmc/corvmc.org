<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { updateGroupSession } from '#lib/remote/group-events.remote.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';

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
	label={m.groups_edit()}
	aria-label={m.groups_edit_session_aria_label({ title: session.title })}
	modalTitle={m.groups_edit_session_modal_title()}
	submitLabel={m.groups_save()}
	successToast={m.groups_edit_session_success_toast()}
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
				label={m.groups_what()}
				value={session.title}
				required
			/>

			<FormField
				field={fields.description}
				type="textarea"
				label={m.groups_details()}
				value={session.description ?? ''}
				description={m.groups_optional_shown_event_page()}
			/>

			<FormField
				field={fields.sessionDate}
				type="date"
				label={m.groups_date()}
				value={start[0]}
				required
			/>

			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.startTime}
					type="time"
					label={m.groups_starts()}
					value={start[1]}
					required
				/>
				<FormField
					field={fields.endTime}
					type="time"
					label={m.groups_ends()}
					value={end ? end[1] : ''}
					required
				/>
			</div>

			<FormField
				field={fields.reserveRoom}
				type="checkbox"
				label={m.groups_hold_practice_room()}
				value={session.reservesRoom}
				description={m.groups_edit_session_free_program_no_credits_spent()}
			/>

			<FormField
				field={fields.doorsTime}
				type="time"
				label={m.groups_doors()}
				value={doors ?? ''}
				description={m.groups_optional_when_people_can_turn()}
			/>

			<FormField
				field={fields.tags}
				type="text"
				label={m.groups_tags()}
				value={session.tags ?? ''}
				placeholder={m.groups_jazz_jam_all_ages()}
				description={m.groups_optional_comma_separated_how_gig()}
			/>

			<FormField
				field={fields.posterFile}
				type="file"
				label={m.groups_poster()}
				description={m.groups_edit_session_optional_replaces_current_one()}
				accept="image/jpeg,image/png,image/webp"
			/>

			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label={m.groups_price()}
					value={centsToDollars(session.ticketPrice)}
					placeholder="10.00"
					description={m.groups_optional_leave_blank_if_s()}
				/>
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label={m.groups_tickets_at()}
					value={session.externalTicketUrl ?? ''}
					placeholder={m.groups_https()}
					description={m.groups_optional_where_people_buy()}
				/>
			</div>

			<p class="text-subtle">
				{m.groups_edit_session_moving_session_moves_room_holds()}
			</p>
		</div>
	{/snippet}
</Action>
