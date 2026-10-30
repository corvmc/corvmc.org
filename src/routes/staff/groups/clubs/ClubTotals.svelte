<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffClubTotals } from '$lib/remote/groups.remote';

	const totals = await getStaffClubTotals();
	const stats = $derived([
		{ title: 'Active clubs', value: totals.clubs },
		{ title: 'Club members', value: totals.members },
		{ title: 'Applications waiting', value: totals.applications }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
