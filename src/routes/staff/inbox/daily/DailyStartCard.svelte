<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * What a Daily session would cover, before you commit to it.
	 *
	 * The breakdown is the whole point. "11 conversations" is a number you bounce
	 * off; "4 you never answered, 2 that came back from a snooze, 1 waiting over
	 * a week" is a set with a shape, and a session with a shape feels finishable.
	 */
	import { IconPlayerPlay } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import type { DailyScope } from '$lib/server/inbox/thread-service';

	let {
		scope,
		alreadyDone = false,
		onstart,
		oncancel
	}: {
		scope: DailyScope;
		/** A session was already finished today — offered again, not pushed. */
		alreadyDone?: boolean;
		onstart: () => void;
		oncancel: () => void;
	} = $props();

	/**
	 * A flat rate, not a learned one.
	 *
	 * The design asks for "roughly 8 minutes at your usual pace", which would
	 * need a history of how long past sessions took. Rather than invent that from
	 * nothing, this says what it is: about forty seconds a thread. It is honest,
	 * it is close enough to set expectations, and it costs no schema.
	 */
	const minutes = $derived(Math.max(1, Math.round((scope.threadIds.length * 40) / 60)));

	// The three kinds partition the set; the age line does not, so it is shown
	// apart from them rather than as a fourth row that breaks the sum.
	const rows = $derived(
		[
			{ label: m.staff_inbox_daily_daily_start_card_unanswered_by(), count: scope.unanswered },
			{ label: m.staff_inbox_daily_daily_start_card_they_replied_waiting(), count: scope.replied },
			{
				label: m.staff_inbox_daily_daily_start_card_snoozed_threads_came_back(),
				count: scope.returned
			}
		].filter((r) => r.count > 0)
	);
</script>

<Card>
	<CardBody class="gap-5">
		<div class="flex flex-col gap-1">
			<h1 class="text-2xl font-bold">
				{m.staff_inbox_daily_daily_start_card_daily_conversations({
					length: scope.threadIds.length
				})}
			</h1>
			<p class="text-muted">
				{m.staff_inbox_daily_daily_start_card_one_at_time_every_thread()}
			</p>
		</div>

		<ul class="flex flex-col gap-2">
			{#each rows as row (row.label)}
				<li class="flex items-baseline justify-between gap-4 border-b border-base-300 pb-2">
					<span>{row.label}</span>
					<span class="font-bold">{row.count}</span>
				</li>
			{/each}
		</ul>

		{#if scope.longWaiting}
			<p class="text-muted text-sm">
				{scope.longWaiting} of these {scope.longWaiting === 1 ? 'has' : 'have'} been waiting over a week.
			</p>
		{/if}

		{#if alreadyDone}
			<p class="text-subtle text-sm">
				{m.staff_inbox_daily_daily_start_card_already_finished_daily_to()}
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary" onclick={onstart}>
				<IconPlayerPlay size={18} />
				{m.staff_start()}
			</Button>
			<span class="text-subtle text-sm"
				>{m.staff_inbox_daily_daily_start_card_roughly_minutes({ minutes })}</span
			>
			<Button variant="ghost" size="sm" class="ml-auto" onclick={oncancel}
				>{m.staff_inbox_daily_daily_start_card_not_now()}</Button
			>
		</div>
	</CardBody>
</Card>
