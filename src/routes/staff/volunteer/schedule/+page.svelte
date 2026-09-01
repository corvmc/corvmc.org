<script lang="ts">
	/**
	 * The next two weeks, grouped by day.
	 *
	 * `/staff/volunteer/shifts` is the catalog — every shift there has ever been, filtered
	 * by role, with an Include-past checkbox. It is the wrong shape for "who is on tonight",
	 * which is the question a coordinator asks most: answering it there meant ticking a box
	 * that merged a month of history into one flat list with no marker for today
	 * (docs/reports/volunteer-workflow-findings.md#a4).
	 *
	 * `listShifts` has taken a `to` since it was written and nothing ever passed one. This
	 * passes one.
	 *
	 * Three numbers per row, not one. `claimed` counts places taken and `confirmed` counts
	 * places actually booked, and a list that prints only the first says a shift with three
	 * unconfirmed claims is fully staffed — which is finding #a3.
	 */
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import NewShiftAction from '../NewShiftAction.svelte';
	import AddVolunteerAction from '../shifts/[id]/AddVolunteerAction.svelte';
	import { formatDateShort, relativeDay, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { getShiftsInWindow } from '$lib/remote/volunteer.remote';

	/** How far ahead a coordinator plans in one sitting. */
	const WINDOW_DAYS = [7, 14, 30] as const;
	type WindowDays = (typeof WINDOW_DAYS)[number];
	const DAY_MS = 24 * 60 * 60 * 1000;

	const initial = page.url.searchParams;
	const parseDays = (raw: string | null): WindowDays =>
		WINDOW_DAYS.includes(Number(raw) as WindowDays) ? (Number(raw) as WindowDays) : 14;

	let days = $state(parseDays(initial.get('days')));
	let roleFilter = $state(initial.get('role') ?? '');

	// Writes the URL, never state — `goto(..., { replaceState })` rather than
	// `replaceState()`, which updates neither `page.url` nor the router's own entry.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (days !== 14) pairs.push(['days', String(days)]);
		if (roleFilter) pairs.push(['role', roleFilter]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/schedule')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// Pinned once rather than derived from the clock. `refresh()` is keyed by argument, so
	// a `from` that ticked every re-evaluation would mint a new key each time and the
	// refresh after a mutation would miss its query — the trap RoleShiftsCard documents.
	const anchor = new Date();
	const from = anchor.toISOString();

	const shifts = $derived(
		getShiftsInWindow({
			from,
			to: new Date(anchor.getTime() + days * DAY_MS).toISOString(),
			volunteerRoleId: roleFilter || undefined
		})
	);

	const defaultStart = toLocalDateTime(new Date(anchor.getTime() + DAY_MS));

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	/** The venue's calendar day, so the grouping matches the day the shift is on. */
	function dayKey(d: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);
	}

	type Shift = Awaited<ReturnType<typeof getShiftsInWindow>>[number];

	// Walked rather than bucketed through a Map: `listShifts` orders by start, so shifts on
	// the same day are already adjacent. (`svelte/prefer-svelte-reactivity` bans a plain Map
	// in a component, and a SvelteMap rebuilt on every filter change is reactivity nobody
	// subscribes to.)
	function byDay(rows: Shift[]) {
		const groups: { key: string; on: Date; rows: Shift[] }[] = [];
		for (const shift of rows) {
			const key = dayKey(shift.startsAt);
			const last = groups.at(-1);
			if (last && last.key === key) last.rows.push(shift);
			else groups.push({ key, on: shift.startsAt, rows: [shift] });
		}
		return groups;
	}
</script>

<PageHeader title="Schedule" subtitle="Volunteering" backHref="/staff/volunteer">
	<NewShiftAction {defaultStart} />
</PageHeader>

<PageContent>
	<FilterBar
		activeCount={(roleFilter ? 1 : 0) + (days !== 14 ? 1 : 0)}
		onclear={() => {
			roleFilter = '';
			days = 14;
		}}
	>
		<Select
			size="sm"
			aria-label="How far ahead"
			value={String(days)}
			onchange={(e: Event) => {
				days = Number((e.currentTarget as HTMLSelectElement).value) as WindowDays;
			}}
		>
			{#each WINDOW_DAYS as d (d)}
				<option value={String(d)}>Next {d} days</option>
			{/each}
		</Select>

		<Select
			size="sm"
			aria-label="Role"
			value={roleFilter}
			onchange={(e: Event) => {
				roleFilter = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">All roles</option>
			<RoleOptions />
		</Select>
	</FilterBar>

	{#await shifts then rows}
		{@const groups = byDay(rows)}
		{#if groups.length === 0}
			<EmptyState
				title="Nothing scheduled"
				description="No shifts in this window. Post one and members interested in that role see it first."
				actionLabel="See every shift"
				actionHref={resolve('/staff/volunteer/shifts')}
			/>
		{:else}
			{#each groups as group (group.key)}
				<!-- "Today" / "Tomorrow" / a weekday, in venue time. The thing the flat list
				     could never say. -->
				<SectionLabel label="{relativeDay(group.on)} · {formatDateShort(group.on)}" />
				<Table>
					{#snippet head()}
						<th class="whitespace-nowrap">Time</th>
						<th>Role</th>
						<th class="cell-num whitespace-nowrap">Confirmed</th>
						<th class="col-extra">Notes</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each group.rows as shift (shift.id)}
						{@const unconfirmed = shift.claimed - shift.confirmed}
						<tr class="hover" class:opacity-50={shift.cancelledAt}>
							<td class="whitespace-nowrap">
								<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium">
									{timeRange(shift.startsAt, shift.endsAt)}
								</a>
							</td>

							<td class="cell-primary">
								<div class="truncate font-medium">{shift.roleName}</div>
								{#if shift.eventTitle}
									<div class="truncate">
										<a href={resolve(`/staff/events/${shift.eventId}`)} class="link text-subtle">
											{shift.eventTitle}
										</a>
									</div>
								{/if}
								{#if shift.cancelledAt}
									<div class="text-xs text-error">Cancelled</div>
								{/if}
							</td>

							<td class="cell-num whitespace-nowrap">
								<span
									class:text-warning={shift.confirmed < shift.capacity}
									class:text-success={shift.confirmed >= shift.capacity}
								>
									{shift.confirmed}/{shift.capacity}
								</span>
								{#if unconfirmed > 0}
									<!-- The number the old list hid inside `claimed`. -->
									<Badge variant="warning" size="xs" class="ml-1">
										+{unconfirmed} unconfirmed
									</Badge>
								{/if}
							</td>

							<td class="col-extra">
								<div class="truncate text-subtle" title={shift.notes ?? ''}>
									{shift.notes ?? ''}
								</div>
							</td>

							<td class="w-px">
								{#if !shift.cancelledAt && shift.claimed < shift.capacity}
									<AddVolunteerAction
										shiftId={shift.id}
										volunteerRoleId={shift.volunteerRoleId}
										roleName={shift.roleName}
										startsAt={shift.startsAt}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/each}
		{/if}
	{/await}
</PageContent>
