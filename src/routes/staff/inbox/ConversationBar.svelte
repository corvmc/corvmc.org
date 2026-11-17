<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The open conversation's half of the inbox toolbar. The layout draws it from
	 * the route param, so it is in the server's HTML: a page cannot hand content up
	 * to a layout that has already rendered (#3217). `getInboxThread` is the same
	 * cached entry the thread page reads.
	 */
	import { resolve } from '$app/paths';
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import DispositionBar from '#lib/components/inbox/DispositionBar.svelte';
	import { channelIcon, channelLabel } from '#lib/components/inbox/channels.js';
	import { threadDisplayStatus } from '#lib/components/inbox/thread-status.js';
	import { getInboxThread } from '#lib/remote/inbox.remote.js';
	import { useInboxToolbar } from './toolbar.svelte';

	let { threadId }: { threadId: string } = $props();

	const toolbar = useInboxToolbar();

	const t = $derived(await getInboxThread(threadId));
	const ChannelIcon = $derived(channelIcon(t.channel));
</script>

<Button
	href={resolve('staff/inbox')}
	variant="ghost"
	size="sm"
	shape="square"
	class="lg:hidden"
	aria-label={m.staff_inbox_id_aria_label()}
>
	<IconArrowLeft size={18} />
</Button>
<ChannelIcon size={16} class="shrink-0 text-muted" aria-label={channelLabel(t.channel)} />
<div class="flex min-w-0 flex-1 items-center gap-2">
	<h2 class="truncate text-lg font-bold">{t.subject ?? channelLabel(t.channel)}</h2>
	<StatusBadge status={threadDisplayStatus(t)} label />
	<span class="hidden truncate text-muted text-sm md:inline">
		{t.contactUserName ?? t.contactName ?? t.contactEmail ?? ''}
	</span>
</div>
<!-- Above `sm` the exits live in the toolbar. Below it they move under the
     thread page's composer instead. -->
<div class="hidden sm:contents">
	<DispositionBar
		threadId={t.id}
		status={t.status}
		awaiting={!!t.awaitingReplySince}
		onassign={() => {
			toolbar.detailsOpen = true;
		}}
	/>
</div>
