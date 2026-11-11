<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import { getStaffClubTotals } from '#lib/remote/groups.remote.js';

	const totals = await getStaffClubTotals();
	const stats = $derived([
		{ title: m.staff_groups_clubs_club_totals_active_clubs_title(), value: totals.clubs },
		{ title: m.staff_groups_clubs_club_totals_club_members_title(), value: totals.members },
		{
			title: m.staff_groups_clubs_club_totals_applications_waiting_title(),
			value: totals.applications
		}
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
