<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { isEventHold } from '#lib/config.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
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
	import { IconUserPlus } from '@tabler/icons-svelte';
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
		reservationPaymentState,
		overlappingReservations
	} from '#lib/utils/reservation-actions.js';
	import { getStaffReservationDetail } from '#lib/remote/reservations.remote.js';
	import { describeCancellation } from '#lib/utils/reservation-cancellation.js';
	import { retryDoorCodes } from '#lib/remote/lock.remote.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let data = $derived(await getStaffReservationDetail(params.id));

	const r = $derived(data.reservation);
	const status = $derived(r.status);

	// Retry door codes without waiting for tomorrow's cron: this booking's, then
	// every code the daily job would handle (#1813).
	let retrying = $state(false);
	let retryResult = $state<Awaited<ReturnType<typeof retryDoorCodes>> | null>(null);
	let retryError = $state<string | null>(null);

	async function handleRetry() {
		retrying = true;
		retryResult = null;
		retryError = null;
		try {
			retryResult = await retryDoorCodes(r.id);
			await getStaffReservationDetail(r.id).refresh();
		} catch (err) {
			retryError = (err as Error).message;
		} finally {
			retrying = false;
		}
	}
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
	const durationLabel = $derived(
		hours === 1 ? m.staff_reservations_id_1_hour() : m.staff_reservations_id_hours({ hours })
	);
	const amountFormatted = $derived(formatCents(Math.round(hours * data.hourlyRateCents)));
	const rateFormatted = $derived(formatCents(data.hourlyRateCents));
	const creditsDiscountFormatted = $derived(
		formatCents(Math.round((r.creditsUsed ?? 0) * data.hourlyRateCents))
	);

	const paymentStatus = $derived.by((): { label: string; class: string } => {
		switch (reservationPaymentState(r)) {
			case 'no_show':
				return { label: m.staff_no_show(), class: 'badge-error' };
			case 'refunded':
				return { label: m.staff_refunded(), class: 'badge-error' };
			case 'cancelled':
				return { label: m.staff_cancelled(), class: 'badge-ghost' };
			case 'paid':
				return { label: m.staff_paid(), class: 'badge-success' };
			case 'cash_due':
				return {
					label: m.staff_reservations_id_cash_due({
						formatCents: formatCents(r.cashDueCents ?? 0)
					}),
					class: 'badge-warning'
				};
			case 'unpaid':
				return { label: m.staff_unpaid(), class: 'badge-warning' };
			case 'credits':
				return { label: m.staff_paid_with_credits(), class: 'badge-info' };
			case 'comped':
				return { label: m.staff_comped(), class: 'badge-info' };
		}
	});
</script>

<!-- The booking's own workflow sits in the header, visible from anywhere on
     the page; money actions stay on the Payment card. -->
<PageHeader width="3xl" title={m.staff_reservation()}>
	{#if actions.has('complete')}
		<CompleteReservationAction reservation={r} />
	{/if}
	{#if actions.has('noShow')}
		<NoShowReservationAction reservation={r} />
	{/if}
	{#if actions.has('cancel')}
		<CancelReservationAction reservation={r} showReasonInput />
	{/if}
</PageHeader>
<PageContent width="3xl">
	<!-- Hero card -->
	<Card>
		<CardBody>
			<header class="flex items-start justify-between">
				<hgroup>
					<p class="flex items-center gap-2 text-xl font-medium">
						{fullDate(r.startsAt)}
						<StatusBadge status={r.status} />
						{#if data.isFirstReservation}
							<!-- Spelled out rather than icon-only: the list has a flag cluster
							     to read this out of, and this page has the room. -->
							<Badge variant="success">
								<IconUserPlus size={14} />
								{m.staff_first_reservation()}
							</Badge>
							<!-- And the question that raises. An orientation shift with nobody
							     on it is the state worth seeing from here; the coordinator's
							     own queue is where it gets filled. -->
							{#if data.orientation && data.orientation.claimed === 0}
								<Badge variant="warning">{m.staff_reservations_id_orientation_unclaimed()}</Badge>
							{:else if data.orientation}
								<Badge variant="info">{m.staff_reservations_id_orientation_covered()}</Badge>
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
						{m.staff_reservations_id_overlaps_other_bookings({
							length: conflicts.length,
							join: conflicts
								.map(
									(c) =>
										`${formatTime(c.startsAt)} – ${formatTime(c.endsAt)} (${isEventHold(c.bookerType) ? 'show' : c.status})`
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
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<!-- Member card — a band or event booking leads with it, then who booked it -->
		<InfoCard
			title={r.bookerType === 'group'
				? m.staff_reservations_id_group_booking()
				: isEventHold(r.bookerType)
					? m.staff_show()
					: m.staff_member()}
		>
			{#snippet header(title)}
				<header class="flex justify-between">
					<CardTitle>{title}</CardTitle>
					{#if r.bookerType === 'group' && r.bandId}
						<Button href="/staff/groups/{r.bandId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_band()}</Button
						>
					{:else if isEventHold(r.bookerType) && r.eventId}
						<Button href="/staff/events/{r.eventId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_event()}</Button
						>
					{:else if r.createdByUserId}
						<Button href="/staff/members/{r.createdByUserId}" variant="default" size="sm"
							>{m.staff_reservations_id_view_profile()}</Button
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
					<p class="mb-2 text-subtle tracking-wide uppercase">{m.staff_booked_by()}</p>
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
			<InfoCard title={m.staff_payment()}>
				{#snippet action()}
					<!-- `refundOnly` is the wider set: completed bookings refund but
					     cannot cancel, so the box is offered only with `refundAndCancel`. -->
					{#if actions.has('refundOnly')}
						<RefundReservationAction reservation={r} canCancel={actions.has('refundAndCancel')} />
					{/if}
				{/snippet}
				<div class="mb-1 flex items-baseline justify-between">
					<span class="text-2xl font-medium">{amountFormatted}</span>
					<span class="badge {paymentStatus.class}">{paymentStatus.label}</span>
				</div>
				<p class="text-muted">{m.staff_reservations_id_hr({ durationLabel, rateFormatted })}</p>
				{#if (r.creditsUsed ?? 0) > 0}
					<p class="text-sm text-success">
						{m.staff_reservations_id_free_hours_applied_hrs({
							creditsUsed: r.creditsUsed ?? '',
							creditsDiscountFormatted
						})}
					</p>
				{/if}

				{#if r.stripePaymentRecordId}
					<div class="mt-3 border-t border-base-200 pt-3">
						<CopyableId
							value={r.stripePaymentRecordId}
							label={m.staff_reservations_id_stripe_record()}
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

	<!-- Door access -->
	{#if !isEventHold(r.bookerType)}
		<InfoCard title={m.staff_reservations_id_door_access()}>
			{#if r.lockCode}
				<p class="font-mono text-2xl font-bold tracking-[0.2em]">{r.lockCode}</p>
				{#if r.lockSyncedAt}
					<p class="text-muted">
						{m.staff_reservations_id_confirmed_lock({ fullDate: fullDate(r.lockSyncedAt) })}
					</p>
				{:else}
					<!-- U-tec acks a queued write the same as an applied one, so an
					     issued code is not a working code until the lock says so. -->
					<p class="text-warning">{m.staff_reservations_id_issued_but_not_confirmed_at()}</p>
				{/if}
			{:else}
				<p class="text-muted">{m.staff_reservations_id_not_provisioned_yet()}</p>
			{/if}

			<!-- What the member's own page shows instead, by the same rule (#1814). -->
			{#if data.doorFallback}
				<p class="mt-2">
					{#if data.doorFallback.showsFrom}
						{m.staff_reservations_id_member_will_shown_break_glass({
							fullDate: fullDate(data.doorFallback.showsFrom),
							formatTime: formatTime(data.doorFallback.showsFrom)
						})}
					{:else if data.doorFallback.code}
						<ParaglideMessage
							message={m.staff_reservations_id_member_sees_break_glass}
							inputs={{ code: data.doorFallback.code }}
							>{#snippet span({ children })}<span class="font-mono font-bold tracking-[0.2em]"
									>{@render children?.()}</span
								>{/snippet}</ParaglideMessage
						>
					{:else}
						<span class="text-warning">
							{m.staff_reservations_id_no_break_glass_code_confirmed()}
						</span>
					{/if}
				</p>
			{/if}

			{#if r.status === 'confirmed'}
				<Button variant="ghost" size="sm" class="mt-3" disabled={retrying} onclick={handleRetry}>
					{retrying
						? m.staff_reservations_id_working()
						: m.staff_reservations_id_retry_pending_door_codes()}
				</Button>
				{#if retryError}
					<Alert type="error" class="mt-2">{retryError}</Alert>
				{:else if retryResult}
					{@const { booking, job } = retryResult}
					<Alert type={booking.ok && job.errors.length === 0 ? 'success' : 'warning'} class="mt-2">
						<div>
							<p>
								{booking.ok
									? m.staff_reservations_id_booking_sent_lock_code({ code: booking.code ?? '' })
									: m.staff_reservations_id_booking({ error: booking.error ?? '' })}
							</p>
							<p>
								{m.staff_reservations_id_all_bookings_provisioned_confirmed_loc({
									provisioned: job.provisioned,
									confirmed: job.confirmed
								})}
							</p>
							{#if job.errors.length > 0}
								<ul class="list-disc pl-5">
									{#each job.errors as e, i (i)}<li>{e}</li>{/each}
								</ul>
							{/if}
						</div>
					</Alert>
				{/if}
			{/if}
		</InfoCard>
	{/if}

	<!-- A labelled line, not a titled box around one paragraph (#1078). -->
	{#if r.notes}
		<DefinitionList>
			<Fact label={m.staff_notes()} wrap>{r.notes}</Fact>
		</DefinitionList>
	{/if}

	<!-- Audit -->
	{#if data.reservation.createdByStaffName}
		<p class="text-muted">
			{m.staff_reservations_id_booked_by_staff({
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
			{r.cancellationReason ?? m.staff_reservations_id_no_reason_given()}
		</Alert>
	{/if}
</PageContent>
