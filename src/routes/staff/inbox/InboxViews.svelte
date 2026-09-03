<script lang="ts">
	/**
	 * The header line, the four view tabs, and whatever the reader has saved.
	 *
	 * `getInboxThreadCounts` is unparameterized and the thread mutations refresh
	 * it by name, so it cannot live in the list's filter-keyed query — see
	 * InboxChannelFilter. It is awaited here rather than in two places because a
	 * second awaited derived in a sibling is a second round trip that renders at
	 * a different moment, and these two are one statement about the same numbers.
	 */
	import { IconAlarmSnooze, IconInbox, IconInboxOff, IconLayoutList } from '@tabler/icons-svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import InboxHeader from './InboxHeader.svelte';
	import { getInboxThreadCounts } from '$lib/remote/inbox.remote';
	import SavedViewTabs from './SavedViewTabs.svelte';

	let { view = $bindable('open'), onchange }: { view?: string; onchange?: (key: string) => void } =
		$props();

	const counts = $derived(await getInboxThreadCounts());
</script>

<InboxHeader open={counts.open} />

<!-- `dense`: four word-tabs are wider than the ~20rem list pane at every
     viewport wide enough to show a conversation beside it, so they used to
     scroll sideways — and a scroll container clips `overflow-y` too, cropping
     the buttons' 5px lift and their shadow with it. Icons plus counts fit the
     pane outright, which is also why there is no `collapse` here any more: the
     strip is narrower than a phone.

     The glyphs are the ones StatusBadge already maps to these statuses, so a
     tab and the badge on a row never disagree — Snoozed's alarm covers the
     awaiting rows it absorbed, which keep their own `awaiting_reply` badge.
     The wrapper stays as a safety net, with room for the lift it used to
     crop — the negative margin keeps that room from costing height. -->
<div class="-mx-1 -my-1.5 overflow-x-auto px-1 py-1.5">
	<TabBar
		class="w-max"
		dense
		tabs={[
			{ key: 'open', label: 'Open', badge: counts.open, icon: IconInbox },
			{ key: 'snoozed', label: 'Snoozed', badge: counts.snoozed, icon: IconAlarmSnooze },
			{ key: 'resolved', label: 'Resolved', badge: counts.resolved, icon: IconInboxOff },
			{ key: 'all', label: 'All', badge: counts.all, icon: IconLayoutList }
		]}
		active={view}
		onchange={(key) => {
			view = key;
			onchange?.(key);
		}}
	/>
</div>

<!-- Below the system tabs rather than beside them: these belong to one person
     and the five above do not, and a saved view sets the status tab as part of
     what it restores. Its own query, so the counts above paint without it. -->
<SavedViewTabs />
