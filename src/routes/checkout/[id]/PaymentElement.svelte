<script lang="ts">
	import { onMount } from 'svelte';
	import { loadStripe } from '@stripe/stripe-js';
	import type { StripeCheckoutElementsSdk, Appearance } from '@stripe/stripe-js';
	import { STRIPE_PUBLISHABLE_KEY } from '$lib/stripe';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	/**
	 * Stripe's Payment Element, mounted on our own page.
	 *
	 * Stripe still owns the line items, the discount, the currency and the
	 * hundred-odd payment methods — this is a Checkout Session with
	 * `ui_mode: 'elements'`, not a hand-rolled PaymentIntent. What we take back is
	 * the page around the card fields, which is the whole point of the migration.
	 *
	 * The card fields themselves stay inside Stripe's iframe, so the PCI posture
	 * is unchanged (SAQ A) and none of this violates the no-raw-`<input>` rule:
	 * the Element mounts into a plain `<div>` and the only control we render is a
	 * `Button`. It is not a `Form`/`SubmitButton` because there is no form to
	 * submit — confirmation is an imperative call into Stripe.js.
	 *
	 * Everything here is client-only. `loadStripe` injects a script tag, so it
	 * runs in `onMount` and never during SSR.
	 */
	let {
		clientSecret,
		/** Shown on the button until Stripe reports the session's own formatted total. */
		fallbackTotal
	}: {
		clientSecret: string;
		fallbackTotal: string;
	} = $props();

	let mountNode: HTMLDivElement;
	let sdk: StripeCheckoutElementsSdk | undefined;
	let ready = $state(false);
	let canConfirm = $state(false);
	let confirming = $state(false);
	// Null until Stripe's first `change`. Seeding it from `fallbackTotal` would
	// snapshot the prop instead of tracking it, which is what Svelte warns about.
	let stripeTotal = $state<string | null>(null);
	const total = $derived(stripeTotal ?? fallbackTotal);
	let errorMessage = $state<string | null>(null);

	/**
	 * daisyUI's tokens, read off the live document rather than hard-coded, so the
	 * Element follows the theme the rest of the page is already wearing. A token
	 * that resolves to nothing is left out entirely — Stripe's own default is a
	 * better answer than an empty string, which it rejects.
	 */
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
		let element: ReturnType<StripeCheckoutElementsSdk['createPaymentElement']> | undefined;

		(async () => {
			const stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
			if (!stripe) {
				errorMessage = 'Payments are unavailable right now. Please try again shortly.';
				return;
			}

			sdk = stripe.initCheckoutElementsSdk({
				clientSecret,
				elementsOptions: { appearance: daisyAppearance() }
			});

			// The total is Stripe's to report, not ours to recompute: a wallet can
			// change it (surcharges, currency conversion) between mount and confirm,
			// and the button must never name a number the charge will disagree with.
			sdk.on('change', (session) => {
				canConfirm = session.canConfirm;
				stripeTotal = session.total.total.amount;
			});

			element = sdk.createPaymentElement();
			element.mount(mountNode);
			ready = true;
		})().catch((err) => {
			console.error('[checkout] Failed to initialise the Payment Element:', err);
			errorMessage = 'Payments are unavailable right now. Please try again shortly.';
		});

		return () => element?.unmount();
	});

	async function pay() {
		if (!sdk || confirming) return;

		confirming = true;
		errorMessage = null;

		try {
			const loaded = await sdk.loadActions();
			if (loaded.type === 'error') {
				errorMessage = loaded.error.message;
				return;
			}

			// On success Stripe navigates to the session's `return_url`, so there is
			// no success branch to write here — only the error one, which keeps the
			// buyer on this page with Stripe's own copy for the decline.
			const result = await loaded.actions.confirm();
			if (result.type === 'error') errorMessage = result.error.message;
		} finally {
			confirming = false;
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
		disabled={!ready || !canConfirm || confirming}
		onclick={pay}
		title={ready ? undefined : 'Waiting for the payment form to load'}
	>
		{confirming ? 'Paying…' : `Pay ${total}`}
	</Button>
</div>
