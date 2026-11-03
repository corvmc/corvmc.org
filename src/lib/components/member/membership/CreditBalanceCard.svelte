<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { formatMonthDay } from '$lib/utils/format';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
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
	const refreshDate = $derived(formatMonthDay(subscription.currentPeriodEnd));
</script>

<Card>
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconMusic size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">
					{m.member_membership_credit_balance_card_free_practice_hours()}
				</h3>
				<p class="text-muted">{m.member_membership_credit_balance_card_monthly_allocation()}</p>
			</div>
		</div>

		<div class="mt-4 grid gap-4 sm:grid-cols-3">
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div class="text-3xl font-bold text-primary">{allocatedHours}</div>
				<div class="text-muted">{m.member_membership_credit_balance_card_total_month()}</div>
			</div>
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div
					class="text-3xl font-bold"
					class:text-success={remaining > 0}
					class:text-warning={remaining === 0}
				>
					{remaining}
				</div>
				<div class="text-muted">{m.member_membership_credit_balance_card_remaining()}</div>
			</div>
			<div class="rounded-lg bg-base-200/50 p-4 text-center">
				<div class="text-3xl font-bold">{usedHours}</div>
				<div class="text-muted">{m.member_membership_credit_balance_card_used()}</div>
			</div>
		</div>

		<div class="mt-4 rounded-lg bg-primary/5 p-3 text-center">
			<p class="text-muted">
				<ParaglideMessage
					message={m.member_membership_credit_balance_card_hours_refresh}
					inputs={{ refreshDate }}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			</p>
		</div>

		<div class="mt-4 space-y-2 border-t border-base-200 pt-4">
			<div class="flex items-start gap-2">
				<IconCircleCheck size={20} class="mt-0.5 shrink-0 text-success" />
				<span
					><ParaglideMessage
						message={m.member_membership_credit_balance_card_lock_regular_practice}
						inputs={{}}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					></span
				>
			</div>
			<div class="flex items-start gap-2">
				<IconCircleCheck size={20} class="mt-0.5 shrink-0 text-success" />
				<span
					><ParaglideMessage
						message={m.member_membership_credit_balance_card_when_last_minute_openi}
						inputs={{}}
						>{#snippet strong({ children })}<strong>{@render children?.()}</strong
							>{/snippet}</ParaglideMessage
					></span
				>
			</div>
		</div>
	</CardBody>
</Card>
