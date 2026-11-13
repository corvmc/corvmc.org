<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Table from '#lib/components/ui/Table.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '#lib/utils/format.js';

	type ShortShift = {
		id: string;
		shiftId: string;
		startsAt: Date;
		roleName: string;
		eventTitle: string | null;
		capacity: number;
		claimed: number;
	};

	/** One row per shift: `id` is the task's and repeats when a task has two shifts. */
	let { rows }: { rows: ShortShift[] } = $props();
</script>

<Table>
	{#snippet head()}
		<th class="whitespace-nowrap">{m.staff_when_label()}</th>
		<th>{m.staff_role_label()}</th>
		<th class="col-support">{m.staff_event_label()}</th>
		<th class="cell-num whitespace-nowrap">{m.staff_still_need_label()}</th>
	{/snippet}
	{#each rows as shift (shift.shiftId)}
		<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/tasks/${shift.id}`)}>
			<td class="whitespace-nowrap">{formatDateShort(shift.startsAt)}</td>
			<td class="cell-primary">{shift.roleName}</td>
			<td class="col-support cell-text truncate">{shift.eventTitle ?? ''}</td>
			<td class="cell-num text-warning">{shift.capacity - shift.claimed}</td>
		</tr>
	{/each}
</Table>
