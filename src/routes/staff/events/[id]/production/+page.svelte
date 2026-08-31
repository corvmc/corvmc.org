<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { responseErrorMessage } from '$lib/api';
	import { CompTicketsAction } from '$lib/components/actions';
	import {
		getStaffEventProduction,
		updateEvent,
		checkRebook,
		checkConflicts,
		cancelEventSeries
	} from '$lib/remote/events.remote';
	const { fields } = updateEvent;
	import ConflictWarnings from '$lib/components/reservations/ConflictWarnings.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import {
		formatCents,
		formatDateShort,
		formatDollars,
		formatTime,
		formatTimeRange,
		fullDate,
		toLocalDate,
		toLocalDateTime,
		toLocalTime
	} from '$lib/utils/format';
	import { priceDisplay } from '$lib/utils/event-ticketing';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { goto } from '$app/navigation';
	import { imageSrc } from '$lib/utils/images';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ShiftFormFields from '$lib/components/volunteer/ShiftFormFields.svelte';
	import { createShift } from '$lib/remote/volunteer.remote';

	let id = $derived(page.params.id!);

	/**
	 * Everything the page needs, in one round trip rather than four.
	 *
	 * A declaration below a top-level `await` is blocked on it, and a remote
	 * query does not start fetching until something reads it — so four
	 * independent queries written as four awaited declarations go out strictly
	 * one after another, and the page commits as a single batch, which means
	 * even the `<h1>` waits for the last of them. `Promise.all` reads all four
	 * in the same tick, so they overlap.
	 *
	 * Not cosmetic. The URL commits before any of this has arrived, so the chain
	 * is dead time on every visit — and it is what
	 * `e2e/staff-event-reserve-space.e2e.ts` was intermittently timing out
	 * against on CI once #235 grew it from three queries to four.
	 *
	 * Shifts leave out the cancelled ones: this card answers "is this show
	 * staffed", and a called-off shift is not staffing. The shift list is where
	 * you go to see what was called off.
	 */
	const loaded = $derived(await getStaffEventProduction(id));

	let data = $derived(loaded.detail);
	const recurringSeries = $derived(loaded.recurringSeries);
	const shifts = $derived(loaded.shifts);
	const volunteerRoles = $derived(loaded.volunteerRoles);

	const evt = $derived(data.event);

	// Gifts are recorded once per purchase, so a plain sum across the ledger is
	// the show's contribution total — no de-duplication needed.
	const contributionsTotal = $derived(
		data.tickets.reduce((sum, t) => sum + t.contributionCents, 0)
	);
	const liveVolunteerRoles = $derived(volunteerRoles.filter((r) => r.isActive));

	/**
	 * Only a show CMC produces has a production.
	 *
	 * Everything on this page — the room, the ticket ledger, the volunteer
	 * shifts, selling through our own checkout — is meaningless for a gig at
	 * someone else's venue that a member posted. The general view at
	 * `/staff/events/[id]` is where every source belongs; this is the
	 * specialisation, and a hand-typed URL should land back there rather than
	 * render an empty shell.
	 */
	$effect(() => {
		if (evt.source !== 'cmc') void goto(resolve(`/staff/events/${id}`), { replaceState: true });
	});

	/**
	 * Volunteers arrive when the doors do, not at downbeat, so a shift scheduled
	 * from this page starts at `doorsAt` when the event has one. The end falls
	 * back to the picked role's own default length for an event with no end time
	 * — only community listings are allowed one, but they are allowed one.
	 */
	let shiftRoleId = $state('');
	const shiftStart = $derived(toLocalDateTime(evt.doorsAt ?? evt.startsAt));
	const shiftEnd = $derived.by(() => {
		if (evt.endsAt) return toLocalDateTime(evt.endsAt);
		const role = volunteerRoles.find((r) => r.id === shiftRoleId);
		const minutes = role?.defaultDurationMinutes ?? 4 * 60;
		return toLocalDateTime(new Date((evt.doorsAt ?? evt.startsAt).getTime() + minutes * 60_000));
	});
	const shiftCapacity = $derived(
		String(volunteerRoles.find((r) => r.id === shiftRoleId)?.defaultCapacity ?? 1)
	);

	// The select has no placeholder option, so a bound value matching nothing
	// leaves nothing selected — which posts an empty role instead of the one on
	// screen. Guarded so it seeds once and never clobbers an actual choice.
	$effect(() => {
		if (shiftRoleId) return;
		const first = volunteerRoles.find((r) => r.isActive);
		if (first) shiftRoleId = first.id;
	});

	// ── Edit state ────────────────────────────────────────────────────────
	let editing = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editTags = $state('');
	let editLocation = $state('');
	let editExternalTicketUrl = $state('');
	let editDate = $state('');
	let editStartTime = $state('');
	let editEndTime = $state('');
	let editDoorsTime = $state('');
	let editReservationStartTime = $state('');
	let editReservationEndTime = $state('');
	let editTicketingEnabled = $state(false);
	let editTicketPriceDollars = $state('');
	let editTicketQuantity = $state('');

	// Rebook state
	let rebookNeeded = $state(false);
	let rebookReason = $state('');
	let rebookConfirmed = $state(false);
	let overrideConflicts = $state(false);

	// Holding the space for an event that never had a hold. Disjoint from rebook:
	// an event with a reservation gets the rebook alert instead, and one without
	// had no way to acquire it at all before this.
	let reserveSpace = $state(false);
	const canReserveSpace = $derived(!data.linkedReservation);

	let hasConflicts = $state(false);

	// Ticket price in cents for the hidden field. Independent of the ticketing
	// toggle: it's the price attendees pay wherever they buy.
	const editTicketPriceCents = $derived(
		editTicketPriceDollars ? String(Math.round(parseFloat(editTicketPriceDollars) * 100)) : ''
	);

	function startEditing() {
		editTitle = evt.title;
		editDescription = evt.description ?? '';
		editTags = evt.tags ?? '';
		editLocation = evt.location ?? '';
		editExternalTicketUrl = evt.externalTicketUrl ?? '';

		// Parse existing dates into form values
		editDate = toLocalDate(evt.startsAt);
		editStartTime = toLocalTime(evt.startsAt);
		editEndTime = evt.endsAt ? toLocalTime(evt.endsAt) : '';
		editDoorsTime = evt.doorsAt ? toLocalTime(evt.doorsAt) : '';

		// Pre-fill ticketing fields. Forced off for a band gig, which is never sold
		// through our checkout. Submitting `false` rather than omitting the field
		// means opening this form on a row that predates that rule also clears the
		// stale flag — `update()` rejects enabling ticketing on a band event but
		// allows disabling it. The price is untouched: a band gig legitimately has
		// one for the door or an outside seller.
		editTicketingEnabled = evt.ticketingEnabled;
		editTicketPriceDollars = evt.ticketPrice ? formatDollars(evt.ticketPrice) : '';
		editTicketQuantity = evt.ticketQuantity ? String(evt.ticketQuantity) : '';

		// Pre-fill reservation times from linked reservation
		if (data.linkedReservation) {
			editReservationStartTime = toLocalTime(data.linkedReservation.startsAt);
			editReservationEndTime = toLocalTime(data.linkedReservation.endsAt);
		} else {
			editReservationStartTime = '';
			editReservationEndTime = '';
		}

		rebookNeeded = false;
		rebookReason = '';
		rebookConfirmed = false;
		overrideConflicts = false;
		reserveSpace = false;
		hasConflicts = false;
		editing = true;
	}

	function cancelEditing() {
		editing = false;
		rebookNeeded = false;
		rebookConfirmed = false;
		reserveSpace = false;
		// Outlives the form otherwise: ConflictWarnings only writes it while
		// mounted, so a conflict seen before Cancel would arm the next override.
		hasConflicts = false;
		overrideConflicts = false;
	}

	/**
	 * Show the hold as the event's own window when the toggle goes on. The server
	 * falls back to exactly this, so the fields are an optional setup/teardown
	 * override — filling them just makes what will be booked visible.
	 */
	function toggleReserveSpace() {
		if (reserveSpace) {
			editReservationStartTime = editStartTime;
			editReservationEndTime = editEndTime;
		} else {
			editReservationStartTime = '';
			editReservationEndTime = '';
			hasConflicts = false;
			overrideConflicts = false;
		}
	}

	// Check if times changed enough to need a rebook
	async function checkForRebook() {
		if (!data.linkedReservation || !editDate || !editStartTime || !editEndTime) {
			rebookNeeded = false;
			return;
		}

		const { startsAt: newStartsAt, endsAt: newEndsAt } = buildISORangeFromLocal(
			editDate,
			editStartTime,
			editEndTime
		);

		const result = await checkRebook({
			eventId: evt.id,
			newStartsAt,
			newEndsAt
		});

		rebookNeeded = result.needed;
		rebookReason = result.reason ?? '';

		if (result.needed) {
			// Default reservation times to event times when rebook is triggered
			editReservationStartTime = editStartTime;
			editReservationEndTime = editEndTime;
			rebookConfirmed = false;
		}
	}

	async function handleUpdateSuccess() {
		editing = false;
		rebookNeeded = false;
		rebookConfirmed = false;
		reserveSpace = false;
		hasConflicts = false;
		overrideConflicts = false;
		void getStaffEventProduction(id).refresh();
	}

	async function handlePosterUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const formData = new FormData();
		formData.append('poster', file);

		try {
			const res = await fetch(`/api/events/${evt.id}/poster`, {
				method: 'POST',
				body: formData
			});
			if (!res.ok) throw new Error(await responseErrorMessage(res, 'Upload failed'));
			toast.success('Poster updated');
			void getStaffEventProduction(id).refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to upload poster');
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	/** Add one calendar day to a "YYYY-MM-DD" string. */
	function nextDay(date: string): string {
		const [year, month, day] = date.split('-').map(Number);
		return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
	}

	function buildISORangeFromLocal(
		date: string,
		startTime: string,
		endTime: string
	): { startsAt: string; endsAt: string } {
		// Build rough ISO strings for the rebook check query.
		// The server will parse with proper timezone handling.
		const startsAt = new Date(`${date}T${startTime}:00`);
		// One date field covers both times: a show that ends past midnight ends on
		// the following day, same as the server builds it when the form is saved.
		const endsOnNextDay = new Date(`${date}T${endTime}:00`) < startsAt;
		const endsAt = new Date(`${endsOnNextDay ? nextDay(date) : date}T${endTime}:00`);

		return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
	}
</script>

<!-- Back where this row came from: a production is on /staff/events, and
     everything else is only ever reachable from the calendar. -->
<!--
	The lifecycle — publish, approve, turn down, unpublish, cancel, delete — is
	the general view's, at `/staff/events/[id]`. This page owns the production:
	the room, the ticket ledger, the poster, the staffing. One rule, so nobody
	has to remember which page a given button lives on.
-->
<PageHeader title={evt.title} subtitle="Production" backHref={resolve(`/staff/events/${id}`)}>
	<div class="flex items-center gap-2">
		{#if evt.ticketingEnabled}
			<Button href="/staff/events/{evt.id}/check-in" variant="ghost" size="sm">Check-in</Button>
		{/if}

		{#if evt.status !== 'cancelled' && !editing}
			<Button variant="ghost" size="sm" onclick={startEditing}>Edit</Button>
		{/if}
	</div>
</PageHeader>
<PageContent width="3xl">
	<!-- Status -->
	<div class="flex items-center gap-2">
		<StatusBadge status={evt.status} />
		{#if evt.publishedAt}
			<span class="text-sm opacity-50">Published {fullDate(evt.publishedAt)}</span>
		{/if}
	</div>

	<!-- Recurring series -->
	{#if recurringSeries}
		<div class="flex flex-wrap items-center gap-2">
			<Badge class="badge-info">Recurring · {recurringSeries.frequencyLabel}</Badge>
			{#if recurringSeries.cancelledAt}
				<span class="text-sm opacity-50">Series cancelled — no new occurrences</span>
			{:else}
				<span class="text-sm opacity-50">
					{#if recurringSeries.endsAt}
						Repeats until {fullDate(recurringSeries.endsAt)}
					{:else}
						New occurrences are generated automatically
					{/if}
				</span>
				<Form
					remote={cancelEventSeries}
					successToast="Series cancelled"
					onsuccess={() => void getStaffEventProduction(id).refresh()}
				>
					<input {...cancelEventSeries.fields.seriesId.as('hidden', recurringSeries.id)} />
					<SubmitButton label="Cancel series" variant="ghost" size="xs" class="text-error" />
				</Form>
			{/if}
		</div>
	{/if}

	<!-- Edit form -->
	{#if editing}
		<svelte:boundary>
			<Card>
				<CardBody class="space-y-4">
					<h3 class="text-muted font-medium">Edit Event</h3>

					<Form remote={updateEvent} guard successToast="Updated" onsuccess={handleUpdateSuccess}>
						<input {...fields.eventId.as('hidden', evt.id)} />
						<input {...fields.ticketingEnabled.as('hidden', editTicketingEnabled)} />
						<!-- Always submitted: the price is the attendee's price whoever sells
						     the ticket, so it has to survive the ticketing toggle being off. -->
						<input {...fields.ticketPrice.as('hidden', editTicketPriceCents)} />
						{#if (rebookNeeded && rebookConfirmed) || reserveSpace}
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
										onchange={checkForRebook}
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
										onchange={checkForRebook}
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

							<!-- Venue and ticket link: what a band gig is made of. CMC shows
							     happen at the space and sell through us, so both stay optional. -->
							<FormField label="Location" id="editLocation" issues={[]}>
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

							<!-- The price is what attendees pay wherever they buy — our checkout,
							     the link above, or the door — so it lives outside the ticketing
							     toggle and applies to band gigs too. Only capacity depends on us
							     doing the selling. -->
							<FormField label="Ticket price ($)" id="editTicketPrice" issues={[]}>
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
								<span class="label-text-alt mt-1 opacity-60"> Leave blank for a free event. </span>
							</FormField>

							<div class="form-control">
								<label class="label cursor-pointer justify-start gap-3">
									<input type="checkbox" bind:checked={editTicketingEnabled} class="toggle" />
									<span class="label-text">Sell tickets through the site</span>
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

							<!-- Rebook warning -->
							{#if rebookNeeded}
								<div class="alert alert-warning" role="alert">
									<div class="w-full space-y-3">
										<p class="font-medium">Reservation needs rebooking</p>
										<p class="text-sm">
											{rebookReason}. The existing reservation will be cancelled and a new one
											created.
										</p>

										<label class="label cursor-pointer justify-start gap-3">
											<input
												type="checkbox"
												bind:checked={rebookConfirmed}
												class="checkbox checkbox-sm"
											/>
											<span class="label-text">Confirm rebook</span>
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
												excludeReservationId={data.linkedReservation?.id}
												bind:hasConflicts
											/>
											{#if hasConflicts}
												<label class="label cursor-pointer justify-start gap-3">
													<input
														type="checkbox"
														bind:checked={overrideConflicts}
														class="checkbox checkbox-sm"
													/>
													<span class="label-text">Override conflicts</span>
												</label>
											{/if}
										{/if}
									</div>
								</div>
							{/if}

							<!--
								Hold the space for an event that never had a hold. The rebook alert
								above covers the other case, so the two never render together.
							-->
							{#if canReserveSpace}
								<div>
									<label class="label cursor-pointer justify-start gap-3">
										<input
											type="checkbox"
											bind:checked={reserveSpace}
											onchange={toggleReserveSpace}
											class="checkbox checkbox-sm"
										/>
										<span class="label-text">Reserve practice space</span>
									</label>

									{#if reserveSpace}
										<Card tone="base-200" class="mt-2 space-y-4 p-4">
											<p class="text-muted">
												Reservation times can differ from event times to allow for setup and
												teardown.
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
												bind:hasConflicts
											/>
											{#if hasConflicts}
												<label class="label cursor-pointer justify-start gap-3">
													<input
														type="checkbox"
														bind:checked={overrideConflicts}
														class="checkbox checkbox-sm"
													/>
													<span class="label-text">Override conflicts</span>
												</label>
											{/if}
										</Card>
									{/if}
								</div>
							{/if}

							<div class="flex justify-end gap-2 pt-2">
								<Button type="button" variant="ghost" size="sm" onclick={cancelEditing}
									>Cancel</Button
								>
								<SubmitButton label="Save" variant="primary" size="sm" />
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
		</svelte:boundary>
	{/if}

	<!-- Ticketing -->
	{#if evt.ticketingEnabled || evt.ticketPrice}
		<InfoCard title="Ticketing">
			<div class="flex gap-6">
				<div>
					<p class="text-muted">Price</p>
					<p class="text-lg font-medium">{priceDisplay(evt).label}</p>
				</div>
				<div>
					<p class="text-muted">Sold by</p>
					<p class="text-lg font-medium">
						{evt.ticketingEnabled ? 'Us' : evt.externalTicketUrl ? 'Off-site' : 'At the door'}
					</p>
				</div>
				{#if evt.ticketingEnabled}
					<div>
						<p class="text-muted">Capacity</p>
						<p class="text-lg font-medium">{evt.ticketQuantity ?? 'Unlimited'}</p>
					</div>
				{/if}
				{#if data.ticketStats}
					<div>
						<p class="text-muted">Sold</p>
						<p class="text-lg font-medium">{data.ticketStats.sold}</p>
					</div>
					<div>
						<p class="text-muted">Remaining</p>
						<p class="text-lg font-medium">{data.ticketStats.remaining ?? '∞'}</p>
					</div>
				{/if}
				{#if contributionsTotal > 0}
					<div>
						<p class="text-muted">Contributions</p>
						<p class="text-lg font-medium">{formatCents(contributionsTotal)}</p>
					</div>
				{/if}
			</div>

			{#if evt.status === 'published' && evt.ticketingEnabled}
				<div class="mt-3">
					<a
						href={resolve(`/events/${evt.id}/tickets`)}
						class="link text-sm link-primary"
						target="_blank"
					>
						View purchase page →
					</a>
				</div>
			{/if}

			{#if evt.status !== 'cancelled'}
				<div class="mt-4 border-t border-base-200 pt-4">
					<CompTicketsAction eventId={evt.id} />
				</div>
			{/if}
		</InfoCard>

		<!-- Ticket list -->
		{#if data.tickets.length > 0}
			<InfoCard title="Tickets ({data.tickets.length})">
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Attendee</th>
						<th class="w-px text-right">Paid</th>
						<th class="col-support w-px">Code</th>
					{/snippet}
					{#each data.tickets as t (t.id)}
						<tr class="hover">
							<td class="w-px"><StatusBadge status={t.status} /></td>
							<td class="cell-primary">
								<div class="truncate font-medium">{t.attendeeName}</div>
								<div class="truncate text-muted">{t.attendeeEmail}</div>
							</td>
							<td class="w-px text-right whitespace-nowrap">
								<div class="font-medium">
									{t.unitPriceCents === null ? '—' : formatCents(t.unitPriceCents)}
								</div>
								{#if t.contributionCents > 0}
									<div class="text-sm text-success">
										+{formatCents(t.contributionCents)} contributed
									</div>
								{/if}
								{#if t.discountWaived}
									<div class="text-muted">Waived discount</div>
								{/if}
							</td>
							<td class="col-support w-px"><span class="font-mono text-sm">{t.code}</span></td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
	{/if}

	<!-- Poster -->
	<InfoCard title="Poster">
		{#if data.posterUrl}
			{@const poster = imageSrc(data.posterUrl, 'poster')}
			<img
				src={poster.src}
				srcset={poster.srcset}
				sizes={poster.sizes}
				alt="Event poster"
				class="max-h-64 rounded object-contain"
			/>
		{:else}
			<p class="text-sm opacity-50">No poster uploaded</p>
		{/if}

		{#if evt.status !== 'cancelled'}
			<div class="mt-3">
				<input
					type="file"
					accept="image/jpeg,image/png,image/webp"
					onchange={handlePosterUpload}
					class="file-input file-input-sm"
				/>
			</div>
		{/if}
	</InfoCard>

	<!--
		Linked reservation. Gated on source, and on nothing else: within a
		production it is always rendered, because omitting the card when nothing is
		held made "no space held" indistinguishable from "this page doesn't show
		holds", which is how a whole calendar of events reached production with
		none. A band gig or a community listing is at someone else's venue, so the
		card had no question to answer there.

		Note this deliberately gets one case wrong: a CMC show at an outside venue
		still asks for a room that will never be held. Nothing on the record says
		where a show is — `location` is free text — and the other failure is the
		one that already happened.
	-->
	<InfoCard title="Space Reservation">
		{#if data.linkedReservation}
			<div class="flex items-center gap-3">
				<StatusBadge status={data.linkedReservation.status} />
				<span
					>{formatTime(data.linkedReservation.startsAt)} – {formatTime(
						data.linkedReservation.endsAt
					)}</span
				>
			</div>
			<div class="mt-2">
				<a
					href={resolve(`/staff/reservations/${data.linkedReservation.id}`)}
					class="link text-sm link-primary"
				>
					View reservation →
				</a>
			</div>
		{:else}
			<p class="text-muted">
				No space held for this event. Use Edit to reserve the practice space.
			</p>
		{/if}
	</InfoCard>

	<!--
		Volunteer staffing. Gated the same way, for the same reason: within a
		production it is always rendered, because with the card hidden "nobody is
		staffing this show" and "this page doesn't track staffing" look identical,
		and the second reading is how a calendar of events reaches production with
		nothing booked. CMC does not staff a show it isn't producing.
	-->
	<InfoCard title="Volunteer Shifts">
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				{#if liveVolunteerRoles.length > 0}
					<Action
						action={createShift}
						label="Schedule a shift"
						variant="ghost"
						size="sm"
						modalTitle="Schedule a shift for {evt.title}"
						submitLabel="Create"
						successToast="Shift scheduled"
						onsuccess={() => getStaffEventProduction(id).refresh()}
					>
						{#snippet form()}
							<!--
								The event is the one thing this form already knows, so it is
								locked rather than offered as a picker.
							-->
							<ShiftFormFields
								form={createShift}
								roles={liveVolunteerRoles}
								bind:roleId={shiftRoleId}
								lockedEvent={{ id: evt.id, title: evt.title }}
								startsAt={shiftStart}
								endsAt={shiftEnd}
								capacity={shiftCapacity}
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		{/snippet}

		{#if shifts.length === 0}
			<EmptyState
				title="No volunteer shifts"
				description="Nobody is scheduled to work this show yet."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>Role</th>
					<th class="whitespace-nowrap">When</th>
					<th class="cell-num">Filled</th>
				{/snippet}

				{#each shifts as shift (shift.id)}
					<tr class="hover">
						<td class="cell-primary">
							<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium"
								>{shift.roleName}</a
							>
						</td>
						<td class="whitespace-nowrap">
							{formatDateShort(shift.startsAt)}, {formatTimeRange(shift.startsAt, shift.endsAt)}
						</td>
						<td class="cell-num">
							<span class:text-warning={shift.claimed < shift.capacity}>
								{shift.claimed}/{shift.capacity}
							</span>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
