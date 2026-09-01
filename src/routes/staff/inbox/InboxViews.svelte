<script lang="ts">
	/**
	 * The header line and the five view tabs, which share one query.
	 *
	 * `getInboxThreadCounts` is unparameterized and the thread mutations refresh
	 * it by name, so it cannot live in the list's filter-keyed query — see
	 * InboxChannelOptions. It is awaited here rather than in two places because a
	 * second awaited derived in a sibling is a second round trip that renders at
	 * a different moment, and these two are one statement about the same numbers.
	 */
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import InboxHeader from './InboxHeader.svelte';
	import { getInboxThreadCounts } from '$lib/remote/inbox.remote';

	let { view = $bindable('open'), onchange }: { view?: string; onchange?: (key: string) => void } =
		$props();

	const counts = $derived(await getInboxThreadCounts());
</script>

<InboxHeader open={counts.open} resolved={counts.resolved} />

<!-- `collapse`: below md this becomes a dropdown naming the active tab. Above
     it the five tabs are still wider than the ~20rem list pane, so the row
     scrolls sideways rather than wrapping into two ragged lines — `collapse`
     keys off the viewport, not the pane, and the pane is narrow at every
     viewport wide enough to show a conversation beside it. -->
<div class="-mx-1 overflow-x-auto px-1">
	<TabBar
		class="w-max"
		collapse
		tabs={[
			{ key: 'open', label: 'Open', badge: counts.open },
			{ key: 'awaiting', label: 'Awaiting reply', badge: counts.awaiting },
			{ key: 'snoozed', label: 'Snoozed', badge: counts.snoozed },
			{ key: 'resolved', label: 'Resolved', badge: counts.resolved },
			{ key: 'all', label: 'All', badge: counts.all }
		]}
		active={view}
		onchange={(key) => {
			view = key;
			onchange?.(key);
		}}
	/>
</div>
