<script lang="ts">
	/** The equipment reports this work order answers; resolving it closes them together. */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import type { getStaffShiftPage } from '$lib/remote/volunteer.remote';
	import { formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	type Report = Awaited<ReturnType<typeof getStaffShiftPage>>['reports'][number];
	let { reports }: { reports: Report[] } = $props();
</script>

<InfoCard title="Equipment reports">
	<ul class="flex flex-col gap-2">
		{#each reports as report (report.id)}
			<li class="flex flex-wrap items-center gap-2 text-sm">
				<a class="link" href={resolve(`/staff/flags/equipment/${report.id}`)}>
					{report.note.length > 80 ? `${report.note.slice(0, 80)}…` : report.note}
				</a>
				{#if report.blocksUse}
					<Badge variant="error" size="xs">out of use</Badge>
				{/if}
				<Badge variant={report.status === 'pending' ? 'warning' : 'ghost'} size="xs">
					{report.status}
				</Badge>
				<span class="text-subtle text-xs">{formatDateShort(report.createdAt)}</span>
			</li>
		{/each}
	</ul>
</InfoCard>
