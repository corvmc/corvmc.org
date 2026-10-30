<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { resolve } from '$app/paths';

	// Presentation only: each view's remotes carry its guard.
	let { active }: { active: 'orders' | 'recurring' } = $props();

	const tabs = [
		{ key: 'orders', label: 'Work orders', href: resolve('/staff/volunteer/schedule') },
		{ key: 'recurring', label: 'Recurring', href: resolve('/staff/volunteer/schedule/recurring') }
	];
</script>

<TabBar class="mb-4" {active} {tabs} />
