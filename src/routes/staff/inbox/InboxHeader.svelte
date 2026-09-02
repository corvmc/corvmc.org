<script lang="ts">
	/**
	 * The bar above the queue: what this is, how much of it there is, and the way
	 * into Daily.
	 *
	 * The counts are the same query the tabs read, so they cost nothing extra —
	 * this states the two numbers worth seeing without opening a tab (what needs
	 * you, what you have cleared) while the tabs carry the rest.
	 */
	import { resolve } from '$app/paths';
	import { IconPlayerPlay } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { doneToday } from './daily/session.svelte';

	let { open, resolved }: { open: number; resolved: number } = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
	<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
		<h1 class="text-xl font-bold">Inbox</h1>
		<p class="text-subtle text-sm">Open {open} · Resolved {resolved}</p>
	</div>

	<!-- Only offered when there is something to walk through. A "Start Daily · 0"
	     is an invitation to a session that ends on the frame it starts on. -->
	{#if open > 0}
		<Button
			href={resolve('/staff/inbox/daily')}
			variant={doneToday() ? 'default' : 'primary'}
			size="sm"
		>
			<IconPlayerPlay size={16} />
			{doneToday() ? 'Daily again' : 'Start Daily'} · {open}
		</Button>
	{/if}
</div>
