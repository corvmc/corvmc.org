<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Modal from '$lib/components/shared/Modal.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/shared/Form';
	import ConflictWarnings from '$lib/components/shared/reservations/ConflictWarnings.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { checkConflicts, createEvent, previewRecurringEvents } from '$lib/remote/events.remote';
	import { responseErrorMessage } from '$lib/api';

	const { fields } = createEvent;

	let { open = $bindable(false) }: { open: boolean } = $props();

	let title = $state('');
	let description = $state('');
	let eventDate = $state(new Date().toISOString().split('T')[0]);
	let eventStartTime = $state('');
	let eventEndTime = $state('');
	let doorsTime = $state('');
	let tags = $state('');
	let reserveSpace = $state(false);
	let reservationStartTime = $state('');
	let reservationEndTime = $state('');
	let ticketingEnabled = $state(false);
	let ticketPriceDollars = $state('');
	let ticketQuantity = $state('');
	let posterFile = $state<File | null>(null);
	let hasConflicts = $state(false);
	let recurring = $state(false);
	let recurringFrequency = $state('weekly');
	let monthlyMode = $state('weekday');
	let recurringEndsAt = $state('');
	let recurringPreview = $state<{ dates: string[]; totalInWindow: number } | null>(null);

	const isMonthly = $derived(recurringFrequency === 'monthly');

	$effect(() => {
		if (recurring && recurringFrequency && eventDate && eventStartTime) {
			recurringPreview = null;
			previewRecurringEvents({
				date: eventDate,
				startTime: eventStartTime,
				frequency: recurringFrequency as 'weekly' | 'biweekly' | 'monthly',
				monthlyMode: isMonthly ? (monthlyMode as 'weekday' | 'monthday') : undefined
			}).then((result) => {
				recurringPreview = result;
			});
		} else {
			recurringPreview = null;
		}
	});

	function formatOccurrence(iso: string): string {
		return new Date(iso).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	// Ticket price in cents for the hidden field. Independent of the ticketing
	// toggle: it's the price attendees pay wherever they buy.
	const ticketPriceCents = $derived(
		ticketPriceDollars ? String(Math.round(parseFloat(ticketPriceDollars) * 100)) : ''
	);

	const toMinutes = (t: string) => {
		const [h, m] = t.split(':').map(Number);
		return h * 60 + m;
	};

	/** Move an "HH:MM" time by a signed number of minutes, wrapping at midnight. */
	function shiftTime(time: string, minutes: number): string {
		const total = (((toMinutes(time) + minutes) % 1440) + 1440) % 1440;
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	// The reservation window is really setup and teardown padding around the show,
	// so it rides along when the event is re-timed. Seeding it only while empty
	// left a window still pointing at the times the event used to have — visible
	// but easy to miss, and it books the wrong slot.
	let lastEventStartTime = '';
	let lastEventEndTime = '';

	$effect(() => {
		const start = eventStartTime;
		const end = eventEndTime;
		if (!reserveSpace) return;

		untrack(() => {
			if (start) {
				reservationStartTime =
					reservationStartTime && lastEventStartTime
						? shiftTime(reservationStartTime, toMinutes(start) - toMinutes(lastEventStartTime))
						: start;
				lastEventStartTime = start;
			}
			if (end) {
				reservationEndTime =
					reservationEndTime && lastEventEndTime
						? shiftTime(reservationEndTime, toMinutes(end) - toMinutes(lastEventEndTime))
						: end;
				lastEventEndTime = end;
			}
		});
	});

	// ConflictWarnings owns this flag but unmounts with the toggle, so a stale
	// `true` would keep the hidden overrideConflicts input in the form and make
	// the next submission skip the server's double-booking check.
	$effect(() => {
		if (!reserveSpace) hasConflicts = false;
	});

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		posterFile = input.files?.[0] ?? null;
	}

	async function handleSuccess(result?: { eventId?: string }) {
		if (posterFile && result?.eventId) {
			const formData = new FormData();
			formData.append('poster', posterFile);
			const res = await fetch(`/api/events/${result.eventId}/poster`, {
				method: 'POST',
				body: formData
			});
			if (!res.ok) {
				toast.warning(
					`Event created but poster upload failed: ${await responseErrorMessage(res, 'unknown error')}`
				);
			}
		}

		open = false;
		resetForm();
		await invalidateAll();

		if (result?.eventId) {
			goto(resolve(`/staff/events/${result.eventId}`));
		}
	}

	function resetForm() {
		title = '';
		description = '';
		eventDate = new Date().toISOString().split('T')[0];
		eventStartTime = '';
		eventEndTime = '';
		doorsTime = '';
		tags = '';
		ticketingEnabled = false;
		ticketPriceDollars = '';
		ticketQuantity = '';
		reserveSpace = false;
		reservationStartTime = '';
		reservationEndTime = '';
		lastEventStartTime = '';
		lastEventEndTime = '';
		// This one outlives the form unless cleared here: ConflictWarnings writes it
		// only while mounted, so a conflict seen before Cancel would arm the
		// override for the next event entered in this modal.
		hasConflicts = false;
		posterFile = null;
		recurring = false;
		recurringFrequency = 'weekly';
		monthlyMode = 'weekday';
		recurringEndsAt = '';
		recurringPreview = null;
	}
</script>

<Modal bind:open title="New Event" maxWidth="max-w-md" onclose={resetForm}>
	<svelte:boundary>
		<Form
			remote={createEvent}
			successToast="Event created"
			onsuccess={handleSuccess}
			class="space-y-4"
		>
			<Field name="title" type="text" label="Title" bind:value={title} />
			<Field name="description" type="textarea" label="Description" bind:value={description} />
			<Field name="eventDate" type="date" label="Date" bind:value={eventDate} />

			<div class="grid grid-cols-2 gap-4">
				<Field name="eventStartTime" type="time" label="Start time" bind:value={eventStartTime} />
				<Field name="eventEndTime" type="time" label="End time" bind:value={eventEndTime} />
			</div>

			<Field name="doorsTime" type="time" label="Doors time" bind:value={doorsTime} />
			<Field name="tags" type="text" label="Tags" bind:value={tags} />

			<Field name="poster" label="Poster image">
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={handleFileSelect}
					class="file-input w-full"
				/>
				{#if posterFile}
					<p class="text-muted mt-1">
						{posterFile.name} ({(posterFile.size / 1024).toFixed(0)} KB)
					</p>
				{/if}
			</Field>

			<!-- Price stands on its own: it's what attendees pay at the door or through
			     an outside seller, even when we aren't the ones selling. -->
			<Field
				name="ticketPriceDollars"
				type="number"
				label="Ticket price ($)"
				bind:value={ticketPriceDollars}
			/>
			<input {...fields.ticketPrice.as('hidden', ticketPriceCents)} />

			<Field
				name="ticketingEnabled"
				type="toggle"
				bind:value={ticketingEnabled}
				checkboxLabel="Sell tickets through the site"
			/>

			{#if ticketingEnabled}
				<Card tone="base-200" class="p-4 space-y-4">
					<Field name="ticketQuantity" type="number" label="Capacity" bind:value={ticketQuantity} />
					<p class="text-muted">Leave capacity blank for unlimited tickets.</p>
				</Card>
			{/if}

			<Field
				name="reserveSpace"
				type="toggle"
				bind:value={reserveSpace}
				checkboxLabel="Reserve practice space"
			/>

			{#if reserveSpace}
				<Card tone="base-200" class="p-4 space-y-4">
					<p class="text-muted">
						Reservation times can differ from event times to allow for setup and teardown.
					</p>

					<div class="grid grid-cols-2 gap-4">
						<Field
							name="reservationStartTime"
							type="time"
							label="Reservation start"
							bind:value={reservationStartTime}
						/>
						<Field
							name="reservationEndTime"
							type="time"
							label="Reservation end"
							bind:value={reservationEndTime}
						/>
					</div>

					<ConflictWarnings
						date={eventDate}
						startTime={reservationStartTime}
						endTime={reservationEndTime}
						{checkConflicts}
						bind:hasConflicts
					/>
				</Card>
			{/if}

			<Field
				name="recurring"
				type="toggle"
				bind:value={recurring}
				checkboxLabel="Repeat this event"
			/>

			{#if recurring}
				<Card tone="base-200" class="p-4 space-y-4">
					<Field
						name="recurringFrequency"
						type="select"
						label="Frequency"
						bind:value={recurringFrequency}
						options={[
							{ value: 'weekly', label: 'Weekly' },
							{ value: 'biweekly', label: 'Every 2 weeks' },
							{ value: 'monthly', label: 'Monthly' }
						]}
					/>

					{#if isMonthly}
						<Field
							name="monthlyMode"
							type="select"
							label="Monthly pattern"
							bind:value={monthlyMode}
							options={[
								{ value: 'weekday', label: 'Same weekday each month (e.g. 2nd Tuesday)' },
								{ value: 'monthday', label: 'Same date each month (e.g. the 15th)' }
							]}
						/>
					{/if}

					<Field
						name="recurringEndsAt"
						type="date"
						label="Repeat until (optional)"
						bind:value={recurringEndsAt}
					/>

					<p class="text-muted">
						Occurrences are created as drafts ahead of time; publish each one when ready. Each
						occurrence starts with a copy of this event's poster, editable per occurrence.
					</p>

					{#if recurringPreview}
						{#if recurringPreview.dates.length > 0}
							<div class="text-sm">
								<p class="font-medium">Next occurrences:</p>
								<ul class="opacity-70 mt-1">
									{#each recurringPreview.dates as iso (iso)}
										<li>{formatOccurrence(iso)}</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-muted">No upcoming occurrences in the next 60 days.</p>
						{/if}
					{/if}
				</Card>
			{/if}

			{#if hasConflicts}
				<input {...fields.overrideConflicts.as('hidden', true)} />
			{/if}

			<div class="modal-action">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
				<SubmitButton
					label={hasConflicts ? 'Create with Override' : 'Create Event'}
					class={hasConflicts ? 'btn-warning' : 'btn-primary'}
				/>
			</div>
		</Form>

		{#snippet pending()}
			<div class="flex items-center justify-center p-8">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{/snippet}
	</svelte:boundary>
</Modal>
