<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { pageTitle, TICKET_MIN_CHARGE_CENTS } from '#lib/config.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { formatCents, formatTime } from '#lib/utils/format.js';
	import {
		cancelDoorSale,
		getDoorEvents,
		getTerminalConnection,
		simulateDoorTap,
		startDoorSale
	} from '#lib/remote/door.remote.js';
	import {
		connectDoorReader,
		describeTapError,
		takeTap,
		tapToPayBridge,
		type TapToPayBridge
	} from '#lib/door/tap-to-pay.js';
	import { capacityNote } from '#lib/door/capacity.js';
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

	type CardSale = {
		eventId: string;
		paymentIntentId: string;
		clientSecret: string;
		chargeCents: number;
	};
	let sale = $state<CardSale | null>(null);
	let tapped = $state(false);
	let busy = $state(false);
	let tapError = $state<string | null>(null);
	let freeLetIn = $state<number | null>(null);
	// A show's staff page opens the till on that show (#1809).
	let chosenEventId = $state<string | undefined>(page.url.searchParams.get('event') ?? undefined);
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
			const eventId = sale.eventId;
			await connectDoorReader(bridge, () => getTerminalConnection(eventId));
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

<PageHeader width="2xl" title={m.member_volunteer_door_door_sales()} />
<PageContent width="2xl">
	{#if door.events.length === 0}
		<EmptyState
			title={m.member_volunteer_door_no_show_at_door()}
			description={m.member_volunteer_door_collective_shows_starting_within_day()}
		/>
	{:else if sale}
		<Alert>
			{m.member_volunteer_door_charging({ formatCents: formatCents(sale.chargeCents) })}
			{#if !tapped && bridge}{m.member_volunteer_door_hand_phone_over_have_them()}{/if}
		</Alert>

		{#if tapError}
			<Alert type="error">{tapError}</Alert>
		{/if}

		{#if tapped}
			<DoorSaleStatus paymentIntentId={sale.paymentIntentId} />
			<Button variant="primary" class="min-h-11" onclick={reset}
				>{m.member_volunteer_door_next_sale()}</Button
			>
		{:else}
			<div class="flex flex-wrap gap-3">
				{#if bridge}
					<Button variant="primary" class="min-h-11" disabled={busy} onclick={tap}>
						{tapError ? m.member_volunteer_door_try_tap_again() : m.member_volunteer_door_tap_pay()}
					</Button>
				{:else if door.canSimulate}
					<Button variant="primary" class="min-h-11" disabled={busy} onclick={simulate}>
						{m.member_simulate_tap()}
					</Button>
				{:else}
					<Alert type="warning">
						{m.member_volunteer_door_no_card_reader_here_door()}
					</Alert>
				{/if}
				<Button variant="ghost" class="min-h-11" disabled={busy} onclick={cancel}
					>{m.member_volunteer_door_cancel_sale()}</Button
				>
			</div>
		{/if}
	{:else}
		{#if freeLetIn !== null}
			<Alert type="success">
				{m.member_volunteer_door_free_tickets_checked_let_them({ freeLetIn })}
			</Alert>
		{/if}

		<Form remote={startDoorSale} {onsuccess} class="space-y-4">
			<FormField
				field={fields.eventId}
				label={m.member_show()}
				type="select"
				options={eventOptions}
				bind:value={chosenEventId}
				required
			/>
			<FormField
				field={fields.quantity}
				label={m.member_volunteer_door_how_many()}
				type="number"
				bind:value={quantity}
				required
			/>
			{#if capacity}
				<Alert type={capacity.level}>{capacity.text}</Alert>
			{/if}
			<MoneyField
				field={fields.unitPriceCents}
				label={m.member_volunteer_door_each_ticket()}
				value={door.events[0].suggestedCents}
				description={m.member_volunteer_door_whatever_they_can_pay_at({
					formatCents: formatCents(TICKET_MIN_CHARGE_CENTS)
				})}
			/>
			<SubmitButton label={m.member_volunteer_door_take_payment()} class="min-h-11" />
		</Form>

		<!-- Always here, not only after a failure: a card that cannot tap, and a
		     staffer whose screen reader blocks PIN entry, never see an error. -->
		<section class="space-y-2">
			<h2 class="font-semibold">{m.member_volunteer_door_card_will_not_tap()}</h2>
			{#each door.events as event (event.id)}
				<p class="text-muted">
					{m.member_volunteer_door_event_suggested({
						title: event.title,
						price: formatCents(event.suggestedCents)
					})}{#if event.floorCents}{m.member_volunteer_door_event_floor({
							floor: formatCents(event.floorCents)
						})}{/if}{#if event.remaining !== null && event.remaining >= 0}{m.member_volunteer_door_event_left(
							{ count: event.remaining }
						)}{:else if event.remaining !== null}{m.member_volunteer_door_event_over({
							count: -event.remaining
						})}{/if}.
					{#if event.onlineSales}
						<ParaglideMessage
							message={m.member_volunteer_door_they_can_buy_their_own}
							inputs={{
								id: event.id
							}}
							>{#snippet a({ children })}<a class="link" href={resolve(`/events/${event.id}`)}
									>{@render children?.()}</a
								>{/snippet}</ParaglideMessage
						>
					{:else}
						{m.member_volunteer_door_online_sales_closed_show()}
					{/if}
				</p>
			{/each}
		</section>
	{/if}
</PageContent>
