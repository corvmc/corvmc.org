<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import SplitBar from '$lib/components/ui/SplitBar.svelte';
	import { buyReleaseForm } from '$lib/remote/music.remote';
	import { computeSplit, suggestedPlatformCents } from '$lib/finance/audio-split';
	import { AUDIO_MIN_PRICE_CENTS } from '$lib/config';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	let {
		bandSlug,
		bandName,
		releaseSlug,
		priceMinCents,
		allowPayMore
	}: {
		bandSlug: string;
		bandName: string;
		releaseSlug: string;
		priceMinCents: number;
		allowPayMore: boolean;
	} = $props();

	const fields = buyReleaseForm.fields;

	/**
	 * Both amounts are "the buyer's choice, or the default until they make one",
	 * expressed as an override over a derived default rather than as state seeded
	 * from a prop.
	 *
	 * Seeding `$state` from a prop looks equivalent and is not: SvelteKit reuses a
	 * component across parameter changes, so navigating from one release to
	 * another would carry the previous record's price into the new page's form.
	 * A `$derived` fallback tracks the prop until the buyer overrides it, which is
	 * both correct and what the `state_referenced_locally` warning is pointing at.
	 */
	let priceOverride = $state<number | null>(null);
	let platformOverride = $state<number | null>(null);
	let coverFees = $state(false);

	const totalCents = $derived(priceOverride ?? priceMinCents);
	/**
	 * Once the buyer has moved this it is theirs — it deliberately stops tracking
	 * the suggestion, or dragging the price would silently undo an allocation they
	 * made on purpose.
	 */
	const platformCents = $derived(platformOverride ?? suggestedPlatformCents(totalCents));

	const split = $derived(computeSplit({ totalCents, platformCents, coverFees }));
	const free = $derived(totalCents === 0);

	/** The band's floor, as the split bar's constraint on the movable share. */
	const bandFloor = $derived(Math.max(0, priceMinCents - split.stripeFeeCents));

	const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

	function afterBuy(result: unknown) {
		const r = result as { checkoutUrl?: string | null; downloadToken?: string } | undefined;
		// Paid: off to Stripe. Free: already fulfilled, straight to the download.
		if (r?.checkoutUrl) window.location.href = r.checkoutUrl;
		else if (r?.downloadToken) goto(resolve(`/music/download/${r.downloadToken}`));
	}
</script>

<Card>
	<CardBody>
		<CardTitle>{free ? 'Get it' : 'Buy it'}</CardTitle>

		<Form remote={buyReleaseForm} onsuccess={afterBuy}>
			<input {...fields.bandSlug.as('hidden', bandSlug)} />
			<input {...fields.releaseSlug.as('hidden', releaseSlug)} />

			{#if priceMinCents > 0 || allowPayMore}
				<label class="flex flex-col gap-1">
					<span class="font-medium">
						{allowPayMore ? 'Name your price' : 'Price'}
						{#if priceMinCents > 0}
							<span class="text-muted">
								— {allowPayMore ? `${dollars(priceMinCents)} or more` : dollars(priceMinCents)}
							</span>
						{/if}
					</span>
					<input
						type="number"
						class="input w-40"
						min={(priceMinCents / 100).toFixed(2)}
						step="0.50"
						disabled={!allowPayMore}
						value={(totalCents / 100).toFixed(2)}
						oninput={(e) => {
							const next = Math.round(Number(e.currentTarget.value) * 100);
							if (Number.isFinite(next)) priceOverride = Math.max(0, next);
						}}
					/>
				</label>
			{/if}

			{#if totalCents > 0}
				<div class="mt-4 space-y-2">
					<p class="text-muted">Where your money goes — drag to change it.</p>
					<SplitBar
						{totalCents}
						value={platformCents}
						onchange={(cents) => (platformOverride = cents)}
						otherFloorCents={bandFloor}
						fixedCents={split.stripeFeeCents}
						fixedLabel="Card processing"
						valueLabel="CMC"
						otherLabel={bandName}
					/>
					<div class="flex flex-wrap items-center gap-3">
						<label class="flex items-center gap-2">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={coverFees} />
							<!-- Sells far better as "the band keeps the full amount" than as
							     "cover our processing fees" — same money, different question. -->
							<span>
								Add {dollars(split.feeCoveredCents || 0)} so {bandName} keeps the full {dollars(
									totalCents - platformCents
								)}
							</span>
						</label>
						{#if platformOverride !== null && platformOverride !== suggestedPlatformCents(totalCents)}
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={() => (platformOverride = null)}
							>
								Reset to suggested
							</button>
						{/if}
					</div>
				</div>
			{:else if priceMinCents === 0}
				<p class="text-muted">This one's free. Pay something if you'd like to.</p>
			{/if}

			<FormField
				field={fields.email}
				label="Email"
				type="email"
				description="Where the download link goes. Keep it — with no account, it's how you get the files back later."
				required
			/>

			<!-- The buyer's choices, as the numbers the server re-derives from. -->
			<input {...fields.totalCents.as('number', totalCents)} type="hidden" />
			<input
				{...fields.platformCents.as('number', totalCents > 0 ? platformCents : 0)}
				type="hidden"
			/>
			<input {...fields.coverFees.as('checkbox', coverFees)} type="hidden" />

			<SubmitButton disabled={totalCents > 0 && totalCents < AUDIO_MIN_PRICE_CENTS}>
				{free ? 'Download' : `Pay ${dollars(split.chargeCents)}`}
			</SubmitButton>

			{#if totalCents > 0 && totalCents < AUDIO_MIN_PRICE_CENTS}
				<p class="text-warning">
					Pay nothing, or at least {dollars(AUDIO_MIN_PRICE_CENTS)} — below that, card fees take almost
					all of it.
				</p>
			{/if}
		</Form>
	</CardBody>
</Card>
