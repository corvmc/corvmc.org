<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	const tiers = [
		{ amount: '$10/month', hours: '2 free hours' },
		{ amount: '$25/month', hours: '5 free hours' },
		{ amount: '$60/month', hours: '12 free hours' }
	];
</script>

<div>
	<div class="mb-6 text-center">
		<h2 class="text-3xl font-bold">Pick What Works for You</h2>
		<p class="mt-2 opacity-70">
			There's no wrong number here. Every dollar goes to the Collective, and every $5 earns you
			another hour of practice time.
		</p>
	</div>

	<Card class="mx-auto max-w-3xl">
		<CardBody>
			<div class="mb-8 text-center">
				<div class="mb-4 text-6xl font-bold text-primary">1 hour = $5</div>
			</div>

			<div class="mb-8 space-y-3">
				{#each tiers as tier (tier.amount)}
					<div class="flex items-center justify-between rounded-lg bg-base-200/50 p-4">
						<span class="font-medium">{tier.amount}</span>
						<span class="opacity-50">→</span>
						<span class="font-semibold">{tier.hours}</span>
					</div>
				{/each}
			</div>

			<div class="rounded-lg bg-primary/5 p-6">
				<div class="mb-2 text-center text-sm font-semibold uppercase tracking-wide text-primary">
					Why sliding scale?
				</div>
				<p class="text-center opacity-70">
					Music shouldn't be gated by budget. Every tier gets the same benefits — the only
					difference is how many practice hours you walk away with. Contribute what feels right.
				</p>
			</div>

			<p class="mt-6 text-center text-muted">
				Change or cancel anytime. No commitments, no awkward conversations.
			</p>
		</CardBody>
	</Card>
</div>
