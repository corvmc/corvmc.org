<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		getBandTicketSale,
		openBandTicketSaleForm,
		closeBandTicketSaleForm
	} from '$lib/remote/band-ticket-sale.remote';
	import { BAND_TICKET_PLATFORM_FEE_BPS } from '$lib/config';
	import { formatCents } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	let { slug, eventId }: { slug: string; eventId: string } = $props();

	// Declared before the awaited query: see the note on `updateFields` in +page.svelte.
	const openFields = openBandTicketSaleForm.fields;
	const closeFields = closeBandTicketSaleForm.fields;

	const sale = $derived(await getBandTicketSale({ slug, eventId }));
	const suggested = (BAND_TICKET_PLATFORM_FEE_BPS / 100).toFixed(0);
	const dollars = (cents: number | null) => (cents ? (cents / 100).toFixed(2) : '');
	const refresh = () => getBandTicketSale({ slug, eventId }).refresh();
</script>

<!--
	A band's own gig, sold through the collective (#1203). The money goes to the
	band's own Stripe account at the sale; the collective asks for a share the
	buyer can move. Premium and finished payouts are both required, and each
	has its own way forward rather than a greyed-out form.
-->
<Card>
	<CardBody>
		<CardTitle>
			{m.band_slug_events_event_id_ticket_sale_card_sell_tickets_thro()}
			{#if sale.onSale && !sale.blocker}
				<Badge variant="success" size="sm"
					>{m.band_slug_events_event_id_ticket_sale_card_sale()}</Badge
				>
			{:else if sale.onSale}
				<Badge variant="warning" size="sm"
					>{m.band_slug_events_event_id_ticket_sale_card_paused()}</Badge
				>
			{/if}
		</CardTitle>

		{#if sale.blocker === 'not_premium'}
			<Alert type="info" href={resolve('/band/[slug]/subscription', { slug })}>
				{m.band_slug_events_event_id_ticket_sale_card_selling_tickets_t()}
			</Alert>
		{:else if sale.blocker === 'no_payouts'}
			<Alert type="warning" href={resolve('/band/[slug]/music/payouts', { slug })}>
				{m.band_slug_events_event_id_ticket_sale_card_finish_setting_up()}
			</Alert>
		{/if}

		{#if sale.onSale}
			<p class="text-muted">
				{sale.quantity
					? m.band_slug_events_event_id_ticket_sale_card_sold_of({
							sold: sale.sold,
							quantity: sale.quantity,
							price: formatCents(sale.priceCents ?? 0)
						})
					: m.band_slug_events_event_id_ticket_sale_card_sold({
							sold: sale.sold,
							price: formatCents(sale.priceCents ?? 0)
						})}
			</p>
		{:else}
			<p class="text-muted">
				{m.band_slug_events_event_id_ticket_sale_card_buyers_pay_collec({ suggested })}
			</p>
		{/if}

		{#if !sale.blocker}
			<Form
				remote={openBandTicketSaleForm}
				successToast={m.band_slug_events_event_id_ticket_sale_card_tickets_saved()}
				onsuccess={refresh}
			>
				<input {...openFields.slug.as('hidden', slug)} />
				<input {...openFields.eventId.as('hidden', eventId)} />
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<FormField
						field={openFields.priceDollars}
						label={m.band_slug_events_event_id_ticket_sale_card_suggested_price()}
						value={dollars(sale.priceCents)}
						placeholder="12.00"
						required
					/>
					<FormField
						field={openFields.floorDollars}
						label={m.band_slug_events_event_id_ticket_sale_card_least_buyer_may_p()}
						value={sale.onSale ? dollars(sale.priceFloorCents) || '0' : '0'}
						description={m.band_slug_events_event_id_ticket_sale_card_0_lets_people_pay()}
					/>
					<FormField
						field={openFields.quantity}
						label={m.band_slug_events_event_id_ticket_sale_card_capacity()}
						value={sale.quantity ? String(sale.quantity) : ''}
						description={m.band_slug_events_event_id_ticket_sale_card_blank_no_limit()}
					/>
				</div>
				<SubmitButton
					label={sale.onSale
						? m.band_slug_events_event_id_ticket_sale_card_save_ticket_terms()
						: m.band_slug_events_event_id_ticket_sale_card_put_tickets_sale()}
				/>
			</Form>
		{/if}

		{#if sale.onSale}
			<Form
				remote={closeBandTicketSaleForm}
				successToast={m.band_slug_events_event_id_ticket_sale_card_tickets_taken_off()}
				onsuccess={refresh}
			>
				<input {...closeFields.slug.as('hidden', slug)} />
				<input {...closeFields.eventId.as('hidden', eventId)} />
				<SubmitButton
					variant="ghost"
					label={m.band_slug_events_event_id_ticket_sale_card_stop_selling()}
				/>
			</Form>
		{/if}
	</CardBody>
</Card>
