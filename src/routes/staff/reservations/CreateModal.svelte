<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		searchMembers,
		searchBands,
		getStaffSlots,
		checkConflicts,
		createReservation
	} from '$lib/remote/reservations.remote';
	import Action from '$lib/components/shared/Action.svelte';
	import { Field, Select } from '$lib/components/shared/Form';
	import SearchSelect from '$lib/components/shared/Form/SearchSelect.svelte';
	import ConflictWarnings from '$lib/components/shared/reservations/ConflictWarnings.svelte';
	import { formatSlotTime } from '$lib/utils/format';

	const { fields } = createReservation;

	let bookerType = $state<'user' | 'band'>('user');
	let selectedMember = $state<{ id: string; name: string; email: string } | null>(null);
	let selectedBand = $state<{
		id: string;
		name: string;
		ownerId: string;
		ownerName: string;
		ownerEmail: string;
	} | null>(null);
	let date = $state(new Date().toISOString().split('T')[0]);
	let startTime = $state('');
	let endTime = $state('');
	let notes = $state('');

	const startOptions = $derived.by(async () => {
		const data = await getStaffSlots(date);
		return data.slots.map((s) => ({
			value: s.startTime,
			label: formatSlotTime(s.startTime),
			available: s.available
		}));
	});

	const endOptions = $derived.by(async () => {
		if (!startTime) return [];
		const data = await getStaffSlots(date);

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
		if (b && !selectedMember) {
			selectedMember = { id: b.ownerId, name: b.ownerName, email: b.ownerEmail };
		}
	}

	function resetForm() {
		bookerType = 'user';
		selectedMember = null;
		selectedBand = null;
		date = new Date().toISOString().split('T')[0];
		startTime = '';
		endTime = '';
		notes = '';
	}
</script>

<Action
	action={createReservation}
	label="New Reservation"
	modalTitle="New Reservation"
	submitLabel="Create Reservation"
	variant="primary"
	size="sm"
	maxWidth="max-w-md"
	onsuccess={async (result) => {
		resetForm();
		const r = result as { reservationId?: string };
		await invalidateAll();
		if (r?.reservationId) goto(resolve(`/staff/reservations/${r.reservationId}`));
	}}
>
	{#snippet form()}
		<svelte:boundary>
			<input {...fields.memberId.as('hidden', selectedMember?.id ?? '')} />
			<input
				{...fields.bandId.as('hidden', bookerType === 'band' ? (selectedBand?.id ?? '') : '')}
			/>
			<input {...fields.startTime.as('hidden', startTime)} />
			<input {...fields.endTime.as('hidden', endTime)} />

			<fieldset class="fieldset">
				<legend class="fieldset-legend">Booking for</legend>
				<Select bind:value={bookerType} class="w-full">
					<option value="user">A member</option>
					<option value="band">A band</option>
				</Select>
			</fieldset>

			{#if bookerType === 'band'}
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Band</legend>
					<SearchSelect
						search={searchBands}
						bind:value={selectedBand}
						descriptionKey="ownerName"
						placeholder="Search bands by name..."
						onselect={onBandSelected}
					/>
				</fieldset>
			{/if}

			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{bookerType === 'band' ? 'Booked by' : 'Member'}
				</legend>
				<SearchSelect
					search={searchMembers}
					bind:value={selectedMember}
					placeholder="Search by name or email..."
				/>
			</fieldset>

			<Field name="date" type="date" label="Date" bind:value={date} />

			<fieldset class="fieldset">
				<legend class="fieldset-legend">Start time</legend>
				<Select bind:value={startTime} class="w-full" disabled={!(await startOptions)?.length}>
					<option value="">Select start time</option>
					{#each await startOptions as opt (opt.value)}
						<option value={opt.value}>
							{opt.label}{opt.available ? '' : ' ⚠ conflict'}
						</option>
					{/each}
				</Select>
			</fieldset>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">End time</legend>
				<Select bind:value={endTime} class="w-full" disabled={!startTime}>
					<option value="">Select end time</option>
					{#each await endOptions as opt (opt.value)}
						<option value={opt.value} class:opacity-40={!opt.available}>
							{opt.label}{opt.available ? '' : ' (unavailable)'}
						</option>
					{/each}
				</Select>
			</fieldset>

			<ConflictWarnings {date} {startTime} {endTime} {checkConflicts} />

			<Field name="notes" type="textarea" label="Notes" bind:value={notes} />

			{#snippet pending()}
				<div class="flex items-center justify-center p-8">
					<span class="loading loading-md loading-spinner"></span>
				</div>
			{/snippet}
		</svelte:boundary>
	{/snippet}
</Action>
