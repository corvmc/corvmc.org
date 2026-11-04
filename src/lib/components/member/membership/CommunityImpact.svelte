<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { CommunityStats } from '#lib/server/db/schema/finance.js';

	let { stats }: { stats: CommunityStats } = $props();
</script>

<div class="rounded-lg bg-base-200/50 p-8">
	<div class="mb-6 text-center">
		<h2 class="text-3xl font-bold">
			{m.member_membership_community_impact_what_we_re_building_toget()}
		</h2>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-primary">{stats.sustainingMemberCount}</div>
			<div class="text-sm font-medium">
				{m.member_membership_community_impact_sustaining_members()}
			</div>
			<div class="mt-1 text-subtle">
				{m.member_membership_community_impact_showing_up_collective_eve()}
			</div>
		</div>
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-secondary">
				{stats.totalFreeHoursAllocated.toLocaleString()}
			</div>
			<div class="text-sm font-medium">{m.member_membership_community_impact_free_hours()}</div>
			<div class="mt-1 text-subtle">
				{m.member_membership_community_impact_practice_time_funded_mont()}
			</div>
		</div>
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-accent">{stats.participationPercent}%</div>
			<div class="text-sm font-medium">{m.member_membership_community_impact_members()}</div>
			<div class="mt-1 text-subtle">
				{m.member_membership_community_impact_chipping_keep_things_runn()}
			</div>
		</div>
	</div>
</div>
