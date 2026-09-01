<script lang="ts">
	/**
	 * Upcoming shifts with places nobody has taken, and a way to fill them from here.
	 *
	 * The old answer to "who do I ask" was on the role page and ended at a **Copy emails**
	 * button (docs/reports/volunteer-workflow-findings.md#a1, #a5). This puts the question
	 * and the answer on the same row: who said they'd help with this role, whether their
	 * clearances actually cover *this shift's date*, and a way to put them on it.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import AddVolunteerAction from './shifts/[id]/AddVolunteerAction.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';

	type ShortShift = {
		id: string;
		roleName: string;
		volunteerRoleId: string;
		eventTitle: string | null;
		startsAt: Date;
		endsAt: Date;
		capacity: number;
		claimed: number;
		confirmed: number;
		short: number;
	};

	let { shifts }: { shifts: ShortShift[] } = $props();

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}
</script>

<InfoCard title="Short-staffed">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>
				{title}
				<span class="text-muted font-normal">· next two weeks</span>
			</CardTitle>
			<Button href="/staff/volunteer/schedule" variant="ghost" size="sm">Schedule →</Button>
		</div>
	{/snippet}

	<Table>
		{#snippet head()}
			<th class="whitespace-nowrap">When</th>
			<th>Role</th>
			<th class="cell-num whitespace-nowrap">Still need</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}

		{#each shifts as shift (shift.id)}
			<tr class="hover">
				<td class="whitespace-nowrap">
					<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium">
						{formatDateShort(shift.startsAt)}
					</a>
					<div class="text-subtle">{timeRange(shift.startsAt, shift.endsAt)}</div>
				</td>

				<td class="cell-primary">
					<div class="truncate font-medium">{shift.roleName}</div>
					{#if shift.eventTitle}
						<div class="truncate text-subtle">{shift.eventTitle}</div>
					{/if}
				</td>

				<td class="cell-num whitespace-nowrap">
					<Badge variant="warning" size="sm">{shift.short}</Badge>
					<span class="ml-1 text-subtle">of {shift.capacity}</span>
				</td>

				<td class="w-px">
					<AddVolunteerAction
						shiftId={shift.id}
						volunteerRoleId={shift.volunteerRoleId}
						roleName={shift.roleName}
						startsAt={shift.startsAt}
					/>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
