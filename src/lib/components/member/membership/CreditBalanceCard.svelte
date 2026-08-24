<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { IconMusic, IconCircleCheck } from '@tabler/icons-svelte';
	import type { SubscriptionInfo, Credits } from '$lib/server/db/schema/finance';
	import { creditsToHours } from '$lib/config';

	let {
		credits,
		subscription,
		allocatedThisMonth,
		usedThisMonth
	}: {
		credits: Credits;
		subscription: SubscriptionInfo;
		allocatedThisMonth: number;
		usedThisMonth: number;
	} = $props();

	// allocated/used/remaining arrive as credits (30-min blocks); display as hours.
	const allocatedHours = $derived(creditsToHours(allocatedThisMonth));
	const usedHours = $derived(creditsToHours(usedThisMonth));
	const remaining = $derived(creditsToHours(credits.free_hours ?? 0));
	const refreshDate = $derived(
		subscription.currentPeriodEnd.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric'
		})
	);
</script>

<Card>
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconMusic size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">Free Practice Hours</h3>
				<p class="text-muted">Your monthly allocation</p>
			</div>
		</div>

		<div class="mt-4 grid gap-4 sm:grid-cols-3">
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div class="text-3xl font-bold text-primary">{allocatedHours}</div>
				<div class="text-muted">Total This Month</div>
			</div>
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div
					class="text-3xl font-bold"
					class:text-success={remaining > 0}
					class:text-warning={remaining === 0}
				>
					{remaining}
				</div>
				<div class="text-muted">Remaining</div>
			</div>
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div class="text-3xl font-bold">{usedHours}</div>
				<div class="text-muted">Used</div>
			</div>
		</div>

		<div class="mt-4 rounded-lg bg-primary/5 p-3 text-center">
			<p class="text-muted">Your hours refresh on <strong>{refreshDate}</strong></p>
		</div>

		<div class="mt-4 space-y-2 border-t border-base-200 pt-4">
			<div class="flex items-start gap-2">
				<IconCircleCheck size={20} class="mt-0.5 shrink-0 text-success" />
				<span><strong>Recurring reservations</strong> to lock in your regular practice times</span>
			</div>
			<div class="flex items-start gap-2">
				<IconCircleCheck size={20} class="mt-0.5 shrink-0 text-success" />
				<span><strong>Priority booking</strong> when last-minute openings pop up</span>
			</div>
		</div>
	</CardBody>
</Card>
