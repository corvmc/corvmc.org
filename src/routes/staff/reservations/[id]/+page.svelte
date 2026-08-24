<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import {
		ConfirmReservationAction,
		CompleteReservationAction,
		NoShowReservationAction,
		CancelReservationAction,
		CashReceivedAction,
		CompReservationAction,
		RefundReservationAction
	} from '$lib/components/shared/actions';
	import DayTimeline from '$lib/components/shared/reservations/DayTimeline.svelte';
	import RecordNav from '$lib/components/shared/RecordNav.svelte';
	import CopyableId from '$lib/components/shared/CopyableId.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import {
		fullDate,
		formatTime,
		durationHours as calcDurationHours,
		formatCents
	} from '$lib/utils/format';
	import { EntityChip, EntityIdentity } from '$lib/components/shared/entity';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		visibleActions,
		reservationPaymentState,
		overlappingReservations
	} from '$lib/utils/reservation-actions';
	import { getStaffReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';

	let data = $derived(await getStaffReservationDetail(page.params.id!));

	const r = $derived(data.reservation);
	const status = $derived(r.status);
	const actions = $derived(
		visibleActions(status, r.startsAt, r.endsAt, r.stripePaymentRecordId, new Date(), {
			cashDueCents: r.cashDueCents,
			paidAt: r.paidAt,
			refundedAt: r.refundedAt
		})
	);

	// Double-bookings for this slot — surfaced so staff see the collision before
	// confirming or comping (creation warns, but detail-page actions didn't).
	const conflicts = $derived(overlappingReservations(r, data.sameDayReservations));

	// Derived formatting
	const hours = $derived(calcDurationHours(r.startsAt, r.endsAt));
	const durationLabel = $derived(hours === 1 ? '1 hour' : `${hours} hours`);
	const amountFormatted = $derived(formatCents(Math.round(hours * data.hourlyRateCents)));
	const rateFormatted = $derived(formatCents(data.hourlyRateCents));
	const creditsDiscountFormatted = $derived(
		formatCents(Math.round((r.creditsUsed ?? 0) * data.hourlyRateCents))
	);

	const paymentStatus = $derived.by((): { label: string; class: string } => {
		switch (reservationPaymentState(r)) {
			case 'no_show':
				return { label: 'No-show', class: 'badge-error' };
			case 'refunded':
				return { label: 'Refunded', class: 'badge-error' };
			case 'cancelled':
				return { label: 'Cancelled', class: 'badge-ghost' };
			case 'paid':
				return { label: 'Paid', class: 'badge-success' };
			case 'cash_due':
				return { label: `Cash due ${formatCents(r.cashDueCents ?? 0)}`, class: 'badge-warning' };
			case 'unpaid':
				return { label: 'Unpaid', class: 'badge-warning' };
			case 'credits':
				return { label: 'Paid with credits', class: 'badge-info' };
			case 'comped':
				return { label: 'Comped', class: 'badge-info' };
		}
	});
</script>

<PageHeader title="Reservation" backHref="/staff/reservations" />
<PageContent width="3xl">
	<!-- Hero card -->
	<Card>
		<CardBody>
			<header class="flex items-start justify-between">
				<hgroup>
					<p class="flex items-center gap-2 text-xl font-medium">
						{fullDate(r.startsAt)}
						<StatusBadge status={r.status} />
					</p>
					<p class="opacity-70">
						{formatTime(r.startsAt)} – {formatTime(r.endsAt)} · {durationLabel}
					</p>
				</hgroup>
				<RecordNav
					prevHref={data.prevId ? `/staff/reservations/${data.prevId}` : undefined}
					nextHref={data.nextId ? `/staff/reservations/${data.nextId}` : undefined}
					endLabel="Last of the day"
				/>
			</header>

			{#if conflicts.length > 0}
				<div role="alert" class="alert alert-warning py-2 text-sm">
					<span>
						Overlaps {conflicts.length} other {conflicts.length === 1 ? 'booking' : 'bookings'}:
						{conflicts
							.map(
								(c) =>
									`${formatTime(c.startsAt)} – ${formatTime(c.endsAt)} (${c.bookerType === 'event' ? 'event' : c.status})`
							)
							.join(', ')}
					</span>
				</div>
			{/if}

			{#if actions.has('confirm') || actions.has('complete') || actions.has('noShow') || actions.has('cancel')}
				<div class="flex flex-wrap items-center gap-2 border-t border-base-200 pt-3">
					{#if actions.has('confirm')}
						<ConfirmReservationAction reservation={r} staff />
					{/if}
					{#if actions.has('complete')}
						<CompleteReservationAction reservation={r} />
					{/if}
					{#if actions.has('noShow')}
						<NoShowReservationAction reservation={r} />
					{/if}
					{#if actions.has('cancel')}
						<CancelReservationAction reservation={r} showReasonInput />
					{/if}
				</div>
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
		/>
	</Card>

	<!-- Member + Payment grid -->
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<!-- Member card — a band or event booking leads with it, then who booked it -->
		<InfoCard
			title={r.bookerType === 'band'
				? 'Band Booking'
				: r.bookerType === 'event'
					? 'Event'
					: 'Member'}
		>
			{#snippet header(title)}
				<header class="flex justify-between">
					<span class="card-title">{title}</span>
					{#if r.bookerType === 'band' && r.bandId}
						<Button href="/staff/bands/{r.bandId}" variant="default" size="sm">View Band</Button>
					{:else if r.bookerType === 'event' && r.eventId}
						<Button href="/staff/events/{r.eventId}" variant="default" size="sm">View Event</Button>
					{:else if r.createdByUserId}
						<Button href="/staff/users/{r.createdByUserId}" variant="default" size="sm"
							>View Profile</Button
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
					<p class="mb-2 text-subtle tracking-wide uppercase">Booked by</p>
				{/if}
				<!-- `link`, unlike a detail page's own strip: the record here is the
				     booking, and the member is a different record with its own page. -->
				<EntityIdentity ref={r.member} size="lg" link email={r.memberEmail} phone={r.memberPhone} />
			</div>
		</InfoCard>

		<!-- Payment card (not shown for event reservations) -->
		{#if r.bookerType !== 'event'}
			<InfoCard title="Payment">
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-2xl font-medium">{amountFormatted}</span>
					<span class="badge {paymentStatus.class}">{paymentStatus.label}</span>
				</div>
				<p class="text-muted">{durationLabel} × {rateFormatted}/hr</p>
				{#if (r.creditsUsed ?? 0) > 0}
					<p class="text-sm text-success">
						Free hours applied: {r.creditsUsed}
						{r.creditsUsed === 1 ? 'hr' : 'hrs'} (−{creditsDiscountFormatted})
					</p>
				{/if}

				{#if r.stripePaymentRecordId}
					<div class="mt-3 border-t border-base-200 pt-3">
						<CopyableId value={r.stripePaymentRecordId} label="Stripe record" />
					</div>
				{/if}

				{#if actions.has('cashReceived') || actions.has('comp') || actions.has('refund')}
					<div class="mt-3 flex flex-wrap gap-2 border-t border-base-200 pt-3">
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
						{#if actions.has('refund')}
							<RefundReservationAction
								reservation={r}
								variant="error"
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

	<!-- Door access -->
	{#if r.bookerType !== 'event'}
		<InfoCard title="Door Access">
			{#if r.lockCode}
				<p class="font-mono text-2xl font-bold tracking-[0.2em]">{r.lockCode}</p>
				<p class="text-muted">Keypad code for this reservation.</p>
			{:else}
				<p class="text-muted">
					Not provisioned yet — codes are issued the morning of the reservation.
				</p>
			{/if}
		</InfoCard>
	{/if}

	<!-- Notes -->
	{#if r.notes}
		<InfoCard title="Notes">
			<p>{r.notes}</p>
		</InfoCard>
	{/if}

	<!-- Audit -->
	{#if data.reservation.createdByStaffName}
		<p class="text-muted">
			Booked by staff: {data.reservation.createdByStaffName}
		</p>
	{/if}

	<!-- Cancellation -->
	{#if status === 'cancelled'}
		<InfoCard title="Cancelled" class="border-l-4 border-error">
			{#if r.cancellationReason}
				<p>{r.cancellationReason}</p>
			{:else}
				<p class="opacity-50">No reason provided</p>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
