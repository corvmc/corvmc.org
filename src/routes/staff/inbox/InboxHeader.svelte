<script lang="ts">
	/**
	 * The bar above the queue: what this is, and the way into Daily.
	 *
	 * It used to state "Open N · Resolved N" as well. The view strip below is now
	 * icon tabs carrying their own counts, so both numbers are already on screen
	 * one line down — and a header that repeats the row under it is a header worth
	 * half its height. One row at every width for the same reason: the queue is
	 * what you came to read, and this is the frame around it.
	 */
	import { resolve } from '$app/paths';
	import { IconPlayerPlay } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { doneToday } from './daily/session.svelte';

	let { open }: { open: number } = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-xl font-bold">Inbox</h1>

	<!-- Only offered when there is something to walk through. A "Start Daily · 0"
	     is an invitation to a session that ends on the frame it starts on. -->
	{#if open > 0}
		<Button
			href={resolve('/staff/inbox/daily')}
			variant={doneToday() ? 'default' : 'primary'}
			size="sm"
			class="shrink-0"
		>
			<IconPlayerPlay size={16} />
			{doneToday() ? 'Daily again' : 'Start Daily'} · {open}
		</Button>
	{/if}
</div>
