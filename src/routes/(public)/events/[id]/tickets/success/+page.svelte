<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { fullDate } from '$lib/utils/format';
	import { IconCircleCheck } from '@tabler/icons-svelte';
	import { getTicketPurchaseSuccess } from '$lib/remote/events.remote';
	import { page } from '$app/state';
	import { formatEventTimeRange } from '$lib/utils/event-time';

	const purchaseId = page.url.searchParams.get('purchase_id') ?? '';
	let data = $derived(await getTicketPurchaseSuccess({ eventId: page.params.id!, purchaseId }));

	const evt = $derived(data.event);
	// Free claims keep the historic `rsvp-` purchase prefix; they're still tickets.
	const isFreeClaim = $derived(purchaseId.startsWith('rsvp-'));
</script>

<div class="mx-auto max-w-lg space-y-6">
	<PageHeader title="Tickets Confirmed" backHref="/events" />

	<Card>
		<CardBody class="space-y-4 text-center">
			<div class="flex justify-center">
				<IconCircleCheck size={64} class="text-success" />
			</div>

			<div>
				<h2 class="text-xl font-bold">{evt.title}</h2>
				<p class="mt-1 opacity-70">
					{fullDate(evt.startsAt)} · {formatEventTimeRange(evt.startsAt, evt.endsAt)}
				</p>
			</div>

			<!-- Only paid purchases trigger an email (ticket.purchased fires from the
			     Stripe webhook). Free claims send nothing, so don't promise one. -->
			<p class="text-muted">
				{#if isFreeClaim}
					Save the {data.tickets.length > 1 ? 'codes' : 'code'} below — that's your confirmation. No email
					is sent for free tickets.
				{:else}
					A confirmation email and receipt will be sent to {data.tickets[0]?.attendeeEmail ??
						'your email'}.
				{/if}
			</p>
		</CardBody>
	</Card>

	<!-- Ticket codes -->
	<Card>
		<CardBody>
			<h3 class="mb-3 font-medium">Your Tickets</h3>
			<div class="space-y-3">
				{#each data.tickets as ticket (ticket.id)}
					<div class="flex items-center justify-between rounded bg-base-200 p-3">
						<div>
							<p class="font-medium">{ticket.attendeeName}</p>
							<p class="text-muted">{ticket.attendeeEmail}</p>
						</div>
						<div class="text-right">
							<p class="font-mono text-lg font-bold tracking-wider">{ticket.code}</p>
							<p class="text-xs opacity-50">Ticket code</p>
						</div>
					</div>
				{/each}
			</div>
		</CardBody>
	</Card>

	<div class="text-center">
		<Button href="/events" variant="ghost">Back to Events</Button>
	</div>
</div>
