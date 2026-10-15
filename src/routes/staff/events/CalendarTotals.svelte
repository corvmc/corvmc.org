<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffCalendarTotals } from '$lib/remote/events.remote';

	const totals = await getStaffCalendarTotals();
	const stats = $derived([
		{ title: 'This week', value: totals.thisWeek },
		{ title: 'This month', value: totals.thisMonth },
		{ title: 'Needs review', value: totals.needsReview }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
