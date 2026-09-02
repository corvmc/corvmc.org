<script lang="ts">
	/**
	 * What the session did, and what is left.
	 *
	 * The hand-back line is the part that matters: a session that ends with
	 * "done!" and no account of what is still open is a session that quietly
	 * teaches you the queue is empty when it is not. Skipped threads are named,
	 * because a skip is a decision deferred and the whole point is that you know
	 * you deferred it.
	 */
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { getInboxThreadCounts } from '$lib/remote/inbox.remote';
	import { undoLast } from '$lib/components/inbox/undo.svelte';
	import { session } from './session.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const c = $derived(session.counts);
	const stats = $derived(
		[
			{ n: c.resolve, label: 'resolved' },
			{ n: c.snooze, label: 'snoozed' },
			{ n: c.wait, label: 'waiting on them' },
			{ n: c.reopen, label: 'reopened' },
			{ n: c.skip, label: 'skipped' }
		].filter((s) => s.n > 0)
	);

	// Skips are not handled threads. A thread you skipped and then decided about
	// when it came round again would otherwise be counted twice, and the headline
	// would claim more conversations than the session contained.
	const handled = $derived(c.resolve + c.snooze + c.wait + c.reopen);
</script>

<Card>
	<CardBody class="gap-5">
		<h1 class="text-2xl font-bold">Daily done — {handled} handled</h1>

		<div class="flex flex-wrap gap-6">
			{#each stats as stat (stat.label)}
				<div class="flex flex-col">
					<span class="text-2xl font-bold">{stat.n}</span>
					<span class="text-subtle text-sm">{stat.label}</span>
				</div>
			{/each}
		</div>

		<!-- Its own query, and the only fresh number here: the counts changed
		     under the session, and saying so is the hand-back. -->
		{#await getInboxThreadCounts() then counts}
			<p class="text-muted">
				{counts.open === 0
					? 'Nothing is left open.'
					: `${counts.open} conversation${counts.open === 1 ? ' is' : 's are'} still open${session.skipped.length ? ` — ${session.skipped.length} you skipped` : ''}.`}
				{#if counts.awaiting}
					{counts.awaiting} are waiting on a reply and will come back on their own.
				{/if}
			</p>
		{/await}

		<div class="flex flex-wrap gap-2">
			<Button variant="primary" onclick={onclose}>Back to inbox</Button>
			<!-- The Resolved view rather than a bespoke surface: what you sent is
			     already a list, and it is one staff can go back to tomorrow. -->
			<Button href="{resolve('/staff/inbox')}?view=resolved" variant="default" onclick={onclose}>
				Review what I sent
			</Button>
			<!-- The same ten-second undo the queue offers, reachable from here
			     because the last thing you did is the one you are most likely to
			     have got wrong. -->
			<Button variant="ghost" onclick={() => undoLast()}>Undo last action</Button>
		</div>
	</CardBody>
</Card>
