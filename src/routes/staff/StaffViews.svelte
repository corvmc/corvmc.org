<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { visibleViews, type StaffView } from './views';

	let { views, active }: { views: readonly StaffView[]; active: string } = $props();

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const tabs = $derived(
		visibleViews(views, caps).map(({ key, label, href }) => ({ key, label: label(), href }))
	);
</script>

{#if tabs.length > 1}
	<TabBar {active} {tabs} />
{/if}
