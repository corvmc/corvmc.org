<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import SetupElement from './SetupElement.svelte';
	import { payFakeSetupIntent, startAddCard } from '$lib/remote/billing.remote';

	let {
		open = $bindable(false),
		driver
	}: {
		open?: boolean;
		driver: 'stripe' | 'fake';
	} = $props();

	const fields = payFakeSetupIntent.fields;

	let clientSecret = $state<string | null>(null);
	let starting = $state(false);
	let errorMessage = $state<string | null>(null);

	/**
	 * The SetupIntent is minted when the modal opens, not when the page loads: it
	 * is a real Stripe object with a lifetime, and creating one per page view for
	 * a member who never clicks "add a card" is a request nobody asked for.
	 */
	$effect(() => {
		if (!open || clientSecret || starting) return;

		starting = true;
		errorMessage = null;
		startAddCard()
			.then((result) => {
				clientSecret = result.clientSecret;
			})
			.catch(() => {
				errorMessage = "We couldn't start that just now. Please try again in a moment.";
			})
			.finally(() => {
				starting = false;
			});
	});

	// The intent id is the client secret's prefix — Stripe's own format, and what
	// the fake's form posts back so the server can find the intent it minted.
	const setupIntentId = $derived(clientSecret?.split('_secret_')[0] ?? '');

	function done() {
		open = false;
		// Dropped so reopening mints a fresh intent: a confirmed one cannot be
		// confirmed twice, and a modal that reopened onto a spent secret would
		// fail with nothing on screen to explain why.
		clientSecret = null;
		toast.success('Card saved');
	}
</script>

<Modal bind:open title="Add a card">
	{#if errorMessage}
		<Alert type="error">{errorMessage}</Alert>
	{:else if !clientSecret}
		<p class="py-4 text-muted">Getting things ready…</p>
	{:else if driver === 'fake'}
		<Alert type="warning">
			No card is stored here. The fake payment gateway is active, so this stands in for Stripe's own
			card form.
		</Alert>

		<div class="mt-4">
			<Form remote={payFakeSetupIntent} onsuccess={done}>
				<input {...fields.setupIntentId.as('hidden', setupIntentId)} />
				<FormField
					label="Card number"
					name="cardNumber"
					type="text"
					field={fields.cardNumber}
					description="Any number works here; the last four become the card on file."
				/>
				<SubmitButton label="Save card" successLabel="Saved" />
			</Form>
		</div>
	{:else}
		<SetupElement {clientSecret} onsaved={done} />
	{/if}
</Modal>
