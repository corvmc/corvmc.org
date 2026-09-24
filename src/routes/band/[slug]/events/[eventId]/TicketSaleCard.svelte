<script lang="ts">
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
			Sell tickets through CMC
			{#if sale.onSale && !sale.blocker}
				<Badge variant="success" size="sm">On sale</Badge>
			{:else if sale.onSale}
				<Badge variant="warning" size="sm">Paused</Badge>
			{/if}
		</CardTitle>

		{#if sale.blocker === 'not_premium'}
			<Alert type="info" href={resolve('/band/[slug]/subscription', { slug })}>
				Selling tickets through the collective is part of the premium plan.
			</Alert>
		{:else if sale.blocker === 'no_payouts'}
			<Alert type="warning" href={resolve('/band/[slug]/music/payouts', { slug })}>
				Finish setting up payouts first. Ticket money goes straight to your own Stripe account.
			</Alert>
		{/if}

		{#if sale.onSale}
			<p class="text-muted">
				{sale.sold} sold{sale.quantity ? ` of ${sale.quantity}` : ''}, suggested {formatCents(
					sale.priceCents ?? 0
				)}. Cancelling the gig refunds every buyer.
			</p>
		{:else}
			<p class="text-muted">
				Buyers pay on the collective's site and the money lands in your own Stripe account. The
				collective suggests {suggested}% for itself; buyers see the split and can move it, down to
				nothing.
			</p>
		{/if}

		{#if !sale.blocker}
			<Form remote={openBandTicketSaleForm} successToast="Tickets saved" onsuccess={refresh}>
				<input {...openFields.slug.as('hidden', slug)} />
				<input {...openFields.eventId.as('hidden', eventId)} />
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<FormField
						field={openFields.priceDollars}
						label="Suggested price ($)"
						value={dollars(sale.priceCents)}
						placeholder="12.00"
						required
					/>
					<FormField
						field={openFields.floorDollars}
						label="Least a buyer may pay ($)"
						value={sale.onSale ? dollars(sale.priceFloorCents) || '0' : '0'}
						description="0 lets people pay what they can."
					/>
					<FormField
						field={openFields.quantity}
						label="Capacity"
						value={sale.quantity ? String(sale.quantity) : ''}
						description="Blank for no limit."
					/>
				</div>
				<SubmitButton label={sale.onSale ? 'Save ticket terms' : 'Put tickets on sale'} />
			</Form>
		{/if}

		{#if sale.onSale}
			<Form
				remote={closeBandTicketSaleForm}
				successToast="Tickets taken off sale"
				onsuccess={refresh}
			>
				<input {...closeFields.slug.as('hidden', slug)} />
				<input {...closeFields.eventId.as('hidden', eventId)} />
				<SubmitButton variant="ghost" label="Stop selling" />
			</Form>
		{/if}
	</CardBody>
</Card>
