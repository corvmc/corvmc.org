<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { BookerType } from '#lib/config.js';
	import { untrack } from 'svelte';
	import {
		getAvailableDates,
		getReservationStartTimes,
		getReservationEndTimes
	} from '#lib/remote/reservations.remote.js';
	import * as Form from '#lib/components/ui/Form/index.js';
	import { getFormContext } from '#lib/components/ui/Form/Form.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { today, getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date';
	import { isValidPhone } from '#lib/utils/phone.js';

	let {
		isSustaining = false,
		needsPhone = false,
		reloadToken = 0,
		bookerType = undefined
	}: {
		isSustaining?: boolean;
		/**
		 * Member has no usable contact number on file. Asked for here, on the first
		 * step, so the wizard can't be advanced at all without one.
		 */
		needsPhone?: boolean;
		/** Bump to force a fresh reload of availability (e.g. after a slot conflict). */
		reloadToken?: number;
		/**
		 * Who is booking, which decides the shortest bookable end time. Left
		 * undefined the server assumes `'user'`, so every existing caller keeps the
		 * member floor it had.
		 */
		bookerType?: BookerType;
	} = $props();

	const tz = getLocalTimeZone();
	// Three booking forms share this step, so the names come from whichever one holds it.
	const fields = getFormContext()!.fields;

	// Left empty until availability loads, then preselected to the first bookable
	// day (see the effect below). Defaulting to today opened the dialog on a dead
	// end whenever today's slots were gone.
	let date = $state('');
	let startTime = $state('');
	let endTime = $state('');
	let notes = $state('');
	let phone = $state('');
	let frequency = $state('');
	let monthlyMode = $state('weekday');

	const isMonthly = $derived(frequency === 'monthly');

	function ordinal(n: number): string {
		const mod100 = n % 100;
		if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
		switch (n % 10) {
			case 1:
				return `${n}st`;
			case 2:
				return `${n}nd`;
			case 3:
				return `${n}rd`;
			default:
				return `${n}th`;
		}
	}

	const monthlyLabels = $derived.by(() => {
		if (!date) return { weekday: 'Same weekday each month', monthday: 'Same date each month' };
		const d = new Date(date + 'T00:00:00Z');
		const weekdayName = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
		const dayOfMonth = d.getUTCDate();
		const nth = Math.ceil(dayOfMonth / 7);
		return {
			weekday: `${ordinal(nth)} ${weekdayName} of the month`,
			monthday: `Monthly on the ${ordinal(dayOfMonth)}`
		};
	});

	let availableDates = $state<string[]>([]);
	let initialLoading = $state(true);

	// Bound the calendar by what the server actually offers rather than
	// recomputing the booking window on the client. That keeps the last
	// selectable day honest (the server returns today..today+13, so a hardcoded
	// +14 painted one extra day as struck-through) and sidesteps the skew
	// between the browser's timezone and the server's DEFAULT_TIMEZONE.
	const minDate = $derived(availableDates.length ? parseDate(availableDates[0]) : today(tz));
	const maxDate = $derived(
		availableDates.length ? parseDate(availableDates[availableDates.length - 1]) : today(tz)
	);

	let availSeen = 0;
	let availGen = 0;
	$effect(() => {
		const token = reloadToken;
		const forceReload = token > availSeen;
		availSeen = token;
		const gen = ++availGen;
		const q = getAvailableDates();
		(async () => {
			// refresh() re-fetches and updates the resource's reactive `current`;
			// the awaitable itself resolves only once, so read `current` after it.
			if (forceReload) await q.refresh();
			const dates = (forceReload ? q.current : await q) ?? [];
			// Drop a stale resolve (e.g. the initial load finishing after a
			// conflict-triggered refresh already ran).
			if (gen !== availGen) return;
			availableDates = dates;
			// Preselect the first bookable day, and re-pick if a conflict reload
			// took the selected day away — otherwise the user is stranded on a
			// date the server no longer offers. untrack: reading `date` here must
			// not make this effect depend on it.
			const current = untrack(() => date);
			if (!current || !dates.includes(current)) date = dates[0] ?? '';
			initialLoading = false;
		})();
	});

	let availableSet = $derived(new Set(availableDates));
	const isDateUnavailable = (d: DateValue) => !availableSet.has(d.toString());

	let startTimeOptions = $state<{ value: string; label: string; disabled?: boolean }[] | null>(
		null
	);
	// The list now carries the taken slots too, so "nothing on this date" is a
	// question about what is selectable rather than about how long the list is.
	const noStartTimes = $derived(
		startTimeOptions !== null && !startTimeOptions.some((o) => !o.disabled)
	);
	let endTimeOptions = $state<{ value: string; label: string }[] | null>(null);

	let startGen = 0;
	let startSeen = 0;
	$effect(() => {
		const d = date;
		const token = reloadToken;
		const forceReload = token > startSeen;
		startSeen = token;
		const gen = ++startGen;
		startTime = '';
		endTime = '';
		startTimeOptions = null;
		endTimeOptions = null;
		// No date yet (availability still loading, or nothing bookable at all) —
		// don't ask the server for times on an empty date.
		if (!d) {
			startTimeOptions = [];
			return;
		}
		const q = getReservationStartTimes(d);
		(async () => {
			if (forceReload) await q.refresh();
			const opts = (forceReload ? q.current : await q) ?? [];
			if (gen === startGen) startTimeOptions = opts;
		})();
	});

	let endGen = 0;
	$effect(() => {
		const st = startTime;
		const gen = ++endGen;
		endTime = '';
		if (st) {
			endTimeOptions = null;
			const d = untrack(() => date);
			getReservationEndTimes({ date: d, startTime: st, bookerType }).then((opts) => {
				if (gen === endGen) endTimeOptions = opts;
			});
		} else {
			endTimeOptions = [];
		}
	});

	const step1Valid = $derived(
		!!date && !!startTime && !!endTime && (!needsPhone || isValidPhone(phone))
	);
</script>

<Form.Step valid={step1Valid}>
	{#if initialLoading}
		<div class="space-y-4 py-2">
			<div class="h-[175px] w-full skeleton rounded-lg"></div>
			<div class="grid grid-cols-2 gap-2">
				<div class="h-12 w-full skeleton rounded-lg"></div>
				<div class="h-12 w-full skeleton rounded-lg"></div>
			</div>
			<div class="h-20 w-full skeleton rounded-lg"></div>
		</div>
	{:else if availableDates.length === 0}
		<EmptyState
			title={m.reservations_booking_date_time_step_title()}
			description={m.reservations_booking_date_time_step_every_slot_current_booki_body()}
		/>
	{:else}
		<Form.Field
			field={fields.date}
			label=""
			type="calendar"
			bind:value={date}
			{isDateUnavailable}
			minValue={minDate}
			maxValue={maxDate}
		/>

		{#if date && noStartTimes}
			<p class="mt-2 text-sm text-error">
				{m.reservations_booking_date_time_step_no_available_times_date_text()}
			</p>
		{/if}

		<div class="grid grid-cols-2 gap-2">
			<Form.Field
				field={fields.startTime}
				label={m.reservations_booking_date_time_step_start_time_label()}
				type="select"
				bind:value={startTime}
				options={startTimeOptions ?? []}
				placeholder={startTimeOptions === null
					? m.reservations_booking_date_time_step_loading_placeholder()
					: noStartTimes
						? m.reservations_booking_date_time_step_no_times_available_placeholder()
						: m.reservations_booking_date_time_step_select_start_time_placeholder()}
				required
			/>

			<Form.Field
				field={fields.endTime}
				label={m.reservations_booking_date_time_step_end_time_label()}
				type="select"
				bind:value={endTime}
				options={endTimeOptions ?? []}
				placeholder={!startTime
					? m.reservations_booking_date_time_step_select_start_time_first_placeholder()
					: endTimeOptions === null
						? m.reservations_booking_date_time_step_loading_placeholder()
						: endTimeOptions.length === 0
							? m.reservations_booking_date_time_step_no_end_times_available_placeholder()
							: m.reservations_booking_date_time_step_select_end_time_placeholder()}
				required
			/>
		</div>

		{#if needsPhone}
			<!-- Bound as well as field-backed: step1Valid needs to see each keystroke. -->
			<Form.Field
				field={fields.phone}
				type="tel"
				label={m.reservations_booking_date_time_step_contact_phone_label()}
				bind:value={phone}
				placeholder="(541) 555-0123"
				required
				description={m.reservations_booking_date_time_step_staff_use_reach_about_bo_body()}
			/>
		{/if}

		<Form.Field
			field={fields.notes}
			label={m.reservations_booking_date_time_step_notes_optional_label()}
			type="textarea"
			bind:value={notes}
			placeholder={m.reservations_booking_date_time_step_what_working_placeholder()}
			rows={2}
		/>

		{#if isSustaining}
			<fieldset class="fieldset">
				<legend class="fieldset-legend"
					>{m.reservations_booking_date_time_step_frequency_title()}</legend
				>
				<div class="flex gap-1">
					{#each [{ value: '', label: m.reservations_booking_date_time_step_one_time_label() }, { value: 'weekly', label: m.reservations_booking_date_time_step_weekly_label() }, { value: 'biweekly', label: m.reservations_booking_date_time_step_biweekly_label() }, { value: 'monthly', label: m.reservations_booking_date_time_step_monthly_label() }] as opt (opt.value)}
						<label class="btn flex-1 btn-sm" class:btn-primary={frequency === opt.value}>
							<!-- One-time posts nothing: kit refuses a radio with an empty value. -->
							<input
								{...opt.value
									? fields.recurring.as('radio', opt.value)
									: { type: 'radio', value: '' }}
								bind:group={frequency}
								class="hidden"
							/>
							{opt.label}
						</label>
					{/each}
				</div>
			</fieldset>

			{#if isMonthly}
				<fieldset class="fieldset">
					<legend class="fieldset-legend"
						>{m.reservations_booking_date_time_step_monthly_pattern_title()}</legend
					>
					<div class="flex flex-col gap-1">
						{#each [{ value: 'weekday', label: monthlyLabels.weekday }, { value: 'monthday', label: monthlyLabels.monthday }] as opt (opt.value)}
							<label class="btn justify-start btn-sm" class:btn-primary={monthlyMode === opt.value}>
								<input
									{...fields.monthlyMode.as('radio', opt.value)}
									bind:group={monthlyMode}
									class="hidden"
								/>
								{opt.label}
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}

			{#if frequency}
				<Form.Field
					field={fields.recurringUntil}
					type="date"
					label={m.reservations_booking_date_time_step_label()}
					min={date}
				/>
			{/if}
		{/if}
	{/if}

	<div class="flex justify-end pt-2">
		<Form.SubmitButton
			label={m.reservations_booking_date_time_step_save_label()}
			continueLabel={m.reservations_booking_date_time_step_continue_label()}
			class="btn-primary"
		/>
	</div>
</Form.Step>
