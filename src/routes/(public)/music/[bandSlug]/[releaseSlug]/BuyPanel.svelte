<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import SplitBar from '$lib/components/ui/SplitBar.svelte';
	import { buyReleaseForm } from '$lib/remote/music.remote';
	import { computeAudioSplit, suggestedPlatformCents } from '$lib/finance/audio-split';
	import { AUDIO_MIN_PRICE_CENTS } from '$lib/config';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let {
		bandSlug,
		bandName,
		releaseSlug,
		priceMinCents,
		allowPayMore,
		viewerEmail
	}: {
		bandSlug: string;
		bandName: string;
		releaseSlug: string;
		priceMinCents: number;
		allowPayMore: boolean;
		/** The signed-in buyer's address, or `null` for a visitor. */
		viewerEmail: string | null;
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
	const suggested = $derived(suggestedPlatformCents(totalCents, coverFees));
	const platformCents = $derived(platformOverride ?? suggested);

	const split = $derived(computeAudioSplit({ totalCents, platformCents, coverFees }));
	/**
	 * The split as it would be *with* coverage, so the checkbox can quote the
	 * surcharge before it is ticked. Reading `split.feeCoveredCents` there shows
	 * $0.00 while unchecked — the number only becomes non-zero once you have
	 * already agreed to it, which is the wrong way round for a decision.
	 */
	const covered = $derived(computeAudioSplit({ totalCents, platformCents, coverFees: true }));
	const free = $derived(totalCents === 0);

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
					<!--
						No `otherFloorCents`. What protects the band is the TOTAL being at
						least its asking price — enforced server-side in `validateSplit` —
						not a floor on its share of that total. Passing `priceMinCents` here
						consumed the whole amount and clamped CMC's share to zero, so the
						suggested 10% never appeared. The agreed model has the band netting
						$8.47 on a $10 minimum, which is below it by design: card
						processing comes off the top before either side is paid.
					-->
					<SplitBar
						totalCents={split.chargeCents}
						value={split.platformNetCents}
						onchange={(cents) => (platformOverride = cents)}
						fixedCents={split.stripeFeeCents}
						fixedLabel="Card processing"
						fixedCovered={coverFees}
						valueLabel="CMC"
						otherLabel={bandName}
						otherTone="blue"
						valueTone="orange"
					/>
					<div class="flex flex-wrap items-center gap-3">
						<label class="flex items-center gap-2">
							<input type="checkbox" class="checkbox checkbox-sm" bind:checked={coverFees} />
							<!-- The bar already shows where the money lands, and turns the fee
							     segment gold the moment this is ticked, so the sentence
							     explaining the consequence was saying twice what the control
							     shows once. -->
							<span>Add {dollars(covered.feeCoveredCents)} to cover processing</span>
						</label>
						{#if platformOverride !== null && platformOverride !== suggested}
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

			<!--
				Where the download goes, and the one moment it is worth offering an
				account.

				A signed-in buyer is never asked: the address is already known, the
				purchase attaches to their session, and re-typing an email you are
				logged in with reads as though the site forgot you. A visitor gets the
				field *and* the offer, because this is the exact moment the difference
				between the two matters — an anonymous buy is recoverable only from the
				emailed link, and one signed-in buy puts it on a page instead.

				Deliberately an offer, not a wall. Buying without an account stays a
				first-class path; the whole free-release design depends on a band being
				able to hand a stranger a record with nothing in the way.
			-->
			<div class="mt-4 mb-4 space-y-2">
				{#if viewerEmail}
					<input {...fields.email.as('hidden', viewerEmail)} />
					<p class="text-muted">
						Buying as <span class="font-medium">{viewerEmail}</span> — it'll be in your
						<a class="link" href={resolve('/member/music')}>Releases</a> straight away.
					</p>
				{:else}
					<FormField
						field={fields.email}
						label="Email"
						type="email"
						description="Where the download link goes."
						required
					/>
					<p class="text-muted">
						Got an account?
						<a
							class="link"
							href="{resolve('/login')}?redirect={encodeURIComponent(page.url.pathname)}"
						>
							Sign in
						</a>
						and it lands in your Releases too.
					</p>
				{/if}
			</div>

			<!-- The buyer's choices, as the numbers the server re-derives from. -->
			<input {...fields.totalCents.as('number', totalCents)} type="hidden" />
			<input
				{...fields.platformCents.as('number', totalCents > 0 ? platformCents : 0)}
				type="hidden"
			/>
			<input {...fields.coverFees.as('checkbox', coverFees)} type="hidden" />

			<SubmitButton
				label={free ? 'Download' : `Pay ${dollars(split.chargeCents)}`}
				disabled={totalCents > 0 && totalCents < AUDIO_MIN_PRICE_CENTS}
			/>

			{#if totalCents > 0 && totalCents < AUDIO_MIN_PRICE_CENTS}
				<p class="text-warning">
					Pay nothing, or at least {dollars(AUDIO_MIN_PRICE_CENTS)} — below that, card fees take almost
					all of it.
				</p>
			{/if}
		</Form>
	</CardBody>
</Card>
