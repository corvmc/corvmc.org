<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { getDoorSale } from '#lib/remote/door.remote.js';

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
		{m.member_volunteer_door_door_sale_status_paid_tickets_checked_body({
			quantity: sale.quantity
		})}
	</Alert>
{:else if sale.status === 'cancelled'}
	<Alert type="warning"
		>{m.member_volunteer_door_door_sale_status_sale_was_cancelled_no_body()}</Alert
	>
{:else if attempts >= RETRY_LIMIT}
	<Alert type="warning">
		{m.member_volunteer_door_door_sale_status_card_was_accepted_but_body()}
	</Alert>
{:else}
	<Alert>{m.member_volunteer_door_door_sale_status_card_accepted_recordi_body()}</Alert>
{/if}
