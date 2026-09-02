<script lang="ts">
	/**
	 * Every shift there is, grouped by day, windowed.
	 *
	 * This absorbed `/staff/volunteer/shifts`. The two pages asked the same
	 * question of the same query and disagreed about the answer: the catalog was
	 * a flat list with an Include-past checkbox and no marker for today, so
	 * "who is on tonight" — the question a coordinator asks most — was answered
	 * there by ticking a box that merged a month of history into one list
	 * (docs/reports/volunteer-workflow-findings.md#a4). The window control's
	 * "Everything" option is that checkbox, in the one place that groups by day.
	 *
	 * Three numbers per row, not one. `claimed` counts places taken and
	 * `confirmed` counts places actually booked; a list that prints only the
	 * first says a shift with three unconfirmed claims is fully staffed, which is
	 * finding #a3. The tone rule below encodes the difference: teal is booked,
	 * amber is hands up but nobody confirmed them, orange is nobody at all.
	 *
	 * Cancelled shifts are not rows. They are a notify list — see the divider at
	 * the bottom — and mixing them into the schedule made a called-off shift read
	 * as one more thing to staff.
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
	import Action from '$lib/components/ui/Action.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import NewShiftAction from '../NewShiftAction.svelte';
	import AddVolunteerAction from '../shifts/[id]/AddVolunteerAction.svelte';
	import { formatDateShort, relativeDay, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { getShifts, confirmShiftClaims } from '$lib/remote/volunteer.remote';

	/**
	 * How far ahead a coordinator plans in one sitting, plus the catalog.
	 * `'all'` drops both bounds rather than passing a wide one, so it really is
	 * everything and not "the next decade".
	 */
	const WINDOWS = [7, 14, 30, 'all'] as const;
	type Range = (typeof WINDOWS)[number];
	const DAY_MS = 24 * 60 * 60 * 1000;
	const DEFAULT_WINDOW: Range = 14;

	const windowLabel = (w: Range) => (w === 'all' ? 'Everything' : `Next ${w} days`);

	function parseRange(raw: string | null): Range {
		if (raw === 'all') return 'all';
		const n = Number(raw);
		return (WINDOWS as readonly (number | string)[]).includes(n) ? (n as Range) : DEFAULT_WINDOW;
	}

	const initial = page.url.searchParams;

	let range = $state(parseRange(initial.get('days')));
	let roleFilter = $state(initial.get('role') ?? '');
	let shortOnly = $state(initial.get('short') === '1');

	// Writes the URL, never state — `goto(..., { replaceState })` rather than
	// `replaceState()`, which updates neither `page.url` nor the router's own entry.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (range !== DEFAULT_WINDOW) pairs.push(['days', String(range)]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (shortOnly) pairs.push(['short', '1']);

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

	const shifts = $derived(
		getShifts({
			// "Everything" means everything, history included: that is the catalog
			// this page absorbed, and a `from` would quietly reinstate it.
			from: range === 'all' ? undefined : anchor.toISOString(),
			to: range === 'all' ? undefined : new Date(anchor.getTime() + range * DAY_MS).toISOString(),
			volunteerRoleId: roleFilter || undefined,
			// Fetched, then split off below the divider. They are the one thing on
			// this page nobody can staff.
			includeCancelled: true
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

	type Shift = Awaited<ReturnType<typeof getShifts>>[number];

	const isShort = (s: Shift) => s.confirmed < s.capacity;

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

	/** "3 live shifts · 2 short-staffed · 4 claims to confirm", minus the zeroes. */
	function summarize(live: Shift[]): string {
		const short = live.filter(isShort).length;
		const claims = live.reduce((n, s) => n + (s.claimed - s.confirmed), 0);

		const parts = [`${live.length} ${live.length === 1 ? 'shift' : 'shifts'}`];
		if (short > 0) parts.push(`${short} short-staffed`);
		if (claims > 0) parts.push(`${claims} ${claims === 1 ? 'claim' : 'claims'} to confirm`);
		return parts.join(' · ');
	}
</script>

<PageHeader title="Schedule" subtitle="Volunteering" backHref="/staff/volunteer">
	<NewShiftAction {defaultStart} />
</PageHeader>

<PageContent>
	<FilterBar
		activeCount={(roleFilter ? 1 : 0) + (range !== DEFAULT_WINDOW ? 1 : 0) + (shortOnly ? 1 : 0)}
		onclear={() => {
			roleFilter = '';
			range = DEFAULT_WINDOW;
			shortOnly = false;
		}}
	>
		<Select
			size="sm"
			aria-label="How far ahead"
			value={String(range)}
			onchange={(e: Event) => {
				range = parseRange((e.currentTarget as HTMLSelectElement).value);
			}}
		>
			{#each WINDOWS as w (w)}
				<option value={String(w)}>{windowLabel(w)}</option>
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

		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={shortOnly}
				onchange={(e) => (shortOnly = e.currentTarget.checked)}
			/>
			Short-staffed only
		</label>
	</FilterBar>

	{#await shifts then rows}
		{@const cancelled = rows.filter((s) => s.cancelledAt)}
		{@const live = rows.filter((s) => !s.cancelledAt)}
		{@const shown = shortOnly ? live.filter(isShort) : live}
		{@const groups = byDay(shown)}

		{#if live.length > 0}
			<p class="text-subtle text-sm">{summarize(live)}</p>
		{/if}

		{#if groups.length === 0}
			<EmptyState
				title="No shifts match that"
				description="Widen the window, or clear the filters."
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
						<th class="cell-num whitespace-nowrap">Staffing</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each group.rows as shift (shift.id)}
						{@const unconfirmed = shift.claimed - shift.confirmed}
						{@const full = shift.confirmed >= shift.capacity}
						{@const empty = shift.claimed === 0}
						<!-- Nobody on it at all is the one state worth seeing from across
						     the room, so it gets the row rather than a number. -->
						<tr class="hover {empty ? 'border-l-4 border-l-warning bg-warning/5' : ''}">
							<td class="whitespace-nowrap">
								<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium">
									{timeRange(shift.startsAt, shift.endsAt)}
								</a>
							</td>

							<td class="cell-primary">
								<a
									href={resolve(`/staff/volunteer/shifts/${shift.id}`)}
									class="link truncate font-medium"
								>
									{shift.roleName}
								</a>
								<!-- One subline, resolved by what the shift actually has:
								     the show it staffs, else the briefing, else the absence
								     of a show — which is information, not a blank. -->
								{#if shift.eventTitle}
									<div class="truncate">
										<a href={resolve(`/staff/events/${shift.eventId}`)} class="link text-info">
											{shift.eventTitle}
										</a>
									</div>
								{:else if shift.notes}
									<div class="truncate text-subtle" title={shift.notes}>{shift.notes}</div>
								{:else}
									<div class="truncate text-subtle">not tied to an event</div>
								{/if}
							</td>

							<td class="cell-num whitespace-nowrap">
								<span
									class:text-success={full}
									class:text-error={!full && shift.confirmed === 0}
									class:text-warning={!full && shift.confirmed > 0 && unconfirmed > 0}
								>
									{shift.confirmed} of {shift.capacity}
								</span>
								{#if unconfirmed > 0}
									<!-- The number the old list hid inside `claimed`. -->
									<span class="text-xs text-warning">· {unconfirmed} unconfirmed</span>
								{/if}
							</td>

							<td class="w-px">
								<div class="flex justify-end gap-1">
									{#if unconfirmed > 0}
										<Action
											label="Confirm {unconfirmed}"
											variant="ghost"
											size="xs"
											class="text-success"
											action={confirmShiftClaims.for(shift.id)}
											modalTitle="Confirm everyone on this shift?"
											submitLabel="Confirm all"
											successToast="Confirmed. They're booked."
										>
											{#snippet form()}
												<input type="hidden" name="shiftId" value={shift.id} />
												<p class="text-sm">
													{unconfirmed}
													{unconfirmed === 1 ? 'person has' : 'people have'} put a hand up for
													{shift.roleName} on {formatDateShort(shift.startsAt)}. Confirming books
													them: each gets the reminder the day before, and the shift completes
													afterwards with hours to log.
												</p>
											{/snippet}
										</Action>
									{/if}
									{#if !full}
										<AddVolunteerAction
											shiftId={shift.id}
											volunteerRoleId={shift.volunteerRoleId}
											roleName={shift.roleName}
											startsAt={shift.startsAt}
										/>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</Table>
			{/each}
		{/if}

		{#if cancelled.length > 0}
			<!-- Below the divider, not in the list: a called-off shift is not work
			     to staff, it is people to ring. The count is what is left of that. -->
			<div class="divider"></div>
			<ul class="space-y-1 text-sm">
				{#each cancelled as shift (shift.id)}
					<li>
						<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link">
							{formatDateShort(shift.startsAt)}
							{shift.roleName} cancelled
						</a>
						<span class:text-warning={shift.unnotified > 0} class="text-subtle">
							· {shift.unnotified > 0 ? `${shift.unnotified} to notify` : 'everybody notified'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/await}
</PageContent>
