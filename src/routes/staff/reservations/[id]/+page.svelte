<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { doorKindLabels, doorOutcomeLabels, isEventHold } from '#lib/config.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge, { statusLabel } from '#lib/components/ui/StatusBadge.svelte';
	import {
		CompleteReservationAction,
		NoShowReservationAction,
		CancelReservationAction,
		CashReceivedAction,
		CompReservationAction,
		RefundReservationAction
	} from '#lib/components/actions/index.js';
	import DayTimeline from '#lib/components/reservations/DayTimeline.svelte';
	import RecordNav from '#lib/components/ui/RecordNav.svelte';
	import CopyableId from '#lib/components/ui/CopyableId.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { IconUserPlus, IconX } from '@tabler/icons-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import {
		fullDate,
		formatTime,
		durationHours as calcDurationHours,
		formatCents
	} from '#lib/utils/format.js';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Button from '#lib/components/ui/Button.svelte';
	import {
		visibleActions,
		reservationTrack,
		trackDetail,
		overlappingReservations
	} from '#lib/utils/reservation-actions.js';
	import { getStaffReservationDetail } from '#lib/remote/reservations.remote.js';
	import { describeCancellation } from '#lib/utils/reservation-cancellation.js';
	import { readOutDoorCode } from '#lib/remote/lock.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';
	import { resolve } from '$app/paths';
	import { getReservationFilters } from '../filters.svelte';
	import { withQuery } from '#lib/utils/with-query.js';

	const params = routeParams('id');
	// Read before the await: context is only available during synchronous init.
	const filters = getReservationFilters();

	let data = $derived(await getStaffReservationDetail(params.id));

	const r = $derived(data.reservation);
	const status = $derived(r.status);

	// Staff reading a code over the phone claim the booking's own pool code,
	// and the read is a reveal: the code comes off the lock afterwards (#2120).
	let readingOut = $state(false);
	let readOut = $state<string | null>(null);
	let readOutError = $state<string | null>(null);

	async function handleReadOut() {
		readingOut = true;
		readOutError = null;
		try {
			readOut = (await readOutDoorCode(r.id)).code;
			await getStaffReservationDetail(r.id).refresh();
		} catch (err) {
			readOutError = (err as Error).message;
		} finally {
			readingOut = false;
		}
	}
	const actions = $derived(
		visibleActions(status, r.startsAt, r.endsAt, r.stripePaymentRecordId, new Date(), r)
	);

	// Double-bookings for this slot — surfaced so staff see the collision before
	// confirming or comping (creation warns, but detail-page actions didn't).
	const conflicts = $derived(overlappingReservations(r, data.sameDayReservations));

	// Derived formatting
	// Charged hours: a new member's tour at the start is held but not billed.
	const hours = $derived(calcDurationHours(r.startsAt, r.endsAt) - r.tourMinutes / 60);
	const durationLabel = $derived(
		hours === 1
			? m.staff_reservations_id_1_hour_label()
			: m.staff_reservations_id_hours_label({ hours })
	);
	const amountFormatted = $derived(formatCents(Math.round(hours * data.hourlyRateCents)));
	const rateFormatted = $derived(formatCents(data.hourlyRateCents));
	const creditsDiscountFormatted = $derived(
		formatCents(Math.round((r.creditsUsed ?? 0) * data.hourlyRateCents))
	);

	const track = $derived(reservationTrack(r));
	// The header carries the track; this card says what the track leaves out.
	const paymentDetail = $derived.by((): string | null => {
		switch (trackDetail(r)) {
			case 'cash_due':
				return m.staff_reservations_id_cash_due_label({
					formatCents: formatCents(r.cashDueCents ?? 0)
				});
			case 'unpriced':
				return m.staff_unpaid_label();
			case 'credits':
				return m.staff_paid_with_credits_label();
			case 'comp':
				return m.staff_comped_label();
			case null:
				return null;
		}
	});
</script>

<!-- The booking's own workflow sits in the header, visible from anywhere on
     the page; money actions stay on the Payment card. -->
<PageHeader width="3xl" title={m.staff_reservation_title()}>
	{#if actions.has('complete')}
		<CompleteReservationAction reservation={r} />
	{/if}
	{#if actions.has('noShow')}
		<NoShowReservationAction reservation={r} />
	{/if}
	{#if actions.has('cancel')}
		<CancelReservationAction reservation={r} showReasonInput />
	{/if}
	<!-- Beside the list only; on a phone this is a page of its own with a back crumb. -->
	<Button
		href={withQuery(resolve('staff/reservations'), filters.urlQuery)}
		variant="ghost"
		shape="square"
		class="hidden lg:inline-flex"
		aria-label={m.ui_close_label()}
		data-testid="close-detail"
	>
		<IconX size={16} />
	</Button>
</PageHeader>
<PageContent width="3xl">
	<!-- Hero card -->
	<Card>
		<CardBody>
			<header class="flex items-start justify-between">
				<hgroup>
					<p class="flex items-center gap-2 text-xl font-medium">
						{fullDate(r.startsAt)}
						<StatusBadge status={track} label />
						{#if data.isFirstReservation}
							<!-- Spelled out rather than icon-only: the list has a flag cluster
							     to read this out of, and this page has the room. -->
							<Badge variant="success">
								<IconUserPlus size={14} />
								{m.staff_first_reservation_label()}
							</Badge>
							<!-- And the question that raises. An orientation shift with nobody
							     on it is the state worth seeing from here; the coordinator's
							     own queue is where it gets filled. -->
							{#if data.orientation && data.orientation.claimed === 0}
								<Badge variant="warning"
									>{m.staff_reservations_id_orientation_unstaffed_label()}</Badge
								>
							{:else if data.orientation}
								<Badge variant="info">{m.staff_reservations_id_orientation_covered_label()}</Badge>
							{/if}
						{/if}
					</p>
					<p class="opacity-70">
						{formatTime(r.startsAt)} – {formatTime(r.endsAt)} · {durationLabel}
					</p>
				</hgroup>
				<RecordNav
					prevHref={data.prevId ? `/staff/reservations/${data.prevId}` : undefined}
					nextHref={data.nextId ? `/staff/reservations/${data.nextId}` : undefined}
					endLabel={m.staff_reservations_id_end_label()}
				/>
			</header>

			{#if conflicts.length > 0}
				<Alert type="warning" class="py-2 text-sm">
					<span>
						{m.staff_reservations_id_overlaps_other_bookings_body({
							length: conflicts.length,
							join: conflicts
								.map(
									(c) =>
										`${formatTime(c.startsAt)} – ${formatTime(c.endsAt)} (${isEventHold(c.bookerType) ? 'show' : statusLabel(reservationTrack(c))})`
								)
								.join(', ')
						})}
					</span>
				</Alert>
			{/if}
		</CardBody>

		<DayTimeline
			current={{ id: r.id, startsAt: r.startsAt, endsAt: r.endsAt, bookerType: r.bookerType }}
			others={data.sameDayReservations.map((o) => ({
				id: o.id,
				startsAt: o.startsAt,
				endsAt: o.endsAt,
				bookerType: o.bookerType,
				label: o.memberName,
				href: `/staff/reservations/${o.id}`
			}))}
			closures={data.sameDayClosures}
		/>
	</Card>

	<!-- Member + Payment grid -->
	<div class="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
		<!-- Member card — a band or event booking leads with it, then who booked it -->
		<InfoCard
			title={r.bookerType === 'group'
				? m.staff_reservations_id_group_booking_title()
				: isEventHold(r.bookerType)
					? m.staff_show_title()
					: m.staff_member_title()}
		>
			{#snippet header(title)}
				<header class="flex justify-between">
					<CardTitle>{title}</CardTitle>
					{#if r.bookerType === 'group' && r.bandId}
						<Button href="/staff/groups/{r.bandId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_band_label()}</Button
						>
					{:else if isEventHold(r.bookerType) && r.eventId}
						<Button href="/staff/events/{r.eventId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_event_label()}</Button
						>
					{:else if r.createdByUserId}
						<Button href="/staff/members/{r.createdByUserId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_profile_label()}</Button
						>
					{/if}
				</header>
			{/snippet}
			<div class="flex flex-col items-center">
				{#if r.booker.type !== 'member'}
					<!--
						Whatever the room is held for leads — a band or a show — and its
						glyph comes with the chip rather than from a booker-type icon beside
						it. "Booked by" then keeps the account that raised the hold, which
						is the audit trail for it.
					-->
					<div class="mb-3"><EntityChip ref={r.booker} /></div>
					<p class="mb-2 text-subtle tracking-wide uppercase">{m.staff_booked_by_text()}</p>
				{/if}
				<!-- `link`, unlike a detail page's own strip: the record here is the
				     booking, and the member is a different record with its own page. -->
				<!-- `max-w-full`: a centred flex child wider than the card overflows
				     both edges at once (#1816). -->
				<EntityIdentity
					ref={r.member}
					size="lg"
					link
					email={r.memberEmail}
					phone={r.memberPhone}
					class="max-w-full"
				/>
			</div>
		</InfoCard>

		<!-- Payment card (not shown for event reservations) -->
		{#if !isEventHold(r.bookerType)}
			<InfoCard title={m.staff_payment_title()}>
				{#snippet action()}
					<!-- `refundOnly` is the wider set: completed bookings refund but
					     cannot cancel, so the box is offered only with `refundAndCancel`. -->
					{#if actions.has('refundOnly')}
						<RefundReservationAction reservation={r} canCancel={actions.has('refundAndCancel')} />
					{/if}
				{/snippet}
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-2xl font-medium">{amountFormatted}</span>
					{#if paymentDetail}
						<Badge variant="ghost">{paymentDetail}</Badge>
					{/if}
				</div>
				<p class="text-muted">
					{m.staff_reservations_id_hr_text({ durationLabel, rateFormatted })}
				</p>
				{#if (r.creditsUsed ?? 0) > 0}
					<p class="text-sm text-success">
						{m.staff_reservations_id_free_hours_applied_hrs_text({
							creditsUsed: r.creditsUsed ?? '',
							creditsDiscountFormatted
						})}
					</p>
				{/if}

				{#if data.paymentReminders.length > 0}
					<div class="mt-3 pt-3 rule-top" data-testid="payment-reminders">
						<p class="text-sm font-medium">{m.staff_reservations_id_payment_reminders_text()}</p>
						<ul class="text-muted text-sm">
							{#each data.paymentReminders as sent (sent.daysAfter)}
								<li>
									{m.staff_reservations_id_payment_reminder_text({
										days: sent.daysAfter,
										date: fullDate(sent.sentAt)
									})}
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if r.stripePaymentRecordId}
					<div class="mt-3 border-t border-base-200 pt-3">
						<CopyableId
							value={r.stripePaymentRecordId}
							label={m.staff_reservations_id_stripe_record_label()}
						/>
					</div>
				{/if}

				{#if actions.has('cashReceived') || actions.has('comp')}
					<div class="mt-3 flex flex-wrap gap-2 pt-3 rule-top">
						{#if actions.has('cashReceived')}
							<CashReceivedAction
								reservation={r}
								variant="success"
								size="sm"
								outline
								class="flex-1"
							/>
						{/if}
						{#if actions.has('comp')}
							<CompReservationAction
								reservation={r}
								variant="info"
								size="sm"
								outline
								class="flex-1"
							/>
						{/if}
					</div>
				{/if}
			</InfoCard>
		{/if}
	</div>

	<!-- Door access (#2120): the /door record, read by `lock.manage` only. -->
	{#if !isEventHold(r.bookerType) && data.door}
		{@const door = data.door}
		<InfoCard title={m.staff_reservations_id_door_access_title()}>
			<DefinitionList>
				<Fact label={m.staff_reservations_id_checked_in_label()}>
					{door.checkedInAt ? formatTime(door.checkedInAt) : m.staff_reservations_id_not_yet_text()}
				</Fact>
				<Fact label={m.staff_reservations_id_checked_out_label()}>
					{door.checkedOutAt
						? formatTime(door.checkedOutAt)
						: m.staff_reservations_id_not_yet_text()}
				</Fact>
				<Fact label={m.staff_reservations_id_code_label()}>
					{#if door.code}
						<span class="font-mono font-bold tracking-[0.2em]">{readOut ?? door.code.code}</span>
						{#if door.code.revealedAt}
							· {m.staff_reservations_id_sent_at_text({ time: formatTime(door.code.revealedAt) })}
						{/if}
					{:else}
						{m.staff_reservations_id_no_code_text()}
					{/if}
				</Fact>
			</DefinitionList>

			{#if door.attempts.length > 0}
				<ul class="mt-2 text-subtle">
					{#each door.attempts as a, i (i)}
						<li>
							{formatTime(a.at)} · {doorKindLabels[a.kind]} · {doorOutcomeLabels[a.outcome]}
							{#if a.by}· {a.by}{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if r.status === 'confirmed' && !door.code}
				<Button
					variant="ghost"
					size="sm"
					class="mt-3"
					disabled={readingOut}
					onclick={handleReadOut}
				>
					{readingOut
						? m.staff_reservations_id_working_label()
						: m.staff_reservations_id_read_out_code_label()}
				</Button>
			{/if}
			{#if readOutError}
				<Alert type="error" class="mt-2">{readOutError}</Alert>
			{/if}
		</InfoCard>
	{/if}

	<RelatedTasks subject={{ type: 'reservation', id: r.id }} />
	<RelatedShifts subject={{ type: 'reservation', id: r.id }} />

	<!-- A labelled line, not a titled box around one paragraph (#1078). -->
	{#if r.notes}
		<DefinitionList>
			<Fact label={m.staff_notes_label()} wrap>{r.notes}</Fact>
		</DefinitionList>
	{/if}

	<!-- Audit -->
	{#if data.reservation.createdByStaffName}
		<p class="text-muted">
			{m.staff_reservations_id_booked_by_staff_text({
				createdByStaffName: data.reservation.createdByStaffName
			})}
		</p>
	{/if}

	<!-- Cancellation -->
	{#if status === 'cancelled'}
		<!-- An alert rather than a card: a cancellation is a state the reader has
		     to notice, and the body is one line either way. -->
		<Alert type="error">
			<strong>{describeCancellation(r)}</strong>
			{r.cancellationReason ?? m.staff_reservations_id_no_reason_given_body()}
		</Alert>
	{/if}
</PageContent>
