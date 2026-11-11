<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import SetupElement from './SetupElement.svelte';
	import { payFakeSetupIntent, startAddCard } from '#lib/remote/billing.remote.js';

	let {
		open = $bindable(false),
		driver,
		/**
		 * Which SetupIntent to mint. Defaults to the member's own; a band passes
		 * its own so the card lands on the band's customer rather than on the
		 * person adding it (#1098). The fake driver's form is member-only — the
		 * band path is stripe-only, which `startBandAddCard` reports.
		 */
		start = startAddCard,
		onsaved
	}: {
		open?: boolean;
		driver: 'stripe' | 'fake';
		start?: () => Promise<{ clientSecret: string }>;
		/** Runs after a card is confirmed, for a caller that must refresh its own query. */
		onsaved?: () => void;
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
		start()
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
		onsaved?.();
		// Dropped so reopening mints a fresh intent: a confirmed one cannot be
		// confirmed twice, and a modal that reopened onto a spent secret would
		// fail with nothing on screen to explain why.
		clientSecret = null;
		toast.success(m.member_membership_add_card_modal_toast());
	}
</script>

<Modal bind:open title={m.member_membership_add_card_modal_title()}>
	{#if errorMessage}
		<Alert type="error">{errorMessage}</Alert>
	{:else if !clientSecret}
		<p class="py-4 text-muted">{m.member_membership_add_card_modal_getting_things_ready_text()}</p>
	{:else if driver === 'fake'}
		<Alert type="warning">
			{m.member_membership_add_card_modal_no_card_stored_here_fake_body()}
		</Alert>

		<div class="mt-4">
			<Form remote={payFakeSetupIntent} onsuccess={done}>
				<input {...fields.setupIntentId.as('hidden', setupIntentId)} />
				<FormField
					label={m.member_membership_add_card_modal_card_number_label()}
					name="cardNumber"
					type="text"
					field={fields.cardNumber}
					description={m.member_membership_add_card_modal_description_body()}
				/>
				<SubmitButton
					label={m.member_membership_add_card_modal_save_card_label()}
					successLabel={m.member_membership_add_card_modal_success_label()}
				/>
			</Form>
		</div>
	{:else}
		<SetupElement {clientSecret} onsaved={done} />
	{/if}
</Modal>
