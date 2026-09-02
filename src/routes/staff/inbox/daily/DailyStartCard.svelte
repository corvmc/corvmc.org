<script lang="ts">
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
			{ label: 'Unanswered by you', count: scope.unanswered },
			{ label: 'They replied and are waiting', count: scope.replied },
			{ label: 'Snoozed threads that came back', count: scope.returned }
		].filter((r) => r.count > 0)
	);
</script>

<Card>
	<CardBody class="gap-5">
		<div class="flex flex-col gap-1">
			<h1 class="text-2xl font-bold">Daily · {scope.threadIds.length} conversations</h1>
			<p class="text-muted">
				One at a time. Every thread gets a decision — reply, assign, snooze or resolve — before the
				next appears.
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
				You already finished a Daily today. These arrived since, or you skipped them.
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary" onclick={onstart}>
				<IconPlayerPlay size={18} /> Start
			</Button>
			<span class="text-subtle text-sm">Roughly {minutes} minutes</span>
			<Button variant="ghost" size="sm" class="ml-auto" onclick={oncancel}>Not now</Button>
		</div>
	</CardBody>
</Card>
