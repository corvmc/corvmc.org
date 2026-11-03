<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		cancelPayAtReader,
		getReaderPayment,
		simulatePayAtReader
	} from '$lib/remote/reservations.remote';

	/**
	 * After the amount is on the reader: the webhook settles the booking, so poll
	 * for it, bounded as the door screen does. Nothing here tells the server a
	 * payment succeeded; `paid` is read back from the booking.
	 */
	let {
		reservationId,
		paymentIntentId,
		canSimulate,
		onretry,
		onpaid,
		oncancelled
	}: {
		reservationId: string;
		paymentIntentId: string;
		canSimulate: boolean;
		onretry: () => Promise<void>;
		onpaid: () => void;
		oncancelled: () => void;
	} = $props();

	const RETRY_LIMIT = 30;
	const RETRY_MS = 2000;
	let attempts = $state(0);
	let busy = $state(false);
	const ref = $derived({ reservationId, paymentIntentId });
	const payment = $derived(await getReaderPayment(ref));

	const polling = $derived(payment.status === 'waiting' || payment.status === 'processing');

	$effect(() => {
		if (payment.status === 'paid') onpaid();
		else if (payment.status === 'cancelled') oncancelled();
	});

	$effect(() => {
		if (!polling || attempts >= RETRY_LIMIT) return;
		const timer = setTimeout(() => {
			attempts += 1;
			getReaderPayment(ref).refresh();
		}, RETRY_MS);
		return () => clearTimeout(timer);
	});

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		try {
			await fn();
			attempts = 0;
			await getReaderPayment(ref).refresh();
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-3" aria-live="polite">
	{#if payment.status === 'processing' || payment.status === 'paid'}
		<Alert>{m.member_reservations_id_reader_payment_status_card_accepted_c()}</Alert>
	{:else if payment.status === 'declined'}
		<Alert type="warning"
			>{m.member_reservations_id_reader_payment_status_try_again_with({
				message: payment.message
			})}</Alert
		>
	{:else if attempts >= RETRY_LIMIT}
		<Alert type="warning">{m.member_reservations_id_reader_payment_status_still_waiting_c()}</Alert>
	{:else if payment.status === 'waiting'}
		<Alert>{m.member_reservations_id_reader_payment_status_tap_card_reader()}</Alert>
	{/if}

	{#if payment.status === 'waiting' || payment.status === 'declined'}
		<div class="flex flex-wrap gap-2">
			{#if payment.status === 'declined' || attempts >= RETRY_LIMIT}
				<Button variant="primary" disabled={busy} onclick={() => run(onretry)}
					>{m.member_reservations_id_reader_payment_status_try_again()}</Button
				>
			{/if}
			{#if canSimulate && payment.status === 'waiting'}
				<Button
					variant="primary"
					outline
					disabled={busy}
					onclick={() => run(() => simulatePayAtReader({ ...ref, outcome: 'succeed' }))}
				>
					{m.member_simulate_tap()}
				</Button>
				<Button
					variant="warning"
					outline
					disabled={busy}
					onclick={() => run(() => simulatePayAtReader({ ...ref, outcome: 'decline' }))}
				>
					{m.member_reservations_id_reader_payment_status_simulate_declin()}
				</Button>
			{/if}
			<Button variant="ghost" disabled={busy} onclick={() => run(() => cancelPayAtReader(ref))}>
				{m.member_cancel()}
			</Button>
		</div>
	{/if}
</div>
