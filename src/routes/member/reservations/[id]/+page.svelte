<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { formatDateLong, formatDollars, formatTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import UnconfirmedNotice from '$lib/components/reservations/UnconfirmedNotice.svelte';
	import { CancelReservationAction, ConfirmWaitlistedAction } from '$lib/components/actions';

	let data = $derived(await getReservationDetail(page.params.id!));

	const res = $derived(data.reservation);
	const durationHours = $derived(data.durationHours);
	const isPast = $derived(res.startsAt.getTime() <= Date.now());

	const refresh = () => getReservationDetail(page.params.id!).refresh();
</script>

<PageHeader title="Your Reservation" backHref="/member/reservations" />
<PageContent width="md">
	<Card>
		<CardBody>
			<header class="flex items-start justify-between gap-2">
				<hgroup>
					<p class="font-medium">{formatDateLong(res.startsAt)}</p>
					<p class="text-muted">
						{formatTime(res.startsAt)}–{formatTime(res.endsAt)} · {durationHours} hour{durationHours ===
						1
							? ''
							: 's'}
					</p>
				</hgroup>
				<StatusBadge status={res.status} label />
			</header>
			{#if res.notes}
				<p class="mt-2 text-muted">{res.notes}</p>
			{/if}
		</CardBody>
	</Card>

	{#if res.status === 'confirmed'}
		<InfoCard title="Door Code">
			{#if res.lockCode && res.lockSyncedAt}
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.lockCode}</p>
				<p class="text-muted">
					Enter this code on the door keypad to get in. It works for the length of your reservation.
				</p>
			{:else if data.fallbackCode}
				<!-- Their own code has not reached the lock, and they are due in
				     now. The break-glass code was synced long ago, so it opens the
				     door even while the lock is offline. -->
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{data.fallbackCode}</p>
				<p class="text-muted">
					We couldn't confirm your usual code reached the door, so this one will get you in for now.
					Staff know about it. If it doesn't work, call us rather than waiting outside.
				</p>
			{:else if data.inAccessWindow}
				<!-- Their session is running and nothing here opens the door: no
				     break-glass code is confirmed on the lock right now, which
				     happens mid-rotation. Standing outside is the failure mode. -->
				<p class="text-muted">
					Your code hasn't reached the door and we don't have a backup to give you right now. Don't
					wait outside — <a class="link" href={resolve('/contact')}>get in touch</a> and someone will
					let you in.
				</p>
			{:else if res.lockCode}
				<p class="text-muted">
					Your code is issued but the door hasn't confirmed it yet. It should be ready before your
					session — check back here, and get in touch if it still isn't showing.
				</p>
			{:else}
				<p class="text-muted">Your door code will appear here before your reservation.</p>
			{/if}
		</InfoCard>
	{/if}

	{#if res.status === 'scheduled'}
		<!-- The card carries the amount, the due date and the confirmation window;
		     without them here, opening a booking to check what is outstanding
		     tells a member less than the list they came from (#895). -->
		<InfoCard title="Not confirmed yet">
			<p>
				<span class="font-medium">${formatDollars(data.totalCents)}</span>
				due — cash at the door, or card online.
			</p>
			<UnconfirmedNotice startsAt={res.startsAt} class="space-y-1 text-muted" />
		</InfoCard>

		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			Pay for this session
		</Button>
	{/if}

	<!--
		The same actions the row that links here offers. This page used to be a
		strict subset of that row on the two things a member opens a booking to
		do: cancelling was absent for every status, and a confirmed-but-unpaid
		booking offered no way to pay (#1062).
	-->
	{#if !isPast && ['waitlisted', 'scheduled', 'confirmed'].includes(res.status)}
		<div class="flex flex-wrap items-center gap-2">
			{#if res.status === 'waitlisted' && res.waitlistNotifiedAt}
				<ConfirmWaitlistedAction reservation={res} onsuccess={refresh} variant="success" />
			{/if}
			{#if res.status === 'confirmed' && !res.paidAt && (res.cashDueCents == null || res.cashDueCents > 0)}
				{#if (res.cashDueCents ?? 0) > 0}
					<span class="text-sm font-medium">
						${formatDollars(res.cashDueCents ?? 0)} due at door
					</span>
				{/if}
				<Button href="/member/reservations/{res.id}/pay" variant="primary" outline>
					Pay online
				</Button>
			{/if}
			<CancelReservationAction reservation={res} onsuccess={refresh} variant="error" outline />
		</div>
	{/if}

	<Button href="/member/reservations" variant="ghost" class="w-full">Back to Reservations</Button>
</PageContent>
