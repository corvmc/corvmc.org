<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import ConflictWarnings from '#lib/components/reservations/ConflictWarnings.svelte';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { focusHashOnNavigation } from '#lib/utils/focus-hash.js';
	import { updateEvent, checkRebook, checkConflicts } from '#lib/remote/events.remote.js';
	import { searchBillActs } from '#lib/remote/external-acts.remote.js';
	import { formatDollars, toLocalDate, toLocalTime } from '#lib/utils/format.js';
	import { eventTabHref } from './tabs';
	import {
		initialTickets,
		initialWhere,
		isoRange,
		shiftTime,
		ticketPosts,
		toMinutes,
		wherePosts,
		type Tickets,
		type Where
	} from './listing-form';

	/**
	 * The whole listing in one form and one Save: basics, when, where, performers
	 * and tickets, through `updateEvent` (#3271). Always mounted and seeded once;
	 * the page re-keys it after a save. A CMC show's bill is the Production tab's,
	 * and its sale's stats and comps are `ListingTicketing`, so neither is here.
	 */
	interface Props {
		event: {
			id: string;
			title: string;
			description: string | null;
			tags: string | null;
			kind: string | null;
			/** Selling through our own checkout is CMC's alone (`update()` refuses it elsewhere). */
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
		lineup: { id: string; name: string; bandId: string | null; actId: string | null }[];
		linkedReservation: { id: string; startsAt: Date; endsAt: Date } | null;
		venues: { id: string; name: string; isPrimary: boolean }[];
		/** The record stays editable, the sale and the room are not (#2126). */
		cancelled?: boolean;
		/** Shown, not editable: a cancelled event is staff's to correct. */
		readOnly?: boolean;
		onsaved: () => void;
	}

	let {
		event,
		lineup: savedLineup,
		linkedReservation,
		venues,
		cancelled = false,
		readOnly = false,
		onsaved
	}: Props = $props();

	focusHashOnNavigation();

	const { fields } = updateEvent;
	const sellsHere = $derived(event.source === 'cmc');
	const isProduction = $derived(event.source === 'cmc');
	const outsideVenues = $derived(venues.filter((v) => !v.isPrimary));

	let title = $state('');
	let description = $state('');
	let tags = $state('');
	let kind = $state('show');
	let date = $state('');
	let startTime = $state('');
	let endTime = $state('');
	let doorsTime = $state('');
	let where = $state<Where>('room');
	let venueId = $state('');
	let location = $state('');
	let address = $state('');
	let tickets = $state<Tickets>('none');
	let externalTicketUrl = $state('');
	let priceDollars = $state('');
	let floorDollars = $state('');
	let quantity = $state('');
	let holdStart = $state('');
	let holdEnd = $state('');
	let lineup = $state<LineupChip[]>([]);

	let rebookNeeded = $state(false);
	let rebookReason = $state('');
	let rebookConfirmed = $state(false);
	let overrideConflicts = $state(false);

	// Holding the space for a listing that never had a hold. Disjoint from
	// rebook: one with a reservation gets the rebook alert instead.
	let reserveSpace = $state(false);
	const canReserveSpace = $derived(!linkedReservation && !cancelled);

	// Only a real overlap (a booking or a closure) gates the override. An
	// advisory about hours or advance days asks for nothing.
	let hasBlockingConflict = $state(false);

	function seed() {
		title = event.title;
		description = event.description ?? '';
		tags = event.tags ?? '';
		kind = event.kind ?? 'show';
		date = toLocalDate(event.startsAt);
		startTime = toLocalTime(event.startsAt);
		endTime = event.endsAt ? toLocalTime(event.endsAt) : '';
		doorsTime = event.doorsAt ? toLocalTime(event.doorsAt) : '';
		where = initialWhere(event, !!linkedReservation, venues);
		venueId = venues.find((v) => v.id === event.venueId && !v.isPrimary)?.id ?? '';
		location = event.location ?? '';
		address = event.address ?? '';
		tickets = initialTickets(event);
		externalTicketUrl = event.externalTicketUrl ?? '';
		priceDollars = event.ticketPrice ? formatDollars(event.ticketPrice) : '';
		floorDollars = event.ticketPriceFloorCents ? formatDollars(event.ticketPriceFloorCents) : '';
		quantity = event.ticketQuantity ? String(event.ticketQuantity) : '';
		holdStart = linkedReservation ? toLocalTime(linkedReservation.startsAt) : '';
		holdEnd = linkedReservation ? toLocalTime(linkedReservation.endsAt) : '';
		lineup = savedLineup.map((l) => ({
			name: l.name,
			bandId: l.bandId ?? undefined,
			actId: l.actId ?? undefined
		}));
	}
	seed();

	const holdOpen = $derived(
		where === 'room' && ((rebookNeeded && rebookConfirmed) || reserveSpace)
	);
	const placed = $derived(
		wherePosts(where, {
			venueId,
			hasHold: !!linkedReservation,
			cancelled,
			holdWanted: holdOpen,
			holdStart,
			holdEnd
		})
	);
	// A cancelled event's sale is closed: its terms are shown, not posted.
	const ticketed = $derived(
		cancelled
			? {}
			: ticketPosts(tickets, event.source, {
					externalTicketUrl,
					price: priceDollars,
					floor: floorDollars,
					quantity
				})
	);

	/**
	 * Show the hold as the event's own window when it is asked for. The server
	 * falls back to exactly this, so the fields are an optional setup/teardown
	 * override.
	 */
	function toggleReserveSpace() {
		if (reserveSpace) {
			holdStart = startTime;
			holdEnd = endTime;
			lastStartTime = startTime;
			lastEndTime = endTime;
		} else {
			clearHold();
		}
	}

	function clearHold() {
		holdStart = '';
		holdEnd = '';
		hasBlockingConflict = false;
		overrideConflicts = false;
	}

	// A hold is the room's, so leaving it drops a pending hold and its override.
	function chooseWhere() {
		if (where === 'venue' && !venueId) venueId = outsideVenues[0]?.id ?? '';
		if (where === 'room') return;
		reserveSpace = false;
		rebookConfirmed = false;
		if (!linkedReservation) clearHold();
		else {
			hasBlockingConflict = false;
			overrideConflicts = false;
		}
	}

	// A new hold's window is setup and teardown padding around the show, so it
	// moves when the show is re-timed (#1866). Run from the inputs, not an effect.
	let lastStartTime = '';
	let lastEndTime = '';
	function carryHoldWindow() {
		if (!reserveSpace) return;
		if (startTime && lastStartTime && holdStart) {
			holdStart = shiftTime(holdStart, toMinutes(startTime) - toMinutes(lastStartTime));
		}
		if (endTime && lastEndTime && holdEnd) {
			holdEnd = shiftTime(holdEnd, toMinutes(endTime) - toMinutes(lastEndTime));
		}
		lastStartTime = startTime;
		lastEndTime = endTime;
	}

	function retimed() {
		carryHoldWindow();
		void checkForRebook();
	}

	async function checkForRebook() {
		if (cancelled || !linkedReservation || !date || !startTime || !endTime) {
			rebookNeeded = false;
			return;
		}
		const range = isoRange(date, startTime, endTime);
		const result = await checkRebook({
			eventId: event.id,
			newStartsAt: range.startsAt,
			newEndsAt: range.endsAt
		});
		rebookNeeded = result.needed;
		rebookReason = result.reason ?? '';
		if (result.needed) {
			holdStart = startTime;
			holdEnd = endTime;
			rebookConfirmed = false;
		}
	}

	/** The check is scoped to this listing, so its guard can admit the show's committee. */
	const checkListingConflicts = (params: Omit<Parameters<typeof checkConflicts>[0], 'eventId'>) =>
		checkConflicts({ ...params, eventId: event.id });

	const WHERE_CHOICES = $derived<{ value: Where; label: string }[]>([
		{ value: 'room', label: m.staff_events_id_listing_form_room_label() },
		...(outsideVenues.length > 0
			? [{ value: 'venue' as const, label: m.staff_events_id_listing_form_venue_label() }]
			: []),
		{ value: 'other', label: m.staff_events_id_listing_form_elsewhere_label() }
	]);
	const TICKET_CHOICES = $derived<{ value: Tickets; label: string }[]>([
		{ value: 'none', label: m.staff_events_id_listing_form_no_tickets_label() },
		{ value: 'link', label: m.staff_events_id_listing_form_ticket_link_label() },
		...(sellsHere
			? [{ value: 'cmc' as const, label: m.staff_events_id_listing_form_through_cmc_label() }]
			: [])
	]);
	const whereState = $derived(
		where !== 'room'
			? m.staff_events_id_listing_form_off_site_label()
			: linkedReservation
				? m.staff_events_id_listing_form_held_label()
				: m.staff_events_id_listing_form_not_held_label()
	);
	const ticketState = $derived(
		tickets === 'band'
			? m.staff_events_id_listing_form_band_sells_label()
			: TICKET_CHOICES.find((c) => c.value === tickets)?.label
	);
</script>

<svelte:boundary>
	<Form
		remote={updateEvent}
		guard
		successToast={m.events_listing_edit_form_success_toast()}
		onsuccess={onsaved}
		data-testid="listing-form"
	>
		<input {...fields.eventId.as('hidden', event.id)} />
		{#if where !== 'venue'}
			<input {...fields.venueId.as('hidden', placed.venueId)} />
		{/if}
		{#if ticketed.ticketingEnabled !== undefined}
			<input {...fields.ticketingEnabled.as('hidden', ticketed.ticketingEnabled)} />
		{/if}
		{#if ticketed.externalTicketUrl !== undefined}
			<input {...fields.externalTicketUrl.as('hidden', ticketed.externalTicketUrl)} />
		{/if}
		{#if ticketed.ticketPrice !== undefined}
			<input {...fields.ticketPrice.as('hidden', ticketed.ticketPrice)} />
		{/if}
		{#if ticketed.ticketPriceFloorCents !== undefined}
			<input {...fields.ticketPriceFloorCents.as('hidden', ticketed.ticketPriceFloorCents)} />
		{/if}
		{#if ticketed.ticketQuantity !== undefined}
			<input {...fields.ticketQuantity.as('hidden', ticketed.ticketQuantity)} />
		{/if}
		{#if placed.rebookReservation}
			<input {...fields.rebookReservation.as('hidden', true)} />
		{/if}
		{#if placed.releaseHold}
			<input {...fields.releaseHold.as('hidden', true)} />
		{/if}
		{#if overrideConflicts}
			<input {...fields.overrideConflicts.as('hidden', true)} />
		{/if}

		<fieldset class="flex min-w-0 flex-col gap-6" disabled={readOnly}>
			<InfoCard title={m.staff_events_id_listing_form_basics_title()}>
				<div class="space-y-4">
					<div id="listing-title">
						<FormField
							field={fields.title}
							label={m.events_title_label()}
							bind:value={title}
							required
						/>
					</div>

					<div id="listing-description">
						<FormField
							field={fields.description}
							type="textarea"
							label={m.events_listing_edit_form_description_label()}
							bind:value={description}
						/>
					</div>

					<FormField
						field={fields.kind}
						type="select"
						label={m.events_kind_label()}
						bind:value={kind}
						options={[
							{ value: 'show', label: m.events_show_label() },
							{ value: 'work_party', label: m.events_work_party_label() },
							{ value: 'meeting', label: m.events_meeting_label() },
							{ value: 'class', label: m.events_class_label() },
							{ value: 'market', label: m.events_market_label() }
						]}
						description={m.events_only_shows_reach_homepage_posters_body()}
					/>

					<FormField
						field={fields.tags}
						label={m.events_listing_edit_form_tags_label()}
						bind:value={tags}
						placeholder={m.events_listing_edit_form_e_g_open_mic_workshop_placeholder()}
					/>
				</div>
			</InfoCard>

			<InfoCard title={m.staff_events_id_listing_form_when_title()}>
				<div class="space-y-4">
					<div id="listing-date">
						<FormField
							field={fields.eventDate}
							type="date"
							label={m.events_date_label()}
							bind:value={date}
							required
							onchange={checkForRebook}
						/>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<FormField
							field={fields.eventStartTime}
							type="time"
							label={m.events_start_time_label()}
							bind:value={startTime}
							required
							onchange={retimed}
						/>
						<FormField
							field={fields.eventEndTime}
							type="time"
							label={m.events_end_time_label()}
							bind:value={endTime}
							required
							onchange={retimed}
						/>
					</div>

					<FormField
						field={fields.doorsTime}
						type="time"
						label={m.events_listing_edit_form_doors_time_label()}
						bind:value={doorsTime}
					/>
				</div>
			</InfoCard>

			<InfoCard title={m.staff_events_id_listing_form_where_title()} state={whereState}>
				<div class="space-y-4">
					<!-- `venueId` decides whether this listing holds the room, so the choice is
					     what is posted; "somewhere else" is a blank venue and a typed place. -->
					<FormField label={m.staff_events_id_listing_form_place_label()} id="where" issues={[]}>
						<div class="join">
							{#each WHERE_CHOICES as choice (choice.value)}
								<input
									type="radio"
									class="btn join-item"
									aria-label={choice.label}
									value={choice.value}
									bind:group={where}
									onchange={chooseWhere}
								/>
							{/each}
						</div>
					</FormField>

					{#if where === 'venue'}
						<FormField
							field={fields.venueId}
							type="select"
							label={m.events_listing_edit_form_venue_label()}
							bind:value={venueId}
							required
							options={outsideVenues.map((v) => ({ value: v.id, label: v.name }))}
						/>
					{:else if where === 'other'}
						<FormField
							field={fields.location}
							label={m.events_listing_edit_form_venue_name_label()}
							bind:value={location}
						/>
						<FormField
							field={fields.address}
							label={m.events_listing_edit_form_address_label()}
							bind:value={address}
						/>
					{/if}

					{#if where !== 'room' && !cancelled}
						<p class="text-muted" data-testid="offsite-note">
							{#if linkedReservation}
								{m.staff_events_id_listing_form_off_site_releases_text()}
							{:else}
								{m.events_listing_edit_form_off_site_so_practice_space_text()}
							{/if}
						</p>
					{/if}

					{#if where === 'room' && rebookNeeded}
						<Alert type="warning">
							<div class="w-full space-y-3">
								<p class="font-medium">
									{m.events_listing_edit_form_reservation_needs_rebooking_text()}
								</p>
								<p class="text-sm">
									{m.events_listing_edit_form_existing_reservation_will_cancelled_text({
										rebookReason
									})}
								</p>
								<FormField id="confirmRebook" issues={[]}>
									<label class="label cursor-pointer justify-start gap-3">
										<input
											type="checkbox"
											bind:checked={rebookConfirmed}
											data-testid="confirm-rebook"
											class="checkbox checkbox-sm"
										/>
										<span class="fieldset-legend"
											>{m.events_listing_edit_form_confirm_rebook_label()}</span
										>
									</label>
								</FormField>
							</div>
						</Alert>
					{/if}

					{#if where === 'room' && canReserveSpace}
						<FormField id="reserveSpace" issues={[]}>
							<label class="label cursor-pointer justify-start gap-3">
								<input
									type="checkbox"
									bind:checked={reserveSpace}
									data-testid="reserve-space"
									onchange={toggleReserveSpace}
									class="checkbox checkbox-sm"
								/>
								<span class="fieldset-legend"
									>{m.events_listing_edit_form_reserve_practice_space_label()}</span
								>
							</label>
						</FormField>
					{/if}

					{#if holdOpen}
						<Card tone="base-200" class="space-y-4 p-4">
							<p class="text-muted">
								{m.events_listing_edit_form_reservation_times_can_differ_from_text()}
							</p>

							<div class="grid grid-cols-2 gap-4">
								<FormField
									field={fields.reservationStartTime}
									type="time"
									label={m.events_listing_edit_form_reservation_start_label()}
									bind:value={holdStart}
								/>
								<FormField
									field={fields.reservationEndTime}
									type="time"
									label={m.events_listing_edit_form_reservation_end_label()}
									bind:value={holdEnd}
								/>
							</div>

							<ConflictWarnings
								{date}
								startTime={holdStart}
								endTime={holdEnd}
								checkConflicts={checkListingConflicts}
								excludeReservationId={linkedReservation?.id}
								bind:hasBlockingConflict
							/>
							{#if hasBlockingConflict}
								<FormField id="overrideConflicts" issues={[]}>
									<label class="label cursor-pointer justify-start gap-3">
										<input
											type="checkbox"
											bind:checked={overrideConflicts}
											data-testid="override-conflicts"
											class="checkbox checkbox-sm"
										/>
										<span class="fieldset-legend">
											{m.events_listing_edit_form_book_anyway_i_know_double_label()}
										</span>
									</label>
								</FormField>
							{/if}
						</Card>
					{/if}
				</div>
			</InfoCard>

			<InfoCard title={m.staff_events_id_listing_form_performers_title()}>
				{#if isProduction}
					<!-- A CMC show's acts are edited on the Production tab (#3272). -->
					<ul class="space-y-1 text-sm">
						{#each savedLineup as act (act.id)}
							<li class="font-medium">{act.name}</li>
						{/each}
					</ul>
					<div class="mt-3">
						<Button href={eventTabHref(event.id, 'production')} variant="ghost" size="sm">
							{m.staff_events_id_bill_edit_lineup_label()}
						</Button>
					</div>
				{:else}
					<LineupEditor
						field={fields.lineup}
						bind:value={lineup}
						readonly={readOnly}
						search={(q) => searchBillActs({ eventId: event.id, q })}
					/>
				{/if}
			</InfoCard>

			<InfoCard title={m.staff_events_id_listing_form_tickets_title()} state={ticketState}>
				{#if cancelled}
					{#if event.externalTicketUrl}
						<a
							href={event.externalTicketUrl}
							class="link text-sm"
							target="_blank"
							rel="noopener noreferrer external"
						>
							{m.staff_events_id_tickets_text()}
						</a>
					{:else}
						<p class="text-muted">{m.staff_events_id_listing_form_no_tickets_text()}</p>
					{/if}
				{:else if tickets === 'band'}
					<p class="text-muted">{m.staff_events_id_listing_form_band_sells_text()}</p>
				{:else}
					<div class="space-y-4">
						<FormField label={m.staff_events_id_listing_form_sold_label()} id="tickets" issues={[]}>
							<div class="join">
								{#each TICKET_CHOICES as choice (choice.value)}
									<input
										type="radio"
										class="btn join-item"
										aria-label={choice.label}
										value={choice.value}
										bind:group={tickets}
									/>
								{/each}
							</div>
						</FormField>

						{#if tickets === 'link'}
							<FormField
								label={m.events_listing_edit_form_external_ticket_url_label()}
								id="ticketUrl"
								issues={[]}
							>
								<input
									id="ticketUrl"
									type="url"
									bind:value={externalTicketUrl}
									class="input w-full"
									placeholder={m.events_listing_edit_form_https_placeholder()}
								/>
							</FormField>
						{/if}

						{#if tickets !== 'none'}
							<FormField
								label={m.events_listing_edit_form_suggested_price_label()}
								id="ticketPrice"
								description={m.events_listing_edit_form_where_sliding_scale_opens_leave_body()}
								issues={[]}
							>
								<input
									id="ticketPrice"
									type="number"
									bind:value={priceDollars}
									min="0.01"
									step="0.01"
									placeholder="15.00"
									class="input w-full"
									required={tickets === 'cmc'}
								/>
							</FormField>
						{/if}

						{#if tickets === 'cmc'}
							<FormField
								label={m.events_listing_edit_form_minimum_price_label()}
								id="ticketFloor"
								description={m.events_listing_edit_form_least_someone_can_pay_0_body()}
								issues={[]}
							>
								<input
									id="ticketFloor"
									type="number"
									bind:value={floorDollars}
									min="0"
									step="0.01"
									placeholder="0.00"
									class="input w-full"
								/>
							</FormField>

							<FormField
								label={m.events_capacity_label()}
								id="ticketQuantity"
								description={m.events_listing_edit_form_leave_capacity_blank_unlimited_tick_body()}
								issues={[]}
							>
								<input
									id="ticketQuantity"
									type="number"
									bind:value={quantity}
									min="1"
									step="1"
									placeholder={m.events_listing_edit_form_unlimited_placeholder()}
									class="input w-full"
								/>
							</FormField>
						{/if}
					</div>
				{/if}
			</InfoCard>
		</fieldset>

		{#if !readOnly}
			<div class="mt-6 flex justify-end">
				<SubmitButton
					label={m.events_save_label()}
					variant="primary"
					disabled={hasBlockingConflict && !overrideConflicts}
				/>
			</div>
		{/if}
	</Form>

	{#snippet failed(error, reset)}
		<Alert type="warning" {reset}>
			{m.events_listing_edit_form_could_not_load_edit_form_body({
				errorMessage: errorMessage(error)
			})}
		</Alert>
	{/snippet}
</svelte:boundary>
