<script lang="ts">
	import { page } from '$app/state';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import PaymentElement from './PaymentElement.svelte';
	import { getCheckoutSession, payFakeCheckout } from '$lib/remote/checkout.remote';

	// Declared above the top-level await below: a declaration that follows one is
	// async-gated, which would compile `fields.sessionId.as()` into an async
	// derived. Pinned by `src/async-effect-shape.spec.ts`.
	const fields = payFakeCheckout.fields;

	const sessionId = $derived(page.params.id ?? '');
	const session = $derived(await getCheckoutSession(sessionId));

	const money = (cents: number, currency: string) =>
		new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
			cents / 100
		);

	const total = $derived(money(session.amountTotal, session.currency));
</script>

<PageHeader
	title={session.driver === 'fake' ? 'Test checkout' : 'Checkout'}
	subtitle={session.driver === 'fake'
		? 'This is not Stripe — the fake payment gateway is active'
		: undefined}
/>

<PageContent width="md">
	{#if session.driver === 'fake'}
		<Alert type="warning">
			No money moves here. This page stands in for Stripe Checkout so the flow can be exercised end
			to end without a network call. Production never serves it.
		</Alert>

		<div class="h-4"></div>
	{/if}

	<Card>
		<CardBody>
			<div class="flex items-baseline justify-between">
				<span class="text-muted">{session.mode === 'subscription' ? 'Due today' : 'Total'}</span>
				<span class="text-3xl font-bold">{total}</span>
			</div>
			{#if session.amountSubtotal !== session.amountTotal}
				<p class="mt-1 text-muted text-sm">
					{money(session.amountSubtotal, session.currency)} before credits
				</p>
			{/if}

			{#if session.status === 'complete'}
				<div class="mt-4">
					<Alert type="success">This session has already been paid.</Alert>
				</div>
			{:else if session.driver === 'fake'}
				<div class="mt-6">
					<Form remote={payFakeCheckout}>
						<input {...fields.sessionId.as('hidden', sessionId)} />
						<FormField
							label="Card number"
							name="cardNumber"
							type="text"
							field={fields.cardNumber}
							description="Stripe's own test numbers, so a card that declines here declines against the real API too."
						/>
						<SubmitButton label="Pay {total}" successLabel="Paid" />
					</Form>
				</div>

				<ul class="mt-4 space-y-1 text-muted text-sm">
					{#each session.testCards as card (card.number)}
						<li><code>{card.number}</code> — {card.outcome.replace('_', ' ')}</li>
					{/each}
				</ul>
			{:else if session.clientSecret}
				<div class="mt-6">
					<PaymentElement clientSecret={session.clientSecret} fallbackTotal={total} />
				</div>
			{:else}
				<div class="mt-4">
					<!-- A `hosted_page` session reached by its id rather than its Stripe URL.
					     Nothing to mount, and no way to recover it from here. -->
					<Alert type="error">This checkout can't be completed on this page.</Alert>
				</div>
			{/if}

			{#if session.cancelUrl && session.status !== 'complete'}
				<div class="mt-6">
					<Button href={session.cancelUrl} variant="ghost" size="sm">Cancel and go back</Button>
				</div>
			{/if}
		</CardBody>
	</Card>
</PageContent>
