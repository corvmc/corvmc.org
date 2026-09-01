<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import ShiftFormFields from '$lib/components/volunteer/ShiftFormFields.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { createShift, getShifts } from '$lib/remote/volunteer.remote';

	/**
	 * A role's upcoming shifts, owning the query behind them.
	 *
	 * The page's query is keyed by the role id alone — that is what lets the role mutations refresh
	 * it — so a shift list keyed by a `from` timestamp could not join it.
	 *
	 * `from` is pinned once by the caller, not recomputed: `refresh()` is keyed by argument, and a
	 * `from` that ticked with the clock would mint a new key on every re-evaluation, so the refresh
	 * after creating a shift would miss its query.
	 */
	let {
		role,
		from
	}: {
		role: {
			id: string;
			name: string;
			isActive: boolean;
			defaultCapacity: number | null;
			defaultDurationMinutes: number | null;
		};
		from: string;
	} = $props();

	const shifts = $derived(getShifts({ volunteerRoleId: role.id, from }));

	// Tomorrow, running for however long this role usually runs.
	const START_MS = Date.now() + 86_400_000;
	const shiftStart = $derived(toLocalDateTime(new Date(START_MS)));
	const shiftEnd = $derived(
		toLocalDateTime(new Date(START_MS + (role.defaultDurationMinutes ?? 4 * 60) * 60_000))
	);

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}
</script>

<InfoCard title="Upcoming Shifts">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			{#if role.isActive}
				<Action
					action={createShift}
					label="New shift"
					variant="ghost"
					size="sm"
					modalTitle="Schedule a {role.name} shift"
					submitLabel="Create"
					successToast="Shift scheduled"
					onsuccess={() => getShifts({ volunteerRoleId: role.id, from }).refresh()}
				>
					{#snippet form()}
						<ShiftFormFields
							form={createShift}
							roleId={role.id}
							startsAt={shiftStart}
							endsAt={shiftEnd}
							capacity={String(role.defaultCapacity ?? 1)}
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}

	{#await shifts then rows}
		{#if rows.length === 0}
			<EmptyState description="Nothing scheduled for this role yet." />
		{:else}
			<Table>
				{#snippet head()}
					<th>When</th>
					<th class="col-support">Event</th>
					<th class="cell-num whitespace-nowrap">Confirmed</th>
				{/snippet}

				{#each rows as shift (shift.id)}
					{@const href = resolve(`/staff/volunteer/shifts/${shift.id}`)}
					{@const short = shift.claimed < shift.capacity}
					{@const unconfirmed = shift.claimed - shift.confirmed}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="cell-primary whitespace-nowrap">
							<a {href} class="font-medium">{formatDateShort(shift.startsAt)}</a>
							<div class="text-subtle">
								{timeRange(shift.startsAt, shift.endsAt)}
							</div>
						</td>
						<td class="col-support">
							{#if shift.eventTitle}
								<span class="truncate">{shift.eventTitle}</span>
							{/if}
						</td>
						<!--
							Confirmed against capacity, with claims nobody has confirmed called out
							separately. One number for both made a shift with three unconfirmed
							claims read as staffed (docs/reports/volunteer-workflow-findings.md#a3).
						-->
						<td class="cell-num whitespace-nowrap">
							{shift.confirmed}/{shift.capacity}
							{#if unconfirmed > 0}
								<Badge variant="warning" size="xs" class="ml-2">+{unconfirmed}</Badge>
							{:else if short}
								<Badge variant="warning" size="xs" class="ml-2">short</Badge>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/await}
</InfoCard>
