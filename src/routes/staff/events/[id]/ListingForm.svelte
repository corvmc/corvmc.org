<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import ConflictWarnings from '#lib/components/reservations/ConflictWarnings.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { focusHashOnNavigation } from '#lib/utils/focus-hash.js';
	import { updateEvent, checkRebook, checkConflicts } from '#lib/remote/events.remote.js';
	import { searchBillActs } from '#lib/remote/external-acts.remote.js';
	import { formatDollars, toLocalDate, toLocalTime } from '#lib/utils/format.js';
	import type { ReservationRef } from '#lib/types/entity.js';
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
		linkedReservation: { id: string; startsAt: Date; endsAt: Date; ref: ReservationRef } | null;
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
	// Release hold is staged: nothing is written until Save.
	let releasing = $state(false);
	// The window Book anyway was pressed for. A different window asks again.
	let overrideFor = $state('');

	// Only a real overlap (a booking or a closure) gates the override. An
	// advisory about hours or advance days asks for nothing.
	let hasBlockingConflict = $state(false);

	// The show's times as last carried into the hold window.
	let lastStartTime = '';
	let lastEndTime = '';

	function seed() {
		title = event.title;
		description = event.description ?? '';
		tags = event.tags ?? '';
		kind = event.kind ?? 'show';
		date = toLocalDate(event.startsAt);
		startTime = toLocalTime(event.startsAt);
		endTime = event.endsAt ? toLocalTime(event.endsAt) : '';
		lastStartTime = startTime;
		lastEndTime = endTime;
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

	const savedHold = $derived(
		linkedReservation
			? {
					start: toLocalTime(linkedReservation.startsAt),
					end: toLocalTime(linkedReservation.endsAt)
				}
			: null
	);
	// A CMC show is expected to hold the room, so it says "not held" where a
	// community listing says nothing.
	const showsHold = $derived(isProduction || !!linkedReservation);
	const holdMoved = $derived(
		!!savedHold && (holdStart !== savedHold.start || holdEnd !== savedHold.end)
	);
	// Hold from and until are offered whenever the room is chosen.
	const holdOpen = $derived(where === 'room' && !cancelled && !releasing);
	const holdWanted = $derived(
		holdOpen && (linkedReservation ? holdMoved || (rebookNeeded && rebookConfirmed) : true)
	);
	const holdWindow = $derived(holdOpen && !!holdStart && !!holdEnd);
	const blocked = $derived(holdWindow && hasBlockingConflict);
	const windowKey = $derived(`${date}|${holdStart}|${holdEnd}`);
	const overridden = $derived(blocked && overrideFor === windowKey);
	const placed = $derived(
		wherePosts(where, {
			venueId,
			hasHold: !!linkedReservation,
			cancelled,
			releasing,
			holdWanted,
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

	// A hold is the room's, so leaving it drops a staged release and any override.
	// Choosing the room with nothing held starts the window at the show's own times;
	// the fields are an optional setup/teardown override, and blank holds nothing.
	function chooseWhere() {
		if (where === 'venue' && !venueId) venueId = outsideVenues[0]?.id ?? '';
		overrideFor = '';
		hasBlockingConflict = false;
		releasing = false;
		if (where !== 'room') {
			rebookConfirmed = false;
			if (!linkedReservation) {
				holdStart = '';
				holdEnd = '';
			}
			return;
		}
		if (!linkedReservation) {
			holdStart = startTime;
			holdEnd = endTime;
			lastStartTime = startTime;
			lastEndTime = endTime;
		}
	}

	// The server renders the form before it is interactive; `ready` marks the
	// moment it has mounted, for the e2e specs and anything else that must wait.
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});

	function releaseHold() {
		releasing = true;
		overrideFor = '';
		hasBlockingConflict = false;
	}

	function bookAnyway() {
		overrideFor = windowKey;
	}

	// A new hold's window is setup and teardown padding around the show, so it
	// moves when the show is re-timed (#1866). Run from the inputs, not an effect.
	function carryHoldWindow() {
		if (!linkedReservation && where === 'room') {
			if (startTime && lastStartTime && holdStart) {
				holdStart = shiftTime(holdStart, toMinutes(startTime) - toMinutes(lastStartTime));
			}
			if (endTime && lastEndTime && holdEnd) {
				holdEnd = shiftTime(holdEnd, toMinutes(endTime) - toMinutes(lastEndTime));
			}
		}
		lastStartTime = startTime;
		lastEndTime = endTime;
	}

	function retimed() {
		carryHoldWindow();
		void checkForRebook();
	}

	async function checkForRebook() {
		const wasNeeded = rebookNeeded;
		if (cancelled || !linkedReservation || !date || !startTime || !endTime) {
			rebookNeeded = false;
		} else {
			const range = isoRange(date, startTime, endTime);
			const result = await checkRebook({
				eventId: event.id,
				newStartsAt: range.startsAt,
				newEndsAt: range.endsAt
			});
			rebookNeeded = result.needed;
			rebookReason = result.reason ?? '';
		}
		// The window follows the show only once Rebook the hold is pressed, and
		// moving the show back inside the hold withdraws that.
		if (wasNeeded && !rebookNeeded && savedHold) {
			holdStart = savedHold.start;
			holdEnd = savedHold.end;
			rebookConfirmed = false;
		}
	}

	function rebookHold() {
		holdStart = startTime;
		holdEnd = endTime;
		rebookConfirmed = true;
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
			: linkedReservation && !releasing
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
		data-ready={ready || undefined}
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
		{#if overridden}
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

					{#if where === 'room' && showsHold}
						<div class="space-y-3" data-testid="space-hold">
							{#if linkedReservation}
								<EntityIdentity ref={linkedReservation.ref} size="md" status />
							{/if}
							{#if releasing}
								<div class="flex flex-wrap items-center gap-3">
									<p class="text-muted">{m.staff_events_id_listing_form_releasing_text()}</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onclick={() => (releasing = false)}
									>
										{m.staff_events_id_listing_form_keep_hold_label()}
									</Button>
								</div>
							{:else if linkedReservation}
								<div class="flex flex-wrap items-center gap-3">
									<p class="font-medium">
										{blocked
											? m.staff_events_id_listing_form_held_conflict_text()
											: m.staff_events_id_listing_form_held_clear_text()}
									</p>
									{#if !cancelled}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={releaseHold}
											data-testid="release-hold"
										>
											{m.staff_events_id_listing_form_release_hold_label()}
										</Button>
									{/if}
								</div>
							{:else}
								<p class="text-muted">{m.staff_events_id_listing_form_no_hold_text()}</p>
							{/if}
						</div>
					{/if}

					{#if where === 'room' && linkedReservation && rebookNeeded && !cancelled && !releasing}
						<Alert type="warning">
							<div class="w-full space-y-3">
								<p class="font-medium">
									{m.events_listing_edit_form_reservation_needs_rebooking_text()}
								</p>
								<p class="text-sm">
									{rebookConfirmed
										? m.staff_events_id_listing_form_rebooked_text()
										: m.staff_events_id_listing_form_rebook_moves_text({ rebookReason })}
								</p>
							</div>
							{#snippet action()}
								{#if !rebookConfirmed}
									<Button
										type="button"
										variant="default"
										size="sm"
										onclick={rebookHold}
										data-testid="confirm-rebook"
									>
										{m.staff_events_id_listing_form_rebook_hold_label()}
									</Button>
								{/if}
							{/snippet}
						</Alert>
					{/if}

					{#if holdOpen}
						<Card tone="base-200" class="space-y-4 p-4">
							<p class="text-muted">
								{linkedReservation
									? m.events_listing_edit_form_reservation_times_can_differ_from_text()
									: m.staff_events_id_listing_form_hold_blank_text()}
							</p>

							<!-- The show's re-timing rewrites these in code, and FormField's field mode
							     only passes `value` one way: a typed-in box would keep showing and
							     posting its old text. A bound input follows the state. -->
							<div class="grid grid-cols-2 gap-4">
								<FormField
									field={fields.reservationStartTime}
									label={m.staff_events_id_listing_form_hold_from_label()}
								>
									{#snippet input(id)}
										<input
											{id}
											{...fields.reservationStartTime.as('text')}
											type="time"
											bind:value={holdStart}
											required={!!linkedReservation}
											class="input w-full"
										/>
									{/snippet}
								</FormField>
								<FormField
									field={fields.reservationEndTime}
									label={m.staff_events_id_listing_form_hold_until_label()}
								>
									{#snippet input(id)}
										<input
											{id}
											{...fields.reservationEndTime.as('text')}
											type="time"
											bind:value={holdEnd}
											required={!!linkedReservation}
											class="input w-full"
										/>
									{/snippet}
								</FormField>
							</div>

							{#if holdWindow}
								<ConflictWarnings
									{date}
									startTime={holdStart}
									endTime={holdEnd}
									checkConflicts={checkListingConflicts}
									excludeReservationId={linkedReservation?.id}
									bind:hasBlockingConflict
								/>
							{/if}
							{#if blocked}
								{#if overridden}
									<p class="text-sm font-medium">
										{m.staff_events_id_listing_form_booking_anyway_text()}
									</p>
								{:else}
									<div>
										<Button
											type="button"
											variant="warning"
											size="sm"
											onclick={bookAnyway}
											data-testid="override-conflicts"
										>
											{m.staff_events_id_listing_form_book_anyway_label()}
										</Button>
									</div>
								{/if}
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
					disabled={blocked && !overridden}
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
