<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffBandTotals } from '$lib/remote/bands.remote';

	const totals = await getStaffBandTotals();
	const stats = $derived([
		{ title: 'Active bands', value: totals.active },
		{ title: 'Premium', value: totals.premium },
		{ title: 'New in 30 days', value: totals.newBands }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
