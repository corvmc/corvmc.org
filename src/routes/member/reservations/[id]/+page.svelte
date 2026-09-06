<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { formatDateLong, formatTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';

	let data = $derived(await getReservationDetail(page.params.id!));

	const res = $derived(data.reservation);
	const durationHours = $derived(data.durationHours);
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
		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			Pay for this session
		</Button>
	{/if}

	<Button href="/member/reservations" variant="ghost" class="w-full">Back to Reservations</Button>
</PageContent>
