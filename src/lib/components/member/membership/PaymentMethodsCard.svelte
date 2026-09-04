<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { IconCreditCard } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import AddCardModal from './AddCardModal.svelte';
	import { forgetCard, makeDefaultCard } from '$lib/remote/billing.remote';
	import type { SavedCard } from '$lib/server/finance/billing-service';

	let {
		cards,
		available,
		driver
	}: {
		cards: SavedCard[];
		/** False when Stripe could not be reached — the card list is unknown, not empty. */
		available: boolean;
		driver: 'stripe' | 'fake';
	} = $props();

	let addOpen = $state(false);

	// Card brands come from Stripe as lowercase slugs (`visa`, `amex`). A lookup
	// beats capitalising: "Amex" is not what `amex` title-cases to, and the class
	// names Tailwind sees have to stay literal anyway.
	const BRAND_NAMES: Record<string, string> = {
		visa: 'Visa',
		mastercard: 'Mastercard',
		amex: 'American Express',
		discover: 'Discover',
		diners: 'Diners Club',
		jcb: 'JCB',
		unionpay: 'UnionPay'
	};
	const brandName = (brand: string) => BRAND_NAMES[brand] ?? 'Card';

	const expiry = (month: number, year: number) =>
		`${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
</script>

<Card>
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconCreditCard size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">Payment Methods</h3>
				<p class="text-muted">The card your contribution is billed to</p>
			</div>
		</div>

		{#if !available}
			<div class="mt-4">
				<Alert type="warning">
					We couldn't reach our payment processor just now, so your cards aren't shown. Everything
					else on this page is up to date — try again in a moment.
				</Alert>
			</div>
		{:else if cards.length === 0}
			<p class="mt-4 text-muted">No card saved yet.</p>
		{:else}
			<ul class="mt-4 divide-y divide-base-300">
				{#each cards as card (card.id)}
					<li class="flex flex-wrap items-center gap-3 py-3">
						<span class="font-medium">{brandName(card.brand)}</span>
						<span class="text-muted tabular-nums">•••• {card.last4}</span>
						<span class="text-subtle text-sm tabular-nums">
							Expires {expiry(card.expMonth, card.expYear)}
						</span>
						{#if card.isDefault}
							<Badge variant="success">Default</Badge>
						{/if}

						<div class="ms-auto flex gap-2">
							{#if !card.isDefault}
								<Action
									action={async () => {
										await makeDefaultCard({ paymentMethodId: card.id });
									}}
									label="Make default"
									variant="default"
									size="sm"
									outline
									onsuccess={() => toast.success('Default card updated')}
								/>
							{/if}
							<Action
								action={async () => {
									await forgetCard({ paymentMethodId: card.id });
								}}
								label="Remove"
								variant="error"
								size="sm"
								outline
								modalTitle="Remove card"
								confirm="Remove this card from your account?"
								onsuccess={() => toast.success('Card removed')}
							/>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-4">
			<Button variant="default" size="sm" outline onclick={() => (addOpen = true)}>
				{cards.length === 0 ? 'Add a card' : 'Add another card'}
			</Button>
		</div>
	</CardBody>
</Card>

<AddCardModal bind:open={addOpen} {driver} />
