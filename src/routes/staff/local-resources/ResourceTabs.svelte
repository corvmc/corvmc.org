<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { resolve } from '$app/paths';

	/** Listings and the tips waiting to become one sit side by side (#1566). */
	let { active, tipCount }: { active: 'listings' | 'tips'; tipCount: number } = $props();
</script>

<div class="mb-4">
	<TabBar
		tabs={[
			{ key: 'listings', label: 'Listings', href: resolve('/staff/local-resources') },
			{
				key: 'tips',
				label: 'Tips',
				href: resolve('/staff/local-resources/tips'),
				...(tipCount > 0 ? { badge: tipCount } : {})
			}
		]}
		{active}
	/>
</div>
