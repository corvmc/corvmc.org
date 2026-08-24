<script lang="ts">
	import type { CommunityStats } from '$lib/server/db/schema/finance';

	let { stats }: { stats: CommunityStats } = $props();
</script>

<div class="rounded-lg bg-base-200/50 p-8">
	<div class="mb-6 text-center">
		<h2 class="text-3xl font-bold">What We're Building Together</h2>
	</div>

	<div class="grid gap-6 md:grid-cols-3">
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-primary">{stats.sustainingMemberCount}</div>
			<div class="text-sm font-medium">Sustaining Members</div>
			<div class="mt-1 text-subtle">showing up for the Collective every month</div>
		</div>
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-secondary">
				{stats.totalFreeHoursAllocated.toLocaleString()}
			</div>
			<div class="text-sm font-medium">Free Hours</div>
			<div class="mt-1 text-subtle">of practice time funded this month</div>
		</div>
		<div class="text-center">
			<div class="mb-2 text-4xl font-bold text-accent">{stats.participationPercent}%</div>
			<div class="text-sm font-medium">of Members</div>
			<div class="mt-1 text-subtle">chipping in to keep things running</div>
		</div>
	</div>
</div>
