<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import { getStaffCalendarTotals } from '#lib/remote/events.remote.js';

	const totals = await getStaffCalendarTotals();
	const stats = $derived([
		{ title: m.staff_events_calendar_totals_week_title(), value: totals.thisWeek },
		{ title: m.staff_events_calendar_totals_month_title(), value: totals.thisMonth },
		{ title: m.staff_events_calendar_totals_needs_review_title(), value: totals.needsReview }
	]);
</script>

<StatGrid cols={3} class="mb-4">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</StatGrid>
