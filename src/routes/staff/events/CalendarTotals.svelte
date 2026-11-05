<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import { getStaffCalendarTotals } from '#lib/remote/events.remote.js';

	const totals = await getStaffCalendarTotals();
	const stats = $derived([
		{ title: m.staff_events_calendar_totals_week(), value: totals.thisWeek },
		{ title: m.staff_events_calendar_totals_month(), value: totals.thisMonth },
		{ title: m.staff_events_calendar_totals_needs_review(), value: totals.needsReview }
	]);
</script>

<div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
	{#each stats as stat (stat.title)}
		<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
	{/each}
</div>
