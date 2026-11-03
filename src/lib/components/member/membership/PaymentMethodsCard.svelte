<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

	/**
	 * `Action`'s callback mode reports a failure only by flashing its trigger,
	 * which sits behind the confirm modal — so the reason never reaches the
	 * member. Removing the last card on a live subscription is refused with a
	 * message that tells them what to do instead, and that message is the whole
	 * point of the guard.
	 */
	function failureMessage(err: unknown): string {
		const e = err as { body?: { message?: string }; message?: string } | undefined;
		return e?.body?.message ?? e?.message ?? 'That did not work. Please try again.';
	}

	const expiry = (month: number, year: number) =>
		`${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
</script>

<Card testid="payment-methods">
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconCreditCard size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">
					{m.member_membership_payment_methods_card_payment_methods()}
				</h3>
				<p class="text-muted">{m.member_membership_payment_methods_card_card_contribution_bil()}</p>
			</div>
		</div>

		{#if !available}
			<div class="mt-4">
				<Alert type="warning">
					{m.member_membership_payment_methods_card_we_couldn_t_reach_our()}
				</Alert>
			</div>
		{:else if cards.length === 0}
			<p class="mt-4 text-muted">{m.member_membership_payment_methods_card_no_card_saved_yet()}</p>
		{:else}
			<ul class="mt-4 divide-y divide-base-300">
				{#each cards as card (card.id)}
					<li class="flex flex-wrap items-center gap-3 py-3">
						<span class="font-medium">{brandName(card.brand)}</span>
						<span class="text-muted tabular-nums">•••• {card.last4}</span>
						<span class="text-subtle text-sm tabular-nums">
							{m.member_membership_payment_methods_card_expires({
								expiry: expiry(card.expMonth, card.expYear)
							})}
						</span>
						{#if card.isDefault}
							<Badge variant="success">{m.member_membership_payment_methods_card_default()}</Badge>
						{/if}

						<div class="ms-auto flex gap-2">
							{#if !card.isDefault}
								<Action
									action={async () => {
										await makeDefaultCard({ paymentMethodId: card.id });
									}}
									label={m.member_membership_payment_methods_card_make_default()}
									variant="default"
									size="sm"
									outline
									onsuccess={() =>
										toast.success(m.member_membership_payment_methods_card_default_card_updated())}
									onfailure={(err) => toast.error(failureMessage(err))}
								/>
							{/if}
							<Action
								action={async () => {
									await forgetCard({ paymentMethodId: card.id });
								}}
								label={m.member_membership_payment_methods_card_remove()}
								variant="error"
								size="sm"
								outline
								modalTitle={m.member_membership_payment_methods_card_modal_title()}
								confirm="Remove this card from your account?"
								onsuccess={() =>
									toast.success(m.member_membership_payment_methods_card_card_removed())}
								onfailure={(err) => toast.error(failureMessage(err))}
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
