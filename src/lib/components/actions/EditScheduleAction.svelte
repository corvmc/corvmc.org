<script lang="ts" module>
	export interface EditableSeries {
		id: string;
		/** `describeFrequency`'s key: "Weekly", "Every 2 weeks" or "Monthly". */
		frequencyLabel: string;
		monthlyMode: 'weekday' | 'monthday' | null;
		/** A session of the current schedule; its weekday and times seed the form. */
		startsAt: Date;
		endsAt: Date;
		/** The series' last day, if it has one. */
		until: Date | null;
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import Badge from '../ui/Badge.svelte';
	import FormField from '../ui/Form/FormField.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { previewSeriesSchedule, rescheduleSeries } from '#lib/remote/recurring.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import {
		clubInstant,
		formatDayOfWeek,
		formatTimeRange,
		formatDateShortYear,
		venueDateInput,
		venueTimeInput
	} from '#lib/utils/format.js';

	let {
		series,
		variant = 'ghost',
		size = 'sm',
		kind = 'booking',
		onsuccess
	}: {
		series: EditableSeries;
		variant?: ButtonVariant;
		size?: ButtonSize;
		/** An event series' sessions are listings, each with a room hold. */
		kind?: 'booking' | 'event';
		/** Called with the series that replaced this one, and an event series' first session. */
		onsuccess?: (seriesId: string, eventId: string | null) => void;
	} = $props();

	const copy = $derived(
		kind === 'event'
			? {
					booked: m.actions_edit_schedule_room_taken_label(),
					closed: m.actions_edit_schedule_room_taken_label(),
					keptTitle: m.actions_edit_schedule_kept_sessions_title(),
					keptBody: m.actions_edit_schedule_kept_sessions_body(),
					removed: m.actions_edit_schedule_removed_sessions_body(),
					waitlisted: m.actions_edit_schedule_hold_waitlisted_toast()
				}
			: {
					booked: m.actions_edit_schedule_booked_label(),
					closed: m.actions_edit_schedule_closed_label(),
					keptTitle: m.actions_edit_schedule_kept_title(),
					keptBody: m.actions_edit_schedule_kept_body(),
					removed: m.actions_edit_schedule_removed_body(),
					waitlisted: m.actions_edit_schedule_waitlisted_toast()
				}
	);

	const fields = rescheduleSeries.fields;
	const DAY_MS = 86_400_000;

	/** The next day, after today, on the given session's weekday. */
	function nextSameWeekday(session: Date): string {
		const weekday = formatDayOfWeek(session);
		for (let d = 1; d <= 7; d++) {
			const day = venueDateInput(new Date(Date.now() + d * DAY_MS));
			if (formatDayOfWeek(clubInstant(day, '12:00')) === weekday) return day;
		}
		return venueDateInput(new Date(Date.now() + DAY_MS));
	}

	// The form starts from the schedule as it was when the modal mounted.
	const initial = untrack(() => ({
		date: nextSameWeekday(series.startsAt),
		startTime: venueTimeInput(series.startsAt),
		endTime: venueTimeInput(series.endsAt),
		frequency: (series.frequencyLabel === 'Monthly'
			? 'monthly'
			: series.frequencyLabel === 'Every 2 weeks'
				? 'biweekly'
				: 'weekly') as 'weekly' | 'biweekly' | 'monthly',
		monthlyMode: series.monthlyMode ?? 'weekday',
		until: series.until ? venueDateInput(series.until) : ''
	}));

	let date = $state(initial.date);
	let startTime = $state(initial.startTime);
	let endTime = $state(initial.endTime);
	let frequency = $state(initial.frequency);
	let monthlyMode = $state<'weekday' | 'monthday'>(initial.monthlyMode);
	let until = $state(initial.until);

	const frequencyOptions = [
		{ value: 'weekly', label: m.actions_edit_schedule_weekly_label() },
		{ value: 'biweekly', label: m.actions_edit_schedule_biweekly_label() },
		{ value: 'monthly', label: m.actions_edit_schedule_monthly_label() }
	];
	const monthlyModeOptions = [
		{ value: 'weekday', label: m.actions_edit_schedule_same_weekday_label() },
		{ value: 'monthday', label: m.actions_edit_schedule_same_date_label() }
	];

	// The preview's input, once the form describes a whole schedule.
	const previewArgs = $derived(
		date && /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime)
			? {
					id: series.id,
					date,
					startTime,
					endTime,
					frequency,
					monthlyMode: frequency === 'monthly' ? monthlyMode : undefined,
					until: until || undefined
				}
			: null
	);
</script>

<Action
	action={rescheduleSeries}
	label={m.actions_edit_schedule_label()}
	modalTitle={m.actions_edit_schedule_title()}
	submitLabel={m.actions_edit_schedule_submit_label()}
	{variant}
	{size}
	onsuccess={(r) => {
		const result = r as
			{ seriesId: string; eventId: string | null; waitlisted: boolean } | undefined;
		toast.success(result?.waitlisted ? copy.waitlisted : m.actions_edit_schedule_success_toast());
		if (result) onsuccess?.(result.seriesId, result.eventId);
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.id.as('hidden', series.id)} />
			<FormField
				field={fields.date}
				type="date"
				label={m.actions_edit_schedule_first_session_label()}
				bind:value={date}
				required
			/>
			<div class="grid grid-cols-2 gap-3">
				<FormField
					field={fields.startTime}
					type="time"
					label={m.actions_edit_schedule_start_label()}
					bind:value={startTime}
					required
				/>
				<FormField
					field={fields.endTime}
					type="time"
					label={m.actions_edit_schedule_end_label()}
					bind:value={endTime}
					required
				/>
			</div>
			<FormField
				field={fields.frequency}
				type="select"
				label={m.actions_edit_schedule_frequency_label()}
				options={frequencyOptions}
				bind:value={frequency}
				required
			/>
			{#if frequency === 'monthly'}
				<FormField
					field={fields.monthlyMode}
					type="select"
					label={m.actions_edit_schedule_monthly_pattern_label()}
					options={monthlyModeOptions}
					bind:value={monthlyMode}
				/>
			{/if}
			<FormField
				field={fields.until}
				type="date"
				label={m.actions_edit_schedule_until_label()}
				description={m.actions_edit_schedule_until_body()}
				min={date}
				bind:value={until}
			/>

			{#if previewArgs}
				{#await previewSeriesSchedule(previewArgs) then preview}
					<div data-testid="schedule-preview" class="space-y-3 text-sm">
						<div>
							<h3 class="font-semibold">{m.actions_edit_schedule_sessions_title()}</h3>
							<ul class="mt-1 space-y-1">
								{#each preview.sessions as session (session.startsAt.getTime())}
									<li
										class="flex items-center justify-between gap-2"
										data-conflict={session.conflict}
									>
										<span>
											{formatDateShortYear(session.startsAt)} · {formatTimeRange(
												session.startsAt,
												session.endsAt
											)}
										</span>
										{#if session.conflict === 'booked'}
											<Badge variant="warning" size="sm">{copy.booked}</Badge>
										{:else if session.conflict === 'closed'}
											<Badge variant="error" size="sm">{copy.closed}</Badge>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
						{#if preview.kept.length > 0}
							<div data-testid="kept-bookings">
								<h3 class="font-semibold">{copy.keptTitle}</h3>
								<p class="text-muted">{copy.keptBody}</p>
								<ul class="mt-1 space-y-1">
									{#each preview.kept as booking (booking.id)}
										<li>
											{formatDateShortYear(booking.startsAt)} · {formatTimeRange(
												booking.startsAt,
												booking.endsAt
											)}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if preview.removed > 0}
							<p class="text-muted">{copy.removed}</p>
						{/if}
					</div>
				{:catch err}
					<p class="text-sm text-error" role="alert">{errorMessage(err)}</p>
				{/await}
			{/if}
		</div>
	{/snippet}
</Action>
