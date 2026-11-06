<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
	import { createGroupSession } from '#lib/remote/group-events.remote.js';

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
		{ value: 'weekly', label: m.groups_every_week() },
		{ value: 'biweekly', label: m.groups_every_other_week() },
		{ value: 'monthly', label: m.groups_every_month() }
	];

	// "Third Thursday" versus "the 17th". Only a monthly series has the choice.
	const monthlyModeOptions = [
		{ value: 'weekday', label: m.groups_same_weekday_month() },
		{ value: 'monthday', label: m.groups_same_date_each_month() }
	];
</script>

<Action
	action={createGroupSession}
	data-testid="new-session"
	label={m.groups_create_session_new_session()}
	modalTitle={m.groups_create_session_new_session()}
	submitLabel={m.groups_create_session_submit_label()}
	successToast={m.groups_create_session_success_toast()}
	variant="primary"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />

			<FormField
				field={fields.title}
				type="text"
				label={m.groups_what()}
				placeholder={m.groups_create_session_monthly_jam()}
				required
			/>

			<FormField
				field={fields.description}
				type="textarea"
				label={m.groups_details()}
				description={m.groups_optional_shown_event_page()}
			/>

			<FormField field={fields.sessionDate} type="date" label={m.groups_date()} required />

			<div class="grid grid-cols-2 gap-3">
				<FormField field={fields.startTime} type="time" label={m.groups_starts()} required />
				<FormField field={fields.endTime} type="time" label={m.groups_ends()} required />
			</div>

			<FormField
				field={fields.reserveRoom}
				type="checkbox"
				label={m.groups_hold_practice_room()}
				description={m.groups_create_session_free_program_booking_belongs_session()}
			/>

			<FormField
				field={fields.recurring}
				type="checkbox"
				label={m.groups_create_session_repeats()}
				bind:value={recurring}
				description={m.groups_create_session_puts_following_sessions_up_automatical()}
			/>

			{#if recurring}
				<div class="space-y-4 border-l-2 border-base-300 pl-4">
					<FormField
						field={fields.recurringFrequency}
						type="select"
						label={m.groups_how_often()}
						options={frequencyOptions}
						bind:value={frequency}
						required
					/>

					{#if frequency === 'monthly'}
						<FormField
							field={fields.monthlyMode}
							type="select"
							label={m.groups_which_day()}
							options={monthlyModeOptions}
							value="weekday"
						/>
					{/if}

					<FormField
						field={fields.recurringEndsAt}
						type="date"
						label={m.groups_until()}
						description={m.groups_optional_leave_empty_keep_going()}
					/>

					<p class="text-subtle">
						{m.groups_create_session_if_later_date_already_booked()}
					</p>
				</div>
			{/if}

			<FormField
				field={fields.doorsTime}
				type="time"
				label={m.groups_doors()}
				description={m.groups_optional_when_people_can_turn()}
			/>

			<FormField
				field={fields.tags}
				type="text"
				label={m.groups_tags()}
				placeholder={m.groups_jazz_jam_all_ages()}
				description={m.groups_optional_comma_separated_how_gig()}
			/>

			<FormField
				field={fields.posterFile}
				type="file"
				label={m.groups_poster()}
				accept="image/jpeg,image/png,image/webp"
				description={m.groups_create_session_optional_shown_event_page_gig()}
			/>

			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.ticketPriceDollars}
					type="text"
					label={m.groups_price()}
					placeholder="10.00"
					description={m.groups_optional_leave_blank_if_s()}
				/>
				<FormField
					field={fields.externalTicketUrl}
					type="text"
					label={m.groups_tickets_at()}
					placeholder={m.groups_https()}
					description={m.groups_optional_where_people_buy()}
				/>
			</div>
		</div>
	{/snippet}
</Action>
