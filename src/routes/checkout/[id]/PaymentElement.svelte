<script lang="ts">
	import { onMount } from 'svelte';
	import { loadStripe } from '@stripe/stripe-js';
	import type {
		StripeCheckoutElementsSdk,
		StripeCheckoutSavedPaymentMethod,
		Appearance
	} from '@stripe/stripe-js';
	import { STRIPE_PUBLISHABLE_KEY } from '$lib/stripe';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	/**
	 * Stripe's Payment Element, mounted on our own page.
	 *
	 * A Checkout Session with `ui_mode: 'elements'`, not a hand-rolled
	 * PaymentIntent: Stripe keeps the line items, discount and payment methods,
	 * we take back the page around them. Card fields stay in its iframe (SAQ A
	 * unchanged) and the one control is a `Button`. Client-only.
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
	 * The cards this member already has on file.
	 *
	 * Stripe hands them over on the session but does not render them — that is
	 * the half of `ui_mode: 'elements'` we own. `null` means "use a different
	 * card", which is the only option a guest ever has.
	 */
	let savedCards = $state<StripeCheckoutSavedPaymentMethod[]>([]);
	let chosenCard = $state<string | null>(null);
	// `chosenCard` starts null, which already means "a different card", so the
	// default cannot be expressed as a null check.
	let defaulted = false;
	const usingSavedCard = $derived(chosenCard !== null);
	// A saved card needs nothing typed, so Stripe's `canConfirm` — which reports
	// on the Element — must not gate it.
	const payable = $derived(ready && !confirming && (usingSavedCard || canConfirm));

	const BRANDS: Record<string, string> = {
		visa: 'Visa',
		mastercard: 'Mastercard',
		amex: 'American Express',
		discover: 'Discover'
	};
	const describe = (c: StripeCheckoutSavedPaymentMethod) =>
		`${BRANDS[c.card.brand] ?? 'Card'} •••• ${c.card.last4}`;

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
				elementsOptions: {
					appearance: daisyAppearance(),
					// Both default off, and both are needed: `enableRedisplay` is what
					// populates `session.savedPaymentMethods` at all, `enableSave` is
					// what lets a buyer put a card there during an ordinary purchase.
					savedPaymentMethod: { enableSave: 'auto', enableRedisplay: 'auto' }
				}
			});

			// The total is Stripe's to report, not ours to recompute: a wallet can
			// change it (surcharges, currency conversion) between mount and confirm,
			// and the button must never name a number the charge will disagree with.
			sdk.on('change', (session) => {
				canConfirm = session.canConfirm;
				stripeTotal = session.total.total.amount;

				const saved = session.savedPaymentMethods ?? [];
				savedCards = saved;
				// Default to paying with the card on file — that is the point of it.
				// Only on the first report, so a later `change` cannot yank the
				// selection out from under someone who chose a different card.
				if (!defaulted && saved.length > 0) {
					chosenCard = saved[0].id;
					defaulted = true;
				}
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
			const result = await loaded.actions.confirm(
				chosenCard ? { paymentMethod: chosenCard } : undefined
			);
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

{#if savedCards.length > 0}
	<fieldset class="mb-4 space-y-2">
		<legend class="mb-2 font-medium">Pay with</legend>
		{#each savedCards as saved (saved.id)}
			<label class="flex cursor-pointer items-center gap-3 rounded-box border border-base-300 p-3">
				<input
					type="radio"
					name="savedCard"
					class="radio radio-sm"
					value={saved.id}
					checked={chosenCard === saved.id}
					onchange={() => (chosenCard = saved.id)}
				/>
				<span>{describe(saved)}</span>
				<span class="text-muted text-sm tabular-nums">
					Expires {String(saved.card.expMonth).padStart(2, '0')}/{String(saved.card.expYear).slice(
						-2
					)}
				</span>
			</label>
		{/each}
		<label class="flex cursor-pointer items-center gap-3 rounded-box border border-base-300 p-3">
			<input
				type="radio"
				name="savedCard"
				class="radio radio-sm"
				checked={chosenCard === null}
				onchange={() => (chosenCard = null)}
			/>
			<span>Use a different payment method</span>
		</label>
	</fieldset>
{/if}

<!-- Kept mounted rather than removed while a saved card is selected: remounting
     the Element costs a round trip to Stripe every time the choice changes. -->
<div bind:this={mountNode} class={usingSavedCard ? 'hidden' : ''}></div>

<div class="mt-6">
	<Button
		shape="block"
		disabled={!payable}
		onclick={pay}
		title={ready ? undefined : 'Waiting for the payment form to load'}
	>
		{confirming ? 'Paying…' : `Pay ${total}`}
	</Button>
</div>
