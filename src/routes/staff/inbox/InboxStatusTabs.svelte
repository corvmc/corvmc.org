<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { getInboxThreadCounts } from '$lib/remote/inbox.remote';

	/**
	 * The status tabs and their counts, owning the query behind the badges.
	 *
	 * `getInboxThreadCounts` is unparameterized and the thread mutations refresh it by name, so it
	 * cannot live in the list's filter-keyed query — see InboxChannelOptions.
	 */
	let { view = $bindable('open'), onchange }: { view?: string; onchange?: (key: string) => void } =
		$props();

	const counts = $derived(await getInboxThreadCounts());
</script>

<!-- `collapse`: below md this becomes a dropdown naming the active tab.
     Four tabs never fit the list pane, which is narrower than the full-width
     page this came from. -->
<TabBar
	collapse
	tabs={[
		{ key: 'open', label: 'Open', badge: counts.open },
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
