<script lang="ts">
	/**
	 * One bar across both panes: the page and the way into Daily over the queue,
	 * the open conversation's subject and actions over the thread (#1927).
	 *
	 * Below `lg` one pane shows at a time, and so does one half of this. The
	 * counts are the view tabs' own query, so this reads the cached entry.
	 */
	import { resolve } from '$app/paths';
	import { IconPlayerPlay } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getInboxThreadCounts } from '$lib/remote/inbox.remote';
	import { doneToday } from './daily/session.svelte';
	import { useInboxToolbar } from './toolbar.svelte';

	let { threadOpen }: { threadOpen: boolean } = $props();

	const slot = useInboxToolbar();
</script>

<div class="flex min-h-10 items-center gap-4 border-b border-base-300 pb-3">
	<div
		class="items-center justify-between gap-2 lg:w-80 lg:shrink-0 xl:w-96 {threadOpen
			? 'hidden lg:flex'
			: 'flex w-full'}"
	>
		<h1 class="text-xl font-bold">Inbox</h1>

		<!-- Only offered when there is something to walk through. A "Start Daily · 0"
		     is an invitation to a session that ends on the frame it starts on. -->
		{#await getInboxThreadCounts() then counts}
			{#if counts.open > 0}
				<Button
					href={resolve('/staff/inbox/daily')}
					variant={doneToday() ? 'default' : 'primary'}
					size="sm"
					class="shrink-0"
				>
					<IconPlayerPlay size={16} />
					{doneToday() ? 'Daily again' : 'Start Daily'} · {counts.open}
				</Button>
			{/if}
		{/await}
	</div>

	{#if slot.conversation}
		<div class="min-w-0 flex-1 items-center gap-3 {threadOpen ? 'flex' : 'hidden lg:flex'}">
			{@render slot.conversation()}
		</div>
	{/if}
</div>
