<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { getStaffBandTotals } from '$lib/remote/bands.remote';

	const totals = await getStaffBandTotals();
	const stats = $derived([
		{ title: m.staff_groups_band_totals_active_bands(), value: totals.active },
		{ title: m.staff_premium(), value: totals.premium },
		{ title: m.staff_groups_band_totals_new_30_days(), value: totals.newBands }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
