<script lang="ts">
	import { doorKindLabels, doorOutcomeLabels, isEventHold } from '$lib/config';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import {
		ConfirmReservationAction,
		CompleteReservationAction,
		NoShowReservationAction,
		CancelReservationAction,
		CashReceivedAction,
		CompReservationAction,
		RefundReservationAction
	} from '$lib/components/actions';
	import DayTimeline from '$lib/components/reservations/DayTimeline.svelte';
	import RecordNav from '$lib/components/ui/RecordNav.svelte';
	import CopyableId from '$lib/components/ui/CopyableId.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { IconUserPlus } from '@tabler/icons-svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import {
		fullDate,
		formatTime,
		durationHours as calcDurationHours,
		formatCents
	} from '$lib/utils/format';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		visibleActions,
		reservationPaymentState,
		overlappingReservations
	} from '$lib/utils/reservation-actions';
	import { getStaffReservationDetail } from '$lib/remote/reservations.remote';
	import { describeCancellation } from '$lib/utils/reservation-cancellation';
	import { readOutDoorCode } from '$lib/remote/lock.remote';
	import { page } from '$app/state';

	let data = $derived(await getStaffReservationDetail(page.params.id!));

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

<!-- The booking's own workflow sits in the header, visible from anywhere on
     the page; money actions stay on the Payment card. -->
<PageHeader width="3xl" title="Reservation">
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
								First reservation
							</Badge>
							<!-- And the question that raises. An orientation shift with nobody
							     on it is the state worth seeing from here; the coordinator's
							     own queue is where it gets filled. -->
							{#if data.orientation && data.orientation.claimed === 0}
								<Badge variant="warning">Orientation unclaimed</Badge>
							{:else if data.orientation}
								<Badge variant="info">Orientation covered</Badge>
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
					endLabel="Last of the day"
				/>
			</header>

			{#if conflicts.length > 0}
				<Alert type="warning" class="py-2 text-sm">
					<span>
						Overlaps {conflicts.length} other {conflicts.length === 1 ? 'booking' : 'bookings'}:
						{conflicts
							.map(
								(c) =>
									`${formatTime(c.startsAt)} – ${formatTime(c.endsAt)} (${isEventHold(c.bookerType) ? 'show' : c.status})`
							)
							.join(', ')}
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
				? 'Group booking'
				: isEventHold(r.bookerType)
					? 'Show'
					: 'Member'}
		>
			{#snippet header(title)}
				<header class="flex justify-between">
					<CardTitle>{title}</CardTitle>
					{#if r.bookerType === 'group' && r.bandId}
						<Button href="/staff/bands/{r.bandId}" variant="default" size="sm">View Band</Button>
					{:else if isEventHold(r.bookerType) && r.eventId}
						<Button href="/staff/events/{r.eventId}" variant="default" size="sm">View Event</Button>
					{:else if r.createdByUserId}
						<Button href="/staff/members/{r.createdByUserId}" variant="default" size="sm"
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
			<InfoCard title="Payment">
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
		<InfoCard title="Door Access">
			<DefinitionList>
				<Fact label="Checked in">
					{door.checkedInAt ? formatTime(door.checkedInAt) : 'Not yet'}
				</Fact>
				<Fact label="Checked out">
					{door.checkedOutAt ? formatTime(door.checkedOutAt) : 'Not yet'}
				</Fact>
				<Fact label="Code">
					{#if door.code?.revealedAt}
						<span class="font-mono font-bold tracking-[0.2em]">{readOut ?? door.code.code}</span>
						· shown {formatTime(door.code.revealedAt)}
					{:else if door.code}
						Held, not shown
					{:else}
						None
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

			{#if r.status === 'confirmed' && !door.code?.revealedAt}
				<Button
					variant="ghost"
					size="sm"
					class="mt-3"
					disabled={readingOut}
					onclick={handleReadOut}
				>
					{readingOut ? 'Working…' : 'Read out a code'}
				</Button>
			{/if}
			{#if readOutError}
				<Alert type="error" class="mt-2">{readOutError}</Alert>
			{/if}
		</InfoCard>
	{/if}

	<!-- A labelled line, not a titled box around one paragraph (#1078). -->
	{#if r.notes}
		<DefinitionList>
			<Fact label="Notes" wrap>{r.notes}</Fact>
		</DefinitionList>
	{/if}

	<!-- Audit -->
	{#if data.reservation.createdByStaffName}
		<p class="text-muted">
			Booked by staff: {data.reservation.createdByStaffName}
		</p>
	{/if}

	<!-- Cancellation -->
	{#if status === 'cancelled'}
		<!-- An alert rather than a card: a cancellation is a state the reader has
		     to notice, and the body is one line either way. -->
		<Alert type="error">
			<strong>{describeCancellation(r)}</strong>
			{r.cancellationReason ?? 'No reason given.'}
		</Alert>
	{/if}
</PageContent>
