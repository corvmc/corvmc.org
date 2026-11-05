<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import AddCardModal from '#lib/components/member/membership/AddCardModal.svelte';
	import { getBandBilling, startBandAddCard } from '#lib/remote/billing.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	/**
	 * The band's card on file. Its own component so the billing query only runs
	 * for someone who may manage it, and through `Latest` rather than `{#await}`
	 * so the refresh after a save keeps the Add card modal mounted (#2359).
	 */
	let { slug }: { slug: string } = $props();

	const billingQuery = new Latest(() => getBandBilling(slug));
	$effect(() => {
		if (billingQuery.error) throw billingQuery.error.e;
	});

	let addCardOpen = $state(false);
</script>

{#if billingQuery.current}
	{@const billing = billingQuery.current}
	<Card>
		<CardBody>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle size="base">{m.band_slug_subscription_card_file()}</CardTitle>
				<Button
					type="button"
					variant="default"
					size="sm"
					outline
					onclick={() => (addCardOpen = true)}
				>
					{billing.cards.length > 0
						? m.band_slug_subscription_replace_card()
						: m.band_slug_subscription_add_card()}
				</Button>
			</div>

			{#if !billing.available}
				<p class="text-muted">
					{m.band_slug_subscription_we_could_not_reach_our()}
				</p>
			{:else if billing.cards.length === 0}
				<p class="text-muted">
					{m.band_slug_subscription_no_card_saved_act_renewals()}
				</p>
			{:else}
				{#each billing.cards as card (card.id)}
					<p class="text-sm">
						<ParaglideMessage
							message={card.isDefault
								? m.band_slug_subscription_expires_billed
								: m.band_slug_subscription_expires}
							inputs={{
								toUpperCase: card.brand.toUpperCase(),
								last4: card.last4,
								expMonth: card.expMonth,
								expYear: card.expYear
							}}
							>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
								>{/snippet}{#snippet span2({ children })}<span class="text-muted"
									>{@render children?.()}</span
								>{/snippet}</ParaglideMessage
						>
					</p>
				{/each}
				<p class="mt-2 text-muted">
					{m.band_slug_subscription_band_s_card_not_member()}
				</p>
			{/if}

			<AddCardModal
				bind:open={addCardOpen}
				driver={billing.driver}
				start={() => startBandAddCard(slug)}
				onsaved={() => getBandBilling(slug).refresh()}
			/>
		</CardBody>
	</Card>
{/if}
