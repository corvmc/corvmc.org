<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { getUserOverview } from '#lib/remote/users.remote.js';
	import { creditsToHours, formatVolunteerHours } from '#lib/config.js';
	import { formatCents } from '#lib/utils/format.js';

	let { overview }: { overview: Awaited<ReturnType<typeof getUserOverview>> } = $props();

	// Four figures, chosen as the ones staff quote back down a phone. Rendered
	// from the overview query that already had to run for the tab badges, so the
	// strip costs nothing beyond what the page was fetching anyway.
	//
	// It was five. "Bands" is gone: the count answered a question nobody asks —
	// which bands is what you want — so the names moved up beside the contact
	// line as links. Four also lays out as a clean 2×2 on a phone instead of
	// leaving a stat stranded on its own row.
	const stats = $derived([
		{
			label: m.staff_members_id_panels_user_scoreboard_free_hours(),
			value: `${creditsToHours(overview.credits.free_hours)}`
		},
		{
			label: m.staff_members_id_panels_user_scoreboard_upcoming_bookings(),
			value: String(overview.counts.upcomingReservations)
		},
		{
			label: m.staff_members_id_panels_user_scoreboard_volunteer_hrs_ytd(),
			value: formatVolunteerHours(overview.counts.approvedMinutesThisYear)
		},
		{
			label: m.staff_members_id_panels_user_scoreboard_lifetime_paid(),
			value: formatCents(overview.counts.lifetimePaidCents)
		}
	]);
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
	{#each stats as stat (stat.label)}
		<div class="rounded-box bg-base-100 px-4 py-3 shadow">
			<div class="text-subtle">{stat.label}</div>
			<div class="text-xl font-medium">{stat.value}</div>
		</div>
	{/each}
</div>
