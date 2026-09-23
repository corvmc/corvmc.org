<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { resolve } from '$app/paths';

	/**
	 * One triage surface, two sources (#552). The tables stay separate — gear
	 * must not queue beside a harassment report — and so do the guards.
	 */
	let { active }: { active: 'content' | 'equipment' } = $props();
</script>

<div class="mb-4">
	<TabBar
		tabs={[
			{ key: 'content', label: 'Content', href: resolve('/staff/flags') },
			{ key: 'equipment', label: 'Equipment', href: resolve('/staff/flags/equipment') }
		]}
		{active}
	/>
</div>
