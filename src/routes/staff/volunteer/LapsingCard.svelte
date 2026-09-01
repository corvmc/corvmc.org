<script lang="ts">
	/**
	 * Clearances that run out before a shift the holder is already on.
	 *
	 * Not the same list as `/staff/volunteer/clearances?state=expiring`, and the difference
	 * is the point (docs/reports/volunteer-workflow-findings.md#c1). That page answers "who
	 * expires soon", which nobody is obliged to act on. This one has a deadline attached:
	 * somebody is rostered for Saturday, the card their role requires lapses on Friday, and
	 * the gate — checked as of the shift's date — will be right to refuse them while the
	 * roster still says they are booked.
	 *
	 * Waiting on a member rather than on staff, which is why it sits below everything else.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import type { MemberRef } from '$lib/types/entity';

	type Row = {
		userId: string;
		member: MemberRef;
		certificationId: string;
		certificationName: string;
		expiresAt: Date;
		shiftId: string;
		roleName: string;
		startsAt: Date;
	};

	let { rows }: { rows: Row[] } = $props();
</script>

<InfoCard title="Lapses before a shift they're on">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Button href="/staff/volunteer/clearances" variant="ghost" size="sm">Who's cleared →</Button>
		</div>
	{/snippet}

	<Table>
		{#snippet head()}
			<th>Member</th>
			<th class="col-support">Clearance</th>
			<th class="col-support whitespace-nowrap">Expires</th>
			<th class="whitespace-nowrap">Shift</th>
		{/snippet}

		{#each rows as row (row.userId + row.certificationId + row.shiftId)}
			<tr class="hover">
				<td class="cell-primary">
					<!-- Straight to the member's page, because granting a renewal is the fix
					     and Grant Certification already lives there. -->
					<a href="{resolve(`/staff/users/${row.userId}`)}?tab=volunteer" class="link">
						<EntityIdentity ref={row.member} />
					</a>
				</td>
				<td class="col-support">{row.certificationName}</td>
				<td class="col-support whitespace-nowrap text-warning">
					{formatDateShortYear(row.expiresAt)}
				</td>
				<td class="whitespace-nowrap">
					<a href={resolve(`/staff/volunteer/shifts/${row.shiftId}`)} class="link">
						{row.roleName}, {formatDateShort(row.startsAt)}
					</a>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
