<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	const tiers = [
		{ amount: '$10/month', hours: '2 free hours' },
		{ amount: '$25/month', hours: '5 free hours' },
		{ amount: '$60/month', hours: '12 free hours' }
	];
</script>

<div>
	<div class="mb-6 text-center">
		<h2 class="text-3xl font-bold">{m.member_membership_sliding_scale_pick_what_works()}</h2>
		<p class="mt-2 opacity-70">
			{m.member_membership_sliding_scale_there_s_no_wrong_number()}
		</p>
	</div>

	<Card class="mx-auto max-w-3xl">
		<CardBody>
			<div class="mb-8 text-center">
				<div class="mb-4 text-6xl font-bold text-primary">
					{m.member_membership_sliding_scale_1_hour_5()}
				</div>
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
				<div class="mb-2 text-center text-sm font-semibold tracking-wide text-primary uppercase">
					{m.member_membership_sliding_scale_why_sliding_scale()}
				</div>
				<p class="text-center opacity-70">
					{m.member_membership_sliding_scale_music_shouldn_t_gated_by()}
				</p>
			</div>

			<p class="mt-6 text-center text-muted">
				{m.member_membership_sliding_scale_change_cancel_anytime_no_com()}
			</p>
		</CardBody>
	</Card>
</div>
