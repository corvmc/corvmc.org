<script lang="ts">
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffUserTotals } from '$lib/remote/users.remote';

	const totals = await getStaffUserTotals();
	const stats = $derived([
		{ title: 'Accounts', value: totals.accounts },
		{ title: 'Sustaining members', value: totals.sustaining },
		{ title: 'New members', value: totals.newMembers }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
