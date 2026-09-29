<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffUserTotals } from '$lib/remote/users.remote';

	const totals = await getStaffUserTotals();
	const stats = $derived([
		{ title: 'Accounts', value: totals.total },
		{ title: 'Active', value: totals.active },
		{ title: 'Sustaining members', value: totals.sustaining },
		{ title: 'Deactivated or banned', value: totals.deactivated }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
