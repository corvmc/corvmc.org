<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import ConflictWarnings from '$lib/components/reservations/ConflictWarnings.svelte';
	import { errorMessage } from '$lib/error-message';
	import { updateEvent, checkRebook, checkConflicts } from '$lib/remote/events.remote';
	import { formatDollars, toLocalDate, toLocalTime } from '$lib/utils/format';

	/**
	 * Every `updateEvent` field, for a listing of any source: the advertisement,
	 * the price, and the room hold, which is the listing's (#1948). Mounted only
	 * while editing, so it seeds from the listing once and never re-reads it.
	 * Selling through our own checkout is CMC's alone (`update()` refuses it
	 * elsewhere), so only a CMC listing is offered the toggle and the capacity.
	 */
	interface Props {
		event: {
			id: string;
			title: string;
			description: string | null;
			tags: string | null;
			kind: string | null;
			source: string;
			location: string | null;
			venueId: string | null;
			externalTicketUrl: string | null;
			startsAt: Date;
			endsAt: Date | null;
			doorsAt: Date | null;
			ticketingEnabled: boolean;
			ticketPrice: number | null;
			ticketPriceFloorCents: number | null;
			ticketQuantity: number | null;
		};
		linkedReservation: { id: string; startsAt: Date; endsAt: Date } | null;
		venues: { id: string; name: string; isPrimary: boolean }[];
		onsaved: () => void;
		oncancel: () => void;
	}

	let { event, linkedReservation, venues, onsaved, oncancel }: Props = $props();

	const { fields } = updateEvent;
	const sellsHere = $derived(event.source === 'cmc');

	let editTitle = $state('');
	let editDescription = $state('');
	let editTags = $state('');
	let editKind = $state('show');
	let editLocation = $state('');
	let editVenueId = $state('');
	let editExternalTicketUrl = $state('');
	let editDate = $state('');
	let editStartTime = $state('');
	let editEndTime = $state('');
	let editDoorsTime = $state('');
	let editReservationStartTime = $state('');
	let editReservationEndTime = $state('');
	let editTicketingEnabled = $state(false);
	let editTicketPriceDollars = $state('');
	let editTicketFloorDollars = $state('');
	let editTicketQuantity = $state('');

	let rebookNeeded = $state(false);
	let rebookReason = $state('');
	let rebookConfirmed = $state(false);
	let overrideConflicts = $state(false);

	// Holding the space for a listing that never had a hold. Disjoint from
	// rebook: one with a reservation gets the rebook alert instead. Not offered
	// once an outside venue is picked, because that show holds no room.
	let reserveSpace = $state(false);
	const offSite = $derived(
		editVenueId !== '' && !venues.find((v) => v.id === editVenueId)?.isPrimary
	);
	const canReserveSpace = $derived(!linkedReservation);
	// `updateEvent` refuses a hold off-site, so picking one drops the toggle.
	$effect(() => {
		if (offSite && reserveSpace) {
			reserveSpace = false;
			toggleReserveSpace();
		}
	});

	// Only a real overlap (a booking or a closure) gates the override. An
	// advisory about hours or advance days asks for nothing.
	let hasBlockingConflict = $state(false);

	// The price is the attendee's whoever sells the ticket, so it survives the
	// toggle. A blank floor posts empty, which the remote reads as zero.
	const editTicketPriceCents = $derived(
		editTicketPriceDollars ? String(Math.round(parseFloat(editTicketPriceDollars) * 100)) : ''
	);
	const editTicketFloorCents = $derived(
		editTicketFloorDollars ? String(Math.round(parseFloat(editTicketFloorDollars) * 100)) : ''
	);

	function seed() {
		editTitle = event.title;
		editDescription = event.description ?? '';
		editTags = event.tags ?? '';
		editKind = event.kind ?? 'show';
		editLocation = event.location ?? '';
		editVenueId = event.venueId ?? '';
		editExternalTicketUrl = event.externalTicketUrl ?? '';
		editDate = toLocalDate(event.startsAt);
		editStartTime = toLocalTime(event.startsAt);
		editEndTime = event.endsAt ? toLocalTime(event.endsAt) : '';
		editDoorsTime = event.doorsAt ? toLocalTime(event.doorsAt) : '';
		editTicketingEnabled = event.ticketingEnabled;
		editTicketPriceDollars = event.ticketPrice ? formatDollars(event.ticketPrice) : '';
		editTicketFloorDollars = event.ticketPriceFloorCents
			? formatDollars(event.ticketPriceFloorCents)
			: '';
		editTicketQuantity = event.ticketQuantity ? String(event.ticketQuantity) : '';
		editReservationStartTime = linkedReservation ? toLocalTime(linkedReservation.startsAt) : '';
		editReservationEndTime = linkedReservation ? toLocalTime(linkedReservation.endsAt) : '';
	}
	seed();

	/**
	 * Show the hold as the event's own window when the toggle goes on. The
	 * server falls back to exactly this, so the fields are an optional
	 * setup/teardown override.
	 */
	function toggleReserveSpace() {
		if (reserveSpace) {
			editReservationStartTime = editStartTime;
			editReservationEndTime = editEndTime;
			lastStartTime = editStartTime;
			lastEndTime = editEndTime;
		} else {
			editReservationStartTime = '';
			editReservationEndTime = '';
			hasBlockingConflict = false;
			overrideConflicts = false;
		}
	}

	const toMinutes = (t: string) => {
		const [h, m] = t.split(':').map(Number);
		return h * 60 + m;
	};
	const shiftTime = (time: string, minutes: number) => {
		const total = (((toMinutes(time) + minutes) % 1440) + 1440) % 1440;
		return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	};

	// A new hold's window is setup and teardown padding around the show, so it
	// moves when the show is re-timed (#1866). Run from the inputs, not an effect.
	let lastStartTime = '';
	let lastEndTime = '';
	function carryReservationWindow() {
		if (!reserveSpace) return;
		if (editStartTime && lastStartTime && editReservationStartTime) {
			editReservationStartTime = shiftTime(
				editReservationStartTime,
				toMinutes(editStartTime) - toMinutes(lastStartTime)
			);
		}
		if (editEndTime && lastEndTime && editReservationEndTime) {
			editReservationEndTime = shiftTime(
				editReservationEndTime,
				toMinutes(editEndTime) - toMinutes(lastEndTime)
			);
		}
		lastStartTime = editStartTime;
		lastEndTime = editEndTime;
	}

	function retimed() {
		carryReservationWindow();
		void checkForRebook();
	}

	/** Add one calendar day to a "YYYY-MM-DD" string. */
	function nextDay(date: string): string {
		const [year, month, day] = date.split('-').map(Number);
		return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
	}

	/** Rough ISO strings for the rebook check; the server parses with the real zone. */
	function isoRange(date: string, startTime: string, endTime: string) {
		const startsAt = new Date(`${date}T${startTime}:00`);
		// A show that ends past midnight ends the next day, as the server builds it.
		const endsOnNextDay = new Date(`${date}T${endTime}:00`) < startsAt;
		const endsAt = new Date(`${endsOnNextDay ? nextDay(date) : date}T${endTime}:00`);
		return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
	}

	async function checkForRebook() {
		if (!linkedReservation || !editDate || !editStartTime || !editEndTime) {
			rebookNeeded = false;
			return;
		}
		const range = isoRange(editDate, editStartTime, editEndTime);
		const result = await checkRebook({
			eventId: event.id,
			newStartsAt: range.startsAt,
			newEndsAt: range.endsAt
		});
		rebookNeeded = result.needed;
		rebookReason = result.reason ?? '';
		if (result.needed) {
			editReservationStartTime = editStartTime;
			editReservationEndTime = editEndTime;
			rebookConfirmed = false;
		}
	}
</script>

<svelte:boundary>
	<Card>
		<CardBody class="space-y-4">
			<h3 class="text-muted font-medium">Edit listing</h3>

			<Form remote={updateEvent} guard successToast="Updated" onsuccess={onsaved}>
				<input {...fields.eventId.as('hidden', event.id)} />
				<!-- Not posted for a listing CMC doesn't sell: a band selling its own gig
				     (#1556) has the flag on, and `false` here would close that sale. -->
				{#if sellsHere}
					<input {...fields.ticketingEnabled.as('hidden', editTicketingEnabled)} />
				{/if}
				<input {...fields.ticketPrice.as('hidden', editTicketPriceCents)} />
				<input {...fields.ticketPriceFloorCents.as('hidden', editTicketFloorCents)} />
				{#if (rebookNeeded && rebookConfirmed) || (reserveSpace && canReserveSpace)}
					<input {...fields.rebookReservation.as('hidden', true)} />
				{/if}
				{#if overrideConflicts}
					<input {...fields.overrideConflicts.as('hidden', true)} />
				{/if}

				<div class="space-y-4">
					<FormField label="Title" id="editTitle" issues={[]}>
						<input
							id="editTitle"
							name="title"
							type="text"
							bind:value={editTitle}
							class="input w-full"
							required
						/>
					</FormField>

					<FormField label="Description" id="editDesc" issues={[]}>
						<textarea
							id="editDesc"
							name="description"
							bind:value={editDescription}
							class="textarea w-full"
							rows="4"></textarea>
					</FormField>

					<FormField label="Date" id="editDate" issues={[]}>
						<input
							id="editDate"
							name="eventDate"
							type="date"
							bind:value={editDate}
							class="input w-full"
							required
							onchange={checkForRebook}
						/>
					</FormField>

					<div class="grid grid-cols-2 gap-4">
						<FormField label="Start time" id="editStartTime" issues={[]}>
							<input
								id="editStartTime"
								name="eventStartTime"
								type="time"
								bind:value={editStartTime}
								class="input w-full"
								required
								onchange={retimed}
							/>
						</FormField>

						<FormField label="End time" id="editEndTime" issues={[]}>
							<input
								id="editEndTime"
								name="eventEndTime"
								type="time"
								bind:value={editEndTime}
								class="input w-full"
								required
								onchange={retimed}
							/>
						</FormField>
					</div>

					<FormField label="Doors time" id="editDoorsTime" issues={[]}>
						<input
							id="editDoorsTime"
							name="doorsTime"
							type="time"
							bind:value={editDoorsTime}
							class="input w-full"
						/>
					</FormField>

					<FormField
						field={fields.kind}
						type="select"
						label="Kind"
						bind:value={editKind}
						options={[
							{ value: 'show', label: 'Show' },
							{ value: 'work_party', label: 'Work party' },
							{ value: 'meeting', label: 'Meeting' },
							{ value: 'class', label: 'Class' },
							{ value: 'market', label: 'Market' }
						]}
						description="Only shows reach the homepage posters. Anything published still appears on the public calendar."
					/>

					<FormField label="Tags" id="editTags" issues={[]}>
						<input
							id="editTags"
							name="tags"
							type="text"
							bind:value={editTags}
							class="input w-full"
							placeholder="e.g. open mic, workshop"
						/>
					</FormField>

					<!--
						`venueId` decides whether this listing holds the room; `location`
						stays the free-text line the guide prints, and the only thing a
						band listing ever had.
					-->
					{#if venues.length > 0}
						<FormField
							field={fields.venueId}
							type="select"
							label="Venue"
							bind:value={editVenueId}
							options={[
								{ value: '', label: 'The practice room' },
								...venues.filter((v) => !v.isPrimary).map((v) => ({ value: v.id, label: v.name }))
							]}
						/>
					{/if}

					<FormField label="Address line" id="editLocation" issues={[]}>
						<input
							id="editLocation"
							name="location"
							type="text"
							bind:value={editLocation}
							class="input w-full"
							placeholder="Venue name and address"
						/>
					</FormField>

					<FormField label="External ticket URL" id="editTicketUrl" issues={[]}>
						<input
							id="editTicketUrl"
							name="externalTicketUrl"
							type="url"
							bind:value={editExternalTicketUrl}
							class="input w-full"
							placeholder="https://..."
						/>
					</FormField>

					<!-- What attendees pay wherever they buy, so it applies to every
					     source. Only capacity depends on us doing the selling. -->
					<FormField label="Suggested price ($)" id="editTicketPrice" issues={[]}>
						<input
							id="editTicketPrice"
							type="number"
							bind:value={editTicketPriceDollars}
							min="0.01"
							step="0.01"
							placeholder="15.00"
							class="input w-full"
							required={editTicketingEnabled}
						/>
						<span class="mt-1 text-muted">
							Where the sliding scale opens. Leave blank for a free event.
						</span>
					</FormField>

					<FormField label="Minimum price ($)" id="editTicketFloor" issues={[]}>
						<input
							id="editTicketFloor"
							type="number"
							bind:value={editTicketFloorDollars}
							min="0"
							step="0.01"
							placeholder="0.00"
							class="input w-full"
						/>
						<span class="mt-1 text-muted">
							The least someone can pay. $0 lets anyone come for free — no card, no questions. Leave
							it at $0 unless an act needs a floor.
						</span>
					</FormField>

					{#if sellsHere}
						<div class="fieldset">
							<label class="label cursor-pointer justify-start gap-3">
								<input type="checkbox" bind:checked={editTicketingEnabled} class="toggle" />
								<span class="fieldset-legend">Sell tickets through the site</span>
							</label>
						</div>

						{#if editTicketingEnabled}
							<Card tone="base-200" class="p-4">
								<FormField label="Capacity" id="editTicketQuantity" issues={[]}>
									<input
										id="editTicketQuantity"
										name="ticketQuantity"
										type="number"
										bind:value={editTicketQuantity}
										min="1"
										step="1"
										placeholder="Unlimited"
										class="input w-full"
									/>
								</FormField>
								<p class="mt-2 text-muted">Leave capacity blank for unlimited tickets.</p>
							</Card>
						{/if}
					{/if}

					{#if rebookNeeded}
						<Alert type="warning">
							<div class="w-full space-y-3">
								<p class="font-medium">Reservation needs rebooking</p>
								<p class="text-sm">
									{rebookReason}. The existing reservation will be cancelled and a new one created.
								</p>

								<label class="label cursor-pointer justify-start gap-3">
									<input
										type="checkbox"
										bind:checked={rebookConfirmed}
										class="checkbox checkbox-sm"
									/>
									<span class="fieldset-legend">Confirm rebook</span>
								</label>

								{#if rebookConfirmed}
									<div class="mt-2 grid grid-cols-2 gap-4">
										<FormField label="Reservation start" id="editResStart" issues={[]}>
											<input
												id="editResStart"
												name="reservationStartTime"
												type="time"
												bind:value={editReservationStartTime}
												class="input w-full"
											/>
										</FormField>
										<FormField label="Reservation end" id="editResEnd" issues={[]}>
											<input
												id="editResEnd"
												name="reservationEndTime"
												type="time"
												bind:value={editReservationEndTime}
												class="input w-full"
											/>
										</FormField>
									</div>

									<ConflictWarnings
										date={editDate}
										startTime={editReservationStartTime}
										endTime={editReservationEndTime}
										{checkConflicts}
										excludeReservationId={linkedReservation?.id}
										bind:hasBlockingConflict
									/>
									{#if hasBlockingConflict}
										<label class="label cursor-pointer justify-start gap-3">
											<input
												type="checkbox"
												bind:checked={overrideConflicts}
												class="checkbox checkbox-sm"
											/>
											<span class="fieldset-legend">
												Book it anyway — I know this double-books the space
											</span>
										</label>
									{/if}
								{/if}
							</div>
						</Alert>
					{/if}

					{#if canReserveSpace && offSite}
						<p class="text-muted">
							Off-site, so the practice space stays bookable while this runs.
						</p>
					{:else if canReserveSpace}
						<div>
							<label class="label cursor-pointer justify-start gap-3">
								<input
									type="checkbox"
									bind:checked={reserveSpace}
									onchange={toggleReserveSpace}
									class="checkbox checkbox-sm"
								/>
								<span class="fieldset-legend">Reserve practice space</span>
							</label>

							{#if reserveSpace}
								<Card tone="base-200" class="mt-2 space-y-4 p-4">
									<p class="text-muted">
										Reservation times can differ from event times to allow for setup and teardown.
									</p>

									<div class="grid grid-cols-2 gap-4">
										<FormField label="Reservation start" id="editReserveStart" issues={[]}>
											<input
												id="editReserveStart"
												name="reservationStartTime"
												type="time"
												bind:value={editReservationStartTime}
												class="input w-full"
											/>
										</FormField>
										<FormField label="Reservation end" id="editReserveEnd" issues={[]}>
											<input
												id="editReserveEnd"
												name="reservationEndTime"
												type="time"
												bind:value={editReservationEndTime}
												class="input w-full"
											/>
										</FormField>
									</div>

									<ConflictWarnings
										date={editDate}
										startTime={editReservationStartTime}
										endTime={editReservationEndTime}
										{checkConflicts}
										bind:hasBlockingConflict
									/>
									{#if hasBlockingConflict}
										<label class="label cursor-pointer justify-start gap-3">
											<input
												type="checkbox"
												bind:checked={overrideConflicts}
												class="checkbox checkbox-sm"
											/>
											<span class="fieldset-legend">
												Book it anyway — I know this double-books the space
											</span>
										</label>
									{/if}
								</Card>
							{/if}
						</div>
					{/if}

					<div class="flex justify-end gap-2 pt-2">
						<!-- `type="button"`: a Button has no type of its own, so inside a
						     Form it submits. -->
						<Button type="button" variant="ghost" size="sm" onclick={oncancel}>Cancel</Button>
						<SubmitButton
							label="Save"
							variant="primary"
							size="sm"
							disabled={hasBlockingConflict && !overrideConflicts}
						/>
					</div>
				</div>
			</Form>
		</CardBody>
	</Card>

	{#snippet pending()}
		<Card>
			<CardBody class="flex items-center justify-center p-8">
				<span class="loading loading-md loading-spinner"></span>
			</CardBody>
		</Card>
	{/snippet}

	{#snippet failed(error, reset)}
		<Alert type="warning" {reset}>
			Could not load the edit form: {errorMessage(error)}
		</Alert>
	{/snippet}
</svelte:boundary>
