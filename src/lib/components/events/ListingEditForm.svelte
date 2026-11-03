<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { addIsoDays } from '$lib/utils/deadline';
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
	import { clubInstant, formatDollars, toLocalDate, toLocalTime } from '$lib/utils/format';

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
			address: string | null;
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
		/** It stays cancelled: the record is editable, the sale and the room are not (#2126). */
		cancelled?: boolean;
		onsaved: () => void;
		oncancel: () => void;
	}

	let { event, linkedReservation, venues, cancelled = false, onsaved, oncancel }: Props = $props();

	const { fields } = updateEvent;
	const sellsHere = $derived(event.source === 'cmc');

	let editTitle = $state('');
	let editDescription = $state('');
	let editTags = $state('');
	let editKind = $state('show');
	let editLocation = $state('');
	let editAddress = $state('');
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
	const canReserveSpace = $derived(!linkedReservation && !cancelled);
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
		editAddress = event.address ?? '';
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
		return addIsoDays(date, 1);
	}

	/** The rebook check compares instants, so the wall clock is read in club time. */
	function isoRange(date: string, startTime: string, endTime: string) {
		const startsAt = clubInstant(date, startTime);
		// A show that ends past midnight ends the next day, as the server builds it.
		const endsOnNextDay = clubInstant(date, endTime) < startsAt;
		const endsAt = clubInstant(endsOnNextDay ? nextDay(date) : date, endTime);
		return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
	}

	async function checkForRebook() {
		if (cancelled || !linkedReservation || !editDate || !editStartTime || !editEndTime) {
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

	/** The check is scoped to this listing, so its guard can admit the show's committee. */
	const checkListingConflicts = (params: Omit<Parameters<typeof checkConflicts>[0], 'eventId'>) =>
		checkConflicts({ ...params, eventId: event.id });
</script>

<svelte:boundary>
	<Card>
		<CardBody class="space-y-4">
			<h3 class="text-muted font-medium">{m.events_listing_edit_form_edit_listing()}</h3>

			<Form
				remote={updateEvent}
				guard
				successToast={m.events_listing_edit_form_success_toast()}
				onsuccess={onsaved}
			>
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
					<FormField label={m.events_title()} id="editTitle" issues={[]}>
						<input
							id="editTitle"
							name="title"
							type="text"
							bind:value={editTitle}
							class="input w-full"
							required
						/>
					</FormField>

					<FormField label={m.events_listing_edit_form_description()} id="editDesc" issues={[]}>
						<textarea
							id="editDesc"
							name="description"
							bind:value={editDescription}
							class="textarea w-full"
							rows="4"></textarea>
					</FormField>

					<FormField label={m.events_date()} id="editDate" issues={[]}>
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
						<FormField label={m.events_start_time()} id="editStartTime" issues={[]}>
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

						<FormField label={m.events_end_time()} id="editEndTime" issues={[]}>
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

					<FormField label={m.events_listing_edit_form_doors_time()} id="editDoorsTime" issues={[]}>
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
						label={m.events_kind()}
						bind:value={editKind}
						options={[
							{ value: 'show', label: m.events_show() },
							{ value: 'work_party', label: m.events_work_party() },
							{ value: 'meeting', label: m.events_meeting() },
							{ value: 'class', label: m.events_class() },
							{ value: 'market', label: m.events_market() }
						]}
						description={m.events_only_shows_reach_homepage_posters()}
					/>

					<FormField label={m.events_listing_edit_form_tags()} id="editTags" issues={[]}>
						<input
							id="editTags"
							name="tags"
							type="text"
							bind:value={editTags}
							class="input w-full"
							placeholder={m.events_listing_edit_form_e_g_open_mic_workshop()}
						/>
					</FormField>

					<!--
						`venueId` decides whether this listing holds the room; `location`
						and `address` stay the free text the guide prints, and the only
						thing a band listing ever had.
					-->
					{#if venues.length > 0}
						<FormField
							field={fields.venueId}
							type="select"
							label={m.events_listing_edit_form_venue()}
							bind:value={editVenueId}
							options={[
								{ value: '', label: m.events_listing_edit_form_practice_room() },
								...venues.filter((v) => !v.isPrimary).map((v) => ({ value: v.id, label: v.name }))
							]}
						/>
					{/if}

					<FormField label={m.events_listing_edit_form_venue_name()} id="editLocation" issues={[]}>
						<input
							id="editLocation"
							name="location"
							type="text"
							bind:value={editLocation}
							class="input w-full"
						/>
					</FormField>

					<FormField label={m.events_listing_edit_form_address()} id="editAddress" issues={[]}>
						<input
							id="editAddress"
							name="address"
							type="text"
							bind:value={editAddress}
							class="input w-full"
						/>
					</FormField>

					<FormField
						label={m.events_listing_edit_form_external_ticket_url()}
						id="editTicketUrl"
						issues={[]}
					>
						<input
							id="editTicketUrl"
							name="externalTicketUrl"
							type="url"
							bind:value={editExternalTicketUrl}
							class="input w-full"
							placeholder={m.events_listing_edit_form_https()}
						/>
					</FormField>

					{#if !cancelled}
						<!-- What attendees pay wherever they buy, so it applies to every
					     source. Only capacity depends on us doing the selling. -->
						<FormField
							label={m.events_listing_edit_form_suggested_price()}
							id="editTicketPrice"
							issues={[]}
						>
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
								{m.events_listing_edit_form_where_sliding_scale_opens_leave()}
							</span>
						</FormField>

						<FormField
							label={m.events_listing_edit_form_minimum_price()}
							id="editTicketFloor"
							issues={[]}
						>
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
								{m.events_listing_edit_form_least_someone_can_pay_0()}
							</span>
						</FormField>

						{#if sellsHere}
							<div class="fieldset">
								<label class="label cursor-pointer justify-start gap-3">
									<input type="checkbox" bind:checked={editTicketingEnabled} class="toggle" />
									<span class="fieldset-legend"
										>{m.events_listing_edit_form_sell_tickets_through_site()}</span
									>
								</label>
							</div>

							{#if editTicketingEnabled}
								<Card tone="base-200" class="p-4">
									<FormField label={m.events_capacity()} id="editTicketQuantity" issues={[]}>
										<input
											id="editTicketQuantity"
											name="ticketQuantity"
											type="number"
											bind:value={editTicketQuantity}
											min="1"
											step="1"
											placeholder={m.events_listing_edit_form_unlimited()}
											class="input w-full"
										/>
									</FormField>
									<p class="mt-2 text-muted">
										{m.events_listing_edit_form_leave_capacity_blank_unlimited_tick()}
									</p>
								</Card>
							{/if}
						{/if}
					{/if}

					{#if rebookNeeded}
						<Alert type="warning">
							<div class="w-full space-y-3">
								<p class="font-medium">
									{m.events_listing_edit_form_reservation_needs_rebooking()}
								</p>
								<p class="text-sm">
									{m.events_listing_edit_form_existing_reservation_will_cancelled({ rebookReason })}
								</p>

								<label class="label cursor-pointer justify-start gap-3">
									<input
										type="checkbox"
										bind:checked={rebookConfirmed}
										data-testid="confirm-rebook"
										class="checkbox checkbox-sm"
									/>
									<span class="fieldset-legend">{m.events_listing_edit_form_confirm_rebook()}</span>
								</label>

								{#if rebookConfirmed}
									<div class="mt-2 grid grid-cols-2 gap-4">
										<FormField
											label={m.events_listing_edit_form_reservation_start()}
											id="editResStart"
											issues={[]}
										>
											<input
												id="editResStart"
												name="reservationStartTime"
												type="time"
												bind:value={editReservationStartTime}
												class="input w-full"
											/>
										</FormField>
										<FormField
											label={m.events_listing_edit_form_reservation_end()}
											id="editResEnd"
											issues={[]}
										>
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
										checkConflicts={checkListingConflicts}
										excludeReservationId={linkedReservation?.id}
										bind:hasBlockingConflict
									/>
									{#if hasBlockingConflict}
										<label class="label cursor-pointer justify-start gap-3">
											<input
												type="checkbox"
												bind:checked={overrideConflicts}
												data-testid="override-conflicts"
												class="checkbox checkbox-sm"
											/>
											<span class="fieldset-legend">
												{m.events_listing_edit_form_book_anyway_i_know_double()}
											</span>
										</label>
									{/if}
								{/if}
							</div>
						</Alert>
					{/if}

					{#if canReserveSpace && offSite}
						<p class="text-muted" data-testid="offsite-note">
							{m.events_listing_edit_form_off_site_so_practice_space()}
						</p>
					{:else if canReserveSpace}
						<div>
							<label class="label cursor-pointer justify-start gap-3">
								<input
									type="checkbox"
									bind:checked={reserveSpace}
									data-testid="reserve-space"
									onchange={toggleReserveSpace}
									class="checkbox checkbox-sm"
								/>
								<span class="fieldset-legend"
									>{m.events_listing_edit_form_reserve_practice_space()}</span
								>
							</label>

							{#if reserveSpace}
								<Card tone="base-200" class="mt-2 space-y-4 p-4">
									<p class="text-muted">
										{m.events_listing_edit_form_reservation_times_can_differ_from()}
									</p>

									<div class="grid grid-cols-2 gap-4">
										<FormField
											label={m.events_listing_edit_form_reservation_start()}
											id="editReserveStart"
											issues={[]}
										>
											<input
												id="editReserveStart"
												name="reservationStartTime"
												type="time"
												bind:value={editReservationStartTime}
												class="input w-full"
											/>
										</FormField>
										<FormField
											label={m.events_listing_edit_form_reservation_end()}
											id="editReserveEnd"
											issues={[]}
										>
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
										checkConflicts={checkListingConflicts}
										bind:hasBlockingConflict
									/>
									{#if hasBlockingConflict}
										<label class="label cursor-pointer justify-start gap-3">
											<input
												type="checkbox"
												bind:checked={overrideConflicts}
												data-testid="override-conflicts"
												class="checkbox checkbox-sm"
											/>
											<span class="fieldset-legend">
												{m.events_listing_edit_form_book_anyway_i_know_double()}
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
						<Button type="button" variant="ghost" size="sm" onclick={oncancel}
							>{m.events_cancel()}</Button
						>
						<SubmitButton
							label={m.events_save()}
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
			{m.events_listing_edit_form_could_not_load_edit_form({ errorMessage: errorMessage(error) })}
		</Alert>
	{/snippet}
</svelte:boundary>
