<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { pageTitle, TICKET_MIN_CHARGE_CENTS } from '$lib/config';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { formatCents, formatTime } from '$lib/utils/format';
	import {
		cancelDoorSale,
		getDoorEvents,
		getTerminalConnection,
		simulateDoorTap,
		startDoorSale
	} from '$lib/remote/door.remote';
	import {
		connectDoorReader,
		describeTapError,
		takeTap,
		tapToPayBridge,
		type TapToPayBridge
	} from '$lib/door/tap-to-pay';
	import { capacityNote } from '$lib/door/capacity';
	import DoorSaleStatus from './DoorSaleStatus.svelte';

	/**
	 * Door sales (#612): pick tonight's show, say how many and what they are
	 * paying, and hand the phone over. Inside the Android shell the phone is
	 * the reader; in a browser there is no reader, and the other path is shown.
	 */
	const fields = startDoorSale.fields;
	// The server has no bridge. Everything that reads it sits under `sale`,
	// which is null at hydration, so the two renders cannot disagree.
	const bridge: TapToPayBridge | null = $derived(browser ? tapToPayBridge() : null);

	type CardSale = { paymentIntentId: string; clientSecret: string; chargeCents: number };
	let sale = $state<CardSale | null>(null);
	let tapped = $state(false);
	let busy = $state(false);
	let tapError = $state<string | null>(null);
	let freeLetIn = $state<number | null>(null);
	let chosenEventId = $state<string | undefined>();
	let quantity = $state<number | undefined>(1);

	function reset() {
		sale = null;
		tapped = false;
		tapError = null;
		freeLetIn = null;
	}

	async function onsuccess(
		result?: { kind: 'free'; purchaseId: string; quantity: number } | ({ kind: 'card' } & CardSale)
	) {
		reset();
		if (!result) return;
		if (result.kind === 'free') {
			freeLetIn = result.quantity;
			return;
		}
		sale = result;
		if (bridge) await tap();
	}

	async function tap() {
		if (!sale || !bridge) return;
		busy = true;
		tapError = null;
		try {
			await connectDoorReader(bridge, () => getTerminalConnection());
			await takeTap(bridge, sale.clientSecret);
			tapped = true;
		} catch (err) {
			tapError = describeTapError(err);
		} finally {
			busy = false;
		}
	}

	async function simulate() {
		if (!sale) return;
		busy = true;
		try {
			await simulateDoorTap(sale.paymentIntentId);
			tapped = true;
		} finally {
			busy = false;
		}
	}

	async function cancel() {
		if (!sale) return;
		busy = true;
		try {
			await cancelDoorSale(sale.paymentIntentId);
			reset();
		} finally {
			busy = false;
		}
	}

	// Last: anything declared after a top-level await is async-gated.
	const door = $derived(await getDoorEvents());
	const eventOptions = $derived(
		door.events.map((e) => ({ value: e.id, label: `${e.title} · ${formatTime(e.startsAt)}` }))
	);
	// Capacity only warns (#1631): past zero the person at the door decides.
	const chosen = $derived(door.events.find((e) => e.id === chosenEventId) ?? door.events[0]);
	const capacity = $derived(chosen ? capacityNote(chosen.remaining, quantity || 1) : null);
</script>

<svelte:head>
	<title>{pageTitle('Door sales')}</title>
</svelte:head>

<PageHeader width="2xl" title="Door sales" />
<PageContent width="2xl">
	{#if door.events.length === 0}
		<EmptyState
			title="No show at the door"
			description="Collective shows starting within a day appear here. A band's own gig is sold by the band."
		/>
	{:else if sale}
		<Alert>
			Charging {formatCents(sale.chargeCents)}.
			{#if !tapped && bridge}Hand the phone over and have them tap their card.{/if}
		</Alert>

		{#if tapError}
			<Alert type="error">{tapError}</Alert>
		{/if}

		{#if tapped}
			<DoorSaleStatus paymentIntentId={sale.paymentIntentId} />
			<Button variant="primary" class="min-h-11" onclick={reset}>Next sale</Button>
		{:else}
			<div class="flex flex-wrap gap-3">
				{#if bridge}
					<Button variant="primary" class="min-h-11" disabled={busy} onclick={tap}>
						{tapError ? 'Try the tap again' : 'Tap to pay'}
					</Button>
				{:else if door.canSimulate}
					<Button variant="primary" class="min-h-11" disabled={busy} onclick={simulate}>
						Simulate a tap
					</Button>
				{:else}
					<Alert type="warning">
						No card reader here. Door sales take cards only in the door phone's app.
					</Alert>
				{/if}
				<Button variant="ghost" class="min-h-11" disabled={busy} onclick={cancel}
					>Cancel sale</Button
				>
			</div>
		{/if}
	{:else}
		{#if freeLetIn !== null}
			<Alert type="success">
				Free. {freeLetIn}
				{freeLetIn === 1 ? 'ticket' : 'tickets'} checked in. Let them in.
			</Alert>
		{/if}

		<Form remote={startDoorSale} {onsuccess} class="space-y-4">
			<FormField
				field={fields.eventId}
				label="Show"
				type="select"
				options={eventOptions}
				bind:value={chosenEventId}
				required
			/>
			<FormField
				field={fields.quantity}
				label="How many"
				type="number"
				bind:value={quantity}
				required
			/>
			{#if capacity}
				<Alert type={capacity.level}>{capacity.text}</Alert>
			{/if}
			<MoneyField
				field={fields.unitPriceCents}
				label="Each ticket"
				value={door.events[0].suggestedCents}
				description="Whatever they can pay, at or above the floor. Under {formatCents(
					TICKET_MIN_CHARGE_CENTS
				)} in total is free."
			/>
			<SubmitButton label="Take payment" class="min-h-11" />
		</Form>

		<!-- Always here, not only after a failure: a card that cannot tap, and a
		     staffer whose screen reader blocks PIN entry, never see an error. -->
		<section class="space-y-2">
			<h2 class="font-semibold">Card will not tap?</h2>
			{#each door.events as event (event.id)}
				<p class="text-muted">
					{event.title}: suggested {formatCents(event.suggestedCents)}{event.floorCents
						? `, floor ${formatCents(event.floorCents)}`
						: ''}{event.remaining !== null && event.remaining >= 0
						? `, ${event.remaining} left`
						: ''}{event.remaining !== null && event.remaining < 0
						? `, over capacity by ${-event.remaining}`
						: ''}.
					{#if event.onlineSales}
						They can buy on their own phone at
						<a class="link" href={resolve(`/events/${event.id}`)}>corvmc.org/events/{event.id}</a>.
					{:else}
						Online sales are closed for this show.
					{/if}
				</p>
			{/each}
		</section>
	{/if}
</PageContent>
