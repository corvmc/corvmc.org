<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goToCheckout } from '$lib/utils/checkout-navigation';
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

<!-- `px-6` is not decoration: `PageHeader` bleeds to its container's edges with
     `-mx-6`, and on the app side the 24px comes from AppShell's `main`. Without
     it here the header hung off both sides and the page scrolled sideways on a
     phone (#970). `/events/[id]` wraps its own header the same way. -->
<div class="mx-auto max-w-lg space-y-6 px-6">
	<PageHeader
		title={isFreeEvent
			? m.public_events_id_tickets_get_free_ticket()
			: m.public_events_id_tickets_get_tickets()}
		parent={[
			{ label: m.public_events(), href: resolve('/events') },
			{ label: evt.title, href: resolve(`/events/${page.params.id!}`) }
		]}
	/>

	<Card>
		<CardBody>
			<CardTitle level={2}>{evt.title}</CardTitle>
			<p class="opacity-70">
				{fullDate(evt.startsAt)}
				{#if evt.doorsAt}
					{m.public_events_id_tickets_doors({ formatTime: formatTime(evt.doorsAt) })}
				{/if}
				· {formatEventTimeRange(evt.startsAt, evt.endsAt)}
			</p>
			{#if !isFreeEvent}
				<!-- A suggestion, so it is never struck through and never called a
				     discount off anything. -->
				<div class="mt-2 flex items-baseline gap-2">
					<span class="text-lg font-bold">{formatCents(unitPrice)}</span>
					<span class="text-muted">{m.public_events_id_tickets_suggested_per_ticket()}</span>
				</div>
			{:else}
				<div class="mt-2">
					<Badge variant="info">{m.public_events_id_tickets_free_event()}</Badge>
				</div>
			{/if}
			{#if scaleReachesFree}
				<!-- The scale IS the mechanism now, so the policy points at the form
				     rather than at the door. -->
				<p class="mt-3 text-muted text-sm">
					{m.public_events_id_tickets_no_one_turned_away_lack()}
				</p>
			{:else if !isFreeEvent}
				<p class="mt-3 text-muted text-sm">
					<ParaglideMessage
						message={m.public_events_id_tickets_no_one_turned_away_lack_2}
						inputs={{}}
						>{#snippet a({ children })}<a href={resolve('/contact')} class="link"
								>{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</p>
			{/if}
			{#if data.remaining !== null}
				<p class="mt-1 text-sm">
					{#if soldOut}
						<span class="font-medium text-error">{isFreeEvent ? 'Full' : 'Sold out'}</span>
					{:else}
						{(isFreeEvent
							? m.public_events_id_tickets_spots_remaining
							: m.public_tickets_remaining)({ remaining: data.remaining })}
					{/if}
				</p>
			{/if}
		</CardBody>
	</Card>

	{#if soldOut}
		<Alert type="warning"
			>{(isFreeEvent
				? m.public_events_id_tickets_event_full
				: m.public_events_id_tickets_event_sold_out)()}</Alert
		>
	{:else if isFreeEvent}
		<Form remote={claimFreeTicket} onsuccess={handleSuccess}>
			<input {...freeTicketFields.eventId.as('hidden', page.params.id!)} />
			<Card>
				<CardBody class="space-y-4">
					<Field label={m.public_events_id_tickets_number_spots()} name="quantity">
						<Select name="quantity" bind:value={quantity} class="w-full">
							{#each Array.from({ length: maxQuantity }, (_, i) => i + 1) as n (n)}
								<option value={n}>{n}</option>
							{/each}
						</Select>
					</Field>

					{#if !data.isAuthenticated}
						<Field name="attendeeName" type="text" label={m.public_name()} value={attendeeName} />

						<Field
							name="attendeeEmail"
							type="email"
							label={m.public_email()}
							value={attendeeEmail}
						/>
					{/if}

					<SubmitButton
						label={m.public_events_id_tickets_get({
							value: quantity > 1 ? `${quantity} tickets` : 'ticket'
						})}
						variant="primary"
						class="w-full"
					/>
				</CardBody>
			</Card>
		</Form>
	{:else}
		<Form remote={purchaseTickets} onsuccess={handleSuccess}>
			<input {...purchaseFields.eventId.as('hidden', page.params.id!)} />
			<Card>
				<CardBody class="space-y-4">
					<!-- The `input` snippet, not children: only it is handed the id the
					     caption points at, so as children this select had no accessible
					     name at all and read as "combo box, 1" (#994). -->
					<Field label={m.public_events_id_tickets_number_tickets()} name="quantity">
						{#snippet input(id)}
							<Select {id} name="quantity" bind:value={quantity} class="w-full">
								{#each Array.from({ length: maxQuantity }, (_, i) => i + 1) as n (n)}
									<option value={n}>{n}</option>
								{/each}
							</Select>
						{/snippet}
					</Field>

					{#if !data.isAuthenticated}
						<Field name="attendeeName" type="text" label={m.public_name()} value={attendeeName} />

						<Field
							name="attendeeEmail"
							type="email"
							label={m.public_email()}
							value={attendeeEmail}
						/>
					{/if}

					{#if data.soldByBand}
						<!-- #1203: a band's own gig. Its share is paid to it at the sale. -->
						<p class="text-muted text-sm">
							{m.public_events_id_tickets_band_sells_gig_through_collective()}
						</p>
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
