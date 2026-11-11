<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { resolve } from '$app/paths';

	/** Listings and the tips waiting to become one sit side by side (#1566). */
	let { active, tipCount }: { active: 'listings' | 'tips'; tipCount: number } = $props();
</script>

<TabBar
	tabs={[
		{ key: 'listings', label: m.staff_listings_label(), href: resolve('staff/local-resources') },
		{
			key: 'tips',
			label: m.staff_local_resources_resource_tabs_tips_label(),
			href: resolve('staff/local-resources/tips'),
			...(tipCount > 0 ? { badge: tipCount } : {})
		}
	]}
	{active}
/>
