<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import Form from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { formatDateLong, formatTimeRange, formatDollars } from '$lib/utils/format';
	import { cancelBandReservation, getBandReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	// Declared above the awaited query: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async derived.
	const { fields: cancelFields } = cancelBandReservation;

	const slug = $derived(page.params.slug!);
	// One query for the page. The band comes from the layout context above, so
	// nothing here fans a second remote call out of a child component.
	const res = $derived(await getBandReservationDetail({ slug, reservationId: page.params.id! }));

	const cancel = $derived(cancelBandReservation.for(res.id));
	const durationLabel = $derived(`${res.durationHours} hour${res.durationHours === 1 ? '' : 's'}`);
	// `paidAt` set ⇒ paid; null with `cashDueCents > 0` ⇒ cash owed; null with 0
	// ⇒ comped or fully credit-settled. See the schema comment on the column.
	const cashDue = $derived(res.cashDueCents ?? 0);
</script>

<PageHeader title="Session" backHref="/band/{slug}/reservations" />
<PageContent width="md">
	<Card>
		<CardBody>
			<header class="flex items-start justify-between gap-2">
				<hgroup>
					<p class="font-medium">{formatDateLong(res.startsAt)}</p>
					<p class="text-muted">
						{formatTimeRange(res.startsAt, res.endsAt)} · {durationLabel}
					</p>
				</hgroup>
				<StatusBadge status={res.status} label />
			</header>
			{#if res.bookedBy.id}
				<p class="mt-2 flex items-center gap-1 text-muted">
					Booked by <EntityChip ref={res.bookedBy} />
				</p>
			{/if}
			{#if res.notes}
				<p class="mt-2 text-muted">{res.notes}</p>
			{/if}
		</CardBody>
	</Card>

	{#if res.status === 'cancelled'}
		<InfoCard title="Cancelled">
			<p class="text-muted">{res.cancellationReason ?? 'No reason was recorded.'}</p>
		</InfoCard>
	{/if}

	<InfoCard title="Payment">
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
			<dt class="text-muted">Session rate</dt>
			<dd class="text-right">
				${formatDollars(res.hourlyRateCents)}/hour · {durationLabel}
			</dd>
			<dt class="text-muted">Total</dt>
			<dd class="text-right font-medium">${formatDollars(res.totalCents)}</dd>
			{#if res.creditsUsed}
				<dt class="text-muted">Free hours applied</dt>
				<dd class="text-right">{res.creditsUsed}</dd>
			{/if}
		</dl>
		<p class="mt-2">
			{#if res.refundedAt}
				Refunded.
			{:else if res.paidAt}
				Paid in full.
			{:else if res.cashDueCents === 0}
				Settled — nothing owed at the door.
			{:else if cashDue > 0}
				<span class="font-medium">${formatDollars(cashDue)} due at the door.</span>
			{:else}
				Not yet paid.
			{/if}
		</p>
		{#if !res.isBooker}
			<!-- Whoever booked pays, from their own reservation page; the act sees
			     what it owes without being handed someone else's checkout. -->
			<p class="text-subtle">{res.bookedBy.title} booked this session and can settle it.</p>
		{/if}
	</InfoCard>

	{#if res.status === 'confirmed'}
		<InfoCard title="Door Code">
			{#if res.lockCode && res.lockSyncedAt}
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.lockCode}</p>
				<p class="text-muted">
					Enter this code on the door keypad. It works for the length of the session, for whoever on
					the act gets there first.
				</p>
			{:else if res.fallbackCode}
				<!-- The session's own code has not reached the lock. The break-glass
				     code was synced long ago, so it opens the door even now, and it
				     is shown rather than asked for — see #780. -->
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.fallbackCode}</p>
				<p class="text-muted">
					We couldn't confirm this session's usual code reached the door, so this one will get the
					act in for now. Staff know about it. If it doesn't work, call us rather than waiting
					outside.
				</p>
			{:else if res.inAccessWindow}
				<p class="text-muted">
					This session's code hasn't reached the door and we don't have a backup to give you right
					now. Don't wait outside — <a class="link" href={resolve('/contact')}>get in touch</a> and someone
					will let the act in.
				</p>
			{:else if res.lockCode}
				<p class="text-muted">
					The code is issued but the door hasn't confirmed it yet. It should be ready before the
					session — check back here, and get in touch if it still isn't showing.
				</p>
			{:else}
				<p class="text-muted">The door code appears here on the day of the session.</p>
			{/if}
		</InfoCard>
	{/if}

	{#if res.canCancel}
		<Form
			remote={cancel}
			onsuccess={() => toast.success('Reservation cancelled')}
			onfailure={() => toast.error('Failed to cancel')}
		>
			<input {...cancelFields.slug.as('hidden', slug)} />
			<input {...cancelFields.reservationId.as('hidden', res.id)} />
			<SubmitButton label="Cancel this session" variant="error" outline class="w-full" />
		</Form>
	{/if}
</PageContent>
