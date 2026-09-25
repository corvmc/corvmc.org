<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import { getDoorSale } from '$lib/remote/door.remote';

	/**
	 * After the tap: the webhook is what checks the order in, so poll for it,
	 * briefly. Admission was already settled by the tap itself; this only says
	 * the record has landed. Same bounded shape as the ticket success page.
	 */
	let { paymentIntentId }: { paymentIntentId: string } = $props();

	const sale = $derived(await getDoorSale(paymentIntentId));
	let attempts = $state(0);
	const RETRY_LIMIT = 10;
	const RETRY_MS = 2000;

	$effect(() => {
		if (sale.status !== 'pending' || attempts >= RETRY_LIMIT) return;
		const timer = setTimeout(() => {
			attempts += 1;
			getDoorSale(paymentIntentId).refresh();
		}, RETRY_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if sale.status === 'paid'}
	<Alert type="success">
		Paid. {sale.quantity}
		{sale.quantity === 1 ? 'ticket' : 'tickets'} checked in. Let them in.
	</Alert>
{:else if sale.status === 'cancelled'}
	<Alert type="warning">This sale was cancelled. Nothing was charged.</Alert>
{:else if attempts >= RETRY_LIMIT}
	<Alert type="warning">
		The card was accepted, but Stripe has not confirmed it yet. Let them in; the tickets will be
		checked in when it does.
	</Alert>
{:else}
	<Alert>Card accepted. Recording the sale…</Alert>
{/if}
