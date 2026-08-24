<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { formatDateLong, formatTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
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
			{#if res.lockCode}
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.lockCode}</p>
				<p class="text-muted">
					Enter this code on the door keypad to get in. It works for the length of your reservation.
				</p>
			{:else}
				<p class="text-muted">Your door code will appear here on the day of your reservation.</p>
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
