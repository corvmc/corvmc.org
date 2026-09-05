<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goToCheckout } from '$lib/utils/checkout-navigation';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field, Select } from '$lib/components/ui/Form';
	import { formatCents, fullDate, formatTime } from '$lib/utils/format';
	import TicketPurchaseFields from '$lib/components/events/TicketPurchaseFields.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { purchaseTickets, claimFreeTicket, getPublicTicketPage } from '$lib/remote/events.remote';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import Alert from '$lib/components/ui/Alert.svelte';

	const purchaseFields = purchaseTickets.fields;
	const freeTicketFields = claimFreeTicket.fields;

	let data = $derived(await getPublicTicketPage(page.params.id!));

	let quantity = $state(1);
	let attendeeName = $state('');
	let attendeeEmail = $state('');

	const evt = $derived(data.event);
	// A null price is a free event outright — no scale, no split, and it goes
	// through `claimFreeTicket`. A priced event with a $0 floor is a different
	// fact: it has a scale that happens to reach zero, and it goes through
	// `purchaseTickets` like any other. Two doors to free, deliberately.
	const isFreeEvent = $derived(!evt.ticketPrice || evt.ticketPrice === 0);
	const unitPrice = $derived(evt.ticketPrice ?? 0);
	const scaleReachesFree = $derived(!isFreeEvent && evt.ticketPriceFloorCents === 0);
	const soldOut = $derived(data.remaining === 0);
	const maxQuantity = $derived(data.remaining !== null ? Math.min(data.remaining, 10) : 10);

	async function handleSuccess(result?: { redirectUrl?: string }) {
		if (result?.redirectUrl) await goToCheckout(result.redirectUrl);
	}
</script>

<div class="mx-auto max-w-lg space-y-6">
	<PageHeader title={isFreeEvent ? 'Get free ticket' : 'Get Tickets'} backHref="/events" />

	<Card>
		<CardBody>
			<CardTitle level={2}>{evt.title}</CardTitle>
			<p class="opacity-70">
				{fullDate(evt.startsAt)}
				{#if evt.doorsAt}
					· Doors {formatTime(evt.doorsAt)}
				{/if}
				· {formatEventTimeRange(evt.startsAt, evt.endsAt)}
			</p>
			{#if !isFreeEvent}
				<!-- A suggestion, so it is never struck through and never called a
				     discount off anything. -->
				<div class="mt-2 flex items-baseline gap-2">
					<span class="text-lg font-bold">{formatCents(unitPrice)}</span>
					<span class="text-muted">suggested, per ticket</span>
				</div>
			{:else}
				<div class="mt-2">
					<Badge variant="info">Free event</Badge>
				</div>
			{/if}
			{#if scaleReachesFree}
				<!-- The scale IS the mechanism now, so the policy points at the form
				     rather than at the door. -->
				<p class="mt-3 text-muted text-sm">
					No one is turned away for lack of funds. Pay what you can — including nothing.
				</p>
			{:else if !isFreeEvent}
				<p class="mt-3 text-muted text-sm">
					No one is turned away for lack of funds. If the price is a barrier,
					<a href={resolve('/contact')} class="link">get in touch</a> or just come to the door.
				</p>
			{/if}
			{#if data.remaining !== null}
				<p class="mt-1 text-sm">
					{#if soldOut}
						<span class="font-medium text-error">{isFreeEvent ? 'Full' : 'Sold out'}</span>
					{:else}
						{data.remaining} {isFreeEvent ? 'spots' : 'tickets'} remaining
					{/if}
				</p>
			{/if}
		</CardBody>
	</Card>

	{#if soldOut}
		<Alert type="warning">This event is {isFreeEvent ? 'full' : 'sold out'}.</Alert>
	{:else if isFreeEvent}
		<Form
			remote={claimFreeTicket}
			onsuccess={handleSuccess}
			onfailure={() => toast.error('Something went wrong')}
		>
			<input {...freeTicketFields.eventId.as('hidden', page.params.id!)} />
			<Card>
				<CardBody class="space-y-4">
					<Field label="Number of spots" name="quantity">
						<Select name="quantity" bind:value={quantity} class="w-full">
							{#each Array.from({ length: maxQuantity }, (_, i) => i + 1) as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</Select>
					</Field>

					{#if !data.isAuthenticated}
						<Field name="attendeeName" type="text" label="Name" value={attendeeName} />

						<Field name="attendeeEmail" type="email" label="Email" value={attendeeEmail} />
					{/if}

					<SubmitButton
						label="Get {quantity > 1 ? `${quantity} tickets` : 'ticket'}"
						variant="primary"
						class="w-full"
					/>
				</CardBody>
			</Card>
		</Form>
	{:else}
		<Form
			remote={purchaseTickets}
			onsuccess={handleSuccess}
			onfailure={() => toast.error('Something went wrong')}
		>
			<input {...purchaseFields.eventId.as('hidden', page.params.id!)} />
			<Card>
				<CardBody class="space-y-4">
					<Field label="Number of tickets" name="quantity">
						<Select name="quantity" bind:value={quantity} class="w-full">
							{#each Array.from({ length: maxQuantity }, (_, i) => i + 1) as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</Select>
					</Field>

					{#if !data.isAuthenticated}
						<Field name="attendeeName" type="text" label="Name" value={attendeeName} />

						<Field name="attendeeEmail" type="email" label="Email" value={attendeeEmail} />
					{/if}

					<!-- The amount, the split bar and the submit button all come from
					     here: only this component knows what the card is charged, and
					     the button's label is that number. -->
					<TicketPurchaseFields
						suggestedUnitCents={unitPrice}
						floorCents={evt.ticketPriceFloorCents}
						{quantity}
						acts={data.acts}
						collectiveShareBps={data.collectiveShareBps}
						fields={purchaseFields}
					/>
				</CardBody>
			</Card>
		</Form>
	{/if}
</div>
