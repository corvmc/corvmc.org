<script lang="ts">
	import { onMount } from 'svelte';
	import { loadStripe } from '@stripe/stripe-js';
	import type { Stripe, StripeElements, StripePaymentElement, Appearance } from '@stripe/stripe-js';
	import { STRIPE_PUBLISHABLE_KEY } from '$lib/stripe';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { finishAddCard } from '$lib/remote/billing.remote';

	/**
	 * Stripe's Payment Element in setup mode — saving a card without charging it.
	 *
	 * The sibling of `routes/checkout/[id]/PaymentElement.svelte`, and the same
	 * bargain: the card fields stay inside Stripe's iframe, so the PCI posture is
	 * unchanged (SAQ A) and the no-raw-`<input>` rule is not in play — the
	 * Element mounts into a plain `<div>` and the only control here is a
	 * `Button`. Not a `Form`, because confirmation is an imperative call into
	 * Stripe.js rather than a submission.
	 *
	 * A SetupIntent rather than a Checkout Session, so this uses `elements()` and
	 * `confirmSetup` where the checkout page uses the Checkout Elements SDK.
	 */
	let {
		clientSecret,
		onsaved
	}: {
		clientSecret: string;
		onsaved: () => void;
	} = $props();

	let mountNode: HTMLDivElement;
	let stripe: Stripe | undefined;
	let elements: StripeElements | undefined;
	let ready = $state(false);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);

	/** daisyUI's own tokens, read off the live document. Same as the checkout page. */
	function daisyAppearance(): Appearance {
		const styles = getComputedStyle(document.documentElement);
		const token = (name: string) => styles.getPropertyValue(name).trim() || undefined;

		return {
			variables: {
				colorBackground: token('--color-base-100'),
				colorText: token('--color-base-content'),
				colorPrimary: token('--color-primary'),
				colorDanger: token('--color-error'),
				borderRadius: token('--radius-field'),
				fontFamily: token('--font-sans')
			}
		};
	}

	onMount(() => {
		let element: StripePaymentElement | undefined;

		(async () => {
			stripe = (await loadStripe(STRIPE_PUBLISHABLE_KEY)) ?? undefined;
			if (!stripe) {
				errorMessage = 'Payments are unavailable right now. Please try again shortly.';
				return;
			}

			elements = stripe.elements({ clientSecret, appearance: daisyAppearance() });
			element = elements.create('payment');
			element.mount(mountNode);
			ready = true;
		})().catch((err) => {
			console.error('[billing] Failed to initialise the Setup Element:', err);
			errorMessage = 'Payments are unavailable right now. Please try again shortly.';
		});

		return () => element?.unmount();
	});

	async function save() {
		if (!stripe || !elements || saving) return;

		saving = true;
		errorMessage = null;

		try {
			// `redirect: 'if_required'` keeps the member in the modal for a card that
			// needs no 3DS step, which is nearly all of them. One that does need it
			// is sent away and comes back to this page, where the modal is closed —
			// so the server is told about the intent rather than the browser being
			// trusted to report success.
			const result = await stripe.confirmSetup({
				elements,
				redirect: 'if_required'
			});

			if (result.error) {
				errorMessage = result.error.message ?? 'That card could not be saved.';
				return;
			}

			await finishAddCard({ setupIntentId: result.setupIntent.id });
			onsaved();
		} catch (err) {
			console.error('[billing] Failed to save the card:', err);
			errorMessage = 'That card could not be saved. Please try again.';
		} finally {
			saving = false;
		}
	}
</script>

{#if errorMessage}
	<div class="mb-4">
		<Alert type="error">{errorMessage}</Alert>
	</div>
{/if}

<div bind:this={mountNode}></div>

<div class="mt-6">
	<Button
		shape="block"
		disabled={!ready || saving}
		onclick={save}
		title={ready ? undefined : 'Waiting for the card form to load'}
	>
		{saving ? 'Saving…' : 'Save card'}
	</Button>
</div>
