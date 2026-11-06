<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		searchMembers,
		searchBands,
		getStaffSlots,
		checkConflicts,
		createReservation
	} from '#lib/remote/reservations.remote.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field, Select } from '#lib/components/ui/Form/index.js';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import ConflictWarnings from '#lib/components/reservations/ConflictWarnings.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { formatSlotTime } from '#lib/utils/format.js';
	import { clubToday } from '#lib/config.js';

	const { fields } = createReservation;

	let bookerType = $state<'user' | 'group'>('user');
	let selectedMember = $state<{ id: string; name: string; email: string } | null>(null);
	let selectedBand = $state<{
		id: string;
		name: string;
		// Null when the band's owner seat is empty, which is legal since phase 3c.
		ownerId: string | null;
		ownerName: string | null;
		ownerEmail: string | null;
	} | null>(null);
	let date = $state(clubToday());
	let startTime = $state('');
	let endTime = $state('');
	let notes = $state('');
	let hasBlockingConflict = $state(false);
	let overrideConflicts = $state(false);

	// An override ticked for one window must not carry over to the next one.
	$effect(() => {
		if (!hasBlockingConflict) overrideConflicts = false;
	});

	// One query for the day, two derivations off it. Two async deriveds each calling
	// `getStaffSlots(date)` deduped to a single request, but they were still two remote queries in
	// flight in one component — the shape that stops a component rendering past kit 2.64.
	const slots = $derived(getStaffSlots(date));

	const startOptions = $derived.by(async () => {
		const data = await slots;
		return data.slots.map((s) => ({
			value: s.startTime,
			label: formatSlotTime(s.startTime),
			available: s.available
		}));
	});

	const endOptions = $derived.by(async () => {
		if (!startTime) return [];
		const data = await slots;

		const opts: Array<{ value: string; label: string; available: boolean }> = [];
		const startIdx = data.slots.findIndex((s) => s.startTime === startTime);
		if (startIdx < 0) return [];

		const slotsPerHour = 60 / data.config.slotMinutes;
		const minSlots = data.config.minDurationHours * slotsPerHour;
		const maxSlots = data.config.maxDurationHours * slotsPerHour;

		for (let i = minSlots; i <= maxSlots; i++) {
			const slotIdx = startIdx + i;
			if (slotIdx > data.slots.length) break;

			const endSlot = slotIdx < data.slots.length ? data.slots[slotIdx] : null;
			const time = endSlot?.startTime ?? addMinutes(startTime, i * data.config.slotMinutes);
			const rangeAvailable = data.slots.slice(startIdx, slotIdx).every((s) => s.available);

			opts.push({
				value: time,
				label: formatSlotTime(time),
				available: rangeAvailable
			});
		}

		return opts;
	});

	function addMinutes(time: string, minutes: number): string {
		const [h, m] = time.split(':').map(Number);
		const total = h * 60 + m + minutes;
		return `${Math.floor(total / 60)
			.toString()
			.padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
	}

	// Picking a band fills the member field with its owner — a band booking still
	// needs a person, since free hours and cash settle against them.
	function onBandSelected(b: typeof selectedBand) {
		// An ownerless band has nobody to prefill with, so staff pick the member
		// themselves — the booking still needs a person, since free hours and cash
		// settle against them.
		if (b?.ownerId && b.ownerName && b.ownerEmail && !selectedMember) {
			selectedMember = { id: b.ownerId, name: b.ownerName, email: b.ownerEmail };
		}
	}

	function resetForm() {
		bookerType = 'user';
		selectedMember = null;
		selectedBand = null;
		date = clubToday();
		startTime = '';
		endTime = '';
		notes = '';
		hasBlockingConflict = false;
		overrideConflicts = false;
	}
</script>

<Action
	action={createReservation}
	label={m.staff_reservations_create_modal_new_reservation()}
	modalTitle={m.staff_reservations_create_modal_new_reservation()}
	submitLabel={m.staff_reservations_create_modal_submit_label()}
	variant="primary"
	size="sm"
	maxWidth="max-w-md"
	canSubmit={!hasBlockingConflict || overrideConflicts}
	onsuccess={async (result) => {
		resetForm();
		const r = result as { reservationId?: string };
		await refreshAll();
		if (r?.reservationId) goto(resolve(`staff/reservations/${r.reservationId}`));
	}}
>
	{#snippet form()}
		<svelte:boundary>
			<input {...fields.memberId.as('hidden', selectedMember?.id ?? '')} />
			<input
				{...fields.bandId.as('hidden', bookerType === 'group' ? (selectedBand?.id ?? '') : '')}
			/>
			<input {...fields.startTime.as('hidden', startTime)} />
			<input {...fields.endTime.as('hidden', endTime)} />

			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.staff_reservations_create_modal_booking()}</legend>
				<Select bind:value={bookerType} class="w-full">
					<option value="user">{m.staff_reservations_create_modal_member()}</option>
					<option value="group">{m.staff_reservations_create_modal_band()}</option>
				</Select>
			</fieldset>

			{#if bookerType === 'group'}
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.staff_band()}</legend>
					<SearchSelect
						search={searchBands}
						bind:value={selectedBand}
						descriptionKey="ownerName"
						placeholder={m.staff_reservations_create_modal_search_bands_by_name()}
						onselect={onBandSelected}
					/>
				</fieldset>
			{/if}

			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{bookerType === 'group' ? m.staff_booked_by() : m.staff_member()}
				</legend>
				<SearchSelect
					search={searchMembers}
					bind:value={selectedMember}
					placeholder={m.staff_search_by_name_email()}
				/>
			</fieldset>

			<Field
				field={createReservation.fields.date}
				type="date"
				label={m.staff_date()}
				bind:value={date}
			/>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.staff_reservations_create_modal_start_time()}</legend>
				<Select bind:value={startTime} class="w-full" disabled={!(await startOptions)?.length}>
					<option value="">{m.staff_reservations_create_modal_select_start_time()}</option>
					{#each await startOptions as opt (opt.value)}
						<option value={opt.value}>
							{opt.label}{opt.available ? '' : m.staff_reservations_create_modal_conflict()}
						</option>
					{/each}
				</Select>
			</fieldset>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.staff_reservations_create_modal_end_time()}</legend>
				<Select bind:value={endTime} class="w-full" disabled={!startTime}>
					<option value="">{m.staff_reservations_create_modal_select_end_time()}</option>
					{#each await endOptions as opt (opt.value)}
						<option value={opt.value} class:opacity-40={!opt.available}>
							{opt.label}{opt.available ? '' : m.staff_reservations_create_modal_unavailable()}
						</option>
					{/each}
				</Select>
			</fieldset>

			<ConflictWarnings {date} {startTime} {endTime} {checkConflicts} bind:hasBlockingConflict />

			<!-- A deliberate second action, as on the event forms (#665). The server
			     refuses the booking unless this was ticked and submitted. -->
			{#if hasBlockingConflict}
				<Field
					field={fields.overrideConflicts}
					type="checkbox"
					label={m.staff_reservations_create_modal_override()}
					checkboxLabel={m.staff_reservations_create_modal_checkbox_label()}
					bind:value={overrideConflicts}
				/>
			{/if}

			<Field
				field={createReservation.fields.notes}
				type="textarea"
				label={m.staff_notes()}
				bind:value={notes}
			/>

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}

			{#snippet failed(error, reset)}
				<Alert type="warning" reset={() => retryQuery(slots, reset)}>
					{m.staff_reservations_create_modal_could_not_load_booking_form({
						errorMessage: errorMessage(error)
					})}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>
